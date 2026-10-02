-- One-time data backfill after 005_home_inventory.sql. No item is ever
-- deleted.
--
--   1. New columns (the only structural changes):
--      - grocery_items.payer (irene / akbar / shared) and
--        grocery_items.subcategory_id, for who pays and the category
--        suggestion on the grocery list;
--      - price_qty + price_unit on pantry_items and grocery_items: what
--        `price` is quoted per (e.g. €2.50 per 500 gr, €1 per can), so
--        the grocery list can work out the real line total.
--   2. Groups items whose sub-category is still empty by keywords in
--      their name (English / Italian / Indonesian). Items already given
--      a sub-category by hand are left alone; items that match nothing
--      keep their current category.
--   3. Switches units to the app's spellings: g → gr, pc → pcs, l → L
--      (plus stray variants like KG, Ml). min_stock is NOT auto-filled —
--      it is set per item in the app — only negatives are clamped to 0.
--   4. Renames "Personal Care & Beauty" to "Beauty Care" and makes sure
--      "Baby & Child Care" and "Automotive" are gone (anything in them
--      moves to "Miscellaneous / Seasonal").
--   5. Adds two main categories:
--      - "Meat & Seafood" (Chicken & Poultry, Beef & Meat, Fish & Seafood);
--      - "Home & Appliances" for durable one-off purchases (oven, vacuum,
--        air purifier, work equipment). These can go on the grocery list
--        but never into the pantry, aren't counted in the grocery budget,
--        and are logged under the matching "Home & Appliances" expense
--        category instead of Groceries.
--   6. Expense categories: renames "Cigarettes" to "Cigarettes & Vape" and
--      adds "Housing & Utilities" (Rent, Apartment Maintenance,
--      Electricity, Gas, Water, Waste Collection, Internet & Phone).
--
-- Run once in the Supabase SQL Editor (it runs the whole script as one
-- transaction). Safe to re-run. The result shown is a verification report.

drop table if exists _before, _rules;
create temp table _before as
  select id, category_id, subcategory_id, unit, min_stock from pantry_items;

-- ── 1. New columns ───────────────────────────────────────────────
alter table grocery_items add column if not exists payer text not null default 'shared';
alter table grocery_items add column if not exists subcategory_id text references inventory_categories(id) on delete set null;
alter table grocery_items add column if not exists price_qty numeric;
alter table grocery_items add column if not exists price_unit text;
alter table pantry_items add column if not exists price_qty numeric;
alter table pantry_items add column if not exists price_unit text;

-- ── 2. Category backfill by item name ─────────────────────────────
insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('meat', 'Meat & Seafood', null, 'parent', 2),
  ('appliances', 'Home & Appliances', null, 'parent', 13)
on conflict (id) do nothing;

insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('beverages:alcohol', 'Beer & Wine', 'beverages', 'sub', 5),
  ('meat:poultry', 'Chicken & Poultry', 'meat', 'sub', 1),
  ('meat:beef', 'Beef & Meat', 'meat', 'sub', 2),
  ('meat:seafood', 'Fish & Seafood', 'meat', 'sub', 3),
  ('appliances:kitchen', 'Kitchen Appliances', 'appliances', 'sub', 1),
  ('appliances:kitchenware', 'Kitchenware & Utensils', 'appliances', 'sub', 2),
  ('appliances:cleaning', 'Cleaning Appliances', 'appliances', 'sub', 3),
  ('appliances:air', 'Air & Climate', 'appliances', 'sub', 4),
  ('appliances:electronics', 'Electronics & Work Equipment', 'appliances', 'sub', 5)
on conflict (id) do nothing;

-- Main category order, with the two new ones in place.
update inventory_categories c set sort_order = o.pos
from (values
  ('pantry-staples', 1), ('meat', 2), ('canned', 3), ('beverages', 4), ('snacks', 5),
  ('cleaning', 6), ('laundry', 7), ('toiletries', 8), ('personal-care', 9), ('health', 10),
  ('pet', 11), ('household', 12), ('appliances', 13), ('misc', 14)
) as o(id, pos)
where c.id = o.id;

-- First matching rule wins; \m and \M are word boundaries, so "tea"
-- doesn't match "steak".
create temp table _rules (pos numeric, category_id text, subcategory_id text, pattern text);
insert into _rules values
  (1,  'beverages', 'beverages:alcohol', 'beer|birra|bir|radler|wine|vino|prosecco|spritz|aperol|gin|vodka|rum|whisk(e)?y'),
  (2,  'beverages', 'beverages:coffee-tea', 'coffee|caff[eè]|kopi|tea|t[eè]|teh|espresso'),
  (3,  'beverages', 'beverages:milk', 'milk|latte|susu'),
  (4,  'beverages', 'beverages:juice-soda', 'juice|succo|jus|soda|cola|coca|fanta|sprite|tonic'),
  (5,  'beverages', 'beverages:water', 'water|acqua|air'),
  (6,  'canned', 'canned:jams', 'peanut butter|jam|marmellata|confettura|selai|nutella|spread|crema spalmabile'),
  (7,  'canned', 'canned:fish-meat', 'tuna|tonno|sarden|sardine|kornet|corned'),
  (8,  'canned', 'canned:legumes', 'beans|fagioli|ceci|chickpeas|lenticchie|lentils'),
  (9,  'canned', 'canned:vegetables', 'pelati|passata|acar|pickles?'),
  (10, 'pantry-staples', 'pantry-staples:oils', 'oil|olio|minyak|vinegar|aceto|cuka'),
  (11, 'pantry-staples', 'pantry-staples:sweeteners', 'honey|miele|madu|sugar|zucchero|gula|syrup|sciroppo'),
  (12, 'pantry-staples', 'pantry-staples:sauces', 'sauce|salsa|ketchup|mayo(nnaise)?|mustard|senape|miso|kecap|sambal'),
  (13, 'pantry-staples', 'pantry-staples:grains', 'rice|riso|beras|oats|avena|quinoa|couscous'),
  (14, 'pantry-staples', 'pantry-staples:pasta', 'pasta|spaghetti|penne|noodles?|mie|ramen'),
  (15, 'pantry-staples', 'pantry-staples:baking', 'flour|farina|tepung|yeast|lievito|baking'),
  (16, 'pantry-staples', 'pantry-staples:spices', 'seasoning|spices?|pepper|pepe|peperoncino|paprika|salt|sale|garam|merica|bumbu|powder|leaves|nutmeg|coriander|turmeric|timo|thyme|parsley|prezzemolo|basil|basilico|oregano|origano|rosemary|rosmarino|cloves|chill?i?|curry|cumin|cumino|cinnamon|cannella|mix'),
  (16.1, 'meat', 'meat:poultry', 'chicken|pollo|ayam|poultry|turkey|tacchino|duck|anatra|bebek|wings'),
  (16.2, 'meat', 'meat:seafood', 'fish|pesce|ikan|seafood|salmon|salmone|cod|merluzzo|baccal[aà]|shrimps?|prawns?|gamber[ie]|gamberetti|udang|squid|calamari|cumi|mussels|cozze|kerang|clams|vongole|octopus|polpo|branzino|orata'),
  (16.3, 'meat', 'meat:beef', 'beef|manzo|sapi|daging|steak|bistecca|meat|carne|pork|maiale|babi|lamb|agnello|kambing|mince|minced|ground beef|sausages?|salsiccia|bacon|pancetta|ham|prosciutto|salame|burgers?|hamburger|vitello|veal'),
  (17, 'snacks', 'snacks:sweet', 'biscuits?|biscotti|biskuit|cookies?|chocolate|cioccolat[oa]|cokelat|candy|caramelle|permen'),
  (18, 'snacks', 'snacks:savory', 'chips|patatine|crackers?|keripik|snack'),
  (19, 'snacks', 'snacks:nuts', 'nuts|almonds?|mandorle|noci|arachidi|pistacchi'),
  (20, 'laundry', 'laundry:softener', 'softener|ammorbidente|pelembut'),
  (21, 'laundry', 'laundry:detergent', 'laundry|bucato|detersivo lavatrice|deterjen|pewangi cucian'),
  (22, 'cleaning', 'cleaning:dish', 'dish|piatti|lavastoviglie|sabun cuci piring'),
  (23, 'cleaning', 'cleaning:tools', 'sponge|spugn[ae]|spons|cloth|panno|pel'),
  (24, 'cleaning', 'cleaning:surface', 'cleaner|pembersih|sgrassatore|bleach|candeggina|cairan'),
  (25, 'toiletries', 'toiletries:oral', 'toothpaste|toothbrush|dentifricio|spazzolino|sikat gigi|pasta gigi|floss'),
  (26, 'toiletries', 'toiletries:hair', 'shampoo|sampo|conditioner|balsamo'),
  (27, 'toiletries', 'toiletries:soap', 'soap|sapone|bagnoschiuma|shower gel|sabun'),
  (28, 'toiletries', 'toiletries:paper', 'toilet paper|carta igienica|tissues?|fazzoletti|tisu'),
  (29, 'personal-care', 'personal-care:deodorant', 'deodorant|deodorante|deodoran'),
  (30, 'personal-care', 'personal-care:makeup', 'lipstick|lipstik|rossetto|makeup|mascara|parfum|perfume|profumo'),
  (31, 'personal-care', 'personal-care:skin', 'cream|crema|krim|serum|lotion|sunscreen'),
  (32, 'health', 'health:vitamins', 'vitamins?|vitamine|integratore|supplements?'),
  (33, 'health', 'health:first-aid', 'plaster|cerotti|plester|bandage|perban|garza'),
  (34, 'health', 'health:medicine', 'medicine|obat|tachipirina|paracetamol|ibuprofen|aspirin[ae]?|moment|oki'),
  (35, 'pet', 'pet:food', 'pet food|cat food|dog food|crocchette|makanan hewan'),
  (36, 'pet', 'pet:litter', 'litter|lettiera|pasir kucing'),
  (37, 'household', 'household:batteries', 'batter(y|ies)|batterie|baterai|bulbs?|lampadin[ae]|lampu'),
  (38, 'household', 'household:bags', 'trash bags?|sacchi|kantong sampah'),
  (39, 'household', 'household:paper', 'paper towels?|scottex|carta (forno|stagnola|alluminio)|foil|cling'),
  (40, 'appliances', 'appliances:kitchen', 'oven|forno|microwave|microonde|kettle|bollitore|toaster|tostapane|blender|frullatore|mixer|planetaria|coffee machine|macchina (del )?caff[eè]|air fryer|friggitrice|fridge|refrigerator|frigorifero|kulkas|freezer|congelatore|dishwasher|rice cooker|slow cooker|induction|piano cottura'),
  (41, 'appliances', 'appliances:kitchenware', 'frying pan|saucepan|padella|pentola|wajan|panci|wok|knife|knives|coltell[io]|pisau|cutting board|tagliere|spatula|mestolo|ladle|colander|scolapasta|baking tray|teglia|food containers?|contenitor[ei]|tupperware|cutlery|posate|plates|glasses|bicchieri'),
  (42, 'appliances', 'appliances:cleaning', 'vacuum|aspirapolvere|vacuum cleaner|robot (vacuum|aspirapolvere)|steam mop|lavapavimenti|vaporetto'),
  (43, 'appliances', 'appliances:air', 'air purifier|purificatore|depuratore|fan|ventilatore|kipas|heater|stufa|termoventilatore|dehumidifier|deumidificatore|humidifier|umidificatore|air conditioner|condizionatore|climatizzatore'),
  (44, 'appliances', 'appliances:electronics', 'laptop|notebook|computer|monitor|keyboard|tastiera|mouse|printer|stampante|headphones|cuffie|webcam|router|charger|caricatore|desk|scrivania|office chair|sedia (da )?ufficio|power bank|hard disk|ssd');

update pantry_items p
set category_id = m.category_id, subcategory_id = m.subcategory_id
from (
  select distinct on (p2.id) p2.id, r.category_id, r.subcategory_id
  from pantry_items p2
  join _rules r on p2.name ~* ('\m(' || r.pattern || ')\M')
  where p2.subcategory_id is null
  order by p2.id, r.pos
) m
where p.id = m.id;

-- ── 3. Units and min_stock ────────────────────────────────────────
update pantry_items set unit = 'gr' where unit in ('g', 'G', 'Gr', 'GR', 'gram', 'grams');
update pantry_items set unit = 'kg' where unit in ('KG', 'Kg', 'kG');
update pantry_items set unit = 'ml' where unit in ('ML', 'Ml', 'mL');
update pantry_items set unit = 'L' where unit in ('l', 'lt', 'Lt', 'LT');
update pantry_items set unit = 'pcs' where unit in ('pc', 'Pcs', 'PCS', 'piece', 'pieces', 'ea');
alter table pantry_items alter column unit set default 'pcs';
update grocery_items set unit = 'gr' where unit in ('g', 'G', 'Gr', 'GR', 'gram', 'grams');
update grocery_items set unit = 'kg' where unit in ('KG', 'Kg', 'kG');
update grocery_items set unit = 'ml' where unit in ('ML', 'Ml', 'mL');
update grocery_items set unit = 'L' where unit in ('l', 'lt', 'Lt', 'LT');
update grocery_items set unit = 'pcs' where unit in ('pc', 'Pcs', 'PCS', 'piece', 'pieces', 'ea');
alter table grocery_items alter column unit set default 'pcs';
update stock_logs set unit = 'gr' where unit = 'g';
update stock_logs set unit = 'pcs' where unit = 'pc';
update stock_logs set unit = 'L' where unit = 'l';

update pantry_items set min_stock = 0 where min_stock < 0;

-- ── 4. Category names ─────────────────────────────────────────────
update inventory_categories set name = 'Beauty Care' where id = 'personal-care';
update inventory_categories set name = 'Household Supplies' where lower(name) = 'home';

-- Remove Baby & Child Care and Automotive.
update pantry_items set category_id = 'misc', subcategory_id = null
where category_id in ('baby', 'automotive')
   or subcategory_id in (select id from inventory_categories where parent_id in ('baby', 'automotive'));
update grocery_items set category_id = 'misc' where category_id in ('baby', 'automotive');
-- Sub-categories go with their parent (on delete cascade).
delete from inventory_categories where id in ('baby', 'automotive');

-- Open grocery entries follow their pantry item's new category.
update grocery_items g set category_id = p.category_id, subcategory_id = p.subcategory_id
from pantry_items p
where g.completed = false
  and (g.pantry_item_id = p.id or (g.pantry_item_id is null and lower(trim(g.name)) = lower(trim(p.name))))
  and (g.category_id is distinct from p.category_id or g.subcategory_id is distinct from p.subcategory_id);

-- ── 5. Expense categories ─────────────────────────────────────────
update expense_categories set name = 'Cigarettes & Vape'
where name = 'Cigarettes'
  and not exists (select 1 from expense_categories where name = 'Cigarettes & Vape');

insert into expense_categories (name, type) values ('Housing & Utilities', 'parent')
on conflict (name) do nothing;
insert into expense_categories (name, parent_id, type)
select sub.name, parent.id, 'sub'
from (values ('Rent'), ('Apartment Maintenance'), ('Electricity'), ('Gas'), ('Water'), ('Waste Collection'), ('Internet & Phone')) as sub(name)
cross join (select id from expense_categories where name = 'Housing & Utilities') as parent
on conflict (name) do nothing;

-- Home & Appliances purchases.
insert into expense_categories (name, type) values ('Home & Appliances', 'parent')
on conflict (name) do nothing;
insert into expense_categories (name, parent_id, type)
select sub.name, parent.id, 'sub'
from (values ('Kitchen Appliances'), ('Kitchenware & Utensils'), ('Cleaning Appliances'), ('Air & Climate'), ('Electronics & Work Equipment')) as sub(name)
cross join (select id from expense_categories where name = 'Home & Appliances') as parent
on conflict (name) do nothing;

-- ── 6. Verification report ────────────────────────────────────────
select
  (select count(*) from _before) as items_before,
  (select count(*) from pantry_items) as items_after,
  (select count(*) from pantry_items p join _before b using (id)
     where p.category_id is distinct from b.category_id or p.subcategory_id is distinct from b.subcategory_id) as items_recategorized,
  (select count(*) from pantry_items p join _before b using (id) where p.unit is distinct from b.unit) as items_unit_fixed,
  (select count(*) from pantry_items where category_id is null) as items_category_null,
  (select count(*) from pantry_items where subcategory_id is null) as items_subcategory_null,
  (select count(*) from pantry_items where coalesce(min_stock, 0) = 0) as items_min_stock_0,
  (select string_agg(distinct unit, ', ') from pantry_items) as units_in_use,
  (select string_agg(name, ', ' order by sort_order) from inventory_categories where type = 'parent') as categories,
  (select string_agg(name, ', ' order by name) from expense_categories where parent_id is null) as expense_categories;
