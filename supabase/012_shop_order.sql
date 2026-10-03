-- The order of the shop (shopping mode), shared by both phones:
-- every item and category can have a position, and the list is shown
-- in that order. Items are keyed by their normalised name, so "Milk"
-- keeps its place on every shopping trip; items without a position of
-- their own go where their category is.
--
--   id        'item:<normalised name>' or 'category:<category id>'
--   position  any number; lower comes first
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

create table if not exists shop_order (
  id text primary key,
  position double precision not null,
  updated_at timestamptz not null default now()
);

grant all on shop_order to anon, authenticated;

do $$
begin
  execute 'alter table shop_order enable row level security';
  execute 'drop policy if exists "public_access" on shop_order';
  execute 'create policy "public_access" on shop_order for all using (true) with check (true)';
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_order'
  ) then
    execute 'alter publication supabase_realtime add table public.shop_order';
  end if;
end $$;
