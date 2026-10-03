-- Brings the database in line with what the app code already uses but
-- no earlier migration creates:
--
--   1. budget_settings: one shared row with the household grocery budget
--      (grocery_budget = null means "No budget limit").
--   2. pantry_items.price, .payer and .last_purchased_at: the last price
--      paid, who paid it, and when, copied over when a grocery item is
--      checked off. price is quoted per price_qty + price_unit (006).
--   3. expense_categories.parent_id and .type: two-level expense
--      categories (parent → sub), as in inventory_categories.
--   4. increment_stock(item_id, delta): adds to an item's stock in one
--      statement, so two people updating at once can't overwrite each
--      other. Never goes below 0.
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

-- ── 1. Budget settings ───────────────────────────────────────────
create table if not exists budget_settings (
  id uuid primary key default gen_random_uuid(),
  grocery_budget numeric,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

-- ── 2. Pantry items: last purchase ───────────────────────────────
-- Nullable: CSV/Excel imports send null for an empty price or payer.
-- The app reads a missing payer as 'shared'.
alter table pantry_items add column if not exists price numeric default 0;
alter table pantry_items add column if not exists payer text default 'shared';
alter table pantry_items add column if not exists last_purchased_at timestamptz;

-- ── 3. Expense categories: parent → sub ──────────────────────────
alter table expense_categories add column if not exists parent_id uuid references expense_categories(id) on delete cascade;
alter table expense_categories add column if not exists type text not null default 'parent' check (type in ('parent', 'sub'));

-- Categories that already have a parent are sub-categories.
update expense_categories set type = 'sub' where parent_id is not null and type <> 'sub';

-- ── 4. Atomic stock change ───────────────────────────────────────
create or replace function increment_stock(item_id uuid, delta numeric)
returns pantry_items
language sql
set search_path = public
as $$
  update pantry_items
  set current_stock = greatest(0, coalesce(pantry_items.current_stock, 0) + increment_stock.delta)
  where pantry_items.id = increment_stock.item_id
  returning *;
$$;

grant execute on function increment_stock(uuid, numeric) to anon, authenticated;

-- ── Access + live sync for the new table ─────────────────────────
grant all on budget_settings to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['budget_settings'] loop
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
