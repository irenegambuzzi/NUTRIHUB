-- A group never receives stock directly.
--
-- confirm_shopping_trip(payload) (last written in 021) matches a SHOP item
-- that has no linked pantry item to a pantry item by name. When that name
-- was also the name of an item group, the purchase would have added the
-- stock to the group row itself instead of one of its variants.
--
-- This file replaces the function with exactly the same one, changed in a
-- single place: that name matching now skips group rows
-- (`and not coalesce(p.is_group, false)`). A name equal to a group's name
-- now finds a normal item of that name, or makes one. Everything else is
-- as in 021: the household-login check, the "already ordered online"
-- check, the store and payer, the stock and the expenses; the grants are
-- the same too (the household account only, never anon).
--
-- No table, column or row is touched: only the function is replaced. The
-- check at the end compares expenses, orders and every item's stock with
-- what they were when this file started.
-- Needs 021 to have been run. Safe to re-run.
--
-- Run in the Supabase SQL Editor.

do $$
begin
  if to_regprocedure('public.arrive_order(uuid, uuid, numeric, date)') is null then
    raise exception 'Run 021_connected_flow.sql first.';
  end if;
end $$;

-- What the data looks like right now, to compare at the end.
drop table if exists pg_temp._expenses_before;
create temp table _expenses_before as
  select id, amount, category_id, description, paid_by, expense_date, shop_id, trip_id from expenses;
drop table if exists pg_temp._orders_before;
create temp table _orders_before as
  select id, item_name, price, status, order_date, expense_id, arrived_date from orders;
drop table if exists pg_temp._stock_before;
create temp table _stock_before as
  select id, name, current_stock from pantry_items;

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

  insert into shopping_trips (id, trip_date, shop_id, paid_by) values ((payload->>'id')::uuid, v_date, v_shop, v_paid) returning * into v_trip;

  for v_item, v_position in select * from jsonb_array_elements(payload->'items') with ordinality loop
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

    v_pantry := null;
    v_created := false;
    v_before := null;
    v_expense := null;
    v_logs := '{}';
    v_add := coalesce((v_item->>'add')::numeric, 0);
    v_discarded := 0;
    v_line := coalesce((v_item->>'line_total')::numeric, 0);

    if v_line > 0 then
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id, shop_id)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id, v_shop)
      returning id into v_expense;
      v_total := v_total + v_line;
    end if;

    if not coalesce((v_item->>'durable')::boolean, false) then
      v_pantry := (v_item->>'pantry_item_id')::uuid;
      if v_pantry is null then
        -- Same name as a pantry item (e.g. made by an earlier line of this
        -- purchase): that one, rather than a second item. Never a group: a
        -- group has no stock of its own, so a name equal to a group's makes
        -- (or finds) a normal item instead.
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
        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date)
        values (
          trim(g.name), g.category_id, g.subcategory_id, v_add, g.unit,
          case when coalesce(g.price, 0) > 0 then g.price end,
          case when coalesce(g.price, 0) > 0 then g.price_qty end,
          case when coalesce(g.price, 0) > 0 then g.price_unit end,
          coalesce(v_item->>'payer', g.payer, 'shared'), v_when,
          case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date end
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

    insert into shopping_trip_items (
      trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created,
      pantry_before, stock_added, stock_discarded, expense_id, log_ids
    ) values (
      v_trip.id, v_position, g.id, to_jsonb(g), g.name, v_line, v_pantry, v_created,
      v_before, case when v_pantry is null then 0 else v_add end, v_discarded, v_expense, v_logs
    );

    update grocery_items set
      completed = true,
      in_cart = false,
      expense_id = v_expense,
      pantry_item_id = coalesce(v_pantry, pantry_item_id),
      trip_id = v_trip.id
    where id = g.id;
  end loop;

  update receipt_photos set trip_id = v_trip.id, receipt_date = v_date
  where id in (select value::uuid from jsonb_array_elements_text(coalesce(payload->'photo_ids', '[]'::jsonb)));

  update shopping_trips set total = v_total where id = v_trip.id returning * into v_trip;
  return v_trip;
end $$;

revoke execute on function confirm_shopping_trip(jsonb) from public, anon;
grant execute on function confirm_shopping_trip(jsonb) to authenticated;

-- ── Check: nothing existing may change ───────────────────────────
-- ── Expected: every *_before = *_now, totals equal, every *_changed ─
-- ── and *_lost 0, stock_changed 0, open_to_anon "none", ─────────────
-- ── skips_groups true ───────────────────────────────────────────────
select
  (select count(*) from _expenses_before) as expenses_before,
  (select count(*) from expenses) as expenses_now,
  (select coalesce(sum(amount), 0) from _expenses_before) as expenses_total_before,
  (select coalesce(sum(amount), 0) from expenses) as expenses_total_now,
  (select count(*) from _expenses_before b join expenses e using (id)
     where (e.amount, e.category_id, e.description, e.paid_by, e.expense_date, e.shop_id, e.trip_id)
           is distinct from (b.amount, b.category_id, b.description, b.paid_by, b.expense_date, b.shop_id, b.trip_id)) as expenses_changed,
  (select count(*) from _expenses_before b where not exists (select 1 from expenses e where e.id = b.id)) as expenses_lost,
  (select count(*) from _orders_before) as orders_before,
  (select count(*) from orders) as orders_now,
  (select coalesce(sum(price), 0) from _orders_before) as orders_total_before,
  (select coalesce(sum(price), 0) from orders) as orders_total_now,
  (select count(*) from _orders_before b where not exists (select 1 from orders o where o.id = b.id)
     or exists (select 1 from orders o where o.id = b.id and (o.item_name, o.price, o.status, o.order_date, o.expense_id, o.arrived_date)
                  is distinct from (b.item_name, b.price, b.status, b.order_date, b.expense_id, b.arrived_date))) as orders_changed,
  (select count(*) from _stock_before) as items_before,
  (select count(*) from pantry_items) as items_now,
  (select count(*) from _stock_before b where not exists (select 1 from pantry_items p where p.id = b.id)
     or exists (select 1 from pantry_items p where p.id = b.id and p.current_stock is distinct from b.current_stock)) as stock_changed,
  (select coalesce(string_agg(p.proname, ', '), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'confirm_shopping_trip'
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))) as open_to_anon,
  (select position('not coalesce(p.is_group, false)' in pg_get_functiondef('public.confirm_shopping_trip(jsonb)'::regprocedure)) > 0) as skips_groups;
