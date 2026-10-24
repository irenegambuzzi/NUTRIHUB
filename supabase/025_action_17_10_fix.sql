-- 025: one-off data fix for the SHOP purchase at "Action" on 17/10/2026
-- (shopping_trips.id 1d47dd08-f03a-4df8-a214-ac00f671d54f, 31 lines, made
-- with SHOP Confirm purchase). It corrects categories, names and HOME
-- items only; see docs/plan-oct-2026.md "9E. Data fix 025".
--
-- Irene's rule: HOME stock is only for consumables that are bought
-- again; durable items are MONEY expenses only.
--
-- What it does, in this order (one transaction):
--   1. MONEY: the sub "Shoes & Accessories" (Shopping) is renamed
--      "Footwear" (its expenses stay where they are).
--   2. MONEY: new subs with fixed ids: Shopping › Accessories, Home &
--      Appliances › Home Textiles and › Home Decor, Pets › Pet Accessories
--      & Toys.
--   3. HOME: new subs under Home & Appliances (no stock there):
--      appliances:textiles "Home Textiles", appliances:decor "Home Decor".
--      They book to the Home & Appliances sub with the same name (the app
--      matches them by name, as for every appliance sub), so no mapping
--      row is needed.
--   4. HOME: the Beauty Care sub "Hair Water" is renamed "Hair Care".
--   5. The expenses of the purchase: new budget category (14) and new
--      name (4). Amount, date, payer, store and purchase never change.
--   6. The lines of the purchase: new name (4) and the category kept in
--      the line (16), so Reopen and "Apply the mapping to past purchases"
--      see the right category.
--   7. The SHOP entries bought by those lines: the same name and category.
--   8. HOME items that stay: new name (2) and category (4). Stock never
--      changes.
--   9. Durable items leave HOME: big towel, small towel, toy elf
--      Christmas, incense holder, bra, bonnet, hair clip, hairband, Cat
--      House Christmas Tree, cat toy, and a HOME item "Shoe Deodorizer" if
--      there is one. Each line that bought one becomes an expense-only
--      line (like an appliance: no HOME item, no stock added, no history),
--      its SHOP entry is unlinked, its stock history is deleted, then the
--      item is deleted. Their expenses stay. An item that is a group or in
--      a group, or has an entry in a cart or ordered online, is left (the
--      check says so).
--  10. Remembered names (category_memory): the 4 old names are forgotten,
--      18 names get the right HOME / budget category.
--  11. The HOME category "clothes" is deleted (its budget mapping row goes
--      with it) — only if nothing points to it any more.
--  12. The SELECT at the end shows the result.
--
-- Safe to run again, also after changes made by hand in the app: every
-- UPDATE and DELETE is by id and only while the row still holds the value
-- it had in Irene's export of 24/10/2026, so a second run changes nothing
-- and a value changed by hand is left alone (the check then says CHECK).
-- A new category is skipped when its name exists (any capitals); a rename
-- is skipped when the category was already renamed by hand. MONEY
-- categories are found by id only. No table, policy or grant; nothing
-- else is touched.
--
-- Why some things are safe to delete (foreign keys):
--   pantry_items is pointed at by shopping_trip_items.pantry_item_id,
--   grocery_items.pantry_item_id, stock_logs.item_id, orders.pantry_item_id
--   and orders.arrived_item_id, pantry_items.group_id (all on delete set
--   null) and ai_category_proposals.pantry_item_id (on delete cascade).
--   So the lines and entries are unlinked and the history deleted first,
--   by hand, then the item.
--   inventory_categories is pointed at by category_memory.category_id,
--   category_budget_map.id, ai_category_proposals.to_category_id /
--   new_category_parent_id and its own sub-categories (on delete cascade:
--   they would be deleted with it), and by pantry_items, grocery_items,
--   category_memory.subcategory_id and the other proposal columns (on
--   delete set null). Purchase lines keep the category in a copy
--   (grocery_snapshot), without a foreign key. So "clothes" is deleted
--   only when none of these points to it.
--
-- How to run: paste the whole file into the Supabase SQL Editor, scroll
-- to the last line to check that it ends with "-- End of 025", then press
-- Run. Send the result table (the last SELECT) for checking.

begin;

-- ── 1. MONEY: "Shoes & Accessories" → "Footwear" ─────────────────
-- Only while it still has its old name, and no other category is called
-- "Footwear" already.
update expense_categories
set name = 'Footwear'
where id = '0f7f387b-0c4a-4095-8865-59cfac4c586a'
  and name = 'Shoes & Accessories'
  and not exists (
    select 1 from expense_categories c
    where lower(btrim(c.name)) = 'footwear' and c.id <> '0f7f387b-0c4a-4095-8865-59cfac4c586a'
  );

-- ── 2. MONEY: new sub-categories (fixed ids; the main by its id) ─
-- After the rename, so "Accessories" never meets "Shoes & Accessories".
-- Only under a main that exists and is still a main. Sub colours follow
-- the main: no colour rows.
insert into expense_categories (id, name, type, parent_id)
select v.id::uuid, v.name, 'sub', p.id
from (values
  ('b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', 'Accessories', '654a80a3-2e6f-4ada-b214-0486d91d869c'),             -- Shopping
  ('f924edef-bf90-477d-8303-ddc4a2b27391', 'Home Textiles', '199ec782-505a-4292-984e-08ae1d76469f'),           -- Home & Appliances
  ('3472a299-73f6-4249-bee4-a5469d1c807a', 'Home Decor', '199ec782-505a-4292-984e-08ae1d76469f'),              -- Home & Appliances
  ('d0c05f29-1418-485f-9433-b4b0e97c2423', 'Pet Accessories & Toys', 'ecd9a924-7f46-4991-83ce-02825c73ce42')   -- Pets
) as v(id, name, parent_id)
join expense_categories p on p.id = v.parent_id::uuid and p.parent_id is null
where not exists (select 1 from expense_categories c where lower(btrim(c.name)) = lower(btrim(v.name)) and c.id <> v.id::uuid)
on conflict (id) do nothing;

-- ── 3. HOME: two sub-categories under Home & Appliances ──────────
-- The durable tree: nothing in it ever gets stock.
insert into inventory_categories (id, name, parent_id, type, sort_order)
select v.id, v.name, v.parent_id, 'sub', v.sort_order
from (values
  ('appliances:textiles', 'Home Textiles', 'appliances', 6),
  ('appliances:decor', 'Home Decor', 'appliances', 7)
) as v(id, name, parent_id, sort_order)
where exists (select 1 from inventory_categories p where p.id = v.parent_id)
  and not exists (select 1 from inventory_categories c where lower(btrim(c.name)) = lower(btrim(v.name)) and c.id <> v.id)
on conflict (id) do nothing;

-- ── 4. HOME: "Hair Water" → "Hair Care" (under Beauty Care) ──────
update inventory_categories
set name = 'Hair Care'
where id = '3ff635c0-7fd1-46ff-ac49-8e408c032398'
  and name = 'Hair Water'
  and not exists (
    select 1 from inventory_categories c
    where lower(btrim(c.name)) = 'hair care' and c.id <> '3ff635c0-7fd1-46ff-ac49-8e408c032398'
  );

-- ── 5. The expenses of the purchase ──────────────────────────────
-- Budget category: only while it is still the one in the export, and the
-- new one exists.
update expenses e
set category_id = v.new_id::uuid
from (values
  ('1d96c083-ef57-4d5e-b380-e1da9fe6f254', '61f92237-3392-4f71-aca8-4dbb1df9b256', '8fbe343f-6fd9-4c58-874b-d9bd809be461'),  -- eletrolytes powder: Groceries → Health › Pharmacy
  ('8ad2e519-fea1-43ad-b663-2af866c1d3b3', '01a993f2-d9af-4881-bc8e-1df5af027000', '4eb77042-660a-41e9-a1b6-cd2057605256'),  -- hair oil: Personal Care › Toiletries → › Beauty & Perfume
  ('5b04fc1c-153a-412e-960b-1465656339b0', '4125ed9e-da65-4b76-8e35-cb1239d8093b', '61f92237-3392-4f71-aca8-4dbb1df9b256'),  -- Dishwasher Detergent: Home & Appliances › Kitchen Appliances → Groceries
  ('b0558eea-4dde-4094-a743-440cc72ab83d', '4125ed9e-da65-4b76-8e35-cb1239d8093b', '61f92237-3392-4f71-aca8-4dbb1df9b256'),  -- Oven Detergent: the same
  ('92b2b31e-5b74-44a9-a2fe-7d3e941befe4', '654a80a3-2e6f-4ada-b214-0486d91d869c', 'f924edef-bf90-477d-8303-ddc4a2b27391'),  -- big towel: Shopping → Home & Appliances › Home Textiles
  ('8e5dff64-b8e3-4b3d-869f-f592a922a2ea', '654a80a3-2e6f-4ada-b214-0486d91d869c', 'f924edef-bf90-477d-8303-ddc4a2b27391'),  -- small towel: the same
  ('a4473501-f21b-49f8-9118-0c5e1ab899cf', '61f92237-3392-4f71-aca8-4dbb1df9b256', '3472a299-73f6-4249-bee4-a5469d1c807a'),  -- toy elf Christmas: Groceries → Home & Appliances › Home Decor
  ('10985ab4-80d1-43c3-807a-7d03dcee51d0', '61f92237-3392-4f71-aca8-4dbb1df9b256', '3472a299-73f6-4249-bee4-a5469d1c807a'),  -- incense holder: the same
  ('54dda4c1-dfdc-424a-9578-0e55c2f7d4c5', '654a80a3-2e6f-4ada-b214-0486d91d869c', '732af8e0-924c-471c-b0e8-ac9286ce074e'),  -- bra: Shopping → Shopping › Clothing
  ('d7575954-3c5e-45d7-aea7-c70189ea18bc', '654a80a3-2e6f-4ada-b214-0486d91d869c', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),  -- Satin Bonnet: Shopping → Shopping › Accessories
  ('df31b3d4-b0ff-4e9b-afbc-dcc871139cb0', '4eb77042-660a-41e9-a1b6-cd2057605256', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),  -- hair clip: Personal Care › Beauty & Perfume → Shopping › Accessories
  ('b3154fe2-b92f-4172-be9f-c01db9176963', '4eb77042-660a-41e9-a1b6-cd2057605256', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),  -- Headband: the same
  ('ecb05397-a0a5-4fe3-9545-383e8a5ab49d', '61f92237-3392-4f71-aca8-4dbb1df9b256', 'd0c05f29-1418-485f-9433-b4b0e97c2423'),  -- Cat House Christmas Tree: Groceries → Pets › Pet Accessories & Toys
  ('f5577c71-1527-4f8f-bf9a-f877225b4416', 'ecd9a924-7f46-4991-83ce-02825c73ce42', 'd0c05f29-1418-485f-9433-b4b0e97c2423')   -- cat toy: Pets → Pets › Pet Accessories & Toys
) as v(id, old_id, new_id)
where e.id = v.id::uuid
  and e.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and e.category_id = v.old_id::uuid
  and exists (select 1 from expense_categories c where c.id = v.new_id::uuid);

-- Name: only while it is still the old one.
update expenses e
set description = v.new_name
from (values
  ('1d96c083-ef57-4d5e-b380-e1da9fe6f254', 'eletrolytes powder', 'Electrolytes Powder'),
  ('9051246b-53be-4c8d-bcde-29c87c3060ce', 'washing machine powder', 'Stain Remover Powder'),
  ('d7575954-3c5e-45d7-aea7-c70189ea18bc', 'bonnet hair cover for sleeping', 'Satin Bonnet'),
  ('b3154fe2-b92f-4172-be9f-c01db9176963', 'hairband', 'Headband')
) as v(id, old_name, new_name)
where e.id = v.id::uuid
  and e.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and e.description = v.old_name;

-- ── 6. The lines of the purchase ─────────────────────────────────
-- Name (and the name in the line's copy of the SHOP entry), only while it
-- is still the old one.
update shopping_trip_items l
set name = v.new_name,
    grocery_snapshot = case when l.grocery_snapshot->>'name' = v.old_name
      then l.grocery_snapshot || jsonb_build_object('name', v.new_name) else l.grocery_snapshot end
from (values
  ('747ed6ad-4882-469f-962b-60e3419baad7', 'eletrolytes powder', 'Electrolytes Powder'),
  ('c11feacd-2761-474c-99a1-b6cb7c7772ba', 'washing machine powder', 'Stain Remover Powder'),
  ('8cfce438-a1a5-438c-975e-87b42d589683', 'bonnet hair cover for sleeping', 'Satin Bonnet'),
  ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'hairband', 'Headband')
) as v(id, old_name, new_name)
where l.id = v.id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and l.name = v.old_name;

-- The category in the line's copy (grocery_snapshot), only while it is
-- still the one in the export and the new one exists. Durable towels and
-- decor get the new Home & Appliances subs (as the ceramic bowl line has
-- appliances:kitchenware); the Shopping and Pets durables get no HOME
-- category (there is none for them).
update shopping_trip_items l
set grocery_snapshot = l.grocery_snapshot || jsonb_build_object('category_id', v.new_main, 'subcategory_id', v.new_sub)
from (values
  ('747ed6ad-4882-469f-962b-60e3419baad7', 'misc', null, 'health', 'health:vitamins'),                                                -- Electrolytes Powder
  ('3d12223f-4e83-4094-8cec-22a5c2639a77', 'personal-care', null, 'personal-care', 'personal-care:skin'),                              -- eye mask
  ('d4a11c6a-ca81-410f-8abc-27e078af70b1', 'toiletries', 'toiletries:hair', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398'),  -- hair oil → Beauty Care › Hair Care
  ('e75e3734-5380-401d-bcf3-81545e2124d2', null, null, 'beverages', 'beverages:coffee-tea'),                                           -- coffee syrup
  ('e7dacee7-5037-467e-998c-4176f70cb818', 'appliances', 'appliances:kitchen', 'cleaning', 'cleaning:dish'),                           -- Dishwasher Detergent
  ('48bfc064-2515-498f-9f74-ac89e495553d', 'appliances', 'appliances:kitchen', 'cleaning', 'cleaning:surface'),                        -- Oven Detergent
  ('e95ae4da-51f4-40f1-9e49-2058ecd0ebe3', 'clothes', null, 'appliances', 'appliances:textiles'),                                      -- big towel
  ('aaa18000-cc38-4e1a-887f-d2c4862c4557', 'clothes', null, 'appliances', 'appliances:textiles'),                                      -- small towel
  ('faec2ec3-915e-4992-a901-ce13884b9003', 'misc', 'misc:seasonal', 'appliances', 'appliances:decor'),                                 -- toy elf Christmas
  ('14e49fbc-c52b-41ef-82a5-d97fe7b9f8b3', 'household', 'household:air', 'appliances', 'appliances:decor'),                            -- incense holder
  ('fef3d676-3ba2-4333-94de-be190232199b', 'clothes', null, null, null),                                                               -- bra
  ('8cfce438-a1a5-438c-975e-87b42d589683', 'clothes', null, null, null),                                                               -- Satin Bonnet
  ('04be8150-492a-4813-b372-c6ebbcce109d', 'personal-care', null, null, null),                                                         -- hair clip
  ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'personal-care', null, null, null),                                                         -- Headband
  ('e9a8a655-233d-45eb-8554-262ee53dc582', 'misc', 'misc:seasonal', null, null),                                                       -- Cat House Christmas Tree
  ('45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'pet', '3d924169-d334-44ee-947a-3e3a498706fc', null, null)                                 -- cat toy
) as v(id, old_main, old_sub, new_main, new_sub)
where l.id = v.id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and (l.grocery_snapshot->>'category_id') is not distinct from v.old_main
  and (l.grocery_snapshot->>'subcategory_id') is not distinct from v.old_sub
  and (v.new_main is null or exists (select 1 from inventory_categories c where c.id = v.new_main))
  and (v.new_sub is null or exists (select 1 from inventory_categories c where c.id = v.new_sub));

-- ── 7. The SHOP entries bought by those lines ────────────────────
-- Found through the line (shopping_trip_items.grocery_item_id) and bought
-- in this purchase. Name, then category: each only while it is still the
-- old one.
update grocery_items g
set name = v.new_name
from shopping_trip_items l,
  (values
    ('747ed6ad-4882-469f-962b-60e3419baad7', 'eletrolytes powder', 'Electrolytes Powder'),
    ('c11feacd-2761-474c-99a1-b6cb7c7772ba', 'washing machine powder', 'Stain Remover Powder'),
    ('8cfce438-a1a5-438c-975e-87b42d589683', 'bonnet hair cover for sleeping', 'Satin Bonnet'),
    ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'hairband', 'Headband')
  ) as v(line_id, old_name, new_name)
where l.id = v.line_id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and g.id = l.grocery_item_id
  and g.trip_id = l.trip_id
  and g.name = v.old_name;

update grocery_items g
set category_id = v.new_main, subcategory_id = v.new_sub
from shopping_trip_items l,
  (values
    ('747ed6ad-4882-469f-962b-60e3419baad7', 'misc', null, 'health', 'health:vitamins'),                                                -- Electrolytes Powder
    ('3d12223f-4e83-4094-8cec-22a5c2639a77', 'personal-care', null, 'personal-care', 'personal-care:skin'),                              -- eye mask
    ('d4a11c6a-ca81-410f-8abc-27e078af70b1', 'toiletries', 'toiletries:hair', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398'),  -- hair oil
    ('e75e3734-5380-401d-bcf3-81545e2124d2', null, null, 'beverages', 'beverages:coffee-tea'),                                           -- coffee syrup
    ('e7dacee7-5037-467e-998c-4176f70cb818', 'appliances', 'appliances:kitchen', 'cleaning', 'cleaning:dish'),                           -- Dishwasher Detergent
    ('48bfc064-2515-498f-9f74-ac89e495553d', 'appliances', 'appliances:kitchen', 'cleaning', 'cleaning:surface'),                        -- Oven Detergent
    ('e95ae4da-51f4-40f1-9e49-2058ecd0ebe3', 'clothes', null, 'appliances', 'appliances:textiles'),                                      -- big towel
    ('aaa18000-cc38-4e1a-887f-d2c4862c4557', 'clothes', null, 'appliances', 'appliances:textiles'),                                      -- small towel
    ('faec2ec3-915e-4992-a901-ce13884b9003', 'misc', 'misc:seasonal', 'appliances', 'appliances:decor'),                                 -- toy elf Christmas
    ('14e49fbc-c52b-41ef-82a5-d97fe7b9f8b3', 'household', 'household:air', 'appliances', 'appliances:decor'),                            -- incense holder
    ('fef3d676-3ba2-4333-94de-be190232199b', 'clothes', null, null, null),                                                               -- bra
    ('8cfce438-a1a5-438c-975e-87b42d589683', 'clothes', null, null, null),                                                               -- Satin Bonnet
    ('04be8150-492a-4813-b372-c6ebbcce109d', 'personal-care', null, null, null),                                                         -- hair clip
    ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'personal-care', null, null, null),                                                         -- Headband
    ('e9a8a655-233d-45eb-8554-262ee53dc582', 'misc', 'misc:seasonal', null, null),                                                       -- Cat House Christmas Tree
    ('45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'pet', '3d924169-d334-44ee-947a-3e3a498706fc', null, null)                                 -- cat toy
  ) as v(line_id, old_main, old_sub, new_main, new_sub)
where l.id = v.line_id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and g.id = l.grocery_item_id
  and g.trip_id = l.trip_id
  and g.category_id is not distinct from v.old_main
  and g.subcategory_id is not distinct from v.old_sub
  and (v.new_main is null or exists (select 1 from inventory_categories c where c.id = v.new_main))
  and (v.new_sub is null or exists (select 1 from inventory_categories c where c.id = v.new_sub));

-- ── 8. HOME items that stay (consumables) ────────────────────────
-- Name: only while it is still the old one, and no other HOME item has
-- the new name.
update pantry_items p
set name = v.new_name
from (values
  ('4e0c3dd0-88de-4c38-9267-0f039d0005b0', 'eletrolytes powder', 'Electrolytes Powder'),
  ('c97a568a-2807-48f0-8de5-d671ddd048ac', 'washing machine powder', 'Stain Remover Powder')
) as v(id, old_name, new_name)
where p.id = v.id::uuid
  and p.name = v.old_name
  and not exists (select 1 from pantry_items x where lower(btrim(x.name)) = lower(btrim(v.new_name)) and x.id <> p.id);

-- Category: only while it is still the one in the export. Stock, minimum,
-- price and 1× never change.
update pantry_items p
set category_id = v.new_main, subcategory_id = v.new_sub
from (values
  ('4e0c3dd0-88de-4c38-9267-0f039d0005b0', 'misc', null, 'health', 'health:vitamins'),                                                -- Electrolytes Powder
  ('c2ba9a90-6c56-4945-b0b6-7b320836f870', 'personal-care', null, 'personal-care', 'personal-care:skin'),                              -- eye mask
  ('ea21e2e4-8ed6-43f8-b9a3-8750aa296250', 'toiletries', 'toiletries:hair', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398'),  -- hair oil
  ('f3556bde-425d-4bdf-b58a-cd8de81bf74c', null, null, 'beverages', 'beverages:coffee-tea')                                            -- coffee syrup
) as v(id, old_main, old_sub, new_main, new_sub)
where p.id = v.id::uuid
  and p.category_id is not distinct from v.old_main
  and p.subcategory_id is not distinct from v.old_sub
  and exists (select 1 from inventory_categories c where c.id = v.new_main)
  and exists (select 1 from inventory_categories c where c.id = v.new_sub);

-- ── 9. Durable items leave HOME (their expenses stay) ────────────
-- The ten durable items of this purchase (by id, while they still have
-- their name) and any HOME item called "Shoe Deodorizer" (any capitals).
-- Left alone: a group or an item in a group, an item with an entry in a
-- cart, an item ordered online and still on the way.
-- For each one, in this order:
--   a. every purchase line that bought it becomes an expense-only line,
--      like an appliance: no HOME item, nothing created or added, no
--      history (so Reopen never touches HOME for it);
--   b. its SHOP entries are unlinked from it;
--   c. its stock history is deleted;
--   d. the item is deleted.
-- One DO block, so the conditions are checked once per item.
do $$
declare
  v_item uuid;
begin
  for v_item in
    select p.id
    from pantry_items p
    left join (values
      ('e4250e5b-910e-466f-9e27-194fb1257af7', 'big towel'),
      ('d3365efa-e523-4d3c-93a3-d4fadd5218c9', 'small towel'),
      ('8b164c9e-524f-4ed5-9fd0-1deaed235956', 'toy elf christmas'),
      ('afd18a37-53de-472e-835b-4687c740d342', 'incense holder'),
      ('e8c07826-8ecf-4ff2-9f8e-ebc4d653b154', 'bra'),
      ('68f96d81-a730-4341-8590-dd4d08f36863', 'bonnet hair cover for sleeping'),
      ('f02fe6a2-8daf-469d-b5a9-faf893da60fb', 'hair clip'),
      ('53cbd441-1ba1-4243-9cf5-391666296b5e', 'hairband'),
      ('a35c5cfd-e5df-4614-88ce-9ef2d269d228', 'cat house christmas tree'),
      ('c37b962d-19d2-4d8a-bf90-2502cb3305aa', 'cat toy')
    ) as d(id, name) on d.id::uuid = p.id
    where (lower(btrim(p.name)) = d.name or lower(btrim(p.name)) = 'shoe deodorizer')
      and not coalesce(p.is_group, false)
      and p.group_id is null
      and not exists (select 1 from grocery_items g where g.pantry_item_id = p.id and not g.completed and coalesce(g.in_cart, false))
      and not exists (
        select 1 from orders o
        where o.status = 'on_the_way'
          and (o.pantry_item_id = p.id or o.grocery_item_id in (select g.id from grocery_items g where g.pantry_item_id = p.id))
      )
  loop
    update shopping_trip_items
    set pantry_item_id = null,
        pantry_created = false,
        pantry_before = null,
        stock_added = 0,
        stock_discarded = 0,
        log_ids = '{}',
        grocery_snapshot = grocery_snapshot || jsonb_build_object('pantry_item_id', null)
    where pantry_item_id = v_item;

    update grocery_items set pantry_item_id = null where pantry_item_id = v_item;

    delete from stock_logs where item_id = v_item;

    delete from pantry_items where id = v_item;
  end loop;
end $$;

-- ── 10. Remembered names (category_memory) ───────────────────────
-- The id is the name as the app normalises it (normalizeName() in
-- src/lib/categoryGuess.js); the keys below are checked against it in
-- supabase/migrations.test.js.
-- a. The old names of renamed items are forgotten, while they still hold
--    what the export showed.
delete from category_memory cm
using (values
  ('eletrolytes powder', 'misc', null),
  ('washing machine powder', 'laundry', 'laundry:stain'),
  ('hairband', 'personal-care', null),
  ('bonnet hair cover for sleeping', 'clothes', null)
) as v(id, old_main, old_sub)
where cm.id = v.id
  and cm.category_id is not distinct from v.old_main
  and cm.subcategory_id is not distinct from v.old_sub
  and cm.expense_category_id is null;

-- b. Names already remembered with the wrong category (as in the export)
--    get the right one.
update category_memory cm
set name = v.name, category_id = v.new_main, subcategory_id = v.new_sub, expense_category_id = v.new_money::uuid,
    source = 'user', updated_at = now()
from (values
  ('eye mask', 'eye mask', 'personal-care', null, 'personal-care', 'personal-care:skin', null),
  ('big towel', 'big towel', 'clothes', null, 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),  -- Home & Appliances › Home Textiles
  ('small towel', 'small towel', 'clothes', null, 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
  ('bra', 'bra', 'clothes', null, null, null, '732af8e0-924c-471c-b0e8-ac9286ce074e'),                                    -- Shopping › Clothing
  ('hair clip', 'hair clip', 'personal-care', null, null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e')                   -- Shopping › Accessories
) as v(id, name, old_main, old_sub, new_main, new_sub, new_money)
where cm.id = v.id
  and cm.category_id is not distinct from v.old_main
  and cm.subcategory_id is not distinct from v.old_sub
  and cm.expense_category_id is null
  and (v.new_main is null or exists (select 1 from inventory_categories c where c.id = v.new_main))
  and (v.new_sub is null or exists (select 1 from inventory_categories c where c.id = v.new_sub))
  and (v.new_money is null or exists (select 1 from expense_categories c where c.id = v.new_money::uuid));

-- c. Names not remembered yet are added. A name remembered with another
--    category (chosen in the app) is left alone; the check shows it.
insert into category_memory (id, name, category_id, subcategory_id, expense_category_id, source, updated_at)
select v.id, v.name, v.main, v.sub, v.money::uuid, 'user', now()
from (values
  ('electrolytes powder', 'Electrolytes Powder', 'health', 'health:vitamins', null),
  ('eye mask', 'eye mask', 'personal-care', 'personal-care:skin', null),
  ('hair oil', 'hair oil', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', null),
  ('hair water', 'hair water', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', null),
  ('coffee syrup', 'coffee syrup', 'beverages', 'beverages:coffee-tea', null),
  ('stain remover powder', 'Stain Remover Powder', 'laundry', 'laundry:stain', null),
  ('dishwasher detergent', 'Dishwasher Detergent', 'cleaning', 'cleaning:dish', null),
  ('oven detergent', 'Oven Detergent', 'cleaning', 'cleaning:surface', null),
  ('big towel', 'big towel', 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),                     -- Home & Appliances › Home Textiles
  ('small towel', 'small towel', 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
  ('toy elf christmas', 'toy elf Christmas', 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),        -- Home & Appliances › Home Decor
  ('incense holder', 'incense holder', 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),
  ('bra', 'bra', null, null, '732af8e0-924c-471c-b0e8-ac9286ce074e'),                                                         -- Shopping › Clothing
  ('satin bonnet', 'Satin Bonnet', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),                                       -- Shopping › Accessories
  ('hair clip', 'hair clip', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
  ('headband', 'Headband', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
  ('cat house christmas tree', 'Cat House Christmas Tree', null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423'),               -- Pets › Pet Accessories & Toys
  ('cat toy', 'cat toy', null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423')
) as v(id, name, main, sub, money)
where (v.main is null or exists (select 1 from inventory_categories c where c.id = v.main))
  and (v.sub is null or exists (select 1 from inventory_categories c where c.id = v.sub))
  and (v.money is null or exists (select 1 from expense_categories c where c.id = v.money::uuid))
on conflict (id) do nothing;

-- ── 11. HOME: delete the category "clothes" if nothing uses it ───
-- Its budget mapping row (→ Shopping) is deleted with it
-- (category_budget_map.id → on delete cascade). Kept, and the check says
-- why, while anything still points to it: an item, a SHOP entry, a
-- remembered name, a sub-category, a purchase line's copy or an AI
-- proposal.
delete from inventory_categories c
where c.id = 'clothes'
  and lower(btrim(c.name)) = 'clothes'
  and c.parent_id is null
  and not exists (select 1 from inventory_categories s where s.parent_id = 'clothes')
  and not exists (select 1 from pantry_items p where p.category_id = 'clothes' or p.subcategory_id = 'clothes')
  and not exists (select 1 from grocery_items g where g.category_id = 'clothes' or g.subcategory_id = 'clothes')
  and not exists (select 1 from category_memory m where m.category_id = 'clothes' or m.subcategory_id = 'clothes')
  and not exists (
    select 1 from shopping_trip_items l
    where l.grocery_snapshot->>'category_id' = 'clothes' or l.grocery_snapshot->>'subcategory_id' = 'clothes'
  )
  and not exists (
    select 1 from ai_category_proposals a
    where 'clothes' in (a.from_category_id, a.from_subcategory_id, a.to_category_id, a.to_subcategory_id, a.new_category_parent_id)
  );

commit;

-- ── Check ────────────────────────────────────────────────────────
-- Read only. Columns: section, item (what 025 wants), value (what is
-- there now), then for the lines of the purchase: line name, expense
-- name, HOME item ("none" if there is none), its HOME category (for a
-- line without an item: "line:" and the category kept in the line),
-- budget category, and what "Apply the mapping to past purchases" would do
-- with it. status: ok · CHECK: … (something is not as planned: send it)
-- · MISMATCH (the purchase's totals) · skipped / left / kept: … (a row
-- was left alone on purpose, with the reason).
-- Names as the app shows them now (renamed categories show their new
-- name).
with
home_cat as (
  -- HOME names as the app shows them (CATEGORY_NAME_OVERRIDES).
  select c.id, c.parent_id,
    case when c.id = 'personal-care' and c.name = 'Personal Care & Beauty' then 'Beauty Care' else c.name end as name
  from inventory_categories c
),
money_cat as (
  select c.id, c.parent_id, case when p.id is null then c.name else p.name || ' › ' || c.name end as path
  from expense_categories c
  left join expense_categories p on p.id = c.parent_id
),
-- What 025 wants for the lines it changes. kind: stays (a HOME item that
-- stays), no item (Irene adds the HOME item by hand), durable (no HOME
-- item, expense only). known_move: "Apply the mapping" would still move
-- this expense (no HOME category books to its budget category; the app
-- fix comes in a later round).
plan(n, line_id, item_id, expense_id, name, kind, home_main, home_sub, line_main, line_sub, budget_id, known_move) as (values
  (1, '747ed6ad-4882-469f-962b-60e3419baad7', '4e0c3dd0-88de-4c38-9267-0f039d0005b0', '1d96c083-ef57-4d5e-b380-e1da9fe6f254', 'Electrolytes Powder', 'stays', 'health', 'health:vitamins', 'health', 'health:vitamins', '8fbe343f-6fd9-4c58-874b-d9bd809be461', false),
  (2, '3d12223f-4e83-4094-8cec-22a5c2639a77', 'c2ba9a90-6c56-4945-b0b6-7b320836f870', 'f46ff8fe-27b7-4884-9a04-8ea35c62ca28', 'eye mask', 'stays', 'personal-care', 'personal-care:skin', 'personal-care', 'personal-care:skin', '4eb77042-660a-41e9-a1b6-cd2057605256', false),
  (3, 'd4a11c6a-ca81-410f-8abc-27e078af70b1', 'ea21e2e4-8ed6-43f8-b9a3-8750aa296250', '8ad2e519-fea1-43ad-b663-2af866c1d3b3', 'hair oil', 'stays', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', '4eb77042-660a-41e9-a1b6-cd2057605256', false),
  (4, 'c5a57022-370b-4e11-b0a9-6d735e83a943', '5fa2c1d5-fb3c-4eec-a74f-9745aa1ef547', '18dffaeb-cdf0-4f32-9c09-928be13cf7ae', 'hair water', 'stays', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', '4eb77042-660a-41e9-a1b6-cd2057605256', false),
  (5, 'e75e3734-5380-401d-bcf3-81545e2124d2', 'f3556bde-425d-4bdf-b58a-cd8de81bf74c', '6c27e414-ff8d-46d9-86a5-f01be3b57b27', 'coffee syrup', 'stays', 'beverages', 'beverages:coffee-tea', 'beverages', 'beverages:coffee-tea', '61f92237-3392-4f71-aca8-4dbb1df9b256', false),
  (6, 'c11feacd-2761-474c-99a1-b6cb7c7772ba', 'c97a568a-2807-48f0-8de5-d671ddd048ac', '9051246b-53be-4c8d-bcde-29c87c3060ce', 'Stain Remover Powder', 'stays', 'laundry', 'laundry:stain', 'laundry', 'laundry:stain', '61f92237-3392-4f71-aca8-4dbb1df9b256', false),
  (7, 'e7dacee7-5037-467e-998c-4176f70cb818', null, '5b04fc1c-153a-412e-960b-1465656339b0', 'Dishwasher Detergent', 'no item', null, null, 'cleaning', 'cleaning:dish', '61f92237-3392-4f71-aca8-4dbb1df9b256', false),
  (8, '48bfc064-2515-498f-9f74-ac89e495553d', null, 'b0558eea-4dde-4094-a743-440cc72ab83d', 'Oven Detergent', 'no item', null, null, 'cleaning', 'cleaning:surface', '61f92237-3392-4f71-aca8-4dbb1df9b256', false),
  (9, 'e95ae4da-51f4-40f1-9e49-2058ecd0ebe3', 'e4250e5b-910e-466f-9e27-194fb1257af7', '92b2b31e-5b74-44a9-a2fe-7d3e941befe4', 'big towel', 'durable', null, null, 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391', false),
  (10, 'aaa18000-cc38-4e1a-887f-d2c4862c4557', 'd3365efa-e523-4d3c-93a3-d4fadd5218c9', '8e5dff64-b8e3-4b3d-869f-f592a922a2ea', 'small towel', 'durable', null, null, 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391', false),
  (11, 'faec2ec3-915e-4992-a901-ce13884b9003', '8b164c9e-524f-4ed5-9fd0-1deaed235956', 'a4473501-f21b-49f8-9118-0c5e1ab899cf', 'toy elf Christmas', 'durable', null, null, 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a', false),
  (12, '14e49fbc-c52b-41ef-82a5-d97fe7b9f8b3', 'afd18a37-53de-472e-835b-4687c740d342', '10985ab4-80d1-43c3-807a-7d03dcee51d0', 'incense holder', 'durable', null, null, 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a', false),
  (13, 'fef3d676-3ba2-4333-94de-be190232199b', 'e8c07826-8ecf-4ff2-9f8e-ebc4d653b154', '54dda4c1-dfdc-424a-9578-0e55c2f7d4c5', 'bra', 'durable', null, null, null, null, '732af8e0-924c-471c-b0e8-ac9286ce074e', true),
  (14, '8cfce438-a1a5-438c-975e-87b42d589683', '68f96d81-a730-4341-8590-dd4d08f36863', 'd7575954-3c5e-45d7-aea7-c70189ea18bc', 'Satin Bonnet', 'durable', null, null, null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', true),
  (15, '04be8150-492a-4813-b372-c6ebbcce109d', 'f02fe6a2-8daf-469d-b5a9-faf893da60fb', 'df31b3d4-b0ff-4e9b-afbc-dcc871139cb0', 'hair clip', 'durable', null, null, null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', true),
  (16, 'f2eb0500-a8c0-497c-927a-e96b282d8b08', '53cbd441-1ba1-4243-9cf5-391666296b5e', 'b3154fe2-b92f-4172-be9f-c01db9176963', 'Headband', 'durable', null, null, null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', true),
  (17, 'e9a8a655-233d-45eb-8554-262ee53dc582', 'a35c5cfd-e5df-4614-88ce-9ef2d269d228', 'ecb05397-a0a5-4fe3-9545-383e8a5ab49d', 'Cat House Christmas Tree', 'durable', null, null, null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423', true),
  (18, '45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'c37b962d-19d2-4d8a-bf90-2502cb3305aa', 'f5577c71-1527-4f8f-bf9a-f877225b4416', 'cat toy', 'durable', null, null, null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423', true)
),
lines as (
  select l.*, p.n as plan_n, p.item_id as plan_item, p.name as plan_name, p.kind, p.home_main, p.home_sub,
    p.line_main, p.line_sub, p.budget_id::uuid as plan_budget, coalesce(p.known_move, false) as known_move
  from shopping_trip_items l
  left join plan p on p.line_id::uuid = l.id
  where l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
),
-- The budget category "Apply the mapping to past purchases" would give a
-- line, worked out like budgetCategoryFor() in src/lib/budgetMap.js from
-- the category kept in the line: the sub-category's mapping, else the
-- main's, else the default (an appliance: the Home & Appliances sub with
-- the same name, else Home & Appliances; anything else: Groceries). The
-- app finds those two by name, so this does too.
line_rows as (
  select
    l.*,
    e.id as e_id, e.description, e.category_id as budget_now,
    hi.id as hi_id, hi.name as hi_name, hi.category_id as hi_main, hi.subcategory_id as hi_sub,
    g.id as g_id, g.name as g_name, g.category_id as g_main, g.subcategory_id as g_sub, g.pantry_item_id as g_item,
    coalesce(
      (select m.expense_category_id from category_budget_map m where m.id = l.grocery_snapshot->>'subcategory_id'),
      (select m.expense_category_id from category_budget_map m where m.id = l.grocery_snapshot->>'category_id'),
      case when l.grocery_snapshot->>'category_id' = 'appliances' then coalesce(
        (select s.id from expense_categories s
         join expense_categories h on h.id = s.parent_id and h.name = 'Home & Appliances' and h.parent_id is null
         where s.name = (select c.name from inventory_categories c where c.id = l.grocery_snapshot->>'subcategory_id')
         limit 1),
        (select h.id from expense_categories h where h.name = 'Home & Appliances' and h.parent_id is null limit 1))
      else (select x.id from expense_categories x where x.name = 'Groceries' order by x.parent_id nulls first limit 1)
      end
    ) as mapped
  from lines l
  left join expenses e on e.id = l.expense_id
  left join pantry_items hi on hi.id = l.pantry_item_id
  left join grocery_items g on g.id = l.grocery_item_id
),
line_checks as (
  select r.*,
    concat_ws(', ',
      case when r.e_id is null then 'expense missing' end,
      case when r.plan_n is not null and r.name is distinct from r.plan_name then 'line name' end,
      case when r.plan_n is not null and r.e_id is not null and r.description is distinct from r.plan_name then 'expense name' end,
      case when r.plan_n is not null and r.e_id is not null and r.budget_now is distinct from r.plan_budget then 'budget category' end,
      case when r.plan_n is not null and ((r.grocery_snapshot->>'category_id') is distinct from r.line_main
                                          or (r.grocery_snapshot->>'subcategory_id') is distinct from r.line_sub) then 'category in the line' end,
      case when r.plan_n is not null and r.g_id is not null and (r.g_name is distinct from r.plan_name
                                          or r.g_main is distinct from r.line_main or r.g_sub is distinct from r.line_sub) then 'SHOP entry' end,
      case
        when r.kind = 'stays' and r.hi_id is null then 'HOME item missing'
        when r.kind = 'stays' and (r.hi_id <> r.plan_item::uuid or r.hi_name is distinct from r.plan_name
                                   or r.hi_main is distinct from r.home_main or r.hi_sub is distinct from r.home_sub) then 'HOME item'
        when r.kind = 'durable' and (r.pantry_item_id is not null or exists (select 1 from pantry_items x where x.id = r.plan_item::uuid)) then 'still in HOME'
        when r.kind = 'durable' and (r.stock_added <> 0 or r.pantry_created or r.log_ids <> '{}' or r.g_item is not null) then 'line not expense-only'
        when r.kind = 'no item' and r.pantry_item_id is not null then 'HOME item linked'
      end,
      case when r.e_id is not null and r.mapped is distinct from r.budget_now and not r.known_move then 'Apply the mapping would move it' end
    ) as problems
  from line_rows r
)
select section, item, value, line_name, expense_description, home_item, home_category, budget_category, mapping_button, status from (
  -- One row per line of the purchase (31)
  select 1 as sort, lower(c.name) as n, '1 line' as section,
    coalesce(c.plan_name, c.name) as item,
    case c.kind
      when 'stays' then 'stays in HOME'
      when 'no item' then 'no HOME item (add it by hand)'
      when 'durable' then 'durable: expense only'
      else 'not changed by 025'
    end as value,
    c.name as line_name,
    c.description as expense_description,
    coalesce(c.hi_name, 'none') as home_item,
    case
      when c.hi_id is not null then coalesce(hm.name, 'no category') || coalesce(' › ' || hs.name, '')
      else 'line: ' || coalesce(sm.name, 'no category') || coalesce(' › ' || ss.name, '')
    end as home_category,
    b.path as budget_category,
    case
      when c.e_id is null then null
      when c.mapped is not distinct from c.budget_now then 'no change'
      when c.known_move then 'would move to ' || coalesce(mp.path, '?') || ' (known: app fix in a later round)'
      else 'would move to ' || coalesce(mp.path, '?')
    end as mapping_button,
    case when c.problems = '' then 'ok' else 'CHECK: ' || c.problems end as status
  from line_checks c
  left join home_cat hm on hm.id = c.hi_main
  left join home_cat hs on hs.id = c.hi_sub
  left join home_cat sm on sm.id = c.grocery_snapshot->>'category_id'
  left join home_cat ss on ss.id = c.grocery_snapshot->>'subcategory_id'
  left join money_cat b on b.id = c.budget_now
  left join money_cat mp on mp.id = c.mapped

  union all
  -- The purchase itself never changes (Irene's export: 31 expenses, € 26.76)
  select 2, '1', '2 purchase', 'lines of the purchase = 31',
    (select count(*)::text from shopping_trip_items where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'),
    null, null, null, null, null, null,
    case when (select count(*) from shopping_trip_items where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f') = 31 then 'ok' else 'MISMATCH' end
  union all
  select 2, '2', '2 purchase', 'expenses of the purchase = 31',
    (select count(*)::text from expenses where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'),
    null, null, null, null, null, null,
    case when (select count(*) from expenses where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f') = 31 then 'ok' else 'MISMATCH' end
  union all
  select 2, '3', '2 purchase', 'sum of their amounts = 26.76',
    (select coalesce(sum(amount), 0)::text from expenses where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'),
    null, null, null, null, null, null,
    case when (select coalesce(sum(amount), 0) from expenses where trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f') = 26.76 then 'ok' else 'MISMATCH' end
  union all
  select 2, '4', '2 purchase', 'purchase total = 26.76',
    (select total::text from shopping_trips where id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'),
    null, null, null, null, null, null,
    case when (select total from shopping_trips where id = '1d47dd08-f03a-4df8-a214-ac00f671d54f') = 26.76 then 'ok' else 'MISMATCH' end

  union all
  -- New MONEY categories
  select 3, v.n::text, '3 new categories', 'MONEY ' || v.label,
    case when c.id is not null then m.path end,
    null, null, null, null, null, null,
    case
      when c.id is not null then 'ok'
      when not exists (select 1 from expense_categories x where x.id = v.parent_id::uuid and x.parent_id is null) then 'skipped: parent missing'
      when exists (select 1 from expense_categories x where lower(btrim(x.name)) = lower(btrim(v.name))) then 'skipped: name exists'
      else 'CHECK: missing'
    end
  from (values
    (1, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', 'Accessories', 'Shopping › Accessories', '654a80a3-2e6f-4ada-b214-0486d91d869c'),
    (2, 'f924edef-bf90-477d-8303-ddc4a2b27391', 'Home Textiles', 'Home & Appliances › Home Textiles', '199ec782-505a-4292-984e-08ae1d76469f'),
    (3, '3472a299-73f6-4249-bee4-a5469d1c807a', 'Home Decor', 'Home & Appliances › Home Decor', '199ec782-505a-4292-984e-08ae1d76469f'),
    (4, 'd0c05f29-1418-485f-9433-b4b0e97c2423', 'Pet Accessories & Toys', 'Pets › Pet Accessories & Toys', 'ecd9a924-7f46-4991-83ce-02825c73ce42')
  ) as v(n, id, name, label, parent_id)
  left join expense_categories c on c.id = v.id::uuid
  left join money_cat m on m.id = c.id

  union all
  -- New HOME categories, and the budget category they book to
  select 3, (4 + v.n)::text, '3 new categories', 'HOME ' || v.label,
    case when c.id is not null then
      coalesce(hp.name, '?') || ' › ' || c.name || ' · books to ' || coalesce(m.path, 'nothing')
    end,
    null, null, null, null, null, null,
    case
      when c.id is null and not exists (select 1 from inventory_categories x where x.id = 'appliances') then 'skipped: parent missing'
      when c.id is null and exists (select 1 from inventory_categories x where lower(btrim(x.name)) = lower(btrim(v.name))) then 'skipped: name exists'
      when c.id is null then 'CHECK: missing'
      when t.target is distinct from v.money_id::uuid then 'CHECK: books to another budget category'
      else 'ok'
    end
  from (values
    (1, 'appliances:textiles', 'Home Textiles', 'Home & Appliances › Home Textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
    (2, 'appliances:decor', 'Home Decor', 'Home & Appliances › Home Decor', '3472a299-73f6-4249-bee4-a5469d1c807a')
  ) as v(n, id, name, label, money_id)
  left join inventory_categories c on c.id = v.id
  left join home_cat hp on hp.id = c.parent_id
  left join lateral (
    -- As in the lines above: its own mapping, the main's, else the Home &
    -- Appliances sub with its name.
    select coalesce(
      (select mm.expense_category_id from category_budget_map mm where mm.id = c.id),
      (select mm.expense_category_id from category_budget_map mm where mm.id = 'appliances'),
      (select s.id from expense_categories s
       join expense_categories h on h.id = s.parent_id and h.name = 'Home & Appliances' and h.parent_id is null
       where s.name = c.name limit 1),
      (select h.id from expense_categories h where h.name = 'Home & Appliances' and h.parent_id is null limit 1)
    ) as target
  ) t on c.id is not null
  left join money_cat m on m.id = t.target

  union all
  -- Renamed categories (never renamed back: a name changed by hand stays)
  select 4, '1', '4 renamed', 'MONEY Shoes & Accessories → Footwear',
    m.path, null, null, null, null, null, null,
    case
      when c.id is null then 'CHECK: missing'
      when c.name = 'Footwear' then 'ok'
      when c.name = 'Shoes & Accessories' then 'skipped: name exists'
      else 'left: renamed by hand'
    end
  from (select 1) as one
  left join expense_categories c on c.id = '0f7f387b-0c4a-4095-8865-59cfac4c586a'
  left join money_cat m on m.id = c.id
  union all
  select 4, '2', '4 renamed', 'HOME Hair Water → Hair Care',
    coalesce(hp.name || ' › ', '') || c.name, null, null, null, null, null, null,
    case
      when c.id is null then 'CHECK: missing'
      when c.name = 'Hair Care' then 'ok'
      when c.name = 'Hair Water' then 'skipped: name exists'
      else 'left: renamed by hand'
    end
  from (select 1) as one
  left join inventory_categories c on c.id = '3ff635c0-7fd1-46ff-ac49-8e408c032398'
  left join home_cat hp on hp.id = c.parent_id

  union all
  -- The HOME category "clothes"
  select 5, '1', '5 clothes', 'HOME category "clothes" deleted',
    case when exists (select 1 from inventory_categories where id = 'clothes') then 'still there' else 'gone' end,
    null, null, null, null, null, null,
    case when exists (select 1 from inventory_categories where id = 'clothes') then 'kept: still used (see the next row)' else 'ok' end
  union all
  select 5, '2', '5 clothes', 'nothing points to "clothes"',
    coalesce(nullif(concat_ws(', ',
      (select 'HOME items ' || count(*) from pantry_items where 'clothes' in (category_id, subcategory_id) having count(*) > 0),
      (select 'SHOP entries ' || count(*) from grocery_items where 'clothes' in (category_id, subcategory_id) having count(*) > 0),
      (select 'remembered names ' || count(*) from category_memory where 'clothes' in (category_id, subcategory_id) having count(*) > 0),
      (select 'sub-categories ' || count(*) from inventory_categories where parent_id = 'clothes' having count(*) > 0),
      (select 'budget mapping ' || count(*) from category_budget_map where id = 'clothes' having count(*) > 0),
      (select 'purchase lines ' || count(*) from shopping_trip_items
        where 'clothes' in (grocery_snapshot->>'category_id', grocery_snapshot->>'subcategory_id') having count(*) > 0),
      (select 'AI proposals ' || count(*) from ai_category_proposals
        where 'clothes' in (from_category_id, from_subcategory_id, to_category_id, to_subcategory_id, new_category_parent_id) having count(*) > 0)
    ), ''), 'none'),
    null, null, null, null, null, null,
    case when
      exists (select 1 from pantry_items where 'clothes' in (category_id, subcategory_id))
      or exists (select 1 from grocery_items where 'clothes' in (category_id, subcategory_id))
      or exists (select 1 from category_memory where 'clothes' in (category_id, subcategory_id))
      or exists (select 1 from inventory_categories where parent_id = 'clothes')
      or exists (select 1 from category_budget_map where id = 'clothes')
      or exists (select 1 from shopping_trip_items where 'clothes' in (grocery_snapshot->>'category_id', grocery_snapshot->>'subcategory_id'))
      or exists (select 1 from ai_category_proposals where 'clothes' in (from_category_id, from_subcategory_id, to_category_id, to_subcategory_id, new_category_parent_id))
    then 'CHECK: still used' else 'ok' end

  union all
  -- Remembered names: the old ones are gone…
  select 6, '00', '6 remembered names', 'old names forgotten',
    coalesce((select string_agg(id, ', ' order by id) from category_memory
              where id in ('eletrolytes powder', 'washing machine powder', 'hairband', 'bonnet hair cover for sleeping')), 'none left'),
    null, null, null, null, null, null,
    case when exists (select 1 from category_memory
                      where id in ('eletrolytes powder', 'washing machine powder', 'hairband', 'bonnet hair cover for sleeping'))
      then 'CHECK: still remembered (changed by hand?)' else 'ok' end
  union all
  -- … and each name has the right HOME and budget category
  select 6, lpad(v.n::text, 2, '0'), '6 remembered names', v.id,
    case when cm.id is null then 'not remembered'
      else coalesce(hm.name, 'no HOME category') || coalesce(' › ' || hs.name, '') || ' · budget: ' || coalesce(b.path, 'none')
    end,
    null, null, null, null, null, null,
    case
      when cm.id is null then 'CHECK: missing'
      when cm.category_id is not distinct from v.main and cm.subcategory_id is not distinct from v.sub
           and cm.expense_category_id is not distinct from v.money::uuid then 'ok'
      else 'CHECK: remembered differently (left alone)'
    end
  from (values
    (1, 'electrolytes powder', 'health', 'health:vitamins', null),
    (2, 'eye mask', 'personal-care', 'personal-care:skin', null),
    (3, 'hair oil', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', null),
    (4, 'hair water', 'personal-care', '3ff635c0-7fd1-46ff-ac49-8e408c032398', null),
    (5, 'coffee syrup', 'beverages', 'beverages:coffee-tea', null),
    (6, 'stain remover powder', 'laundry', 'laundry:stain', null),
    (7, 'dishwasher detergent', 'cleaning', 'cleaning:dish', null),
    (8, 'oven detergent', 'cleaning', 'cleaning:surface', null),
    (9, 'big towel', 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
    (10, 'small towel', 'appliances', 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
    (11, 'toy elf christmas', 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),
    (12, 'incense holder', 'appliances', 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),
    (13, 'bra', null, null, '732af8e0-924c-471c-b0e8-ac9286ce074e'),
    (14, 'satin bonnet', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
    (15, 'hair clip', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
    (16, 'headband', null, null, 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
    (17, 'cat house christmas tree', null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423'),
    (18, 'cat toy', null, null, 'd0c05f29-1418-485f-9433-b4b0e97c2423')
  ) as v(n, id, main, sub, money)
  left join category_memory cm on cm.id = v.id
  left join home_cat hm on hm.id = cm.category_id
  left join home_cat hs on hs.id = cm.subcategory_id
  left join money_cat b on b.id = cm.expense_category_id

  union all
  -- A HOME item "Shoe Deodorizer" (durable): removed, or why it was kept
  select 7, '1', '7 Shoe Deodorizer', 'no HOME item "Shoe Deodorizer"',
    coalesce((select string_agg(p.name || ' (' ||
        concat_ws(', ',
          case when coalesce(p.is_group, false) or p.group_id is not null then 'a group or in a group' end,
          case when exists (select 1 from grocery_items g where g.pantry_item_id = p.id and not g.completed and coalesce(g.in_cart, false)) then 'in a cart' end,
          case when exists (select 1 from orders o where o.status = 'on_the_way'
                            and (o.pantry_item_id = p.id or o.grocery_item_id in (select g.id from grocery_items g where g.pantry_item_id = p.id))) then 'ordered online, on the way' end
        ) || ')', '; ')
      from pantry_items p where lower(btrim(p.name)) = 'shoe deodorizer'), 'none in HOME'),
    null, null, null, null, null, null,
    case when exists (select 1 from pantry_items p where lower(btrim(p.name)) = 'shoe deodorizer')
      then 'CHECK: kept (see value)' else 'ok' end
) as checks
order by sort, n;

-- End of 025
