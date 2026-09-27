-- Run this in the Supabase SQL Editor if pages show empty data or
-- buttons fail with "new row violates row-level security policy".
--
-- Supabase enables Row Level Security by default on new tables. Since
-- this app has no login (no auth.uid() to write policies against),
-- we grant the anon key open access via an explicit permissive policy
-- instead of relying on RLS being off. Safe for a private two-person
-- app with no sensitive third-party data.

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'recipes', 'meal_plan_entries', 'grocery_items',
      'pantry_items', 'expense_categories', 'expenses'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public_access" on %I', t);
    execute format('create policy "public_access" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Live sync: lets both of you see each other's changes without
-- reloading the page. Guarded so it's safe to re-run.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'recipes', 'meal_plan_entries', 'grocery_items',
      'pantry_items', 'expense_categories', 'expenses'
    ])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
