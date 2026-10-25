-- 026: the durable lock (round 9F, docs/plan-oct-2026.md "9F. Durable
-- lock"). Categories, budget mapping and a few data fixes only.
--
-- The rule (Zidane): HOME stock is only for consumables, things bought
-- again. A durable (bought once and kept) is a MONEY expense only. In the
-- app every sub-category of the HOME main `appliances` is durable, so
-- this file gives that tree the durable kinds it was missing.
--
-- What it does, in this order (one transaction):
--   1. HOME: new sub-categories under `appliances` — Clothing, Footwear,
--      Accessories, Pet Accessories & Toys, Glasses, Furniture — and
--      Health & Medicine › Contact Lenses, Laundry Supplies › Washing
--      Machine Care (both consumables).
--   2. HOME: `appliances` "Home & Appliances" → "Durables";
--      `appliances:electronics` "Electronics & Work Equipment" →
--      "Electronics". (The MONEY main "Home & Appliances" keeps its name:
--      the app finds it by name.)
--   3. HOME: "Gifts & Party" (`misc:gifts`) moves under `appliances`, with
--      its id (nothing is deleted), only while nothing uses it.
--   4. MONEY: a new main "Work"; Home & Appliances › Furniture; Shopping ›
--      Electronics is deleted only while nothing uses it; then Home &
--      Appliances › "Electronics & Work Equipment" → "Electronics" (the
--      one electronics category).
--   5. Budget mapping rows by id for every `appliances` sub, Gifts & Party
--      and Contact Lenses, so a MONEY rename never breaks the link. Only
--      added where missing: a row chosen by hand is never changed.
--   6. The Action purchase of 17/10 (fixed by 025): its six Shopping / Pets
--      durables get a durable HOME sub-category — on the purchase line, on
--      its SHOP entry and on the remembered name (its budget category is
--      kept) — so Reopen and "Apply the mapping…" see them as durables.
--      Their expenses are not changed.
--   7. HOME item "Washing Machine Cleaner" (and its open SHOP entry and
--      remembered name) → Laundry Supplies › Washing Machine Care.
--   8. HOME item "Hair Gel" (and its remembered name) → Beauty Care ›
--      Hair Care.
--   9. Expense "Working Ear Plug" → Work.
--  10. The SELECT at the end shows the result (one row per step).
--
-- Safe to run again, also after renames made in the app: every write is
-- by id and only while the row still holds the value it has now (a second
-- run changes nothing; a value changed by hand is left alone and the check
-- says CHECK). MONEY categories are found by id only. A new category is
-- skipped when its name already exists (any capitals, among HOME or among
-- MONEY). Amounts, discounts, coupons, totals, dates, payers, stores,
-- quantities and stock are never touched. No table, function, policy or
-- grant. Needs 024 and 025 (run them first).
--
-- Why it is safe to delete Shopping › Electronics when nothing uses it
-- (foreign keys): expenses.category_id and orders.category_id would be
-- set to null, category_budget_map and expense_category_colors rows and
-- its sub-categories deleted with it (cascade), category_memory set to
-- null. So it is deleted only while no expense, order, mapping row,
-- remembered name or sub-category points to it (its colour row, if any,
-- goes with it: sub colours follow the main and are unused).
--
-- How to run: paste the whole file into the Supabase SQL Editor, scroll
-- to the last line to check that it ends with "-- End of 026", then press
-- Run. Send the result table (the last SELECT) for checking.

begin;

-- ── 1. HOME: new sub-categories ──────────────────────────────────
-- Only under a main that exists, and only when no HOME category has the
-- name already.
insert into inventory_categories (id, name, parent_id, type, sort_order)
select v.id, v.name, v.parent_id, 'sub', v.sort_order
from (values
  ('appliances:clothing', 'Clothing', 'appliances', 8),
  ('appliances:footwear', 'Footwear', 'appliances', 9),
  ('appliances:accessories', 'Accessories', 'appliances', 10),
  ('appliances:pet', 'Pet Accessories & Toys', 'appliances', 11),
  ('appliances:glasses', 'Glasses', 'appliances', 12),
  ('appliances:furniture', 'Furniture', 'appliances', 13),
  ('health:contact-lenses', 'Contact Lenses', 'health', 4),
  ('laundry:machine-care', 'Washing Machine Care', 'laundry', 6)
) as v(id, name, parent_id, sort_order)
where exists (select 1 from inventory_categories p where p.id = v.parent_id and p.parent_id is null)
  and not exists (select 1 from inventory_categories c where lower(btrim(c.name)) = lower(btrim(v.name)) and c.id <> v.id)
on conflict (id) do nothing;

-- ── 2. HOME: two renames ─────────────────────────────────────────
-- Only while the old name is still there, and the new one is free.
update inventory_categories
set name = 'Durables'
where id = 'appliances'
  and name = 'Home & Appliances'
  and not exists (select 1 from inventory_categories c where lower(btrim(c.name)) = 'durables' and c.id <> 'appliances');

update inventory_categories
set name = 'Electronics'
where id = 'appliances:electronics'
  and name = 'Electronics & Work Equipment'
  and not exists (select 1 from inventory_categories c where lower(btrim(c.name)) = 'electronics' and c.id <> 'appliances:electronics');

-- ── 3. HOME: Gifts & Party into the Durables tree ────────────────
-- The same id moves (as the app's own "Move" does): its mapping row and
-- the copies kept on old purchase lines still point at it, nothing is
-- deleted. Only while it is still under Miscellaneous / Seasonal and no
-- item, SHOP entry, remembered name or sub-category uses it (items there
-- would have stock in the Durables tree). No code reads a parent from
-- the "misc:" part of the id.
update inventory_categories c
set parent_id = 'appliances'
where c.id = 'misc:gifts'
  and c.parent_id = 'misc'
  and exists (select 1 from inventory_categories p where p.id = 'appliances' and p.parent_id is null)
  and not exists (select 1 from pantry_items p where 'misc:gifts' in (p.category_id, p.subcategory_id))
  and not exists (select 1 from grocery_items g where 'misc:gifts' in (g.category_id, g.subcategory_id))
  and not exists (select 1 from category_memory m where 'misc:gifts' in (m.category_id, m.subcategory_id))
  and not exists (select 1 from inventory_categories s where s.parent_id = 'misc:gifts');

-- ── 4. MONEY ─────────────────────────────────────────────────────
-- a. The main "Work" (fixed id): what was bought FOR work.
insert into expense_categories (id, name, type, parent_id)
select v.id::uuid, v.name, 'parent', null
from (values ('6faa75ea-ece5-40c9-9e44-75785f59568e', 'Work')) as v(id, name)
where not exists (select 1 from expense_categories c where lower(btrim(c.name)) = lower(btrim(v.name)) and c.id <> v.id::uuid)
on conflict (id) do nothing;

-- b. Home & Appliances › Furniture (fixed id; the main by its id, only
--    while it is a main).
insert into expense_categories (id, name, type, parent_id)
select v.id::uuid, v.name, 'sub', p.id
from (values ('f840ec58-7bd7-4ad7-b2d5-b08678ba7439', 'Furniture', '199ec782-505a-4292-984e-08ae1d76469f')) as v(id, name, parent_id)
join expense_categories p on p.id = v.parent_id::uuid and p.parent_id is null
where not exists (select 1 from expense_categories c where lower(btrim(c.name)) = lower(btrim(v.name)) and c.id <> v.id::uuid)
on conflict (id) do nothing;

-- c. Shopping › Electronics: deleted only while it is still under
--    Shopping and nothing points to it (see the top of this file).
delete from expense_categories c
where c.id = '1697124e-22a7-4417-b5b9-0439ccc67e17'
  and c.parent_id = '654a80a3-2e6f-4ada-b214-0486d91d869c'
  and not exists (select 1 from expenses e where e.category_id = c.id)
  and not exists (select 1 from orders o where o.category_id = c.id)
  and not exists (select 1 from category_budget_map m where m.expense_category_id = c.id)
  and not exists (select 1 from category_memory m where m.expense_category_id = c.id)
  and not exists (select 1 from expense_categories s where s.parent_id = c.id);

-- d. Home & Appliances › "Electronics & Work Equipment" → "Electronics",
--    after c (MONEY names are unique): only while it has the old name and
--    no other MONEY category is called Electronics.
update expense_categories
set name = 'Electronics'
where id = '2a05cb39-e90c-4349-9f77-4b1e679d42b4'
  and name = 'Electronics & Work Equipment'
  and not exists (select 1 from expense_categories c where lower(btrim(c.name)) = 'electronics' and c.id <> '2a05cb39-e90c-4349-9f77-4b1e679d42b4');

-- ── 5. Budget mapping rows, by id ────────────────────────────────
-- New rows only, and only when both ends exist; a row chosen by hand in
-- HOME → Categories is never changed. (A sub without a row still books to
-- the Home & Appliances sub with its name, as before.)
insert into category_budget_map (id, expense_category_id)
select v.home_id, v.money_id::uuid
from (values
  ('appliances:kitchen', '4125ed9e-da65-4b76-8e35-cb1239d8093b'),       -- Home & Appliances › Kitchen Appliances
  ('appliances:kitchenware', 'a364fa44-7513-47ca-aabc-7c5254c0a961'),   -- Home & Appliances › Kitchenware & Utensils
  ('appliances:cleaning', '83c6b924-e7cd-4ba6-881d-a1ff1e6385d1'),      -- Home & Appliances › Cleaning Appliances
  ('appliances:air', '7d226f51-f809-494d-92c0-50d9c12f7812'),           -- Home & Appliances › Air & Climate
  ('appliances:electronics', '2a05cb39-e90c-4349-9f77-4b1e679d42b4'),   -- Home & Appliances › Electronics
  ('appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),      -- Home & Appliances › Home Textiles
  ('appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),         -- Home & Appliances › Home Decor
  ('appliances:clothing', '732af8e0-924c-471c-b0e8-ac9286ce074e'),      -- Shopping › Clothing
  ('appliances:footwear', '0f7f387b-0c4a-4095-8865-59cfac4c586a'),      -- Shopping › Footwear
  ('appliances:accessories', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),   -- Shopping › Accessories
  ('appliances:pet', 'd0c05f29-1418-485f-9433-b4b0e97c2423'),           -- Pets › Pet Accessories & Toys
  ('appliances:glasses', 'f81fa3cb-8dfc-45f5-b351-f22d877761cd'),       -- Health › Glasses & Lenses
  ('appliances:furniture', 'f840ec58-7bd7-4ad7-b2d5-b08678ba7439'),     -- Home & Appliances › Furniture
  ('misc:gifts', '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c'),               -- Shopping › Gifts
  ('health:contact-lenses', 'f81fa3cb-8dfc-45f5-b351-f22d877761cd')     -- Health › Glasses & Lenses
) as v(home_id, money_id)
where exists (select 1 from inventory_categories h where h.id = v.home_id)
  and exists (select 1 from expense_categories e where e.id = v.money_id::uuid)
on conflict (id) do nothing;

-- ── 6. The Action purchase of 17/10: six durables get a HOME sub ──
-- Each line by its id, in this purchase, with its expense, still an
-- expense-only line with no HOME category (as 025 left it). Then its SHOP
-- entry, and the remembered name (category_id / subcategory_id only; its
-- budget category stays). Each only while it still holds 025's values and
-- the new sub-category exists under Durables. Expenses are not touched.
update shopping_trip_items l
set grocery_snapshot = l.grocery_snapshot || jsonb_build_object('category_id', 'appliances', 'subcategory_id', v.new_sub)
from (values
  ('fef3d676-3ba2-4333-94de-be190232199b', '54dda4c1-dfdc-424a-9578-0e55c2f7d4c5', 'appliances:clothing'),      -- bra
  ('8cfce438-a1a5-438c-975e-87b42d589683', 'd7575954-3c5e-45d7-aea7-c70189ea18bc', 'appliances:accessories'),   -- Satin Bonnet
  ('04be8150-492a-4813-b372-c6ebbcce109d', 'df31b3d4-b0ff-4e9b-afbc-dcc871139cb0', 'appliances:accessories'),   -- hair clip
  ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'b3154fe2-b92f-4172-be9f-c01db9176963', 'appliances:accessories'),   -- Headband
  ('e9a8a655-233d-45eb-8554-262ee53dc582', 'ecb05397-a0a5-4fe3-9545-383e8a5ab49d', 'appliances:pet'),           -- Cat House Christmas Tree
  ('45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'f5577c71-1527-4f8f-bf9a-f877225b4416', 'appliances:pet')            -- cat toy
) as v(line_id, expense_id, new_sub)
where l.id = v.line_id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and l.expense_id = v.expense_id::uuid
  and l.pantry_item_id is null
  and (l.grocery_snapshot->>'category_id') is null
  and (l.grocery_snapshot->>'subcategory_id') is null
  and exists (select 1 from inventory_categories c where c.id = v.new_sub and c.parent_id = 'appliances');

update grocery_items g
set category_id = 'appliances', subcategory_id = v.new_sub
from shopping_trip_items l,
  (values
    ('fef3d676-3ba2-4333-94de-be190232199b', 'appliances:clothing'),      -- bra
    ('8cfce438-a1a5-438c-975e-87b42d589683', 'appliances:accessories'),   -- Satin Bonnet
    ('04be8150-492a-4813-b372-c6ebbcce109d', 'appliances:accessories'),   -- hair clip
    ('f2eb0500-a8c0-497c-927a-e96b282d8b08', 'appliances:accessories'),   -- Headband
    ('e9a8a655-233d-45eb-8554-262ee53dc582', 'appliances:pet'),           -- Cat House Christmas Tree
    ('45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'appliances:pet')            -- cat toy
  ) as v(line_id, new_sub)
where l.id = v.line_id::uuid
  and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  and g.id = l.grocery_item_id
  and g.trip_id = l.trip_id
  and g.pantry_item_id is null
  and g.category_id is null
  and g.subcategory_id is null
  and exists (select 1 from inventory_categories c where c.id = v.new_sub and c.parent_id = 'appliances');

-- The key is the name as the app normalises it (normalizeName() in
-- src/lib/categoryGuess.js; checked in supabase/migrations.test.js).
update category_memory cm
set category_id = 'appliances', subcategory_id = v.new_sub, updated_at = now()
from (values
  ('bra', '732af8e0-924c-471c-b0e8-ac9286ce074e', 'appliances:clothing'),                        -- budget: Shopping › Clothing
  ('satin bonnet', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', 'appliances:accessories'),            -- budget: Shopping › Accessories
  ('hair clip', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', 'appliances:accessories'),
  ('headband', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e', 'appliances:accessories'),
  ('cat house christmas tree', 'd0c05f29-1418-485f-9433-b4b0e97c2423', 'appliances:pet'),        -- budget: Pets › Pet Accessories & Toys
  ('cat toy', 'd0c05f29-1418-485f-9433-b4b0e97c2423', 'appliances:pet')
) as v(id, money_id, new_sub)
where cm.id = v.id
  and cm.category_id is null
  and cm.subcategory_id is null
  and cm.expense_category_id is not distinct from v.money_id::uuid
  and exists (select 1 from inventory_categories c where c.id = v.new_sub and c.parent_id = 'appliances');

-- ── 7. "Washing Machine Cleaner" → Laundry › Washing Machine Care ─
-- The HOME item (stock, minimum and price never change), its open SHOP
-- entry and the remembered name: each by id, only while it is still
-- Cleaning Supplies › Surface Cleaners.
update pantry_items
set category_id = 'laundry', subcategory_id = 'laundry:machine-care'
where id = 'fb053da7-b1e3-49e6-9e15-dab6d5abd6a4'
  and category_id = 'cleaning'
  and subcategory_id = 'cleaning:surface'
  and exists (select 1 from inventory_categories c where c.id = 'laundry:machine-care' and c.parent_id = 'laundry');

update grocery_items
set category_id = 'laundry', subcategory_id = 'laundry:machine-care'
where id = 'd84c6427-edf1-41bf-a588-ab26bef0869a'
  and category_id = 'cleaning'
  and subcategory_id = 'cleaning:surface'
  and exists (select 1 from inventory_categories c where c.id = 'laundry:machine-care' and c.parent_id = 'laundry');

update category_memory
set category_id = 'laundry', subcategory_id = 'laundry:machine-care', updated_at = now()
where id = 'washing machine cleaner'
  and category_id = 'cleaning'
  and subcategory_id is not distinct from 'cleaning:surface'
  and exists (select 1 from inventory_categories c where c.id = 'laundry:machine-care' and c.parent_id = 'laundry');

-- ── 8. "Hair Gel" → Beauty Care › Hair Care ──────────────────────
-- Hair Care is the Beauty Care sub made in the app (was "Hair Water").
update pantry_items
set category_id = 'personal-care', subcategory_id = '3ff635c0-7fd1-46ff-ac49-8e408c032398'
where id = '7f586552-9cbb-449a-a059-a546dabf6f28'
  and category_id = 'toiletries'
  and subcategory_id = 'toiletries:hair'
  and exists (select 1 from inventory_categories c where c.id = '3ff635c0-7fd1-46ff-ac49-8e408c032398' and c.parent_id = 'personal-care');

update category_memory
set category_id = 'personal-care', subcategory_id = '3ff635c0-7fd1-46ff-ac49-8e408c032398', updated_at = now()
where id = 'hair gel'
  and category_id = 'toiletries'
  and subcategory_id is not distinct from 'toiletries:hair'
  and exists (select 1 from inventory_categories c where c.id = '3ff635c0-7fd1-46ff-ac49-8e408c032398' and c.parent_id = 'personal-care');

-- ── 9. Expense "Working Ear Plug" → Work ─────────────────────────
-- Only the budget category, only while it is still Home & Appliances ›
-- Electronics (any name) and Work exists.
update expenses
set category_id = '6faa75ea-ece5-40c9-9e44-75785f59568e'
where id = '62babc6c-234a-4549-9136-e8a82d8f1d16'
  and category_id = '2a05cb39-e90c-4349-9f77-4b1e679d42b4'
  and exists (select 1 from expense_categories c where c.id = '6faa75ea-ece5-40c9-9e44-75785f59568e');

commit;

-- ── Check ────────────────────────────────────────────────────────
-- Read only. Columns: step, item (what 026 wants), value (what is there
-- now, names as they are stored now), status: ok · skipped: … (left alone
-- on purpose, with the reason) · CHECK: … (not as planned: send it).
with
home_cat as (
  -- HOME names as the app shows them (CATEGORY_NAME_OVERRIDES).
  select c.id, c.parent_id,
    case when c.id = 'personal-care' and c.name = 'Personal Care & Beauty' then 'Beauty Care' else c.name end as name
  from inventory_categories c
),
home_path as (
  select c.id, case when p.id is null then c.name else p.name || ' › ' || c.name end as path
  from home_cat c left join home_cat p on p.id = c.parent_id
),
money_path as (
  select c.id, case when p.id is null then c.name else p.name || ' › ' || c.name end as path
  from expense_categories c left join expense_categories p on p.id = c.parent_id
),
action(n, line_id, expense_id, name, key, new_sub, money_id) as (values
  (1, 'fef3d676-3ba2-4333-94de-be190232199b', '54dda4c1-dfdc-424a-9578-0e55c2f7d4c5', 'bra', 'bra', 'appliances:clothing', '732af8e0-924c-471c-b0e8-ac9286ce074e'),
  (2, '8cfce438-a1a5-438c-975e-87b42d589683', 'd7575954-3c5e-45d7-aea7-c70189ea18bc', 'Satin Bonnet', 'satin bonnet', 'appliances:accessories', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
  (3, '04be8150-492a-4813-b372-c6ebbcce109d', 'df31b3d4-b0ff-4e9b-afbc-dcc871139cb0', 'hair clip', 'hair clip', 'appliances:accessories', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
  (4, 'f2eb0500-a8c0-497c-927a-e96b282d8b08', 'b3154fe2-b92f-4172-be9f-c01db9176963', 'Headband', 'headband', 'appliances:accessories', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
  (5, 'e9a8a655-233d-45eb-8554-262ee53dc582', 'ecb05397-a0a5-4fe3-9545-383e8a5ab49d', 'Cat House Christmas Tree', 'cat house christmas tree', 'appliances:pet', 'd0c05f29-1418-485f-9433-b4b0e97c2423'),
  (6, '45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'f5577c71-1527-4f8f-bf9a-f877225b4416', 'cat toy', 'cat toy', 'appliances:pet', 'd0c05f29-1418-485f-9433-b4b0e97c2423')
),
-- "Apply the mapping to past purchases" for the Action purchase, worked
-- out like the app (src/lib/budgetMap.js): a line without a HOME
-- category, or an expense in Work / Family Support / Trips & Holidays
-- (or their subs), is left alone; else the sub's mapping, the main's,
-- else the default (Durables: the Home & Appliances sub with the same
-- name, else Home & Appliances; anything else: Groceries, found by name
-- as the app does).
action_moves as (
  select e.id
  from shopping_trip_items l
  join expenses e on e.id = l.expense_id
  left join expense_categories ec on ec.id = e.category_id
  cross join lateral (
    select coalesce(
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
  ) t
  where l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
    and coalesce(l.line_kind, 'shop') = 'shop'
    and (l.grocery_snapshot->>'category_id') is not null
    and not ('6faa75ea-ece5-40c9-9e44-75785f59568e'::uuid in (e.category_id, ec.parent_id)
             or '54c1355d-5ebb-4237-ae67-1be0ca593443'::uuid in (e.category_id, ec.parent_id)
             or 'dc79f604-19fd-4bdd-817e-335816c4afe7'::uuid in (e.category_id, ec.parent_id))
    and t.mapped is distinct from e.category_id
)
select step, item, value, status from (
  -- 1. HOME new sub-categories (8)
  select 1 as sort, v.n as n, '1 HOME new' as step, v.label as item,
    hp.path as value,
    case
      when c.id is not null and c.parent_id = v.parent_id then 'ok'
      when c.id is not null then 'CHECK: under another main'
      when not exists (select 1 from inventory_categories p where p.id = v.parent_id and p.parent_id is null) then 'skipped: parent missing'
      when exists (select 1 from inventory_categories x where lower(btrim(x.name)) = lower(btrim(v.name))) then 'skipped: name exists'
      else 'CHECK: missing'
    end as status
  from (values
    (1, 'appliances:clothing', 'Clothing', 'appliances', 'Durables › Clothing'),
    (2, 'appliances:footwear', 'Footwear', 'appliances', 'Durables › Footwear'),
    (3, 'appliances:accessories', 'Accessories', 'appliances', 'Durables › Accessories'),
    (4, 'appliances:pet', 'Pet Accessories & Toys', 'appliances', 'Durables › Pet Accessories & Toys'),
    (5, 'appliances:glasses', 'Glasses', 'appliances', 'Durables › Glasses'),
    (6, 'appliances:furniture', 'Furniture', 'appliances', 'Durables › Furniture'),
    (7, 'health:contact-lenses', 'Contact Lenses', 'health', 'Health & Medicine › Contact Lenses'),
    (8, 'laundry:machine-care', 'Washing Machine Care', 'laundry', 'Laundry Supplies › Washing Machine Care')
  ) as v(n, id, name, parent_id, label)
  left join inventory_categories c on c.id = v.id
  left join home_path hp on hp.id = c.id

  union all
  -- 2. Renames (never renamed back: a name changed by hand stays)
  select 2, v.n, '2 renamed', v.label, c.name,
    case
      when c.id is null then 'CHECK: missing'
      when c.name = v.new_name then 'ok'
      when c.name = v.old_name then 'skipped: name exists'
      else 'skipped: renamed by hand'
    end
  from (values
    (1, 'inventory', 'appliances', 'Home & Appliances', 'Durables', 'HOME Home & Appliances → Durables'),
    (2, 'inventory', 'appliances:electronics', 'Electronics & Work Equipment', 'Electronics', 'HOME Electronics & Work Equipment → Electronics'),
    (3, 'money', '2a05cb39-e90c-4349-9f77-4b1e679d42b4', 'Electronics & Work Equipment', 'Electronics', 'MONEY Home & Appliances › Electronics & Work Equipment → Electronics')
  ) as v(n, kind, id, old_name, new_name, label)
  left join lateral (
    select i.id, i.name from inventory_categories i where v.kind = 'inventory' and i.id = v.id
    union all
    select e.id::text, e.name from expense_categories e where v.kind = 'money' and e.id::text = v.id
  ) c on true

  union all
  -- 3. Gifts & Party under Durables
  select 3, 1, '3 Gifts & Party', 'HOME Gifts & Party (misc:gifts) under Durables',
    hp.path ||
      coalesce(' · purchase lines that kept it: ' || (select count(*) from shopping_trip_items l where 'misc:gifts' in (l.grocery_snapshot->>'category_id', l.grocery_snapshot->>'subcategory_id')) || ' (their expenses are not changed)', ''),
    case
      when c.id is null then 'CHECK: missing'
      when c.parent_id = 'appliances' then 'ok'
      when c.parent_id is distinct from 'misc' then 'skipped: moved by hand'
      else 'CHECK: still used (' || concat_ws(', ',
        (select 'HOME items ' || count(*) from pantry_items where 'misc:gifts' in (category_id, subcategory_id) having count(*) > 0),
        (select 'SHOP entries ' || count(*) from grocery_items where 'misc:gifts' in (category_id, subcategory_id) having count(*) > 0),
        (select 'remembered names ' || count(*) from category_memory where 'misc:gifts' in (category_id, subcategory_id) having count(*) > 0),
        (select 'sub-categories ' || count(*) from inventory_categories where parent_id = 'misc:gifts' having count(*) > 0)) || ')'
    end
  from (select 1) as one
  left join inventory_categories c on c.id = 'misc:gifts'
  left join home_path hp on hp.id = c.id

  union all
  -- 4. MONEY: new categories
  select 4, v.n, '4 MONEY', v.label, mp.path,
    case
      when c.id is not null then 'ok'
      when v.parent_id is not null and not exists (select 1 from expense_categories x where x.id = v.parent_id::uuid and x.parent_id is null) then 'skipped: parent missing'
      when exists (select 1 from expense_categories x where lower(btrim(x.name)) = lower(btrim(v.name))) then 'skipped: name exists'
      else 'CHECK: missing'
    end
  from (values
    (1, '6faa75ea-ece5-40c9-9e44-75785f59568e', 'Work', null, 'MONEY new main Work'),
    (2, 'f840ec58-7bd7-4ad7-b2d5-b08678ba7439', 'Furniture', '199ec782-505a-4292-984e-08ae1d76469f', 'MONEY new Home & Appliances › Furniture')
  ) as v(n, id, name, parent_id, label)
  left join expense_categories c on c.id = v.id::uuid
  left join money_path mp on mp.id = c.id

  union all
  -- 4. MONEY: Shopping › Electronics deleted, or why it was kept
  select 4, 3, '4 MONEY', 'MONEY Shopping › Electronics deleted',
    case when c.id is null then 'gone' else mp.path || ' · ' || coalesce(nullif(concat_ws(', ',
      (select 'expenses ' || count(*) from expenses where category_id = c.id having count(*) > 0),
      (select 'orders ' || count(*) from orders where category_id = c.id having count(*) > 0),
      (select 'mapping rows ' || count(*) from category_budget_map where expense_category_id = c.id having count(*) > 0),
      (select 'remembered names ' || count(*) from category_memory where expense_category_id = c.id having count(*) > 0),
      (select 'sub-categories ' || count(*) from expense_categories where parent_id = c.id having count(*) > 0)), ''), 'moved by hand') end,
    case
      when c.id is null then 'ok'
      when c.parent_id is distinct from '654a80a3-2e6f-4ada-b214-0486d91d869c' then 'skipped: moved by hand'
      else 'skipped: still used (see value)'
    end
  from (select 1) as one
  left join expense_categories c on c.id = '1697124e-22a7-4417-b5b9-0439ccc67e17'
  left join money_path mp on mp.id = c.id

  union all
  -- 5. Mapping rows by id (15)
  select 5, v.n, '5 mapping', coalesce(hp.path, v.home_id) || ' → ' || coalesce(want.path, v.money_id),
    case when m.id is null then 'no row' else 'books to ' || coalesce(now_.path, '?') end,
    case
      when not exists (select 1 from inventory_categories h where h.id = v.home_id) then 'skipped: HOME category missing'
      when not exists (select 1 from expense_categories e where e.id = v.money_id::uuid) then 'skipped: MONEY category missing'
      when m.id is null then 'CHECK: missing'
      when m.expense_category_id = v.money_id::uuid then 'ok'
      else 'skipped: chosen by hand (kept)'
    end
  from (values
    (1, 'appliances:kitchen', '4125ed9e-da65-4b76-8e35-cb1239d8093b'),
    (2, 'appliances:kitchenware', 'a364fa44-7513-47ca-aabc-7c5254c0a961'),
    (3, 'appliances:cleaning', '83c6b924-e7cd-4ba6-881d-a1ff1e6385d1'),
    (4, 'appliances:air', '7d226f51-f809-494d-92c0-50d9c12f7812'),
    (5, 'appliances:electronics', '2a05cb39-e90c-4349-9f77-4b1e679d42b4'),
    (6, 'appliances:textiles', 'f924edef-bf90-477d-8303-ddc4a2b27391'),
    (7, 'appliances:decor', '3472a299-73f6-4249-bee4-a5469d1c807a'),
    (8, 'appliances:clothing', '732af8e0-924c-471c-b0e8-ac9286ce074e'),
    (9, 'appliances:footwear', '0f7f387b-0c4a-4095-8865-59cfac4c586a'),
    (10, 'appliances:accessories', 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e'),
    (11, 'appliances:pet', 'd0c05f29-1418-485f-9433-b4b0e97c2423'),
    (12, 'appliances:glasses', 'f81fa3cb-8dfc-45f5-b351-f22d877761cd'),
    (13, 'appliances:furniture', 'f840ec58-7bd7-4ad7-b2d5-b08678ba7439'),
    (14, 'misc:gifts', '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c'),
    (15, 'health:contact-lenses', 'f81fa3cb-8dfc-45f5-b351-f22d877761cd')
  ) as v(n, home_id, money_id)
  left join category_budget_map m on m.id = v.home_id
  left join home_path hp on hp.id = v.home_id
  left join money_path want on want.id = v.money_id::uuid
  left join money_path now_ on now_.id = m.expense_category_id

  union all
  -- 6. The Action purchase: line, SHOP entry and remembered name of each
  select 6, a.n, '6 Action 17/10', a.name || ' → ' || coalesce(hp.path, a.new_sub),
    'line: ' || coalesce(lp.path, 'no category') || ' · SHOP entry: ' || coalesce(gp.path, case when g.id is null then 'none' else 'no category' end)
      || ' · remembered: ' || coalesce(mp.path, case when cm.id is null then 'not remembered' else 'no HOME category' end)
      || ' · budget: ' || coalesce(bp.path, 'none'),
    case when concat_ws(', ',
        case when l.id is null then 'line missing'
             when (l.grocery_snapshot->>'subcategory_id') is distinct from a.new_sub or (l.grocery_snapshot->>'category_id') is distinct from 'appliances' then 'line' end,
        case when l.id is not null and l.pantry_item_id is not null then 'line has a HOME item' end,
        case when g.id is not null and (g.category_id is distinct from 'appliances' or g.subcategory_id is distinct from a.new_sub) then 'SHOP entry' end,
        case when cm.id is null then 'remembered name missing'
             when cm.category_id is distinct from 'appliances' or cm.subcategory_id is distinct from a.new_sub then 'remembered name' end,
        case when cm.id is not null and cm.expense_category_id is distinct from a.money_id::uuid then 'remembered budget' end
      ) = '' then 'ok' else 'CHECK: ' || concat_ws(', ',
        case when l.id is null then 'line missing'
             when (l.grocery_snapshot->>'subcategory_id') is distinct from a.new_sub or (l.grocery_snapshot->>'category_id') is distinct from 'appliances' then 'line' end,
        case when l.id is not null and l.pantry_item_id is not null then 'line has a HOME item' end,
        case when g.id is not null and (g.category_id is distinct from 'appliances' or g.subcategory_id is distinct from a.new_sub) then 'SHOP entry' end,
        case when cm.id is null then 'remembered name missing'
             when cm.category_id is distinct from 'appliances' or cm.subcategory_id is distinct from a.new_sub then 'remembered name' end,
        case when cm.id is not null and cm.expense_category_id is distinct from a.money_id::uuid then 'remembered budget' end)
    end
  from action a
  left join shopping_trip_items l on l.id = a.line_id::uuid and l.trip_id = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  left join grocery_items g on g.id = l.grocery_item_id
  left join category_memory cm on cm.id = a.key
  left join expenses e on e.id = a.expense_id::uuid
  left join home_path hp on hp.id = a.new_sub
  left join home_path lp on lp.id = coalesce(l.grocery_snapshot->>'subcategory_id', l.grocery_snapshot->>'category_id')
  left join home_path gp on gp.id = coalesce(g.subcategory_id, g.category_id)
  left join home_path mp on mp.id = coalesce(cm.subcategory_id, cm.category_id)
  left join money_path bp on bp.id = e.category_id

  union all
  select 6, 7, '6 Action 17/10', '"Apply the mapping…" moves none of its expenses',
    (select count(*) from action_moves)::text || ' would move',
    case when exists (select 1 from action_moves) then 'CHECK: some would move' else 'ok' end

  union all
  -- 7–9. Items, entries, remembered names and the expense fixed by id
  select 7, v.n, v.step, v.label,
    case
      when v.kind = 'item' then (select p.name || ' · ' || coalesce(hp.path, 'no category') from pantry_items p left join home_path hp on hp.id = coalesce(p.subcategory_id, p.category_id) where p.id = v.id::uuid)
      when v.kind = 'entry' then (select g.name || ' · ' || coalesce(hp.path, 'no category') || case when g.completed then ' (bought)' else '' end from grocery_items g left join home_path hp on hp.id = coalesce(g.subcategory_id, g.category_id) where g.id = v.id::uuid)
      when v.kind = 'memory' then (select m.name || ' · ' || coalesce(hp.path, 'no HOME category') from category_memory m left join home_path hp on hp.id = coalesce(m.subcategory_id, m.category_id) where m.id = v.id)
      else (select e.description || ' · ' || coalesce(mp.path, 'no category') from expenses e left join money_path mp on mp.id = e.category_id where e.id = v.id::uuid)
    end,
    case
      when v.kind = 'item' then (select case when p.id is null then 'CHECK: missing' when p.subcategory_id = v.new_sub then 'ok' else 'CHECK: not moved' end from (select 1) one left join pantry_items p on p.id = v.id::uuid)
      when v.kind = 'entry' then (select case when g.id is null then 'skipped: not there' when g.subcategory_id = v.new_sub then 'ok' else 'CHECK: not moved' end from (select 1) one left join grocery_items g on g.id = v.id::uuid)
      when v.kind = 'memory' then (select case when m.id is null then 'ok: not remembered' when m.subcategory_id = v.new_sub then 'ok' else 'CHECK: remembered differently (left alone)' end from (select 1) one left join category_memory m on m.id = v.id)
      else (select case when e.id is null then 'CHECK: missing' when e.category_id::text = v.new_sub then 'ok' else 'CHECK: not moved' end from (select 1) one left join expenses e on e.id = v.id::uuid)
    end
  from (values
    (1, '7 Washing Machine Cleaner', 'item', 'fb053da7-b1e3-49e6-9e15-dab6d5abd6a4', 'laundry:machine-care', 'HOME item → Laundry Supplies › Washing Machine Care'),
    (2, '7 Washing Machine Cleaner', 'entry', 'd84c6427-edf1-41bf-a588-ab26bef0869a', 'laundry:machine-care', 'its SHOP entry → the same'),
    (3, '7 Washing Machine Cleaner', 'memory', 'washing machine cleaner', 'laundry:machine-care', 'remembered name → the same'),
    (4, '8 Hair Gel', 'item', '7f586552-9cbb-449a-a059-a546dabf6f28', '3ff635c0-7fd1-46ff-ac49-8e408c032398', 'HOME item → Beauty Care › Hair Care'),
    (5, '8 Hair Gel', 'memory', 'hair gel', '3ff635c0-7fd1-46ff-ac49-8e408c032398', 'remembered name → the same'),
    (6, '9 Working Ear Plug', 'expense', '62babc6c-234a-4549-9136-e8a82d8f1d16', '6faa75ea-ece5-40c9-9e44-75785f59568e', 'expense → Work')
  ) as v(n, step, kind, id, new_sub, label)
) as checks
order by sort, n;

-- End of 026
