-- Turns the pantry into a full home inventory: two-level categories,
-- metric/count units, multipack packaging, minimum stock with derived
-- OK/Low/Out status, expiry tracking, a stock change log, and grocery
-- items linked back to the pantry item they restock.
--
-- Non-destructive for existing data: old Home/Kitchen/Bathroom pantry
-- categories and Kitchen/Beauty Care/Cleaning/Home grocery categories
-- are mapped onto the new categories before the old columns are
-- dropped, and old units (pcs, l) are renamed (pc, L).
-- Run once in the Supabase SQL Editor. Safe to re-run.

-- ── Categories (parent → sub) ─────────────────────────────────────
create table if not exists inventory_categories (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  parent_id text references inventory_categories(id) on delete cascade,
  type text not null default 'sub' check (type in ('parent', 'sub')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('pantry-staples', 'Pantry Staples', null, 'parent', 1),
  ('canned', 'Canned & Preserved Goods', null, 'parent', 2),
  ('beverages', 'Beverages', null, 'parent', 3),
  ('snacks', 'Snacks', null, 'parent', 4),
  ('cleaning', 'Cleaning Supplies', null, 'parent', 5),
  ('laundry', 'Laundry Supplies', null, 'parent', 6),
  ('toiletries', 'Toiletries', null, 'parent', 7),
  ('personal-care', 'Personal Care & Beauty', null, 'parent', 8),
  ('health', 'Health & Medicine', null, 'parent', 9),
  ('baby', 'Baby & Child Care', null, 'parent', 10),
  ('pet', 'Pet Supplies', null, 'parent', 11),
  ('household', 'Household Supplies', null, 'parent', 12),
  ('automotive', 'Automotive', null, 'parent', 13),
  ('misc', 'Miscellaneous / Seasonal', null, 'parent', 14)
on conflict (id) do nothing;

insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('pantry-staples:grains', 'Rice & Grains', 'pantry-staples', 'sub', 1),
  ('pantry-staples:pasta', 'Pasta & Noodles', 'pantry-staples', 'sub', 2),
  ('pantry-staples:baking', 'Flour & Baking', 'pantry-staples', 'sub', 3),
  ('pantry-staples:oils', 'Oils & Vinegar', 'pantry-staples', 'sub', 4),
  ('pantry-staples:spices', 'Spices & Seasonings', 'pantry-staples', 'sub', 5),
  ('pantry-staples:sauces', 'Sauces & Condiments', 'pantry-staples', 'sub', 6),
  ('pantry-staples:sweeteners', 'Sugar & Sweeteners', 'pantry-staples', 'sub', 7),
  ('canned:vegetables', 'Canned Vegetables', 'canned', 'sub', 1),
  ('canned:fish-meat', 'Canned Fish & Meat', 'canned', 'sub', 2),
  ('canned:legumes', 'Beans & Legumes', 'canned', 'sub', 3),
  ('canned:jams', 'Jams & Spreads', 'canned', 'sub', 4),
  ('beverages:water', 'Water', 'beverages', 'sub', 1),
  ('beverages:coffee-tea', 'Coffee & Tea', 'beverages', 'sub', 2),
  ('beverages:juice-soda', 'Juice & Soft Drinks', 'beverages', 'sub', 3),
  ('beverages:milk', 'Milk & Plant Milk', 'beverages', 'sub', 4),
  ('snacks:sweet', 'Sweet Snacks', 'snacks', 'sub', 1),
  ('snacks:savory', 'Savory Snacks', 'snacks', 'sub', 2),
  ('snacks:nuts', 'Nuts & Dried Fruit', 'snacks', 'sub', 3),
  ('cleaning:surface', 'Surface Cleaners', 'cleaning', 'sub', 1),
  ('cleaning:dish', 'Dishwashing', 'cleaning', 'sub', 2),
  ('cleaning:tools', 'Sponges & Cloths', 'cleaning', 'sub', 3),
  ('laundry:detergent', 'Detergent', 'laundry', 'sub', 1),
  ('laundry:softener', 'Fabric Softener', 'laundry', 'sub', 2),
  ('laundry:stain', 'Stain Removers', 'laundry', 'sub', 3),
  ('toiletries:paper', 'Toilet Paper & Tissues', 'toiletries', 'sub', 1),
  ('toiletries:soap', 'Soap & Shower Gel', 'toiletries', 'sub', 2),
  ('toiletries:oral', 'Oral Care', 'toiletries', 'sub', 3),
  ('toiletries:hair', 'Shampoo & Conditioner', 'toiletries', 'sub', 4),
  ('personal-care:skin', 'Skincare', 'personal-care', 'sub', 1),
  ('personal-care:makeup', 'Makeup', 'personal-care', 'sub', 2),
  ('personal-care:deodorant', 'Deodorant', 'personal-care', 'sub', 3),
  ('health:medicine', 'Medicine', 'health', 'sub', 1),
  ('health:vitamins', 'Vitamins & Supplements', 'health', 'sub', 2),
  ('health:first-aid', 'First Aid', 'health', 'sub', 3),
  ('baby:diapers', 'Diapers & Wipes', 'baby', 'sub', 1),
  ('baby:food', 'Baby Food & Formula', 'baby', 'sub', 2),
  ('pet:food', 'Pet Food', 'pet', 'sub', 1),
  ('pet:litter', 'Litter & Hygiene', 'pet', 'sub', 2),
  ('household:paper', 'Paper Towels & Foil', 'household', 'sub', 1),
  ('household:bags', 'Trash Bags', 'household', 'sub', 2),
  ('household:batteries', 'Batteries & Bulbs', 'household', 'sub', 3),
  ('automotive:fluids', 'Fluids & Oil', 'automotive', 'sub', 1),
  ('automotive:care', 'Car Care', 'automotive', 'sub', 2),
  ('misc:seasonal', 'Seasonal', 'misc', 'sub', 1),
  ('misc:gifts', 'Gifts & Party', 'misc', 'sub', 2)
on conflict (id) do nothing;

-- ── Pantry items → inventory items ────────────────────────────────
alter table pantry_items add column if not exists category_id text references inventory_categories(id) on delete set null;
alter table pantry_items add column if not exists subcategory_id text references inventory_categories(id) on delete set null;
alter table pantry_items add column if not exists packaging_unit text;
alter table pantry_items add column if not exists quantity_per_pack numeric;
alter table pantry_items add column if not exists min_stock numeric not null default 0;
alter table pantry_items add column if not exists expiry_date date;
alter table pantry_items add column if not exists batch_lot text;
alter table pantry_items add column if not exists notes text;
alter table pantry_items add column if not exists updated_at timestamptz not null default now();

do $$
begin
  -- quantity → current_stock
  if exists (select 1 from information_schema.columns where table_name = 'pantry_items' and column_name = 'quantity') then
    alter table pantry_items rename column quantity to current_stock;
  end if;

  -- Old category text → new parent category
  if exists (select 1 from information_schema.columns where table_name = 'pantry_items' and column_name = 'category') then
    update pantry_items set category_id = case category
      when 'Kitchen' then 'pantry-staples'
      when 'Bathroom' then 'toiletries'
      else 'household'
    end
    where category_id is null;
    alter table pantry_items drop column category;
  end if;

  -- Status is now derived from current_stock vs min_stock. Items that
  -- were toggled "out" while still holding a quantity become 0.
  if exists (select 1 from information_schema.columns where table_name = 'pantry_items' and column_name = 'status') then
    update pantry_items set current_stock = 0 where status <> 'ok';
    alter table pantry_items drop column status;
  end if;
end $$;

update pantry_items set unit = 'pc' where unit = 'pcs';
update pantry_items set unit = 'L' where unit = 'l';
alter table pantry_items alter column unit set default 'pc';
alter table pantry_items alter column current_stock set default 0;

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists pantry_items_updated_at on pantry_items;
create trigger pantry_items_updated_at before update on pantry_items
  for each row execute function set_updated_at();

-- ── Stock change log ──────────────────────────────────────────────
create table if not exists stock_logs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references pantry_items(id) on delete set null,
  item_name text not null,
  change numeric not null,
  new_stock numeric not null,
  unit text,
  reason text not null default 'adjust',
  created_at timestamptz not null default now()
);

-- ── Grocery items linked to inventory ─────────────────────────────
alter table grocery_items add column if not exists category_id text references inventory_categories(id) on delete set null;
alter table grocery_items add column if not exists pantry_item_id uuid references pantry_items(id) on delete set null;
alter table grocery_items add column if not exists auto_generated boolean not null default false;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'grocery_items' and column_name = 'category') then
    update grocery_items set category_id = case category
      when 'Kitchen' then 'pantry-staples'
      when 'Beauty Care' then 'personal-care'
      when 'Cleaning' then 'cleaning'
      else 'household'
    end
    where category_id is null;
    alter table grocery_items drop column category;
  end if;
end $$;

update grocery_items set unit = 'pc' where unit = 'pcs';
update grocery_items set unit = 'L' where unit = 'l';
alter table grocery_items alter column unit set default 'pc';

-- Link existing open grocery items to the pantry item of the same name.
update grocery_items g set pantry_item_id = p.id
from pantry_items p
where g.pantry_item_id is null and g.completed = false and lower(g.name) = lower(p.name);

-- Seed the auto shopping list with items already out of stock.
insert into grocery_items (name, category_id, quantity, unit, pantry_item_id, auto_generated)
select p.name, p.category_id, 1, p.unit, p.id, true
from pantry_items p
where p.current_stock <= p.min_stock
  and not exists (select 1 from grocery_items g where g.pantry_item_id = p.id and g.completed = false);

-- ── Access + live sync for the new tables ─────────────────────────
grant all on inventory_categories, stock_logs to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['inventory_categories', 'stock_logs'] loop
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
