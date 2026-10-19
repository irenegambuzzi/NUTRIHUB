-- Everything the database needs for rounds 2–8 of docs/plan-oct-2026.md,
-- in one file. Read that plan for the why of each part.
--
--   A. grocery_items.cart_added_at: when an entry went into the cart, so
--      the cart and Confirm purchase list the oldest first. Set and cleared
--      by the database itself (trigger grocery_items_cart_time) on every
--      path that puts an entry in or out of the cart. Entries in the cart
--      right now get their created_at (the only backfill in this file).
--   B. One-time purchases ("1×"): pantry_items.one_time and
--      grocery_items.one_time. Every existing row stays not 1×. A group can
--      never be 1× (pantry_items_one_time_not_group).
--   C. pantry_items.shop_dismissed_at: a variant of a group taken off the
--      SHOP list by hand stays off until it is restocked; the database
--      clears it as soon as the stock is above 0 (trigger
--      pantry_items_shop_dismissed).
--   D. Purchases entered in MONEY reuse shopping_trips / shopping_trip_items:
--      shopping_trips.source ('shop' | 'money' | 'merged'),
--      shopping_trip_items.line_kind ('shop' | 'money') and the details of
--      each line (quantity, unit, normal price before discounts, discounts).
--   E. Discounts: per line (percent or €), a coupon for the whole purchase
--      (spread over the lines by the app), and for orders (per order only).
--   F. Old expenses merged into one purchase: expenses.merged_at and
--      expenses.shop_before_merge. A merged expense is never a line of the
--      purchase, so nothing that undoes a purchase can delete it.
--   G. Travel ("Trips" in the app; "trip" already means a shopping trip in
--      the database): table travels and expenses.travel_id.
--   H. AI, off until there is an API key: household_settings (with
--      ai_suggestions = false), ai_model_chain (seeded, read-only for the
--      app), ai_category_proposals (reviewed by hand), and
--      category_memory.expense_category_id / .source.
--   I. Functions:
--        confirm_shopping_trip(payload)          replaced: SHOP purchases
--          exactly as in 022; also MONEY purchases (payload.source =
--          'money'), and the new optional details (1× of a new item, its
--          minimum, discounts, travel)
--        reopen_shopping_trip(trip_id)           replaced: SHOP purchases
--          exactly as before; MONEY lines; never deletes a merged expense;
--          refuses a purchase made by merging (that is Split)
--        merge_expenses_into_purchase(payload)   new (Merge)
--        split_merged_purchase(trip_id, ids)     new (Split)
--        merge_inventory_category(from, to)      new (HOME Manage: delete a
--          category that is in use = move everything to another one)
--        move_inventory_subcategory(id, parent)  new (HOME Manage: move a
--          sub-category with its items)
--        grocery_items_cart_time()               new trigger function (A)
--        pantry_items_shop_dismissed()           new trigger function (C)
--
-- Only tables, columns, constraints, indexes, triggers and functions are
-- added, and two functions are replaced with the same signature. No table
-- or column is dropped, no row is deleted. The only data written: A's
-- backfill (entries in the cart get cart_added_at = created_at), the
-- setting ai_suggestions = false and the AI model chain rows (inserted
-- only if missing). Every new table is locked like the others after 015:
-- one policy "household_only" for the logged-in household account, nothing
-- for anon, live sync on. Every new or replaced function checks the
-- household login itself and is closed to anon.
--
-- Needs 015, 018, 019 and 021 to have been run (022 is replaced by this
-- file's confirm_shopping_trip, which keeps its change). Safe to re-run.
-- The SELECT at the end is the check: every row must say ok = true.
--
-- Run in the Supabase SQL Editor.

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pantry_items' and column_name = 'is_group') then
    raise exception 'Run 018_item_groups.sql first.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.shops') is null then
    raise exception 'Run 019_stores_and_orders.sql first.';
  end if;
  if to_regprocedure('public.arrive_order(uuid, uuid, numeric, date)') is null or to_regclass('public.category_budget_map') is null then
    raise exception 'Run 021_connected_flow.sql first.';
  end if;
end $$;

-- ── G (first, others point to it). Travel ────────────────────────
-- A trip away ("🌴 Holiday" or "🚗 Short trip"). Its period runs from
-- start_date to end_date, or to ended_on when it was ended early.
create table if not exists travels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'holiday' check (kind in ('holiday', 'short')),
  start_date date not null,
  end_date date not null,
  ended_on date,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (ended_on is null or (ended_on >= start_date and ended_on <= end_date))
);

-- ── A. When an entry went into the cart ──────────────────────────
alter table grocery_items add column if not exists cart_added_at timestamptz;

-- What is in the cart now: in the order it was added to the list.
update grocery_items set cart_added_at = created_at where in_cart and cart_added_at is null;

-- ── B. One-time purchases ────────────────────────────────────────
alter table pantry_items add column if not exists one_time boolean not null default false;
-- Nullable on purpose: a SHOP entry put back by Reopen from a snapshot
-- taken before this file has no value for it (read as "not 1×").
alter table grocery_items add column if not exists one_time boolean default false;

-- ── C. A variant taken off the SHOP list by hand ─────────────────
alter table pantry_items add column if not exists shop_dismissed_at timestamptz;

-- ── D, E. Purchases from SHOP and MONEY, with their details ───────
alter table shopping_trips add column if not exists source text not null default 'shop' check (source in ('shop', 'money', 'merged'));
alter table shopping_trips add column if not exists coupon_kind text;
alter table shopping_trips add column if not exists coupon_value numeric;
alter table shopping_trips add column if not exists coupon_total numeric not null default 0 check (coupon_total >= 0);

alter table shopping_trip_items add column if not exists line_kind text not null default 'shop' check (line_kind in ('shop', 'money'));
alter table shopping_trip_items add column if not exists quantity numeric;
alter table shopping_trip_items add column if not exists unit text;
-- The normal price of the line, as on the receipt before any discount.
alter table shopping_trip_items add column if not exists list_total numeric check (list_total >= 0);
alter table shopping_trip_items add column if not exists item_discount_kind text;
alter table shopping_trip_items add column if not exists item_discount_value numeric;
-- This line's part of the purchase coupon, in €.
alter table shopping_trip_items add column if not exists coupon_share numeric not null default 0 check (coupon_share >= 0);

alter table orders add column if not exists list_price numeric check (list_price >= 0);
alter table orders add column if not exists discount_kind text;
alter table orders add column if not exists discount_value numeric;

-- A discount is a percent (0–100) or an amount in € (0 or more).
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('shopping_trip_items', 'shopping_trip_items_discount_ok', 'item_discount_kind', 'item_discount_value'),
      ('shopping_trips', 'shopping_trips_coupon_ok', 'coupon_kind', 'coupon_value'),
      ('orders', 'orders_discount_ok', 'discount_kind', 'discount_value')
    ) as v(tab, name, kind, val)
  loop
    if not exists (select 1 from pg_constraint where conrelid = ('public.' || c.tab)::regclass and conname = c.name) then
      execute format(
        'alter table public.%I add constraint %I check (%I is null or (%I in (''percent'', ''amount'') and %I >= 0 and (%I = ''amount'' or %I <= 100)))',
        c.tab, c.name, c.kind, c.kind, c.val, c.kind, c.val
      );
    end if;
  end loop;
end $$;

-- ── F, G. Expenses: merged into a purchase; part of a trip away ───
alter table expenses add column if not exists merged_at timestamptz;
alter table expenses add column if not exists shop_before_merge uuid references shops(id) on delete set null;
alter table expenses add column if not exists travel_id uuid references travels(id) on delete set null;

create index if not exists expenses_travel_id_idx on expenses (travel_id) where travel_id is not null;
create index if not exists expenses_trip_id_idx on expenses (trip_id) where trip_id is not null;

-- A group can never be 1× (its variants can).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pantry_items'::regclass and conname = 'pantry_items_one_time_not_group') then
    alter table pantry_items add constraint pantry_items_one_time_not_group check (not (is_group and one_time));
  end if;
end $$;

-- ── H. AI (off until there is an API key) ────────────────────────
-- Household settings, one row per setting.
create table if not exists household_settings (
  key text primary key check (length(btrim(key)) > 0),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into household_settings (key, value) values ('ai_suggestions', 'false'::jsonb)
on conflict (key) do nothing;

-- Which model answers each kind of question, tried in order of position;
-- an inactive row is skipped. New models are added at the end (the next
-- position). The app only shows this list: it can't change it.
create table if not exists ai_model_chain (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('light', 'medium', 'heavy', 'photo')),
  position integer not null check (position > 0),
  model text not null check (length(btrim(model)) > 0),
  active boolean not null default true,
  web_search boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  unique (level, position),
  unique (level, model)
);

insert into ai_model_chain (level, position, model, web_search, note) values
  ('light', 1, 'claude-haiku-5-5', false, 'One new item name → its category'),
  ('light', 2, 'claude-sonnet-5-5', false, 'One new item name → its category'),
  ('light', 3, 'claude-opus-5-5', false, 'One new item name → its category'),
  ('medium', 1, 'claude-sonnet-5-5', true, 'Unknown product: may search the web'),
  ('medium', 2, 'claude-opus-5-5', true, 'Unknown product: may search the web'),
  ('heavy', 1, 'claude-opus-5-5', false, 'Review all categories: cross-check every item'),
  ('photo', 1, 'claude-sonnet-5-5', false, 'Receipt photos (later)')
on conflict do nothing;

-- "Review all categories with AI": each proposal waits for Approve or
-- Reject; nothing changes by itself.
create table if not exists ai_category_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  pantry_item_id uuid references pantry_items(id) on delete cascade,
  item_name text not null,
  from_category_id text references inventory_categories(id) on delete set null,
  from_subcategory_id text references inventory_categories(id) on delete set null,
  to_category_id text references inventory_categories(id) on delete cascade,
  to_subcategory_id text references inventory_categories(id) on delete set null,
  -- A category that doesn't exist yet: it is only made when Create is pressed.
  new_category_name text,
  new_category_parent_id text references inventory_categories(id) on delete cascade,
  reason text,
  model text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (to_category_id is not null or new_category_name is not null)
);

create index if not exists ai_category_proposals_run_idx on ai_category_proposals (run_id);

-- The remembered category of a name: also its budget category (for things
-- bought in MONEY that aren't in HOME), and who chose it.
alter table category_memory add column if not exists expense_category_id uuid references expense_categories(id) on delete set null;
alter table category_memory add column if not exists source text not null default 'user' check (source in ('user', 'ai'));

-- ── Locked to the household, live sync on ────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['travels', 'household_settings', 'ai_model_chain', 'ai_category_proposals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household_only" on public.%I', t);
    execute format(
      'create policy "household_only" on public.%I for all to authenticated using (public.is_household_member()) with check (public.is_household_member())',
      t
    );
    execute format('revoke all on public.%I from anon', t);
    if t = 'ai_model_chain' then
      -- Shown in the app, changed only here in the SQL Editor.
      execute format('revoke all on public.%I from authenticated', t);
      execute format('grant select on public.%I to authenticated', t);
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── A. Trigger: the time an entry went into the cart ─────────────
create or replace function grocery_items_cart_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only for the household's account (see is_household_member). The table's
  -- own policy already says so; the SQL Editor (not a logged-in user) is
  -- never stopped.
  if current_user in ('anon', 'authenticated') and not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  if coalesce(new.in_cart, false) then
    if tg_op = 'UPDATE' and coalesce(old.in_cart, false) then
      -- Still in the cart: it keeps its time.
      new.cart_added_at := coalesce(new.cart_added_at, old.cart_added_at, now());
    else
      -- Just put in the cart (by a tap, by Reopen, …): the time the app
      -- sent (the tap, also when sent later without signal), else now.
      new.cart_added_at := coalesce(new.cart_added_at, now());
    end if;
  else
    new.cart_added_at := null;
  end if;
  return new;
end $$;

-- ── C. Trigger: restocked, so it may come back to SHOP later ──────
create or replace function pantry_items_shop_dismissed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only for the household's account (see is_household_member); the SQL
  -- Editor is never stopped (as above).
  if current_user in ('anon', 'authenticated') and not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  if new.shop_dismissed_at is not null and coalesce(new.current_stock, 0) > 0 then
    new.shop_dismissed_at := null;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.grocery_items'::regclass and tgname = 'grocery_items_cart_time') then
    create trigger grocery_items_cart_time before insert or update on grocery_items
      for each row execute function grocery_items_cart_time();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pantry_items'::regclass and tgname = 'pantry_items_shop_dismissed') then
    create trigger pantry_items_shop_dismissed before insert or update on pantry_items
      for each row execute function pantry_items_shop_dismissed();
  end if;
end $$;

-- ── I. Confirm a purchase (SHOP, and now MONEY) ──────────────────
-- payload as in 021/022 for SHOP. Lines marked "023" are new; with a
-- payload the app sends today they do exactly what 022 did.
--   payload.source        'money': a purchase typed in MONEY (every line
--                         without a SHOP entry). Anything else: SHOP.
--   payload.coupon_kind / coupon_value / coupon_total   the coupon of the
--                         whole purchase (optional)
--   every line, optional:
--     travel_id           the trip away its expense belongs to
--     min_stock           the minimum of an item it creates in HOME
--     list_total          the normal price of the line before discounts
--     item_discount_kind / item_discount_value / coupon_share
--   a MONEY line instead of grocery_item_id:
--     name, category_id, subcategory_id, quantity, unit, price, price_qty,
--     price_unit, payer, one_time   (what was typed; "durable": true when
--                         "Add to HOME" is off: an expense only)
--     list_entry_id       an open SHOP entry for it: it leaves the list
--                         when the stock really went into HOME
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
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id, shop_id, travel_id)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id, v_shop, nullif(v_item->>'travel_id', '')::uuid)
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

-- ── I. Reopen (undo) a purchase ──────────────────────────────────
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

-- ── I. Merge single expenses into one purchase ───────────────────
-- payload: {
--   id: uuid            the new purchase (made by the app; sending it twice
--                       makes it once). Ignored with trip_id.
--   trip_id: uuid       or: an existing purchase to add them to
--   expense_ids: [uuid] single expenses (no purchase, no order), all of
--                       the same day and the same payer
--   shop_id: uuid       the store of a new purchase (optional; if they all
--                       share one store, that one)
-- }
-- Their amount, category, date, payer and trip away never change; each
-- one takes the purchase's store (the one it had is kept for Split).
create or replace function merge_expenses_into_purchase(payload jsonb)
returns shopping_trips
language plpgsql
set search_path = public
as $$
declare
  v_trip shopping_trips;
  v_target uuid := nullif(payload->>'trip_id', '')::uuid;
  v_shop uuid := nullif(payload->>'shop_id', '')::uuid;
  v_ids uuid[];
  v_found integer;
  v_dates integer;
  v_payers integer;
  v_shops integer;
  v_date date;
  v_payer text;
  v_one_shop uuid;
  v_sum numeric;
  v_bad text;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(payload->'expense_ids', '[]'::jsonb));

  if v_target is null then
    -- Already merged (the same request sent again): nothing to do.
    select * into v_trip from shopping_trips where id = (payload->>'id')::uuid;
    if found then
      return v_trip;
    end if;
    if cardinality(v_ids) < 2 then
      raise exception 'Pick at least two expenses to merge into one purchase.';
    end if;
  else
    select * into v_trip from shopping_trips t where t.id = v_target for update;
    if not found then
      raise exception 'That purchase was deleted meanwhile — open the list again.';
    end if;
  end if;

  perform 1 from expenses e where e.id = any(v_ids) for update;
  select count(*) into v_found from expenses e where e.id = any(v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'An expense was deleted meanwhile — open the list again.';
  end if;

  if v_target is not null then
    -- Already added (the same request sent again): only the others count.
    v_ids := array(select e.id from expenses e where e.id = any(v_ids) and e.trip_id is distinct from v_target);
    if cardinality(v_ids) = 0 then
      return v_trip;
    end if;
  end if;

  -- Only single expenses: not part of a purchase, never an order's.
  select string_agg(format('"%s"', coalesce(e.description, 'an expense')), ', ') into v_bad
  from expenses e
  where e.id = any(v_ids)
    and (e.trip_id is not null or exists (select 1 from shopping_trip_items i where i.expense_id = e.id));
  if v_bad is not null then
    raise exception '% is already part of a purchase — only single expenses can be merged.', v_bad;
  end if;
  select string_agg(format('"%s"', coalesce(e.description, 'an expense')), ', ') into v_bad
  from expenses e
  where e.id = any(v_ids) and exists (select 1 from orders o where o.expense_id = e.id);
  if v_bad is not null then
    raise exception '% is an online order — orders can''t be merged.', v_bad;
  end if;

  select count(distinct e.expense_date), count(distinct e.paid_by), count(distinct e.shop_id),
         min(e.expense_date), min(e.paid_by), (array_agg(e.shop_id) filter (where e.shop_id is not null))[1], sum(e.amount)
  into v_dates, v_payers, v_shops, v_date, v_payer, v_one_shop, v_sum
  from expenses e where e.id = any(v_ids);
  if v_dates > 1 then
    raise exception 'Only expenses of the same day can be merged into one purchase.';
  end if;
  if v_payers > 1 then
    raise exception 'Only expenses paid by the same person can be merged into one purchase.';
  end if;

  if v_target is not null then
    if v_trip.trip_date <> v_date then
      raise exception 'That purchase is on %, these expenses on % — only the same day can be merged.', to_char(v_trip.trip_date, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY');
    end if;
    if (v_trip.paid_by is not null and v_trip.paid_by <> v_payer)
       or exists (select 1 from expenses e where e.trip_id = v_target and e.paid_by <> v_payer) then
      raise exception 'That purchase was paid by someone else — only the same payer can be merged.';
    end if;
    v_shop := coalesce(v_trip.shop_id, v_shop);
  else
    -- Every expense at the same store: that is the purchase's store.
    if v_shop is null and v_shops = 1 and not exists (select 1 from expenses e where e.id = any(v_ids) and e.shop_id is null) then
      v_shop := v_one_shop;
    end if;
    insert into shopping_trips (id, trip_date, shop_id, paid_by, total, source)
    values ((payload->>'id')::uuid, v_date, v_shop, v_payer, 0, 'merged')
    returning * into v_trip;
  end if;

  update expenses e set
    shop_before_merge = e.shop_id,
    merged_at = now(),
    trip_id = v_trip.id,
    shop_id = coalesce(v_shop, e.shop_id)
  where e.id = any(v_ids);

  update shopping_trips t set total = t.total + coalesce(v_sum, 0), shop_id = coalesce(t.shop_id, v_shop)
  where t.id = v_trip.id
  returning * into v_trip;
  return v_trip;
end $$;

-- ── I. Split: merged expenses become single expenses again ────────
-- expense_ids null = every merged expense of the purchase. Each gets back
-- the store it had. A purchase made only by merging, with nothing left in
-- it, is gone too. Returns how many expenses were split off.
create or replace function split_merged_purchase(trip_id uuid, expense_ids uuid[] default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_source text;
  v_count integer;
  v_sum numeric;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select t.source into v_source from shopping_trips t where t.id = split_merged_purchase.trip_id for update;
  if not found then
    return 0;
  end if;

  with moved as (
    update expenses e set trip_id = null, shop_id = e.shop_before_merge, shop_before_merge = null, merged_at = null
    where e.trip_id = split_merged_purchase.trip_id and e.merged_at is not null
      and (split_merged_purchase.expense_ids is null or e.id = any(split_merged_purchase.expense_ids))
    returning e.amount
  )
  select count(*), coalesce(sum(amount), 0) into v_count, v_sum from moved;

  update shopping_trips t set total = greatest(0, t.total - v_sum) where t.id = split_merged_purchase.trip_id;

  if v_source = 'merged'
     and not exists (select 1 from expenses e where e.trip_id = split_merged_purchase.trip_id)
     and not exists (select 1 from shopping_trip_items i where i.trip_id = split_merged_purchase.trip_id) then
    delete from shopping_trips t where t.id = split_merged_purchase.trip_id;
  end if;
  return v_count;
end $$;

-- ── I. HOME Manage: delete a category in use = move it all ───────
-- Everything in `from_id` moves to `to_id` in one go, then `from_id` is
-- deleted: the items, the open SHOP entries and the remembered names. A
-- main category moving to a main category takes its sub-categories along.
-- Its own budget mapping goes with it (the items then follow the target's).
-- Stock, expenses, colours and icons don't change. "Home & Appliances"
-- can't be deleted, and nothing moves into or out of it (its items never
-- have stock). Returns { items, list_entries, memory, subcategories }.
create or replace function merge_inventory_category(from_id text, to_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  f inventory_categories;
  t inventory_categories;
  v_subs integer := 0;
  v_items integer := 0;
  v_entries integer := 0;
  v_memory integer := 0;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  if from_id is not distinct from to_id then
    raise exception 'Pick another category to move everything to.';
  end if;
  select * into f from inventory_categories c where c.id = merge_inventory_category.from_id for update;
  if not found then
    raise exception 'This category no longer exists.';
  end if;
  select * into t from inventory_categories c where c.id = merge_inventory_category.to_id for update;
  if not found then
    raise exception 'The category to move everything to no longer exists.';
  end if;
  if f.id = 'appliances' then
    raise exception '"%" can''t be deleted (it can be renamed).', f.name;
  end if;
  if (coalesce(f.parent_id, f.id) = 'appliances') <> (coalesce(t.parent_id, t.id) = 'appliances') then
    raise exception 'Home & Appliances items never have stock: move them only within Home & Appliances.';
  end if;
  if t.parent_id = f.id then
    raise exception '"%" is a sub-category of "%" — pick a category outside it.', t.name, f.name;
  end if;

  if f.parent_id is null then
    select count(*) into v_subs from inventory_categories c where c.parent_id = f.id;
    if t.parent_id is null then
      -- Main → main: its sub-categories go along, with their items.
      update inventory_categories c set parent_id = t.id where c.parent_id = f.id;
      update pantry_items p set category_id = t.id where p.category_id = f.id;
      get diagnostics v_items = row_count;
      update grocery_items g set category_id = t.id where g.category_id = f.id;
      get diagnostics v_entries = row_count;
      update category_memory m set category_id = t.id where m.category_id = f.id;
      get diagnostics v_memory = row_count;
    else
      if v_subs > 0 then
        raise exception '"%" has sub-categories — move it to a main category, so they can go along.', f.name;
      end if;
      -- Main (no sub-categories) → a sub-category.
      update pantry_items p set category_id = t.parent_id, subcategory_id = t.id where p.category_id = f.id;
      get diagnostics v_items = row_count;
      update grocery_items g set category_id = t.parent_id, subcategory_id = t.id where g.category_id = f.id;
      get diagnostics v_entries = row_count;
      update category_memory m set category_id = t.parent_id, subcategory_id = t.id where m.category_id = f.id;
      get diagnostics v_memory = row_count;
    end if;
  else
    -- A sub-category → a main category (no sub-category) or another sub-category.
    update pantry_items p set category_id = coalesce(t.parent_id, t.id), subcategory_id = case when t.parent_id is null then null else t.id end
    where p.subcategory_id = f.id;
    get diagnostics v_items = row_count;
    update grocery_items g set category_id = coalesce(t.parent_id, t.id), subcategory_id = case when t.parent_id is null then null else t.id end
    where g.subcategory_id = f.id;
    get diagnostics v_entries = row_count;
    update category_memory m set category_id = coalesce(t.parent_id, t.id), subcategory_id = case when t.parent_id is null then null else t.id end
    where m.subcategory_id = f.id;
    get diagnostics v_memory = row_count;
  end if;

  delete from inventory_categories c where c.id = f.id;
  return jsonb_build_object('items', v_items, 'list_entries', v_entries, 'memory', v_memory, 'subcategories', v_subs);
end $$;

-- ── I. HOME Manage: move a sub-category with its items ───────────
-- parent_id: the main category it goes under; null = it becomes a main
-- category. A main category with no sub-categories can also become a
-- sub-category; one with sub-categories can't. The items, open SHOP
-- entries and remembered names follow (their main category changes, the
-- sub-category stays the same row, with its own budget mapping). "Home &
-- Appliances" can't be moved, and nothing moves into or out of it.
-- Returns { items, list_entries, memory }.
create or replace function move_inventory_subcategory(sub_id text, parent_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s inventory_categories;
  p inventory_categories;
  v_items integer := 0;
  v_entries integer := 0;
  v_memory integer := 0;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select * into s from inventory_categories c where c.id = move_inventory_subcategory.sub_id for update;
  if not found then
    raise exception 'This category no longer exists.';
  end if;
  if s.id = 'appliances' then
    raise exception '"%" can''t be moved (it can be renamed).', s.name;
  end if;
  if move_inventory_subcategory.parent_id is not null then
    select * into p from inventory_categories c where c.id = move_inventory_subcategory.parent_id for update;
    if not found or p.parent_id is not null then
      raise exception 'Pick a main category to move it to.';
    end if;
    if p.id = s.id then
      raise exception 'A category can''t go inside itself.';
    end if;
  end if;
  if (coalesce(s.parent_id, s.id) = 'appliances') <> (coalesce(move_inventory_subcategory.parent_id, s.id) = 'appliances') then
    raise exception 'Home & Appliances items never have stock: move them only within Home & Appliances.';
  end if;
  if s.parent_id is not distinct from move_inventory_subcategory.parent_id then
    return jsonb_build_object('items', 0, 'list_entries', 0, 'memory', 0);
  end if;

  if s.parent_id is null then
    if exists (select 1 from inventory_categories c where c.parent_id = s.id) then
      raise exception '"%" has sub-categories — a main category with sub-categories can''t become a sub-category.', s.name;
    end if;
    -- A main category (no sub-categories) becomes a sub-category of p.
    update inventory_categories c set parent_id = p.id, type = 'sub',
      sort_order = coalesce((select max(x.sort_order) from inventory_categories x where x.parent_id = p.id), 0) + 1
    where c.id = s.id;
    update pantry_items i set category_id = p.id, subcategory_id = s.id where i.category_id = s.id;
    get diagnostics v_items = row_count;
    update grocery_items g set category_id = p.id, subcategory_id = s.id where g.category_id = s.id;
    get diagnostics v_entries = row_count;
    update category_memory m set category_id = p.id, subcategory_id = s.id where m.category_id = s.id;
    get diagnostics v_memory = row_count;
  elsif move_inventory_subcategory.parent_id is null then
    -- A sub-category becomes a main category, at the end of the shop order.
    update inventory_categories c set parent_id = null, type = 'parent',
      sort_order = coalesce((select max(x.sort_order) from inventory_categories x where x.parent_id is null), 0) + 1
    where c.id = s.id;
    update pantry_items i set category_id = s.id, subcategory_id = null where i.subcategory_id = s.id;
    get diagnostics v_items = row_count;
    update grocery_items g set category_id = s.id, subcategory_id = null where g.subcategory_id = s.id;
    get diagnostics v_entries = row_count;
    update category_memory m set category_id = s.id, subcategory_id = null where m.subcategory_id = s.id;
    get diagnostics v_memory = row_count;
  else
    -- A sub-category moves under another main category.
    update inventory_categories c set parent_id = p.id,
      sort_order = coalesce((select max(x.sort_order) from inventory_categories x where x.parent_id = p.id), 0) + 1
    where c.id = s.id;
    update pantry_items i set category_id = p.id where i.subcategory_id = s.id;
    get diagnostics v_items = row_count;
    update grocery_items g set category_id = p.id where g.subcategory_id = s.id;
    get diagnostics v_entries = row_count;
    update category_memory m set category_id = p.id where m.subcategory_id = s.id;
    get diagnostics v_memory = row_count;
  end if;

  return jsonb_build_object('items', v_items, 'list_entries', v_entries, 'memory', v_memory);
end $$;

-- ── Function access: the household account only, never anon ─────
revoke execute on function confirm_shopping_trip(jsonb) from public, anon;
grant execute on function confirm_shopping_trip(jsonb) to authenticated;
revoke execute on function reopen_shopping_trip(uuid) from public, anon;
grant execute on function reopen_shopping_trip(uuid) to authenticated;
revoke execute on function merge_expenses_into_purchase(jsonb) from public, anon;
grant execute on function merge_expenses_into_purchase(jsonb) to authenticated;
revoke execute on function split_merged_purchase(uuid, uuid[]) from public, anon;
grant execute on function split_merged_purchase(uuid, uuid[]) to authenticated;
revoke execute on function merge_inventory_category(text, text) from public, anon;
grant execute on function merge_inventory_category(text, text) to authenticated;
revoke execute on function move_inventory_subcategory(text, text) from public, anon;
grant execute on function move_inventory_subcategory(text, text) to authenticated;
revoke execute on function grocery_items_cart_time() from public, anon;
grant execute on function grocery_items_cart_time() to authenticated;
revoke execute on function pantry_items_shop_dismissed() from public, anon;
grant execute on function pantry_items_shop_dismissed() to authenticated;

-- ── Check: every row must say ok = true ──────────────────────────
-- ── 1 new tables · 2 new columns · 3 new/changed functions · ─────
-- ── 4 the AI model chain · 5 the data (first run: as written) ────
select section, name, ok, detail from (
  select '1 new table' as section, w.name, 10 as sort,
    coalesce(c.relrowsecurity, false)
      and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = w.name) = 1
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = w.name and p.policyname = 'household_only'
                    and p.cmd = 'ALL' and p.roles = array['authenticated']::name[]
                    and p.qual like '%is_household_member()%' and p.with_check like '%is_household_member()%')
      and not (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
               or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
      and has_table_privilege('authenticated', c.oid, 'select')
      and (w.name = 'ai_model_chain') <> has_table_privilege('authenticated', c.oid, 'insert')
      and exists (select 1 from pg_publication_tables r where r.pubname = 'supabase_realtime' and r.schemaname = 'public' and r.tablename = w.name) as ok,
    case when c.oid is null then 'MISSING' else format('RLS %s · policy %s · anon: none · app: %s · realtime: %s',
      case when c.relrowsecurity then 'on' else 'OFF' end,
      coalesce((select string_agg(p.policyname, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = w.name), 'NONE'),
      case when w.name = 'ai_model_chain' then 'read only' else 'read and write' end,
      case when exists (select 1 from pg_publication_tables r where r.pubname = 'supabase_realtime' and r.schemaname = 'public' and r.tablename = w.name) then 'on' else 'OFF' end) end as detail
  from (values ('travels'), ('household_settings'), ('ai_model_chain'), ('ai_category_proposals')) as w(name)
  left join pg_class c on c.oid = to_regclass('public.' || w.name)

  union all
  select '2 new column', w.tab || '.' || w.col, 20, col.column_name is not null,
    coalesce(col.data_type || case when col.is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || col.column_default, ''), 'MISSING')
  from (values
    ('grocery_items', 'cart_added_at'), ('grocery_items', 'one_time'),
    ('pantry_items', 'one_time'), ('pantry_items', 'shop_dismissed_at'),
    ('shopping_trips', 'source'), ('shopping_trips', 'coupon_kind'), ('shopping_trips', 'coupon_value'), ('shopping_trips', 'coupon_total'),
    ('shopping_trip_items', 'line_kind'), ('shopping_trip_items', 'quantity'), ('shopping_trip_items', 'unit'), ('shopping_trip_items', 'list_total'),
    ('shopping_trip_items', 'item_discount_kind'), ('shopping_trip_items', 'item_discount_value'), ('shopping_trip_items', 'coupon_share'),
    ('expenses', 'merged_at'), ('expenses', 'shop_before_merge'), ('expenses', 'travel_id'),
    ('orders', 'list_price'), ('orders', 'discount_kind'), ('orders', 'discount_value'),
    ('category_memory', 'expense_category_id'), ('category_memory', 'source')
  ) as w(tab, col)
  left join information_schema.columns col on col.table_schema = 'public' and col.table_name = w.tab and col.column_name = w.col

  union all
  select '3 function', w.sig, 30,
    p.oid is not null
      and p.proconfig @> array['search_path=public']
      and position('is_household_member()' in p.prosrc) > 0
      and position('42501' in p.prosrc) > 0
      and not has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute'),
    case when p.oid is null then 'MISSING' else format('%s · search_path=public: %s · login check: %s · anon: %s',
      w.what,
      case when p.proconfig @> array['search_path=public'] then 'yes' else 'NO' end,
      case when position('is_household_member()' in p.prosrc) > 0 then 'yes' else 'NO' end,
      case when has_function_privilege('anon', p.oid, 'execute') then 'CAN RUN IT' else 'none' end) end
  from (values
    ('confirm_shopping_trip(jsonb)', 'replaced'), ('reopen_shopping_trip(uuid)', 'replaced'),
    ('merge_expenses_into_purchase(jsonb)', 'new'), ('split_merged_purchase(uuid,uuid[])', 'new'),
    ('merge_inventory_category(text,text)', 'new'), ('move_inventory_subcategory(text,text)', 'new'),
    ('grocery_items_cart_time()', 'new trigger function'), ('pantry_items_shop_dismissed()', 'new trigger function')
  ) as w(sig, what)
  left join pg_proc p on p.oid = to_regprocedure('public.' || w.sig)

  union all
  select '4 AI model chain', m.level || ' #' || m.position, 40, m.active,
    m.model || case when m.web_search then ' · web search' else '' end || case when m.active then '' else ' · INACTIVE' end || coalesce(' · ' || m.note, '')
  from ai_model_chain m

  union all
  select '5 data', 'cart entries without cart_added_at', 50, count(*) = 0, count(*) || ' (must be 0)'
  from grocery_items where in_cart and cart_added_at is null
  union all
  select '5 data', 'triggers', 51, count(*) = 2, string_agg(tgname::text, ', ')
  from pg_trigger where tgname in ('grocery_items_cart_time', 'pantry_items_shop_dismissed') and not tgisinternal
  union all
  select '5 data', 'AI suggestions setting', 52, exists (select 1 from household_settings where key = 'ai_suggestions'),
    coalesce((select value::text from household_settings where key = 'ai_suggestions'), 'MISSING') || ' (false until there is an API key)'
  union all
  select '5 data', '1× items', 53, true, count(*) || ' (0 the first time: no item becomes 1× by itself)'
  from pantry_items where one_time
  union all
  select '5 data', 'merged expenses · expenses in a trip away', 54, true,
    (select count(*) from expenses where merged_at is not null) || ' · ' || (select count(*) from expenses where travel_id is not null) || ' (0 · 0 the first time)'
) as checks
order by sort, section, name;
