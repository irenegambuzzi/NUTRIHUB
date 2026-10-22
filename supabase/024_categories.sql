-- 024: new categories for HOME and MONEY, and their budget mapping
-- (round 6C, docs/categories-proposal-6c.md with the decisions of
-- docs/plan-oct-2026.md "As built in round 6C").
--
-- What it does:
--   1. HOME (inventory_categories): a new main "Baby" (id baby) with 6
--      subs, and 9 subs under existing mains (Beauty Care › Perfume,
--      Frozen Food › Frozen Meat, Toiletries › Feminine Care, Pantry
--      Staples › World Foods, Household Supplies › Stationery, Car Care,
--      Air Fresheners, Pest Control, Plants & Garden). 16 rows.
--   2. MONEY (expense_categories): two new mains, "Personal Care" and
--      "Family Support", and 21 subs under Trips & Holidays, Personal
--      Care, Subscription, Entertainment, Car / Vehicle, Health, Pets and
--      Bank & Fee. 23 rows.
--   3. Budget mapping (category_budget_map): Beauty Care → Personal Care ›
--      Beauty & Perfume, Toiletries → Personal Care › Toiletries, Car Care
--      → Car / Vehicle. HOME Health & Medicine moves from Health to
--      Health › Pharmacy, but only if it still books to the Health main
--      (if it was changed by hand, it is left alone).
--   4. The SELECT at the end shows the result: one row per category and
--      per mapping, with its name as it is stored now.
--
-- Safe to run again, also after renaming categories. Every MONEY category
-- is found by its id, never by its name, and every new one has a fixed id
-- (the same ids are in src/data/budgetKeywords.js), so you can rename any
-- category (for example "Trips & Holidays" to "Travel", or "Flights" to
-- "Voli") before or after running this file, and run it again: nothing is
-- duplicated and no name is changed back.
--
-- It only adds rows. Nothing is deleted or renamed. The only change to an
-- existing row is the one Health & Medicine mapping row above. A category
-- is skipped (and the check says so) when one with the same name already
-- exists (ignoring capitals and spaces at the ends), for example if you
-- made it by hand, or when its main category no longer exists. No new
-- table, no policy, no grant; income is not touched. Needs 021.
--
-- How to run: paste the whole file into the Supabase SQL Editor, scroll
-- to the last line to check that it ends with "-- End of 024", then press
-- Run. Send the result table (the last SELECT) for checking.

-- ── 1. HOME: the main category "Baby" ────────────────────────────
-- sort_order 14, the same as Beauty Care: in Shop mode it comes after
-- Toiletries (13). Lists show categories A–Z anyway.
insert into inventory_categories (id, name, parent_id, type, sort_order)
select v.id, v.name, null, 'parent', v.sort_order
from (values ('baby', 'Baby', 14)) as v(id, name, sort_order)
where not exists (select 1 from inventory_categories c where lower(trim(c.name)) = lower(trim(v.name)) and c.id <> v.id)
on conflict (id) do nothing;

-- ── 2. HOME: sub-categories (only under a main that exists) ──────
insert into inventory_categories (id, name, parent_id, type, sort_order)
select v.id, v.name, v.parent_id, 'sub', v.sort_order
from (values
  ('baby:diapers', 'Diapers', 'baby', 1),
  ('baby:wipes', 'Baby Wipes', 'baby', 2),
  ('baby:food', 'Baby Food', 'baby', 3),
  ('baby:formula', 'Formula', 'baby', 4),
  ('baby:care', 'Baby Care', 'baby', 5),
  ('baby:feeding', 'Feeding', 'baby', 6),
  ('personal-care:perfume', 'Perfume', 'personal-care', 5),
  ('frozen:meat', 'Frozen Meat', 'frozen', 5),
  ('toiletries:feminine', 'Feminine Care', 'toiletries', 5),
  ('pantry-staples:world', 'World Foods', 'pantry-staples', 9),
  ('household:stationery', 'Stationery', 'household', 4),
  ('household:car-care', 'Car Care', 'household', 5),
  ('household:air', 'Air Fresheners', 'household', 6),
  ('household:pest', 'Pest Control', 'household', 7),
  ('household:garden', 'Plants & Garden', 'household', 8)
) as v(id, name, parent_id, sort_order)
where exists (select 1 from inventory_categories p where p.id = v.parent_id)
  and not exists (select 1 from inventory_categories c where lower(trim(c.name)) = lower(trim(v.name)) and c.id <> v.id)
on conflict (id) do nothing;

-- ── 3. MONEY: the new main categories (fixed ids) ────────────────
insert into expense_categories (id, name, type, parent_id)
select v.id::uuid, v.name, 'parent', null
from (values
  ('f194dd95-a6c4-4399-a2ed-2114d6b8a1eb', 'Personal Care'),
  ('54c1355d-5ebb-4237-ae67-1be0ca593443', 'Family Support')
) as v(id, name)
where not exists (select 1 from expense_categories c where lower(trim(c.name)) = lower(trim(v.name)) and c.id <> v.id::uuid)
on conflict (id) do nothing;

-- ── 4. MONEY: sub-categories (fixed ids; the main by its id) ─────
-- A sub is only added under a main that exists and is still a main.
insert into expense_categories (id, name, type, parent_id)
select v.id::uuid, v.name, 'sub', p.id
from (values
  ('38455d3e-ab33-4eae-8088-e6c9e4e55b3e', 'Flights', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),             -- Trips & Holidays
  ('a972798e-d08c-4b09-b8cf-cfe5c1724128', 'Souvenirs', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),           -- Trips & Holidays
  ('5c21c7eb-281b-46b5-ac2c-d42da39dd548', 'Insurance & Visas', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),   -- Trips & Holidays
  ('4eb77042-660a-41e9-a1b6-cd2057605256', 'Beauty & Perfume', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),    -- Personal Care (new)
  ('01a993f2-d9af-4881-bc8e-1df5af027000', 'Toiletries', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),          -- Personal Care (new)
  ('d3728a31-bd77-487d-ac80-aaffe90fa5f3', 'Hairdresser', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),         -- Personal Care (new)
  ('a953640c-9716-4f1f-a989-279c03ddba63', 'Streaming', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'),           -- Subscription
  ('d9c27fc6-378b-475b-b4e9-097b6e448a27', 'Software & Apps', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'),     -- Subscription
  ('02fd813a-21b8-4d24-91c3-dbb289af07bb', 'Cinema & Events', '744f7d8e-c90d-49d3-ad03-72c6e81aad9d'),     -- Entertainment
  ('6aedf34e-9f47-48e9-a5ca-7b8b529fa447', 'Fuel', '8b2d4f49-af1d-41af-bd19-9050a7689164'),                -- Car / Vehicle
  ('1fe3c787-1e67-4e31-86a1-d6114f2ef473', 'Maintenance', '8b2d4f49-af1d-41af-bd19-9050a7689164'),         -- Car / Vehicle
  ('90065703-c0e7-436e-9ba3-2992dc819c7c', 'Insurance & Tax', '8b2d4f49-af1d-41af-bd19-9050a7689164'),     -- Car / Vehicle
  ('e6ce7094-0f5c-49f7-aff4-78e2b9f2e494', 'Parking & Tolls', '8b2d4f49-af1d-41af-bd19-9050a7689164'),     -- Car / Vehicle
  ('8fbe343f-6fd9-4c58-874b-d9bd809be461', 'Pharmacy', '06729df9-06b2-4465-955b-17d03f3fe125'),            -- Health
  ('cd1ec5e6-4c7e-4f38-a86f-e6d1e42b10f5', 'Doctor & Tests', '06729df9-06b2-4465-955b-17d03f3fe125'),      -- Health
  ('3bbb8479-42e4-4f40-b9fb-bacc5d586128', 'Dentist', '06729df9-06b2-4465-955b-17d03f3fe125'),             -- Health
  ('f81fa3cb-8dfc-45f5-b351-f22d877761cd', 'Glasses & Lenses', '06729df9-06b2-4465-955b-17d03f3fe125'),    -- Health
  ('b79bd43a-bfa9-4101-93d7-70468af9dcfd', 'Veterinary', 'ecd9a924-7f46-4991-83ce-02825c73ce42'),          -- Pets
  ('9d61caa3-80c5-4104-a734-51deca1f19ed', 'Pet Sitting', 'ecd9a924-7f46-4991-83ce-02825c73ce42'),         -- Pets
  ('e2fe4339-59ac-4f79-af56-8bb5f3aeac9d', 'Taxes & Fines', 'b498cc5d-95ea-4666-89f2-11973222ec2c'),       -- Bank & Fee
  ('f6f56e33-bfc9-426c-9b3d-d1c217620316', 'Documents & Permits', 'b498cc5d-95ea-4666-89f2-11973222ec2c')  -- Bank & Fee
) as v(id, name, parent_id)
join expense_categories p on p.id = v.parent_id::uuid and p.parent_id is null
where not exists (select 1 from expense_categories c where lower(trim(c.name)) = lower(trim(v.name)) and c.id <> v.id::uuid)
on conflict (id) do nothing;

-- ── 5. Budget mapping: new rows only, never over a choice made by hand
insert into category_budget_map (id, expense_category_id)
select v.home_id, v.money_id::uuid
from (values
  ('personal-care', '4eb77042-660a-41e9-a1b6-cd2057605256'),     -- Beauty Care → Personal Care › Beauty & Perfume
  ('toiletries', '01a993f2-d9af-4881-bc8e-1df5af027000'),        -- Toiletries → Personal Care › Toiletries
  ('household:car-care', '8b2d4f49-af1d-41af-bd19-9050a7689164') -- Car Care → Car / Vehicle
) as v(home_id, money_id)
where exists (select 1 from inventory_categories h where h.id = v.home_id)
  and exists (select 1 from expense_categories e where e.id = v.money_id::uuid)
on conflict (id) do nothing;

-- ── 6. Health & Medicine → Health › Pharmacy ─────────────────────
-- Its mapping row already exists (→ the Health main). It is changed only
-- while it still points at the Health main and Pharmacy exists under
-- Health; a choice made by hand is left alone. This is the only UPDATE in
-- this file.
update category_budget_map
set expense_category_id = '8fbe343f-6fd9-4c58-874b-d9bd809be461', updated_at = now()  -- Health › Pharmacy
where id = 'health'
  and expense_category_id = '06729df9-06b2-4465-955b-17d03f3fe125'                     -- still the Health main
  and exists (
    select 1 from expense_categories e
    where e.id = '8fbe343f-6fd9-4c58-874b-d9bd809be461' and e.parent_id = '06729df9-06b2-4465-955b-17d03f3fe125'
  );

-- ── Check ────────────────────────────────────────────────────────
-- One row per category and per mapping, with the name and main as they
-- are stored NOW (renamed ones show their new name). status:
--   ok                        the row is there (made now or before)
--   skipped: name exists      another category already has this name
--   skipped: parent missing   its main category doesn't exist (or is no
--                             longer a main)
--   missing                   not there, for no reason above: report it
-- Mapping rows (current_name = the HOME category, current_main = the
-- budget category it books to now): ok · kept: chosen by hand · skipped:
-- … missing. Health: updated (now) · already Pharmacy · left: changed by
-- hand · skipped: Pharmacy missing. Then the totals and the duplicate-name
-- check.
-- (The whole file runs as one transaction in the SQL Editor, so a row
-- changed by this run has updated_at = now().)
select section, planned, current_name, current_main, status from (
  -- HOME categories
  select 1 as sort, v.n as n, '1 HOME' as section, v.name as planned,
    c.name as current_name, p.name as current_main,
    case
      when c.id is not null then 'ok'
      when v.parent_id is not null and not exists (select 1 from inventory_categories x where x.id = v.parent_id) then 'skipped: parent missing'
      when exists (select 1 from inventory_categories x where lower(trim(x.name)) = lower(trim(v.name))) then 'skipped: name exists'
      else 'missing'
    end as status
  from (values
    (1, 'baby', 'Baby', null),
    (2, 'baby:diapers', 'Diapers', 'baby'),
    (3, 'baby:wipes', 'Baby Wipes', 'baby'),
    (4, 'baby:food', 'Baby Food', 'baby'),
    (5, 'baby:formula', 'Formula', 'baby'),
    (6, 'baby:care', 'Baby Care', 'baby'),
    (7, 'baby:feeding', 'Feeding', 'baby'),
    (8, 'personal-care:perfume', 'Perfume', 'personal-care'),
    (9, 'frozen:meat', 'Frozen Meat', 'frozen'),
    (10, 'toiletries:feminine', 'Feminine Care', 'toiletries'),
    (11, 'pantry-staples:world', 'World Foods', 'pantry-staples'),
    (12, 'household:stationery', 'Stationery', 'household'),
    (13, 'household:car-care', 'Car Care', 'household'),
    (14, 'household:air', 'Air Fresheners', 'household'),
    (15, 'household:pest', 'Pest Control', 'household'),
    (16, 'household:garden', 'Plants & Garden', 'household')
  ) as v(n, id, name, parent_id)
  left join inventory_categories c on c.id = v.id
  left join inventory_categories p on p.id = c.parent_id

  union all
  -- MONEY categories
  select 2, v.n, '2 MONEY', v.name,
    c.name, p.name,
    case
      when c.id is not null then 'ok'
      when v.parent_id is not null and not exists (select 1 from expense_categories x where x.id = v.parent_id::uuid and x.parent_id is null) then 'skipped: parent missing'
      when exists (select 1 from expense_categories x where lower(trim(x.name)) = lower(trim(v.name))) then 'skipped: name exists'
      else 'missing'
    end
  from (values
    (1, 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb', 'Personal Care', null),
    (2, '54c1355d-5ebb-4237-ae67-1be0ca593443', 'Family Support', null),
    (3, '38455d3e-ab33-4eae-8088-e6c9e4e55b3e', 'Flights', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),
    (4, 'a972798e-d08c-4b09-b8cf-cfe5c1724128', 'Souvenirs', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),
    (5, '5c21c7eb-281b-46b5-ac2c-d42da39dd548', 'Insurance & Visas', 'dc79f604-19fd-4bdd-817e-335816c4afe7'),
    (6, '4eb77042-660a-41e9-a1b6-cd2057605256', 'Beauty & Perfume', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),
    (7, '01a993f2-d9af-4881-bc8e-1df5af027000', 'Toiletries', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),
    (8, 'd3728a31-bd77-487d-ac80-aaffe90fa5f3', 'Hairdresser', 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'),
    (9, 'a953640c-9716-4f1f-a989-279c03ddba63', 'Streaming', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'),
    (10, 'd9c27fc6-378b-475b-b4e9-097b6e448a27', 'Software & Apps', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'),
    (11, '02fd813a-21b8-4d24-91c3-dbb289af07bb', 'Cinema & Events', '744f7d8e-c90d-49d3-ad03-72c6e81aad9d'),
    (12, '6aedf34e-9f47-48e9-a5ca-7b8b529fa447', 'Fuel', '8b2d4f49-af1d-41af-bd19-9050a7689164'),
    (13, '1fe3c787-1e67-4e31-86a1-d6114f2ef473', 'Maintenance', '8b2d4f49-af1d-41af-bd19-9050a7689164'),
    (14, '90065703-c0e7-436e-9ba3-2992dc819c7c', 'Insurance & Tax', '8b2d4f49-af1d-41af-bd19-9050a7689164'),
    (15, 'e6ce7094-0f5c-49f7-aff4-78e2b9f2e494', 'Parking & Tolls', '8b2d4f49-af1d-41af-bd19-9050a7689164'),
    (16, '8fbe343f-6fd9-4c58-874b-d9bd809be461', 'Pharmacy', '06729df9-06b2-4465-955b-17d03f3fe125'),
    (17, 'cd1ec5e6-4c7e-4f38-a86f-e6d1e42b10f5', 'Doctor & Tests', '06729df9-06b2-4465-955b-17d03f3fe125'),
    (18, '3bbb8479-42e4-4f40-b9fb-bacc5d586128', 'Dentist', '06729df9-06b2-4465-955b-17d03f3fe125'),
    (19, 'f81fa3cb-8dfc-45f5-b351-f22d877761cd', 'Glasses & Lenses', '06729df9-06b2-4465-955b-17d03f3fe125'),
    (20, 'b79bd43a-bfa9-4101-93d7-70468af9dcfd', 'Veterinary', 'ecd9a924-7f46-4991-83ce-02825c73ce42'),
    (21, '9d61caa3-80c5-4104-a734-51deca1f19ed', 'Pet Sitting', 'ecd9a924-7f46-4991-83ce-02825c73ce42'),
    (22, 'e2fe4339-59ac-4f79-af56-8bb5f3aeac9d', 'Taxes & Fines', 'b498cc5d-95ea-4666-89f2-11973222ec2c'),
    (23, 'f6f56e33-bfc9-426c-9b3d-d1c217620316', 'Documents & Permits', 'b498cc5d-95ea-4666-89f2-11973222ec2c')
  ) as v(n, id, name, parent_id)
  left join expense_categories c on c.id = v.id::uuid
  left join expense_categories p on p.id = c.parent_id

  union all
  -- Mapping rows (HOME category → budget category), names as stored now
  select 3, v.n, '3 mapping', v.label,
    h.name, coalesce(ep.name || ' › ' || e.name, e.name),
    case
      when v.home_id = 'health' then
        case
          when m.id is not null and m.expense_category_id = v.money_id::uuid and m.updated_at = now() then 'updated'
          when m.id is not null and m.expense_category_id = v.money_id::uuid then 'already Pharmacy'
          when m.id is not null and m.expense_category_id = '06729df9-06b2-4465-955b-17d03f3fe125'
            and not exists (select 1 from expense_categories x where x.id = v.money_id::uuid) then 'skipped: Pharmacy missing'
          else 'left: changed by hand'
        end
      when m.id is not null and m.expense_category_id = v.money_id::uuid then 'ok'
      when m.id is not null then 'kept: chosen by hand'
      when h.id is null then 'skipped: HOME category missing'
      when not exists (select 1 from expense_categories x where x.id = v.money_id::uuid) then 'skipped: budget category missing'
      else 'missing'
    end
  from (values
    (1, 'personal-care', 'Beauty Care → Personal Care › Beauty & Perfume', '4eb77042-660a-41e9-a1b6-cd2057605256'),
    (2, 'toiletries', 'Toiletries → Personal Care › Toiletries', '01a993f2-d9af-4881-bc8e-1df5af027000'),
    (3, 'household:car-care', 'Car Care → Car / Vehicle', '8b2d4f49-af1d-41af-bd19-9050a7689164'),
    (4, 'health', 'Health & Medicine → Health › Pharmacy', '8fbe343f-6fd9-4c58-874b-d9bd809be461')
  ) as v(n, home_id, label, money_id)
  left join inventory_categories h on h.id = v.home_id
  left join category_budget_map m on m.id = v.home_id
  left join expense_categories e on e.id = m.expense_category_id
  left join expense_categories ep on ep.id = e.parent_id

  union all
  -- Totals
  select 4, 1, '4 totals', 'HOME categories',
    (select count(*) filter (where parent_id is null) || ' main · ' || count(*) filter (where parent_id is not null) || ' sub' from inventory_categories),
    null, 'info'
  union all
  select 4, 2, '4 totals', 'MONEY categories',
    (select count(*) filter (where parent_id is null) || ' main · ' || count(*) filter (where parent_id is not null) || ' sub' from expense_categories),
    null, 'info'
  union all
  select 4, 3, '4 totals', 'Budget mapping rows',
    (select count(*)::text from category_budget_map),
    null, 'info'

  union all
  -- The same name twice (ignoring capitals and spaces at the ends)
  select 5, 1, '5 duplicate names', 'HOME',
    (select string_agg(d.name, ', ' order by d.name) from (
      select min(name) as name from inventory_categories group by lower(trim(name)) having count(*) > 1) d),
    null,
    case when exists (select 1 from inventory_categories group by lower(trim(name)) having count(*) > 1) then 'CHECK: same name twice' else 'ok' end
  union all
  select 5, 2, '5 duplicate names', 'MONEY',
    (select string_agg(d.name, ', ' order by d.name) from (
      select min(name) as name from expense_categories group by lower(trim(name)) having count(*) > 1) d),
    null,
    case when exists (select 1 from expense_categories group by lower(trim(name)) having count(*) > 1) then 'CHECK: same name twice' else 'ok' end
) as checks
order by sort, n;

-- End of 024
