-- Adds the supermarket categories that were missing, and moves existing
-- items into them:
--
--   1. New main categories with sub-categories:
--      - Fruit & Vegetables (fruit, vegetables, potatoes/onions/garlic,
--        salad, fresh herbs)
--      - Dairy & Eggs (milk & cream, yogurt & desserts, cheese, butter,
--        eggs)
--      - Bakery & Bread (bread, pastries & cakes, rusks & breadsticks)
--      - Deli & Cold Cuts (cold cuts, fresh pasta, ready meals & dips)
--      - Frozen Food (ice cream, vegetables, meals & pizza, fish)
--      plus "Cereal & Breakfast" under Pantry Staples.
--   2. The main categories in shop order.
--   3. Pantry items whose sub-category is still empty are matched by
--      keywords in their name (English / Italian / Indonesian), like
--      006. Items given a sub-category by hand are left alone; items that
--      match nothing keep their category. Open grocery entries follow
--      their pantry item.
--
-- Non-destructive. Run in the Supabase SQL Editor (after 001–009). Safe
-- to re-run. The result shown is a short check.

-- ── 1. Categories ────────────────────────────────────────────────
insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('produce', 'Fruit & Vegetables', null, 'parent', 2),
  ('dairy', 'Dairy & Eggs', null, 'parent', 4),
  ('deli', 'Deli & Cold Cuts', null, 'parent', 5),
  ('bakery', 'Bakery & Bread', null, 'parent', 6),
  ('frozen', 'Frozen Food', null, 'parent', 7)
on conflict (id) do nothing;

insert into inventory_categories (id, name, parent_id, type, sort_order) values
  ('produce:fruit', 'Fresh Fruit', 'produce', 'sub', 1),
  ('produce:vegetables', 'Fresh Vegetables', 'produce', 'sub', 2),
  ('produce:potatoes', 'Potatoes, Onions & Garlic', 'produce', 'sub', 3),
  ('produce:salad', 'Salad & Leafy Greens', 'produce', 'sub', 4),
  ('produce:herbs', 'Fresh Herbs', 'produce', 'sub', 5),
  ('dairy:milk', 'Milk & Cream', 'dairy', 'sub', 1),
  ('dairy:yogurt', 'Yogurt & Desserts', 'dairy', 'sub', 2),
  ('dairy:cheese', 'Cheese', 'dairy', 'sub', 3),
  ('dairy:butter', 'Butter & Margarine', 'dairy', 'sub', 4),
  ('dairy:eggs', 'Eggs', 'dairy', 'sub', 5),
  ('deli:cold-cuts', 'Cold Cuts', 'deli', 'sub', 1),
  ('deli:fresh-pasta', 'Fresh Pasta', 'deli', 'sub', 2),
  ('deli:ready', 'Ready Meals & Dips', 'deli', 'sub', 3),
  ('bakery:bread', 'Bread', 'bakery', 'sub', 1),
  ('bakery:pastries', 'Pastries & Cakes', 'bakery', 'sub', 2),
  ('bakery:crispbread', 'Rusks & Breadsticks', 'bakery', 'sub', 3),
  ('frozen:ice-cream', 'Ice Cream', 'frozen', 'sub', 1),
  ('frozen:vegetables', 'Frozen Vegetables', 'frozen', 'sub', 2),
  ('frozen:meals', 'Frozen Meals & Pizza', 'frozen', 'sub', 3),
  ('frozen:fish', 'Frozen Fish', 'frozen', 'sub', 4),
  ('pantry-staples:cereal', 'Cereal & Breakfast', 'pantry-staples', 'sub', 8)
on conflict (id) do nothing;

-- ── 2. Shop order ────────────────────────────────────────────────
update inventory_categories c set sort_order = o.pos
from (values
  ('produce', 1), ('pantry-staples', 2), ('meat', 3), ('dairy', 4), ('deli', 5), ('bakery', 6), ('frozen', 7),
  ('canned', 8), ('beverages', 9), ('snacks', 10), ('cleaning', 11), ('laundry', 12), ('toiletries', 13),
  ('personal-care', 14), ('health', 15), ('pet', 16), ('household', 17), ('appliances', 18), ('misc', 19)
) as o(id, pos)
where c.id = o.id;

-- ── 3. Move matching items ───────────────────────────────────────
-- First matching rule wins (lowest pos). A rule without a category is an
-- exception that keeps the item where it is (e.g. "latte detergente" is
-- skincare, "oat milk" stays a drink). \m and \M are word boundaries.
with rules (pos, category_id, subcategory_id, pattern) as (
  values
    (1, null, null, 'daun salam|latte detergente|latte struccante|cleansing milk|body milk|ice cream (viso|corpo)|coconut milk|latte di cocco|santan|oat milk|soy milk|almond milk|rice milk|latte (di )?(avena|soia|mandorla|riso)|susu (kedelai|almond|oat)|peanut butter|burro di arachidi|cocoa butter|burro di cacao|body butter'),
    (2, 'frozen', 'frozen:fish', 'frozen (fish|shrimps?|prawns?|seafood)|pesce surgelato|gamberi surgelati|bastoncini( di pesce)?|fish fingers|fish sticks'),
    (3, 'frozen', 'frozen:vegetables', 'frozen (vegetables|veg|peas|spinach|broccoli|beans|corn)|verdure surgelate|minestrone surgelato|piselli surgelati|spinaci surgelati|sayur beku'),
    (4, 'frozen', 'frozen:ice-cream', 'ice ?creams?|ice-creams?|gelat[oi]|es krim|sorbett?o?|ghiaccioli?|ice lolly|ice pops?|magnum|algida|sammontana|walls'),
    (5, 'frozen', 'frozen:meals', 'frozen|surgelat[oi]|pizza|pizze|nuggets?|naget|sofficini|french fries|patatine fritte|frozen fries|findus|buitoni'),
    (6, 'produce', 'produce:potatoes', 'sweet potato(es)?|patate dolci|ubi|potato(es)?|patat[ae]|kentang|onions?|cipoll[ae]|bawang|garlic|aglio|shallots?|scalogn[oi]|ginger|zenzero|jahe'),
    (7, 'produce', 'produce:salad', 'salad|insalata|insalate|lettuce|lattuga|rucola|rocket|arugula|selada|valeriana|songino|iceberg'),
    (8, 'produce', 'produce:fruit', 'apples?|mel[ae]|apel|bananas?|banan[ae]|pisang|oranges?|arance?|arancia|jeruk|lemons?|limon[ei]|lime|pears?|per[ae]|pir|grapes?|uva|anggur|strawberr(y|ies)|fragol[ae]|stroberi|kiwi|mangos?|mangoes|mangga|pineapples?|ananas|nanas|peach(es)?|pesc[ah]e|persik|plums?|prugn[ae]|susine?|melons?|melon[ei]|semangka|watermelons?|anguri[ae]|cherr(y|ies)|cilieg[ie]e?|avocados?|alpukat|papayas?|pepaya|mandarin[ei]?|clementin[ae]|blueberr(y|ies)|mirtill[io]|raspberr(y|ies)|lampon[ei]|figs?|fich[io]|apricots?|albicocc(a|he)|pomegranates?|melagran[ae]|delima|dragon ?fruit|buah naga|durian|rambutan|salak|jambu|nectarines?|nettarin[ae]'),
    (9, 'produce', 'produce:vegetables', 'eggplants?|aubergines?|melanzan[ae]|terong|tomato(es)?|pomodor[io]|pomodorini|tomat|zucchin[ie]|courgettes?|carrots?|carot[ae]|wortel|bell peppers?|peperon[ei]|cucumbers?|cetriol[io]|timun|broccoli|brokoli|cauliflowers?|cavolfior[ei]|cabbages?|cavol[oi]|cavolo nero|kubis|kol|spinach|spinaci|bayam|kangkung|green beans|fagiolini|buncis|mushrooms?|fungh?[io]|champignons?|jamur|corn on the cob|pannocchi[ae]|jagung|asparag(i|us)|carciof[io]|artichokes?|celery|sedano|seledri|leeks?|porr[oi]|pumpkins?|zucca|labu|radish(es)?|ravanell[io]|lobak|fennel|finocchi?o?|beetroots?|barbabietol[ae]|kale|cime di rapa|friarielli|bok choy|pak ?choi|sawi|tauge|bean sprouts|okra|chayote|labu siam'),
    (10, 'produce', 'produce:herbs', 'fresh (basil|parsley|coriander|mint|rosemary|thyme|dill)|basilico fresco|prezzemolo fresco|menta fresca|daun (kemangi|seledri|bawang)|kemangi'),
    (11, 'dairy', 'dairy:eggs', 'eggs?|uov[ao]|telur'),
    (12, 'dairy', 'dairy:cheese', 'cheeses?|formaggi[oi]?|keju|mozzarella|parmigiano|parmesan|grana( padano)?|pecorino|ricotta|mascarpone|gorgonzola|stracchino|crescenza|scamorza|provolone|feta|cheddar|burrata|stracciatella|philadelphia|emmental|asiago|fontina|taleggio|brie|camembert|halloumi|galbani|vallelata|santa lucia'),
    (13, 'dairy', 'dairy:yogurt', 'yog(h)?urts?|skyr|kefir|budin[oi]|puddings?|panna cotta|activia|yomo|danone|m(ü|u)ller'),
    (14, 'dairy', 'dairy:butter', 'butter|burro|mentega|margarin[ae]|blue band'),
    (15, 'dairy', 'dairy:milk', 'milk|latte|susu|panna( da cucina| fresca| montata)?|cooking cream|whipping cream|heavy cream|single cream|double cream|parmalat|granarolo|ultra milk|indomilk|frisian flag'),
    (16, 'deli', 'deli:cold-cuts', 'prosciutto( cotto| crudo)?|salam[ei]|salami|mortadella|bresaola|speck|coppa|w(u|ü)rstel|hot ?dogs?|cold cuts|affettat[oi]|ham|turkey (slices|breast)|petto di tacchino|beretta|rovagnati|fiorucci|sosis|kanzler'),
    (17, 'deli', 'deli:fresh-pasta', 'tortellini|tortelloni|ravioli|cappelletti|agnolotti|gnocchi|pasta fresca|fresh pasta|rana'),
    (18, 'deli', 'deli:ready', 'hummus|ready meals?|piatti pronti|sushi|tzatziki|guacamole|pesto fresco'),
    (19, 'bakery', 'bakery:crispbread', 'grissini|fette biscottate|rusks?|crispbread|friselle|taralli|crostini'),
    (20, 'bakery', 'bakery:pastries', 'croissants?|cornett[oi]|brioche|cakes?|torta|torte|kue|muffins?|donuts?|doughnuts?|ciambell[ae]|panettone|pandoro|colomba|crostata|merendin[ae]|plumcake|bauli'),
    (21, 'bakery', 'bakery:bread', 'bread|pane|pan carr[eè]|roti|baguettes?|ciabatta|focaccia|piadin[ae]|tortillas?|wraps?|pita|buns?|bagels?|panini|sari roti'),
    (22, 'pantry-staples', 'pantry-staples:cereal', 'cereals?|cereali|corn ?flakes|muesli|granola|porridge|oatmeal|fiocchi d.avena|sereal|kellogg.?s')
),
matched as (
  select distinct on (p.id) p.id, r.category_id, r.subcategory_id
  from pantry_items p
  join rules r on p.name ~* ('\m(' || r.pattern || ')\M')
  where p.subcategory_id is null
  order by p.id, r.pos
)
update pantry_items p
set category_id = m.category_id, subcategory_id = m.subcategory_id
from matched m
where p.id = m.id and m.category_id is not null;

-- Open grocery entries follow their pantry item's category.
update grocery_items g set category_id = p.category_id, subcategory_id = p.subcategory_id
from pantry_items p
where g.completed = false
  and (g.pantry_item_id = p.id or (g.pantry_item_id is null and lower(trim(g.name)) = lower(trim(p.name))))
  and p.category_id in ('produce', 'dairy', 'deli', 'bakery', 'frozen')
  and (g.category_id is distinct from p.category_id or g.subcategory_id is distinct from p.subcategory_id);

-- ── Check ────────────────────────────────────────────────────────
select
  (select string_agg(name, ', ' order by sort_order) from inventory_categories where type = 'parent') as categories,
  (select count(*) from pantry_items where category_id in ('produce', 'dairy', 'deli', 'bakery', 'frozen')) as items_in_new_categories,
  (select count(*) from pantry_items where subcategory_id is null) as items_without_subcategory;
