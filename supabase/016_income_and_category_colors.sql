-- Money: income, and a fixed color for every expense category.
--
--   1. income: money received (amount, date, Salary / Other, who received
--      it, an optional note or source). A separate table: expenses and
--      everything calculated from them are untouched.
--   2. expense_category_colors: one color per expense category, so a
--      category looks the same on every phone and screen. A separate
--      table too, so expense_categories and expenses stay exactly as
--      they are.
--
-- Both tables are locked like every other table after 015: only the
-- logged-in household account can read or change them (policy
-- "household_only"); the anon key gets nothing. Needs 015 to have been
-- run (it provides is_household_member()). Nothing existing is changed
-- or deleted. Safe to re-run.

-- ── 1. Income ────────────────────────────────────────────────────
create table if not exists income (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount > 0),
  income_date date not null default current_date,
  income_type text not null default 'other' check (income_type in ('salary', 'other')),
  received_by text not null default 'shared',
  source text,
  created_at timestamptz not null default now()
);

create index if not exists income_date_idx on income (income_date);

-- ── 2. Category colors ───────────────────────────────────────────
create table if not exists expense_category_colors (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null unique references expense_categories(id) on delete cascade,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- ── 3. Locked to the household, like the other tables ────────────
do $$
declare
  t text;
begin
  foreach t in array array['income', 'expense_category_colors']
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

-- ── Check: both must say "none" / true ───────────────────────────
select
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('income', 'expense_category_colors')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as open_to_anon,
  (select count(*) = 2 from pg_policies
     where schemaname = 'public' and tablename in ('income', 'expense_category_colors') and policyname = 'household_only') as locked_to_household;
