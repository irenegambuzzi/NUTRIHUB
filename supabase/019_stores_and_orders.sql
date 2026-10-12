-- Money: where things were bought ("Bought at"), and online orders.
--
--   1. shops: the list of stores (name + online yes/no), managed like
--      categories. Called "shops" in the database only so it isn't mixed
--      up with the app's own "stores" of loaded data; in the app it's
--      always "store".
--   2. expenses.shop_id: the store of an expense. Every existing expense
--      stays empty. Deleting a store never deletes expenses: the
--      expense's store simply becomes empty.
--   3. orders: online purchases waiting to arrive (name, details, store,
--      order date, price, paid by, category, expected date or range, a
--      link, a status). expense_id links an order to the one expense it
--      created, so the money is counted once.
--
-- Only tables and columns are added. No existing row is changed or
-- deleted, and nothing about how amounts or categories are saved changes.
-- The new tables are locked like every other table after 015: only the
-- logged-in household account can read or change them (policy
-- "household_only"); the anon key gets nothing. Live sync between the
-- phones is switched on for them the same way as for the other tables.
-- Needs 015 to have been run (it provides is_household_member()). Until
-- this file has been run the app works exactly as before and says so
-- where the new features would be. Safe to re-run.
--
-- Run in the Supabase SQL Editor.

-- What the expenses look like right now, to compare at the end.
drop table if exists pg_temp._expenses_before;
create temp table _expenses_before as
  select id, amount, category_id, description, paid_by, expense_date from expenses;

-- ── 1. Stores ────────────────────────────────────────────────────
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

-- One store per name, whatever the capitals.
create unique index if not exists shops_name_key on shops (lower(name));

-- ── 2. The store of an expense ───────────────────────────────────
alter table expenses add column if not exists shop_id uuid references shops(id) on delete set null;

create index if not exists expenses_shop_id_idx on expenses (shop_id) where shop_id is not null;

-- ── 3. Orders ────────────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  item_name text not null check (length(btrim(item_name)) > 0),
  details text,
  shop_id uuid references shops(id) on delete set null,
  order_date date not null default current_date,
  price numeric not null check (price >= 0),
  paid_by text not null default 'shared',
  -- The expense category (or sub-category), like on an expense.
  category_id uuid references expense_categories(id) on delete set null,
  expected_date date,
  -- The latest expected date, for marketplaces that give a range.
  expected_until date,
  order_url text,
  status text not null default 'on_the_way' check (status in ('on_the_way', 'arrived', 'cancelled')),
  arrived_date date,
  -- The expense made when the order was placed. If that expense is
  -- deleted the order stays, with no expense.
  expense_id uuid references expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expected_until is null or expected_date is null or expected_until >= expected_date)
);

-- An expense belongs to at most one order.
create unique index if not exists orders_expense_id_key on orders (expense_id) where expense_id is not null;
create index if not exists orders_status_idx on orders (status, expected_date);
create index if not exists orders_shop_id_idx on orders (shop_id) where shop_id is not null;

-- ── 4. Locked to the household, like the other tables ────────────
do $$
declare
  t text;
begin
  foreach t in array array['shops', 'orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household_only" on public.%I', t);
    execute format(
      'create policy "household_only" on public.%I for all to authenticated using (public.is_household_member()) with check (public.is_household_member())',
      t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- Live sync between the two phones.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Check: the numbers of the existing expenses must not change ──
-- ── (expenses_before = expenses_now, total_before = total_now, ───
-- ── expenses_changed 0, expenses_lost 0, expenses_with_store 0), ─
-- ── open_to_anon "none", locked_to_household, realtime and ───────
-- ── new_columns true ──────────────────────────────────────────────
select
  (select count(*) from _expenses_before) as expenses_before,
  (select count(*) from expenses) as expenses_now,
  (select coalesce(sum(amount), 0) from _expenses_before) as total_before,
  (select coalesce(sum(amount), 0) from expenses) as total_now,
  (select count(*) from _expenses_before b join expenses e using (id)
     where (e.amount, e.category_id, e.description, e.paid_by, e.expense_date)
           is distinct from (b.amount, b.category_id, b.description, b.paid_by, b.expense_date)) as expenses_changed,
  (select count(*) from _expenses_before b where not exists (select 1 from expenses e where e.id = b.id)) as expenses_lost,
  (select count(*) from expenses where shop_id is not null) as expenses_with_store,
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('shops', 'orders')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as open_to_anon,
  (select count(*) = 2 from pg_policies
     where schemaname = 'public' and tablename in ('shops', 'orders') and policyname = 'household_only') as locked_to_household,
  (select count(*) = 2 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('shops', 'orders')) as realtime_on,
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'expenses' and column_name = 'shop_id') as new_columns;
