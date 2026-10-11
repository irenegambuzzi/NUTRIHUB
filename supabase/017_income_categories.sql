-- Money: income categories and sub-categories, with a fixed color each.
--
--   1. income_categories: main categories and sub-categories for income,
--      working exactly like expense_categories (a separate set).
--      "Salary" and "Other" are created as the starting ones.
--   2. income_category_colors: one color per income category.
--   3. income.category_id: the category of each income entry. Every
--      existing entry is moved to "Salary" or "Other" to match its old
--      type. The old income_type column and its check are left exactly
--      as they are (the app keeps it filled in), so nothing breaks for a
--      phone still running the previous version.
--
-- The new tables are locked like every other table after 015: only the
-- logged-in household account can read or change them (policy
-- "household_only"); the anon key gets nothing. Needs 015 and 016 to have
-- been run. No row is deleted or changed except income.category_id being
-- filled in where it is empty. Safe to re-run.

-- ── 1. Income categories ─────────────────────────────────────────
create table if not exists income_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references income_categories(id) on delete cascade,
  type text not null default 'parent',
  created_at timestamptz not null default now()
);

insert into income_categories (name, type)
select v.name, 'parent'
from (values ('Salary'), ('Other')) as v(name)
where not exists (select 1 from income_categories c where c.name = v.name);

-- ── 2. Category colors ───────────────────────────────────────────
create table if not exists income_category_colors (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null unique references income_categories(id) on delete cascade,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- ── 3. The category of each income entry ─────────────────────────
alter table income add column if not exists category_id uuid references income_categories(id) on delete set null;

create index if not exists income_category_idx on income (category_id);

-- Existing entries move to the matching category; ones that already
-- have a category are left alone.
update income i
set category_id = c.id
from income_categories c
where i.category_id is null
  and c.parent_id is null
  and c.name = case i.income_type when 'salary' then 'Salary' else 'Other' end;

-- ── 4. Locked to the household, like the other tables ────────────
do $$
declare
  t text;
begin
  foreach t in array array['income_categories', 'income_category_colors']
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

-- ── Check: open_to_anon must say "none", the rest true, and ──────
-- ── entries_without_category must be 0 ───────────────────────────
select
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('income_categories', 'income_category_colors')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as open_to_anon,
  (select count(*) = 2 from pg_policies
     where schemaname = 'public' and tablename in ('income_categories', 'income_category_colors') and policyname = 'household_only') as locked_to_household,
  (select count(*) = 2 from income_categories where parent_id is null and name in ('Salary', 'Other')) as starting_categories,
  (select count(*) from income where category_id is null) as entries_without_category;
