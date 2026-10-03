-- Shopping in two steps: a cart first, then one confirmation.
--
--   1. grocery_items.in_cart: tapping an item in the shop only puts it in
--      the cart (or takes it out). Nothing else changes until the
--      purchase is confirmed. completed keeps meaning "bought": items
--      checked off before this change stay bought, and their stock
--      (already in the pantry) is never added again.
--   2. shopping_trips: one confirmed purchase, dated by the shopping day.
--      The app makes its id, so sending the same confirmation twice saves
--      it once. receipt_match is for a later automatic comparison of the
--      receipt with the cart, and stays empty for now.
--   3. shopping_trip_items: what the confirmation did for each item
--      (stock added and thrown away, the pantry item as it was before,
--      the expense and history it wrote), so it can be undone exactly.
--   4. trip_id on grocery_items, expenses and receipt_photos.
--   5. confirm_shopping_trip(payload): does everything for the cart in one
--      transaction — expenses dated by the shopping day, new pantry items,
--      stock (throwing expired stock away where asked), history, items
--      marked bought, receipt photos linked. All or nothing.
--   6. reopen_shopping_trip(trip_id): undoes a confirmed purchase in one
--      transaction — stock, history and expenses go back, pantry items it
--      created are removed, and the items return to the cart.
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

-- ── 1–4. Columns and tables ──────────────────────────────────────
alter table grocery_items add column if not exists in_cart boolean not null default false;

create table if not exists shopping_trips (
  id uuid primary key,
  trip_date date not null,
  total numeric not null default 0,
  receipt_match jsonb,
  created_at timestamptz not null default now()
);

create table if not exists shopping_trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references shopping_trips(id) on delete cascade,
  position integer not null default 0,
  grocery_item_id uuid references grocery_items(id) on delete set null,
  grocery_snapshot jsonb not null,
  name text not null,
  line_total numeric not null default 0,
  pantry_item_id uuid references pantry_items(id) on delete set null,
  pantry_created boolean not null default false,
  pantry_before jsonb,
  stock_added numeric not null default 0,
  stock_discarded numeric not null default 0,
  expense_id uuid references expenses(id) on delete set null,
  log_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- (position was added after a first draft; harmless if already there)
alter table shopping_trip_items add column if not exists position integer not null default 0;

create index if not exists shopping_trip_items_trip_idx on shopping_trip_items (trip_id);

alter table grocery_items add column if not exists trip_id uuid references shopping_trips(id) on delete set null;
alter table expenses add column if not exists trip_id uuid references shopping_trips(id) on delete set null;
alter table receipt_photos add column if not exists trip_id uuid references shopping_trips(id) on delete set null;

grant all on shopping_trips, shopping_trip_items to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['shopping_trips', 'shopping_trip_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public_access" on %I', t);
    execute format('create policy "public_access" on %I for all using (true) with check (true)', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 5. Confirm a purchase ────────────────────────────────────────
-- payload: {
--   id: uuid (made by the app), trip_date: 'YYYY-MM-DD', at: timestamp,
--   photo_ids: [uuid],
--   items: [{
--     grocery_item_id, line_total, payer, expense_category_id,
--     durable: bool          -- appliances: an expense only, no stock
--     pantry_item_id         -- null: a new pantry item is made
--     add                    -- stock to add, in the pantry item's unit
--     discard_expired: bool  -- throw the current (expired) stock away first
--     expiry_date            -- present = set it (null clears it)
--     packaging_unit, quantity_per_pack   -- a pack size given now
--   }]
-- }
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
begin
  -- Already confirmed (the same confirmation sent again): nothing to do.
  select * into v_trip from shopping_trips where id = (payload->>'id')::uuid;
  if found then
    return v_trip;
  end if;

  insert into shopping_trips (id, trip_date) values ((payload->>'id')::uuid, v_date) returning * into v_trip;

  for v_item, v_position in select * from jsonb_array_elements(payload->'items') with ordinality loop
    select * into g from grocery_items where id = (v_item->>'grocery_item_id')::uuid for update;
    if not found then
      raise exception 'An item in the cart was deleted meanwhile — open the cart again.';
    end if;
    if g.completed then
      raise exception '"%" is already bought (confirmed on the other phone?) — open the cart again.', g.name;
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
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id)
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

-- ── 6. Reopen (undo) a purchase ──────────────────────────────────
-- Returns how many items went back to the cart (0 if the purchase no
-- longer exists, e.g. already reopened on the other phone).
create or replace function reopen_shopping_trip(trip_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  ti shopping_trip_items;
  v_count integer := 0;
  v_snapshot jsonb;
begin
  perform 1 from shopping_trips t where t.id = reopen_shopping_trip.trip_id for update;
  if not found then
    return 0;
  end if;

  -- Last line first, so a pantry item changed by several lines ends up
  -- exactly as it was before the first.
  for ti in select * from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id order by i.position desc loop
    if ti.pantry_item_id is not null then
      if ti.pantry_created then
        delete from pantry_items where id = ti.pantry_item_id;
      else
        update pantry_items p set
          current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added) + ti.stock_discarded,
          price = (ti.pantry_before->>'price')::numeric,
          price_qty = (ti.pantry_before->>'price_qty')::numeric,
          price_unit = ti.pantry_before->>'price_unit',
          payer = ti.pantry_before->>'payer',
          last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,
          expiry_date = (ti.pantry_before->>'expiry_date')::date,
          packaging_unit = ti.pantry_before->>'packaging_unit',
          quantity_per_pack = (ti.pantry_before->>'quantity_per_pack')::numeric
        where p.id = ti.pantry_item_id;
      end if;
    end if;

    delete from stock_logs where id = any(ti.log_ids);
    if ti.expense_id is not null then
      delete from expenses where id = ti.expense_id;
    end if;

    if ti.grocery_item_id is not null then
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

  delete from shopping_trips t where t.id = reopen_shopping_trip.trip_id;
  return v_count;
end $$;

grant execute on function confirm_shopping_trip(jsonb) to anon, authenticated;
grant execute on function reopen_shopping_trip(uuid) to anon, authenticated;
