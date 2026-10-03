-- Makes sure the expense categories the grocery list books purchases
-- under always exist, so the app never has to create them itself (two
-- phones checking off appliances at the same moment could otherwise
-- race):
--
--   1. Merges expense categories that share the same name (if any):
--      the oldest one is kept, and the expenses and sub-categories of the
--      others move to it before the others are removed. No expense is
--      deleted.
--   2. Adds a unique constraint on expense_categories.name, unless the
--      table already has one (schema.sql created it as
--      expense_categories_name_key).
--   3. Makes sure "Groceries" and "Home & Appliances" exist as main
--      categories, with the Home & Appliances sub-categories.
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run. The
-- result shown is a short check.

-- ── 1. Merge duplicate names ─────────────────────────────────────
-- One DO block, so it runs as a single statement in one session (the SQL
-- Editor may run separate statements on separate connections, so a temp
-- table isn't reliable). Each statement ranks the duplicates afresh; the
-- oldest row per name is kept.
do $$
begin
  with ranked as (
    select id, first_value(id) over (partition by name order by created_at, id) as keep_id
    from expense_categories
  )
  update expenses e set category_id = r.keep_id
  from ranked r
  where e.category_id = r.id and r.id <> r.keep_id;

  with ranked as (
    select id, first_value(id) over (partition by name order by created_at, id) as keep_id
    from expense_categories
  )
  update expense_categories c set parent_id = r.keep_id
  from ranked r
  where c.parent_id = r.id and r.id <> r.keep_id and c.id <> r.keep_id;

  with ranked as (
    select id, first_value(id) over (partition by name order by created_at, id) as keep_id
    from expense_categories
  )
  delete from expense_categories c
  using ranked r
  where c.id = r.id and r.id <> r.keep_id;
end $$;

-- ── 2. Unique names ──────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where t.relname = 'expense_categories'
      and t.relnamespace = 'public'::regnamespace
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'name'
  ) then
    alter table expense_categories add constraint expense_categories_name_key unique (name);
  end if;
end $$;

-- ── 3. Required categories ───────────────────────────────────────
insert into expense_categories (name, type) values
  ('Groceries', 'parent'),
  ('Home & Appliances', 'parent')
on conflict (name) do nothing;

-- The app looks these up as main categories.
update expense_categories set parent_id = null, type = 'parent'
where name in ('Groceries', 'Home & Appliances') and (parent_id is not null or type <> 'parent');

insert into expense_categories (name, parent_id, type)
select sub.name, parent.id, 'sub'
from (values ('Kitchen Appliances'), ('Kitchenware & Utensils'), ('Cleaning Appliances'), ('Air & Climate'), ('Electronics & Work Equipment')) as sub(name)
cross join (select id from expense_categories where name = 'Home & Appliances') as parent
on conflict (name) do nothing;

-- ── Check ────────────────────────────────────────────────────────
select
  (select count(*) from expense_categories) as expense_categories,
  (select count(*) - count(distinct name) from expense_categories) as duplicate_names,
  (select string_agg(c.name, ', ' order by c.name) from expense_categories c
     join expense_categories p on p.id = c.parent_id where p.name = 'Home & Appliances') as home_appliances_subcategories,
  exists (select 1 from expense_categories where name = 'Groceries' and parent_id is null) as groceries_ok,
  exists (select 1 from expense_categories where name = 'Home & Appliances' and parent_id is null) as home_appliances_ok;
