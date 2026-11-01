-- 031: Reopen / Undo purchase of an item a purchase created, and unit
-- changes after a purchase or an arrival (docs/plan-oct-2026.md "9M.
-- Reopen of items a purchase created").
--
--   reopen_shopping_trip(trip_id)   replaced, starting from the 023
--                         version (the last one). Changed ONLY for a line
--                         with a HOME item:
--                         (a) the line's stock is converted from the unit
--                         it was counted in (the line's stock_unit, 030;
--                         for an older line the unit of its own "Bought"
--                         history row, else the line's own unit, then only
--                         when it is the item's unit) to the item's unit
--                         now: the same unit → as is; kg ↔ gr, L ↔ ml →
--                         × 1000 / ÷ 1000; the item's usual pack
--                         (packaging_unit = that unit) → × its size. No
--                         conversion → the stock is not touched at all;
--                         (b) an item the line CREATED, with no stock or
--                         order from elsewhere (another line's history row
--                         that put stock in, another purchase's line, any
--                         order) → deleted with ALL its history and its
--                         automatic "to buy" SHOP entries (never one in a
--                         cart, ordered online, typed by hand, or of a line
--                         of this purchase); with stock or an order from
--                         elsewhere → kept, only this line's stock taken
--                         out (a);
--                         (c) an existing item whose unit changed after the
--                         purchase keeps its usual pack size now, and a
--                         price the purchase found without a unit is put
--                         back per the unit it was counted in then;
--                         (d) an existing item that had a complete usual
--                         size before the purchase (packaging_unit and
--                         quantity_per_pack > 0, the 9H first-time rule: a
--                         purchase never overwrites one) keeps its usual
--                         size now too (K33); without one, it is put back
--                         from before the purchase, as today.
--                         Lines without a unit change: exactly the 023
--                         text.
--   unarrive_order(order_id)        replaced, starting from the 021 version
--                         (the last one). Changed ONLY: the arrival's stock
--                         is converted the same way, from the unit of the
--                         arrival's own history row (orders.arrived_log_id;
--                         no row → the item's unit, as today). No
--                         conversion → the stock is not touched.
--
-- Both keep their signature and return type (integer / orders): the app
-- reads the purchase lines and items before the call and the items after
-- it, and says when a created item was kept or stock could not be taken
-- out. An older app version on the other phone calls them exactly as
-- before. Same search_path = public, the household check (42501), security
-- invoker and their grants (create or replace keeps them: closed to anon
-- and public, open to authenticated). No other function, no table, policy
-- or grant changes, and no data. Safe to run twice. Nothing for anon.
-- The SELECT at the end is the check: every row must say ok.
--
-- Run in the Supabase SQL Editor, after 030.

begin;

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopping_trip_items' and column_name = 'stock_unit') then
    raise exception 'Run 030_new_item_units.sql first.';
  end if;
end $$;

-- ── 1. Reopen (undo) a purchase: the 023 function, plus units and ──
-- ── the items it created ──────────────────────────────────────────
-- Returns how many lines were undone (for a SHOP purchase: how many items
-- went back to the cart, as before); 0 if the purchase no longer exists.
create or replace function reopen_shopping_trip(trip_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  ti shopping_trip_items;
  v_count integer := 0;
  v_snapshot jsonb;
  v_source text;
  -- 031: the line's item, the unit the line counted its stock in, the
  -- factor to the item's unit now (null: can't be converted), whether a
  -- created item got stock or an order from elsewhere, and the history
  -- rows of every line of this purchase (never "from elsewhere").
  pi pantry_items;
  v_unit text;
  v_factor numeric;
  v_elsewhere boolean;
  v_trip_logs uuid[];
  -- 031 (K33): the item keeps its usual pack size of now.
  v_keep_pack boolean;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select t.source into v_source from shopping_trips t where t.id = reopen_shopping_trip.trip_id for update;
  if not found then
    return 0;
  end if;
  -- 023: a purchase made by merging old expenses can't be reopened: those
  -- expenses existed before it and must never be deleted. Split undoes it.
  if v_source = 'merged' then
    raise exception 'This purchase was made by merging expenses — use Split to undo it. Nothing was changed.';
  end if;
  -- 031: every history row written by a line of this purchase.
  select coalesce(array_agg(l.id), '{}') into v_trip_logs
  from shopping_trip_items i cross join lateral unnest(i.log_ids) as l(id)
  where i.trip_id = reopen_shopping_trip.trip_id;

  -- Last line first, so a pantry item changed by several lines ends up
  -- exactly as it was before the first.
  for ti in select * from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id order by i.position desc loop
    if ti.pantry_item_id is not null then
      -- 031: the item is locked; one deleted meanwhile is skipped (as before).
      select * into pi from pantry_items p where p.id = ti.pantry_item_id for update;
      if found then
        -- 031: the unit the line counted its stock in: stock_unit (030), else
        -- its own "Bought" row's; without either, the line's unit, only as is.
        v_unit := coalesce(ti.stock_unit, (select l.unit from stock_logs l where l.id = any(ti.log_ids) and l.reason = 'purchased' order by l.created_at limit 1));
        v_factor := case
          when v_unit is null then case when ti.unit is not distinct from pi.unit then 1 end
          when v_unit is not distinct from pi.unit then 1
          when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000
          when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001
          when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack
        end;
        v_unit := coalesce(v_unit, ti.unit);
        -- 031: stock or an order from elsewhere: a history row of another line
        -- that put stock in (a "Unit changed" row only when its numbers are
        -- not a plain conversion), another purchase's line, any order.
        v_elsewhere := ti.pantry_created and (
          exists (select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.change > 0 and l.reason <> 'converted')
          or exists (
            select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.reason = 'converted'
              and not exists (
                select 1 from unnest(array[1, 1000, 0.001, pi.quantity_per_pack]) as f(n)
                where f.n > 0 and l.new_stock - l.change >= 0
                  and abs(l.new_stock - (l.new_stock - l.change) * f.n) <= 0.0001 * greatest(abs(l.new_stock), 1)
              )
          )
          or exists (select 1 from shopping_trip_items o where o.pantry_item_id = pi.id and o.trip_id <> reopen_shopping_trip.trip_id)
          or exists (select 1 from orders o where o.pantry_item_id = pi.id or o.arrived_item_id = pi.id)
        );
        if ti.pantry_created and not v_elsewhere then
          -- 031: "this purchase never happened": its automatic "to buy" SHOP
          -- entries (as the HOME trash; never one of this purchase's lines),
          -- all its history, then the item.
          delete from grocery_items g
          where g.pantry_item_id = pi.id and g.auto_generated and not g.completed and not coalesce(g.in_cart, false)
            and not exists (select 1 from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way')
            and not exists (select 1 from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id and i.grocery_item_id = g.id);
          delete from stock_logs l where l.item_id = pi.id;
          delete from pantry_items where id = ti.pantry_item_id;
        elsif ti.pantry_created then
          -- 031: kept: only this line's stock comes out (none if it can't be
          -- converted); the other history rows stay.
          if v_factor is not null then
            update pantry_items p set current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor)
            where p.id = pi.id;
          end if;
        else
          -- 031: converted (not at all if it can't be); a unit changed after
          -- the purchase keeps the usual pack size of now. So does a usual
          -- size complete before the purchase (K33): a purchase never
          -- overwrites one (9H), so one different now was changed by hand.
          v_keep_pack := v_unit is distinct from pi.unit
            or (coalesce(ti.pantry_before->>'packaging_unit', '') <> '' and coalesce((ti.pantry_before->>'quantity_per_pack')::numeric, 0) > 0);
          update pantry_items p set
            current_stock = case when v_factor is null then p.current_stock
                                 else greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor) + ti.stock_discarded * v_factor end,
            price = (ti.pantry_before->>'price')::numeric,
            price_qty = (ti.pantry_before->>'price_qty')::numeric,
            price_unit = case when v_unit is distinct from p.unit and ti.pantry_before->>'price' is not null
                              then coalesce(ti.pantry_before->>'price_unit', v_unit) else ti.pantry_before->>'price_unit' end,
            payer = ti.pantry_before->>'payer',
            last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,
            expiry_date = (ti.pantry_before->>'expiry_date')::date,
            packaging_unit = case when v_keep_pack then p.packaging_unit else ti.pantry_before->>'packaging_unit' end,
            quantity_per_pack = case when v_keep_pack then p.quantity_per_pack else (ti.pantry_before->>'quantity_per_pack')::numeric end
          where p.id = pi.id;
        end if;
      end if;
    end if;

    delete from stock_logs where id = any(ti.log_ids);
    if ti.expense_id is not null then
      -- 023: never an expense merged into the purchase (a merged expense is
      -- never a line; this only makes sure).
      delete from expenses e where e.id = ti.expense_id and e.merged_at is null;
    end if;

    if ti.line_kind = 'money' then
      -- 023: a line typed in MONEY has no cart to go back to. The SHOP entry
      -- it closed (if any) is "to buy" again.
      if ti.grocery_item_id is not null then
        update grocery_items set completed = false, in_cart = false, expense_id = null, trip_id = null
        where id = ti.grocery_item_id;
      end if;
    elsif ti.grocery_item_id is not null then
      update grocery_items set completed = false, in_cart = true, expense_id = null, trip_id = null
      where id = ti.grocery_item_id;
    else
      -- The entry was deleted meanwhile: put it back as it was.
      v_snapshot := ti.grocery_snapshot || jsonb_build_object('completed', false, 'in_cart', true, 'expense_id', null, 'trip_id', null);
      if not exists (select 1 from pantry_items where id = (v_snapshot->>'pantry_item_id')::uuid) then
        v_snapshot := v_snapshot || jsonb_build_object('pantry_item_id', null);
      end if;
      insert into grocery_items select * from jsonb_populate_record(null::grocery_items, v_snapshot);
    end if;
    v_count := v_count + 1;
  end loop;

  -- 023: expenses merged into this purchase are never deleted: they become
  -- single expenses again, with the store they had before.
  update expenses e set trip_id = null, shop_id = e.shop_before_merge, shop_before_merge = null, merged_at = null
  where e.trip_id = reopen_shopping_trip.trip_id and e.merged_at is not null;

  delete from shopping_trips t where t.id = reopen_shopping_trip.trip_id;
  return v_count;
end $$;

-- ── 2. Back on the way: the 021 function, plus units ─────────────
create or replace function unarrive_order(order_id uuid)
returns orders
language plpgsql
set search_path = public
as $$
declare
  o orders;
  v_stock numeric;
  pi pantry_items;
  -- 031: the unit the arrival counted its stock in, and the factor to the
  -- item's unit now (null: can't be converted).
  v_unit text;
  v_factor numeric;
begin
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select * into o from orders where id = unarrive_order.order_id for update;
  if not found then
    raise exception 'This order was deleted meanwhile.';
  end if;
  if o.status <> 'arrived' then
    return o;
  end if;

  if o.arrived_item_id is not null and o.stock_added > 0 then
    select * into pi from pantry_items where id = o.arrived_item_id for update;
    if found then
      -- 031: the unit of the arrival's own history row (none: the item's).
      v_unit := coalesce((select l.unit from stock_logs l where l.id = o.arrived_log_id), pi.unit);
      v_factor := case
        when v_unit is not distinct from pi.unit then 1
        when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000
        when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001
        when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack
      end;
      if v_factor is not null then
        v_stock := greatest(0, coalesce(pi.current_stock, 0) - o.stock_added * v_factor);
        update pantry_items set current_stock = v_stock where id = pi.id;
      end if;
    end if;
  end if;
  if o.arrived_log_id is not null then
    delete from stock_logs where id = o.arrived_log_id;
  end if;

  update orders set status = 'on_the_way', arrived_date = null, stock_added = 0, arrived_item_id = null, arrived_log_id = null
  where id = o.id
  returning * into o;

  if o.grocery_item_id is not null then
    update grocery_items set completed = false where id = o.grocery_item_id and trip_id is null;
  end if;
  return o;
end $$;

commit;

-- ── Check: every row must say ok ─────────────────────────────────
select n, object, status, detail from (
  select c.n, 'function reopen_shopping_trip(uuid): ' || c.what as object,
    case when p.oid is null then 'missing' when c.ok then 'ok' else 'CHECK' end as status,
    case when p.oid is null then '' else c.detail end as detail
  from (select to_regprocedure('public.reopen_shopping_trip(uuid)') as oid) x
  left join pg_proc p on p.oid = x.oid
  cross join lateral (values
    (1, 'converts the line''s stock to the item''s unit (031)', position('v_factor' in coalesce(p.prosrc, '')) > 0 and position('ti.stock_unit' in coalesce(p.prosrc, '')) > 0, ''),
    (2, 'a created item untouched: all its history goes with it', position('delete from stock_logs l where l.item_id = pi.id' in coalesce(p.prosrc, '')) > 0, ''),
    (3, 'a created item untouched: its automatic "to buy" entries go too', position('g.auto_generated' in coalesce(p.prosrc, '')) > 0, ''),
    (4, 'returns integer', coalesce(pg_get_function_result(p.oid) = 'integer', false), coalesce(pg_get_function_result(p.oid), '')),
    (5, 'search_path = public', coalesce(p.proconfig @> array['search_path=public'], false), coalesce(array_to_string(p.proconfig, ', '), '')),
    (6, 'security invoker', not coalesce(p.prosecdef, true), case when p.prosecdef then 'definer' else 'invoker' end),
    (7, 'household check (42501)', position('is_household_member()' in coalesce(p.prosrc, '')) > 0 and position('42501' in coalesce(p.prosrc, '')) > 0, ''),
    (8, 'anon none, authenticated can run it', p.oid is not null and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'),
      case when p.oid is null then '' when has_function_privilege('anon', p.oid, 'execute') then 'anon CAN RUN IT' else 'anon: none' end)
  ) as c(n, what, ok, detail)

  union all
  select c.n, 'function unarrive_order(uuid): ' || c.what,
    case when p.oid is null then 'missing' when c.ok then 'ok' else 'CHECK' end,
    case when p.oid is null then '' else c.detail end
  from (select to_regprocedure('public.unarrive_order(uuid)') as oid) x
  left join pg_proc p on p.oid = x.oid
  cross join lateral (values
    (9, 'converts the arrival''s stock to the item''s unit (031)', position('v_factor' in coalesce(p.prosrc, '')) > 0 and position('o.arrived_log_id), pi.unit)' in coalesce(p.prosrc, '')) > 0, ''),
    (10, 'returns orders', coalesce(pg_get_function_result(p.oid) = 'orders', false), coalesce(pg_get_function_result(p.oid), '')),
    (11, 'search_path = public', coalesce(p.proconfig @> array['search_path=public'], false), coalesce(array_to_string(p.proconfig, ', '), '')),
    (12, 'security invoker', not coalesce(p.prosecdef, true), case when p.prosecdef then 'definer' else 'invoker' end),
    (13, 'household check (42501)', position('is_household_member()' in coalesce(p.prosrc, '')) > 0 and position('42501' in coalesce(p.prosrc, '')) > 0, ''),
    (14, 'anon none, authenticated can run it', p.oid is not null and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'),
      case when p.oid is null then '' when has_function_privilege('anon', p.oid, 'execute') then 'anon CAN RUN IT' else 'anon: none' end)
  ) as c(n, what, ok, detail)
) as checks
order by n;

-- End of 031
