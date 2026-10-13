-- Orders: a "Returned" status, and a record of what happened to the expense
-- when an order is cancelled or returned.
--
--   1. orders.status also accepts 'returned' (it accepted on_the_way,
--      arrived and cancelled).
--   2. orders.expense_outcome: 'kept' or 'deleted' — what was done with the
--      order's expense when it was cancelled or returned. Empty for every
--      existing order and for orders still on the way.
--
-- The day an order arrived, was cancelled or was returned is kept in the
-- column that already exists (arrived_date).
--
-- Only a column is added and one check is widened. No existing row is
-- changed or deleted, no policy is touched: the table stays locked to the
-- household account (policy "household_only"), nothing is open to anon.
-- Until this file has been run the app works exactly as before: Cancel /
-- Return saves "Cancelled", and says that "Returned" needs this update.
-- Safe to re-run.
--
-- Run in the Supabase SQL Editor.

-- What the data looks like right now, to compare at the end.
drop table if exists pg_temp._orders_before;
create temp table _orders_before as
  select id, item_name, price, status, order_date, expected_date, expense_id, arrived_date from orders;
drop table if exists pg_temp._expenses_before;
create temp table _expenses_before as
  select id, amount, category_id, description, paid_by, expense_date from expenses;
drop table if exists pg_temp._income_before;
create temp table _income_before as
  select id, amount, income_date, received_by from income;

-- ── 1. What happened to the expense ──────────────────────────────
alter table orders add column if not exists expense_outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_expense_outcome_check') then
    alter table orders add constraint orders_expense_outcome_check check (expense_outcome is null or expense_outcome in ('kept', 'deleted'));
  end if;
end $$;

-- ── 2. The status check also accepts 'returned' ──────────────────
do $$
declare
  c text;
begin
  -- The old check has whatever name Postgres gave it; find it by what it checks.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%on_the_way%'
  loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
  alter table orders add constraint orders_status_check check (status in ('on_the_way', 'arrived', 'cancelled', 'returned'));
end $$;

-- ── Check: nothing existing may change ───────────────────────────
-- ── (orders_before = orders_now, orders_changed 0, orders_lost 0, ─
-- ── expenses_changed 0, expenses_lost 0, income_changed 0, ───────
-- ── income_lost 0, totals equal), returned_allowed true, ─────────
-- ── outcome_column true, open_to_anon "none", ────────────────────
-- ── locked_to_household true ──────────────────────────────────────
select
  (select count(*) from _orders_before) as orders_before,
  (select count(*) from orders) as orders_now,
  (select count(*) from _orders_before b join orders o using (id)
     where (o.item_name, o.price, o.status, o.order_date, o.expected_date, o.expense_id, o.arrived_date)
           is distinct from (b.item_name, b.price, b.status, b.order_date, b.expected_date, b.expense_id, b.arrived_date)) as orders_changed,
  (select count(*) from _orders_before b where not exists (select 1 from orders o where o.id = b.id)) as orders_lost,
  (select count(*) from _expenses_before) as expenses_before,
  (select count(*) from expenses) as expenses_now,
  (select coalesce(sum(amount), 0) from _expenses_before) as expenses_total_before,
  (select coalesce(sum(amount), 0) from expenses) as expenses_total_now,
  (select count(*) from _expenses_before b join expenses e using (id)
     where (e.amount, e.category_id, e.description, e.paid_by, e.expense_date)
           is distinct from (b.amount, b.category_id, b.description, b.paid_by, b.expense_date)) as expenses_changed,
  (select count(*) from _expenses_before b where not exists (select 1 from expenses e where e.id = b.id)) as expenses_lost,
  (select count(*) from _income_before) as income_before,
  (select count(*) from income) as income_now,
  (select coalesce(sum(amount), 0) from _income_before) as income_total_before,
  (select coalesce(sum(amount), 0) from income) as income_total_now,
  (select count(*) from _income_before b join income i using (id)
     where (i.amount, i.income_date, i.received_by) is distinct from (b.amount, b.income_date, b.received_by)) as income_changed,
  (select count(*) from _income_before b where not exists (select 1 from income i where i.id = b.id)) as income_lost,
  (select exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_status_check'
                    and pg_get_constraintdef(oid) like '%returned%')) as returned_allowed,
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'expense_outcome') as outcome_column,
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'orders'
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as open_to_anon,
  (select count(*) = 1 from pg_policies
     where schemaname = 'public' and tablename = 'orders' and policyname = 'household_only') as locked_to_household;
