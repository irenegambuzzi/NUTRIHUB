-- 029: "Shared" with each person's part in € (docs/plan-oct-2026.md "9K.
-- Shared parts"). Phase 1: Money "Add expense", "Edit expense" and SHOP
-- "Confirm purchase". Orders and order groups are not touched.
--
--   expenses.part_irene   what each of the two people paid of a Shared
--   expenses.part_akbar   expense, in € (cents). The names are the payer
--                         codes the app already uses (paid_by). Both empty
--                         = no parts (every existing expense, and Shared
--                         expenses saved without parts). Constraint
--                         expenses_parts_ok: both empty, or both filled and
--                         each >= 0.
--   confirm_shopping_trip(payload)   replaced ONLY so that a purchase line
--                         may send part_irene / part_akbar, which go onto
--                         the expense it inserts. Every other line is the
--                         023 version exactly; a payload without parts
--                         writes exactly what it writes today (both empty).
--
-- On purpose there is NO check that the parts add up to the amount, and NO
-- check that paid_by is 'shared': save_order_group (028) and "Edit order"
-- change an expense's amount, and 028 and the SHOP payer buttons change its
-- payer, without knowing about parts — such a check would make those saves
-- fail. The app treats parts as meaningful only while paid_by = 'shared',
-- and shows them scaled to a changed amount with a note to check them.
--
-- The columns, the constraint and the function are changed in ONE
-- transaction, so they are never half applied (the app takes "the columns
-- are there" to mean "the function writes them"). The app is deployed
-- before this file is run and works without it: before 029 "Shared" works
-- exactly as before (no part fields).
--
-- No other function, no table, policy or grant changes, and no data: every
-- existing expense keeps both parts empty. confirm_shopping_trip keeps its
-- signature, search_path = public, the household check (42501), security
-- invoker and its grants (create or replace keeps them: closed to anon and
-- public, open to authenticated). Nothing for anon. Safe to run twice.
-- The SELECT at the end is the check: every row must say ok.
--
-- Run in the Supabase SQL Editor.

begin;

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopping_trips' and column_name = 'source')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'expenses' and column_name = 'travel_id') then
    raise exception 'Run 023_oct_2026_features.sql first.';
  end if;
end $$;

-- ── 1. Each person's part of a Shared expense ────────────────────
alter table expenses add column if not exists part_irene numeric(12, 2);
alter table expenses add column if not exists part_akbar numeric(12, 2);

-- Both empty, or both filled and never below 0.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.expenses'::regclass and conname = 'expenses_parts_ok') then
    alter table expenses add constraint expenses_parts_ok
      check ((part_irene is null and part_akbar is null) or (part_irene is not null and part_akbar is not null and part_irene >= 0 and part_akbar >= 0));
  end if;
end $$;

-- ── 2. Confirm a purchase (SHOP and MONEY): the 023 function, plus ──
-- ── the parts of a line on its expense ───────────────────────────
-- payload as in 023. New, optional, on any line:
--   part_irene / part_akbar   each person's part of the line's expense
--                             (a Shared line; the app sends both or none,
--                             adding up to line_total). Not sent: both
--                             empty, exactly as before.
create or replace function confirm_shopping_trip(payload jsonb)
returns shopping_trips
language plpgsql
set search_path = public
as $$
declare
  v_trip shopping_trips;
  v_item jsonb;
  g grocery_items;
  pi pantry_items;
  v_date date := (payload->>'trip_date')::date;
  v_when timestamptz := coalesce((payload->>'at')::timestamptz, now());
  v_shop uuid := nullif(payload->>'shop_id', '')::uuid;
  v_paid text := nullif(payload->>'paid_by', '');
  -- 023: a purchase typed in MONEY; every other payload is a SHOP purchase.
  v_money boolean := coalesce(payload->>'source', '') = 'money';
  v_entry grocery_items;
  v_entry_id uuid;
  v_pantry uuid;
  v_created boolean;
  v_before jsonb;
  v_expense uuid;
  v_logs uuid[];
  v_log uuid;
  v_stock numeric;
  v_add numeric;
  v_discarded numeric;
  v_line numeric;
  v_total numeric := 0;
  v_position bigint;
  v_order orders;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  -- Already confirmed (the same confirmation sent again): nothing to do.
  select * into v_trip from shopping_trips where id = (payload->>'id')::uuid;
  if found then
    return v_trip;
  end if;

  -- 023: also where it was made, and the coupon (defaults: 'shop', none).
  insert into shopping_trips (id, trip_date, shop_id, paid_by, source, coupon_kind, coupon_value, coupon_total)
  values (
    (payload->>'id')::uuid, v_date, v_shop, v_paid,
    case when v_money then 'money' else 'shop' end,
    nullif(payload->>'coupon_kind', ''), (payload->>'coupon_value')::numeric, coalesce((payload->>'coupon_total')::numeric, 0)
  )
  returning * into v_trip;

  for v_item, v_position in select * from jsonb_array_elements(payload->'items') with ordinality loop
    if not v_money then
      select * into g from grocery_items where id = (v_item->>'grocery_item_id')::uuid for update;
      if not found then
        raise exception 'An item in the cart was deleted meanwhile — open the cart again.';
      end if;
      if g.completed then
        raise exception '"%" is already bought (confirmed on the other phone?) — open the cart again.', g.name;
      end if;
      -- Ordered online and on the way: buying it here too would record it twice.
      select * into v_order from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way' limit 1;
      if found then
        raise exception '"%" is already ordered online (on %), still on the way — cancel the order first, or take it out of the cart.', g.name, to_char(v_order.order_date, 'DD/MM/YYYY');
      end if;
    else
      -- 023: a line typed in MONEY has no SHOP entry: what was typed stands
      -- in for one, and every step below works on it the same way (nothing
      -- is written to grocery_items for it).
      g := jsonb_populate_record(null::grocery_items, jsonb_build_object(
        'name', btrim(coalesce(v_item->>'name', '')),
        'category_id', nullif(v_item->>'category_id', ''),
        'subcategory_id', nullif(v_item->>'subcategory_id', ''),
        'quantity', coalesce((v_item->>'quantity')::numeric, 1),
        'unit', coalesce(nullif(v_item->>'unit', ''), 'pcs'),
        'price', coalesce((v_item->>'price')::numeric, 0),
        'price_qty', (v_item->>'price_qty')::numeric,
        'price_unit', nullif(v_item->>'price_unit', ''),
        'payer', coalesce(nullif(v_item->>'payer', ''), v_paid, 'shared'),
        'one_time', coalesce((v_item->>'one_time')::boolean, false),
        'completed', false,
        'in_cart', false
      ));
      if g.name = '' then
        raise exception 'Every item needs a name.';
      end if;
    end if;

    v_pantry := null;
    v_created := false;
    v_before := null;
    v_expense := null;
    v_logs := '{}';
    v_entry_id := null;
    v_add := coalesce((v_item->>'add')::numeric, 0);
    v_discarded := 0;
    v_line := coalesce((v_item->>'line_total')::numeric, 0);

    if v_line > 0 then
      -- 023: also the trip away it belongs to (none unless sent).
      -- 029: also each person's part of a Shared line (both empty unless sent).
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id, shop_id, travel_id, part_irene, part_akbar)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id, v_shop, nullif(v_item->>'travel_id', '')::uuid, (v_item->>'part_irene')::numeric, (v_item->>'part_akbar')::numeric)
      returning id into v_expense;
      v_total := v_total + v_line;
    end if;

    if not coalesce((v_item->>'durable')::boolean, false) then
      v_pantry := (v_item->>'pantry_item_id')::uuid;
      if v_pantry is null then
        -- Same name as a pantry item (e.g. made by an earlier line of this
        -- purchase, or a finished 1× item, which comes back): that one,
        -- rather than a second item. Never a group: a group has no stock of
        -- its own, so a name equal to a group's makes (or finds) a normal
        -- item instead.
        select p.id into v_pantry from pantry_items p where lower(trim(p.name)) = lower(trim(g.name)) and not coalesce(p.is_group, false) order by p.created_at limit 1;
      end if;
      if v_pantry is not null then
        select * into pi from pantry_items where id = v_pantry for update;
        if not found then
          raise exception 'The pantry item for "%" was deleted meanwhile — open the cart again.', g.name;
        end if;
        v_before := jsonb_build_object(
          'price', pi.price, 'price_qty', pi.price_qty, 'price_unit', pi.price_unit, 'payer', pi.payer,
          'last_purchased_at', pi.last_purchased_at, 'expiry_date', pi.expiry_date,
          'packaging_unit', pi.packaging_unit, 'quantity_per_pack', pi.quantity_per_pack
        );
        v_stock := coalesce(pi.current_stock, 0);

        if coalesce((v_item->>'discard_expired')::boolean, false) and v_stock > 0 then
          v_discarded := v_stock;
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (pi.id, pi.name, -v_stock, 0, pi.unit, 'discarded') returning id into v_log;
          v_logs := v_logs || v_log;
          v_stock := 0;
        end if;

        v_stock := v_stock + v_add;
        update pantry_items set
          current_stock = v_stock,
          payer = coalesce(v_item->>'payer', g.payer, payer),
          last_purchased_at = v_when,
          price = case when coalesce(g.price, 0) > 0 then g.price else price end,
          price_qty = case when coalesce(g.price, 0) > 0 then g.price_qty else price_qty end,
          price_unit = case when coalesce(g.price, 0) > 0 then g.price_unit else price_unit end,
          expiry_date = case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date else expiry_date end,
          packaging_unit = coalesce(v_item->>'packaging_unit', packaging_unit),
          quantity_per_pack = coalesce((v_item->>'quantity_per_pack')::numeric, quantity_per_pack)
        where id = pi.id;

        if v_add <> 0 then
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (pi.id, pi.name, v_add, v_stock, pi.unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      else
        -- 023: a new item is 1× when its entry (or MONEY line) is, and gets
        -- the minimum sent (0 = the column's default, as before).
        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date, one_time, min_stock)
        values (
          trim(g.name), g.category_id, g.subcategory_id, v_add, g.unit,
          case when coalesce(g.price, 0) > 0 then g.price end,
          case when coalesce(g.price, 0) > 0 then g.price_qty end,
          case when coalesce(g.price, 0) > 0 then g.price_unit end,
          coalesce(v_item->>'payer', g.payer, 'shared'), v_when,
          case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date end,
          coalesce(g.one_time, false), coalesce((v_item->>'min_stock')::numeric, 0)
        )
        returning id into v_pantry;
        v_created := true;
        if v_add <> 0 then
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (v_pantry, trim(g.name), v_add, v_add, g.unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      end if;
    end if;

    -- 023: a MONEY line that really put stock into HOME closes the open
    -- SHOP entry for it (only one still "to buy": not in a cart, not ordered).
    if v_money and v_pantry is not null and v_add > 0 and nullif(v_item->>'list_entry_id', '') is not null then
      select * into v_entry from grocery_items where id = (v_item->>'list_entry_id')::uuid for update;
      if found and not v_entry.completed and not coalesce(v_entry.in_cart, false)
         and not exists (select 1 from orders o where o.grocery_item_id = v_entry.id and o.status = 'on_the_way') then
        update grocery_items set
          completed = true,
          in_cart = false,
          expense_id = v_expense,
          pantry_item_id = coalesce(v_pantry, pantry_item_id),
          trip_id = v_trip.id
        where id = v_entry.id;
        v_entry_id := v_entry.id;
      end if;
    end if;

    -- 023: also what kind of line, what was bought and its discounts.
    insert into shopping_trip_items (
      trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created,
      pantry_before, stock_added, stock_discarded, expense_id, log_ids,
      line_kind, quantity, unit, list_total, item_discount_kind, item_discount_value, coupon_share
    ) values (
      v_trip.id, v_position, case when v_money then v_entry_id else g.id end, to_jsonb(g), g.name, v_line, v_pantry, v_created,
      v_before, case when v_pantry is null then 0 else v_add end, v_discarded, v_expense, v_logs,
      case when v_money then 'money' else 'shop' end, g.quantity, g.unit,
      (v_item->>'list_total')::numeric, nullif(v_item->>'item_discount_kind', ''), (v_item->>'item_discount_value')::numeric,
      coalesce((v_item->>'coupon_share')::numeric, 0)
    );

    if not v_money then
      update grocery_items set
        completed = true,
        in_cart = false,
        expense_id = v_expense,
        pantry_item_id = coalesce(v_pantry, pantry_item_id),
        trip_id = v_trip.id
      where id = g.id;
    end if;
  end loop;

  update receipt_photos set trip_id = v_trip.id, receipt_date = v_date
  where id in (select value::uuid from jsonb_array_elements_text(coalesce(payload->'photo_ids', '[]'::jsonb)));

  update shopping_trips set total = v_total where id = v_trip.id returning * into v_trip;
  return v_trip;
end $$;

commit;

-- ── Check: every row must say ok ─────────────────────────────────
select n, object, status, detail from (
  select w.n, 'column ' || w.name as object,
    case when col.column_name is null then 'missing'
         when col.data_type = 'numeric' and col.numeric_scale = 2 and col.is_nullable = 'YES' and col.column_default is null then 'ok' else 'CHECK' end as status,
    coalesce(col.data_type || '(' || col.numeric_precision || ', ' || col.numeric_scale || ')' || case when col.is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || col.column_default, ''), '') as detail
  from (values (1, 'expenses.part_irene', 'part_irene'), (2, 'expenses.part_akbar', 'part_akbar')) as w(n, name, col)
  left join information_schema.columns col on col.table_schema = 'public' and col.table_name = 'expenses' and col.column_name = w.col

  union all
  select 3, 'expenses_parts_ok (both empty, or both >= 0)',
    case when exists (select 1 from pg_constraint where conrelid = 'public.expenses'::regclass and conname = 'expenses_parts_ok' and contype = 'c') then 'ok' else 'missing' end, ''

  union all
  select 4, 'function confirm_shopping_trip(jsonb)',
    case when p.oid is null then 'missing'
         when position('part_irene' in p.prosrc) > 0 and position('part_akbar' in p.prosrc) > 0
              and p.proconfig @> array['search_path=public'] and not p.prosecdef
              and position('is_household_member()' in p.prosrc) > 0 and position('42501' in p.prosrc) > 0
              and not has_function_privilege('anon', p.oid, 'execute')
              and has_function_privilege('authenticated', p.oid, 'execute') then 'ok' else 'CHECK' end,
    case when p.oid is null then '' else format('writes the parts: %s · search_path=public: %s · security invoker: %s · login check: %s · anon: %s',
      case when position('part_irene' in p.prosrc) > 0 and position('part_akbar' in p.prosrc) > 0 then 'yes' else 'NO' end,
      case when p.proconfig @> array['search_path=public'] then 'yes' else 'NO' end,
      case when p.prosecdef then 'NO (definer)' else 'yes' end,
      case when position('is_household_member()' in p.prosrc) > 0 then 'yes' else 'NO' end,
      case when has_function_privilege('anon', p.oid, 'execute') then 'CAN RUN IT' else 'none' end) end
  from (select to_regprocedure('public.confirm_shopping_trip(jsonb)') as oid) x left join pg_proc p on p.oid = x.oid

  union all
  select 5, 'expenses with parts (0 the first time)', 'ok',
    (select count(*) from expenses e where e.part_irene is not null)::text || ' of ' || (select count(*) from expenses)::text
) as checks
order by n;

-- End of 029
