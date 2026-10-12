-- Item groups: a group (e.g. "Chips & Snacks") is a row in pantry_items
-- with is_group = true, and its variants (the brands) are rows whose
-- group_id points to it. Two columns, nothing else:
--
--   1. pantry_items.is_group  – true for a group (default false).
--   2. pantry_items.group_id  – the group a variant belongs to. If a group
--      row were ever removed, its variants simply become normal items
--      again (they are never deleted with it).
--
-- No row is changed or deleted: every existing item stays an ordinary
-- item, with the same stock. The new columns follow the table's existing
-- row level security (household account only; nothing open to anon), so
-- no policy is added or changed. Until this has been run the app works
-- exactly as before and says so where groups would be used.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- What every item's stock is right now, to compare at the end.
drop table if exists pg_temp._stock_before;
create temp table _stock_before as
  select id, current_stock from pantry_items;

alter table pantry_items add column if not exists is_group boolean not null default false;
alter table pantry_items add column if not exists group_id uuid references pantry_items(id) on delete set null;

-- A group can't sit inside another group, and an item can't be its own group.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pantry_items_group_shape') then
    alter table pantry_items add constraint pantry_items_group_shape
      check (group_id is null or (not is_group and group_id <> id));
  end if;
end $$;

create index if not exists pantry_items_group_id_idx on pantry_items (group_id) where group_id is not null;

-- ── Check: stock_changed must be 0, items_lost 0, groups_now and ──
-- ── variants_now 0 (nothing is a group yet), columns 2, ──────────
-- ── open_to_anon "none", locked_to_household true ────────────────
select
  (select count(*) from _stock_before b join pantry_items p using (id) where p.current_stock is distinct from b.current_stock) as stock_changed,
  (select count(*) from _stock_before b where not exists (select 1 from pantry_items p where p.id = b.id)) as items_lost,
  (select count(*) from pantry_items where is_group) as groups_now,
  (select count(*) from pantry_items where group_id is not null) as variants_now,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pantry_items' and column_name in ('is_group', 'group_id')) as columns,
  (case when has_table_privilege('anon', 'public.pantry_items', 'select') or has_table_privilege('anon', 'public.pantry_items', 'insert')
          or has_table_privilege('anon', 'public.pantry_items', 'update') or has_table_privilege('anon', 'public.pantry_items', 'delete')
        then 'OPEN' else 'none' end) as open_to_anon,
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'pantry_items' and policyname = 'household_only') as locked_to_household;
