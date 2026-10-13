-- HOME, SHOP, Orders and MONEY as one flow.
--
--   1. shopping_trips.shop_id and paid_by: a confirmed purchase is one
--      trip at one store, paid by one person (or "mixed" = empty). Every
--      existing trip stays as it is, with both empty; its expenses keep
--      their own store.
--   2. pantry_items.usual_shop_id: where an item is usually bought ("Usually
--      bought at"). An online store means the item is normally ordered.
--      Empty for every existing item.
--   3. orders linked to HOME and SHOP: pantry_item_id (the item or group),
--      grocery_item_id (the SHOP list entry), quantity and unit ordered,
--      and what "Arrived" added (stock_added, arrived_item_id,
--      arrived_log_id). At most one order on the way per SHOP list entry.
--      Empty for every existing order: those keep working as before.
--   4. category_budget_map: which budget (expense) category an item
--      category or sub-category is booked under. Empty: until something is
--      chosen, purchases are booked exactly as before (Groceries, or Home &
--      Appliances for appliances).
--   5. confirm_shopping_trip(payload): as before, plus the trip's store and
--      payer (put on the trip and on its expenses), and it refuses an item
--      that is already ordered online and on the way (no double purchase).
--   6. arrive_order(order_id, item_id, add_qty, arrived_on): marks a linked
--      order as arrived and adds the stock in one transaction. Only the
--      first call does anything: pressing Arrived twice, or on two phones
--      at once, adds the stock once. It never makes an expense.
--   7. unarrive_order(order_id): puts an arrived order back on the way and
--      takes out exactly the stock its arrival added.
--
-- Only tables, columns, an index and functions are added. No existing row
-- is changed or deleted. The new table is locked like every other table
-- after 015: only the logged-in household account can read or change it
-- (policy "household_only"); the anon key gets nothing. Live sync between
-- the phones is on for it. The functions check the household login too.
-- Needs 015, 018 and 019 to have been run. Until this file has been run
-- the app works exactly as before and says so where the new features
-- would be. Safe to re-run.
--
-- Run in the Supabase SQL Editor.

do $$
begin
  if to_regclass('public.orders') is null or to_regclass('public.shops') is null then
    raise exception 'Run 019_stores_and_orders.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pantry_items' and column_name = 'is_group') then
    raise exception 'Run 018_item_groups.sql first.';
  end if;
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
end $$;

-- What the data looks like right now, to compare at the end.
drop table if exists pg_temp._expenses_before;
create temp table _expenses_before as
  select id, amount, category_id, description, paid_by, expense_date, shop_id, trip_id from expenses;
drop table if exists pg_temp._income_before;
create temp table _income_before as
  select id, amount, income_date, received_by from income;
drop table if exists pg_temp._orders_before;
create temp table _orders_before as
  select id, item_name, price, status, order_date, expense_id, arrived_date from orders;
drop table if exists pg_temp._stock_before;
create temp table _stock_before as
  select id, name, current_stock from pantry_items;

-- ── 1. The store and payer of a shopping trip ────────────────────
alter table shopping_trips add column if not exists shop_id uuid references shops(id) on delete set null;
alter table shopping_trips add column if not exists paid_by text;

-- ── 2. Where an item is usually bought ───────────────────────────
alter table pantry_items add column if not exists usual_shop_id uuid references shops(id) on delete set null;

-- ── 3. Orders linked to HOME and SHOP ────────────────────────────
alter table orders add column if not exists pantry_item_id uuid references pantry_items(id) on delete set null;
alter table orders add column if not exists grocery_item_id uuid references grocery_items(id) on delete set null;
alter table orders add column if not exists quantity numeric;
alter table orders add column if not exists unit text;
alter table orders add column if not exists stock_added numeric not null default 0;
alter table orders add column if not exists arrived_item_id uuid references pantry_items(id) on delete set null;
alter table orders add column if not exists arrived_log_id uuid;

-- At most one order on the way per SHOP list entry.
create unique index if not exists orders_open_grocery_key on orders (grocery_item_id)
  where grocery_item_id is not null and status = 'on_the_way';
create index if not exists orders_pantry_item_idx on orders (pantry_item_id) where pantry_item_id is not null;

-- ── 4. Item category → budget category ───────────────────────────
-- id is the item category (or sub-category) id.
create table if not exists category_budget_map (
  id text primary key references inventory_categories(id) on delete cascade,
  expense_category_id uuid not null references expense_categories(id) on delete cascade,
  updated_at timestamptz not null default now()
);

do $$
begin
  execute 'alter table public.category_budget_map enable row level security';
  execute 'drop policy if exists "household_only" on public.category_budget_map';
  execute 'create policy "household_only" on public.category_budget_map for all to authenticated using (public.is_household_member()) with check (public.is_household_member())';
  execute 'revoke all on public.category_budget_map from anon';
  execute 'grant select, insert, update, delete on public.category_budget_map to authenticated';
  -- Live sync between the two phones.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'category_budget_map'
  ) then
    execute 'alter publication supabase_realtime add table public.category_budget_map';
  end if;
end $$;

-- ── 5. Confirm a purchase: one store, one payer, no double purchase ─
-- payload as in 014, plus shop_id and paid_by (both optional).
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
        -- purchase): that one, rather than a second item.
        select p.id into v_pantry from pantry_items p where lower(trim(p.name)) = lower(trim(g.name)) order by p.created_at limit 1;
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

-- ── 6. A linked order arrived: stock added once ──────────────────
-- item_id: the item (or the group's variant) that gets the stock, in its
-- own unit (`add_qty`); null or 0 adds nothing. Returns { order, added }:
-- added is false when the order wasn't on the way any more (already
-- arrived, e.g. on the other phone) and nothing was changed.
create or replace function arrive_order(order_id uuid, item_id uuid, add_qty numeric, arrived_on date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  o orders;
  pi pantry_items;
  v_stock numeric;
  v_log uuid;
  v_add numeric := coalesce(arrive_order.add_qty, 0);
begin
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  -- The order row is locked: a second Arrived waits here, then sees it arrived.
  select * into o from orders where id = arrive_order.order_id for update;
  if not found then
    raise exception 'This order was deleted meanwhile.';
  end if;
  if o.status <> 'on_the_way' then
    return jsonb_build_object('order', to_jsonb(o), 'added', false);
  end if;

  if arrive_order.item_id is not null and v_add > 0 then
    select * into pi from pantry_items where id = arrive_order.item_id for update;
    if not found then
      raise exception 'The item for this order was deleted meanwhile.';
    end if;
    if pi.is_group then
      raise exception 'Pick which variant of "%" arrived.', pi.name;
    end if;
    v_stock := coalesce(pi.current_stock, 0) + v_add;
    update pantry_items set current_stock = v_stock, last_purchased_at = now() where id = pi.id;
    insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
    values (pi.id, pi.name, v_add, v_stock, pi.unit, 'purchased') returning id into v_log;
  else
    v_add := 0;
  end if;

  update orders set
    status = 'arrived',
    arrived_date = coalesce(arrive_order.arrived_on, current_date),
    stock_added = v_add,
    arrived_item_id = case when v_add > 0 then arrive_order.item_id end,
    arrived_log_id = v_log
  where id = o.id
  returning * into o;

  -- It leaves the SHOP list: bought (by ordering).
  if o.grocery_item_id is not null then
    update grocery_items set completed = true, in_cart = false where id = o.grocery_item_id;
  end if;

  return jsonb_build_object('order', to_jsonb(o), 'added', true);
end $$;

-- ── 7. Back on the way: the arrival's stock taken out again ──────
create or replace function unarrive_order(order_id uuid)
returns orders
language plpgsql
set search_path = public
as $$
declare
  o orders;
  v_stock numeric;
  pi pantry_items;
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
      v_stock := greatest(0, coalesce(pi.current_stock, 0) - o.stock_added);
      update pantry_items set current_stock = v_stock where id = pi.id;
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

revoke execute on function confirm_shopping_trip(jsonb) from public, anon;
grant execute on function confirm_shopping_trip(jsonb) to authenticated;
revoke execute on function arrive_order(uuid, uuid, numeric, date) from public, anon;
grant execute on function arrive_order(uuid, uuid, numeric, date) to authenticated;
revoke execute on function unarrive_order(uuid) from public, anon;
grant execute on function unarrive_order(uuid) to authenticated;

-- ── Check: nothing existing may change ───────────────────────────
-- ── Expected: every *_before = *_now, totals equal, every *_changed ─
-- ── and *_lost 0, stock_changed 0, new_columns true, ─────────────
-- ── open_to_anon "none", locked_to_household true, realtime_on true ─
select
  (select count(*) from _expenses_before) as expenses_before,
  (select count(*) from expenses) as expenses_now,
  (select coalesce(sum(amount), 0) from _expenses_before) as expenses_total_before,
  (select coalesce(sum(amount), 0) from expenses) as expenses_total_now,
  (select count(*) from _expenses_before b join expenses e using (id)
     where (e.amount, e.category_id, e.description, e.paid_by, e.expense_date, e.shop_id, e.trip_id)
           is distinct from (b.amount, b.category_id, b.description, b.paid_by, b.expense_date, b.shop_id, b.trip_id)) as expenses_changed,
  (select count(*) from _expenses_before b where not exists (select 1 from expenses e where e.id = b.id)) as expenses_lost,
  (select count(*) from _income_before) as income_before,
  (select count(*) from income) as income_now,
  (select coalesce(sum(amount), 0) from _income_before) as income_total_before,
  (select coalesce(sum(amount), 0) from income) as income_total_now,
  (select count(*) from _income_before b where not exists (select 1 from income i where i.id = b.id)
     or exists (select 1 from income i where i.id = b.id and (i.amount, i.income_date, i.received_by) is distinct from (b.amount, b.income_date, b.received_by))) as income_changed,
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
  (select count(*) = 12 from information_schema.columns
     where table_schema = 'public' and (
       (table_name = 'shopping_trips' and column_name in ('shop_id', 'paid_by'))
       or (table_name = 'pantry_items' and column_name = 'usual_shop_id')
       or (table_name = 'orders' and column_name in ('pantry_item_id', 'grocery_item_id', 'quantity', 'unit', 'stock_added', 'arrived_item_id', 'arrived_log_id'))
       or (table_name = 'category_budget_map' and column_name in ('id', 'expense_category_id'))
     )) as new_columns,
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('category_budget_map', 'orders', 'shopping_trips', 'pantry_items')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as open_to_anon,
  (select count(*) = 1 from pg_policies
     where schemaname = 'public' and tablename = 'category_budget_map' and policyname = 'household_only') as locked_to_household,
  (select count(*) = 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'category_budget_map') as realtime_on;
