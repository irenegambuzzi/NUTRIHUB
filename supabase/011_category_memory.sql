-- Remembers the category chosen for an item name, shared by both
-- phones: when someone picks or changes the category of e.g. "Bounty",
-- the app suggests that category for "Bounty" from then on, before its
-- own keyword list.
--
-- id is the item name as the app normalises it (lower case, no accents
-- or amounts), so "Ice-Cream 500g" and "ice cream" share a row; name is
-- how it was written.
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

create table if not exists category_memory (
  id text primary key,
  name text not null,
  category_id text references inventory_categories(id) on delete cascade,
  subcategory_id text references inventory_categories(id) on delete set null,
  updated_at timestamptz not null default now()
);

grant all on category_memory to anon, authenticated;

do $$
begin
  execute 'alter table category_memory enable row level security';
  execute 'drop policy if exists "public_access" on category_memory';
  execute 'create policy "public_access" on category_memory for all using (true) with check (true)';
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'category_memory'
  ) then
    execute 'alter publication supabase_realtime add table public.category_memory';
  end if;
end $$;
