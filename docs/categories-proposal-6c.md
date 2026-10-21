# NUTRIHUB round 6C: category completion proposal

Written 21/10/2026. **This document is a proposal only.** Nothing in the app, the
SQL files or the database was changed in round 6C. The build stage starts
only after Irene has answered the decisions below.

Source of truth: the Supabase export of 21/10/2026 (`tmp-export/`, not
in git), with two changes Irene made by hand after the export:

- the HOME sub "Perfume" under Laundry Supplies (id `e8e447c7-…`) is now
  **"Laundry Fragrance"**, and "Laundry Freshener" (Air Fresh Essence
  Cristalli profumati) has moved into it, so the name "Perfume" is free
- the MONEY main "Holiday" is now **"Trips & Holidays"** (same id `dc79f604-…`)

## Summary

- **Live data today.** HOME has 19 main categories and 75 sub-categories,
  with 238 items. MONEY has 15 main categories and 29 sub-categories.
  Only two mapping rows exist: Pet Supplies goes to Pets and Health &
  Medicine goes to Health. Every other HOME category books into
  **Groceries**, so an €80 body perfume is counted as Groceries today.
- **A bug in the app today.** If you create a HOME main category called
  "Baby" or "Automotive" with "+ New category", the app gives it the id
  `baby` or `automotive`. Both ids are still in `HIDDEN_CATEGORY_IDS`, so
  the new category is saved but never shown. The live data has no row
  with either id, so nothing else is hidden by that list.
- **Proposed HOME categories: 17.** 9 are Recommended: a new main "Baby"
  with 5 subs, Beauty Care › Perfume, Frozen Food › Frozen Meat and
  Toiletries › Feminine Care. 8 are Optional subs.
- **Proposed MONEY categories: 27.** 3 are already approved (Trips &
  Holidays › Flights, Souvenirs, Insurance & Visas). 13 are Recommended:
  a new main "Personal Care" with 3 subs, plus subs for Subscription,
  Entertainment, Car / Vehicle, Health and Pets. 11 are Optional. No
  income category is touched.
- **Keywords.** There are 28 HOME rules in the format of
  `data/categoryKeywords.js`. They cover the new categories and fill
  keyword gaps in existing subs. Some keywords move out of existing rules
  (table C.3). There is also a new MONEY keyword list with 41 rules, so a
  MONEY row with "Add to HOME" off can suggest Fuel, Netflix, Vet and so
  on without AI. I checked every rule with the app's real matching code:
  - With the new rules, the guess changes for 14 of the 238 live items,
    and all 14 changes are improvements.
  - All 59 MONEY test names find the right category.
- **Order (step 3, already decided by Irene).** One shared sort helper:
  categories A–Z, sub-categories A–Z under their main, and catch-alls
  last. Shop mode keeps `sort_order`, the MONEY charts keep sorting by
  amount, and the suggestion chips keep their own order. There are 16
  places to change (table 3.1).
- **How to create (step 4).** One insert-only file,
  `supabase/024_categories.sql`, that is safe to run twice, plus a short
  list of code changes and tests for the build stage.

## Decisions for Irene

Each decision has a real example, options and a recommendation. Nothing
is built until these are answered.

### 1. Where should non-food HOME categories book in MONEY?

**Example:** you buy a body perfume "Chanel Coco Mademoiselle 100 ml"
(HOME: Beauty Care › Perfume) for **€80**. Today it is booked as
**Groceries**. Shampoo (Toiletries, €4.50) and dish soap (Cleaning
Supplies, €2.20) are Groceries too.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| **A. Only beauty leaves Groceries** | New MONEY sub Shopping › "Beauty & Perfume". HOME Beauty Care books there. Everything else stays in Groceries. | Smallest change: 1 new MONEY sub, 1 mapping row. | Shampoo, razors and pads stay in Groceries. Hairdresser costs have no place except Other. |
| **B. A "Personal Care" main (Recommended)** | New MONEY main "Personal Care" with subs "Beauty & Perfume", "Toiletries" and "Hairdresser". HOME Beauty Care → Personal Care › Beauty & Perfume. HOME Toiletries → Personal Care › Toiletries. Cleaning, Laundry and Household Supplies stay in Groceries. | The €80 perfume and the €4.50 shampoo leave Groceries. The hairdresser gets a place. Groceries still means "the supermarket basket": food, drinks and cleaning. | 1 new main and 3 new subs. One supermarket receipt is split over two main categories (round 4 already shows that with a dot per main). |
| **C. Groceries = food and drink only** | Everything in B, plus a new MONEY main "Home Supplies" for Cleaning Supplies, Laundry Supplies and Household Supplies. | Groceries becomes a clean food number. | 2 new mains. Every supermarket receipt is split three ways. Small amounts (a €2.20 sponge) get their own chart slice. |

**Recommendation: B.** It fixes what is actually wrong (beauty and
hygiene counted as food) and leaves cheap household cleaning where it is.
You can still move to C later with one mapping change in HOME →
Categories, and the existing "Apply the mapping to past purchases" can
re-book old SHOP purchases if you want.

**Small extra choice in the same decision:** HOME Health & Medicine books
into MONEY **Health** (the main). With the new MONEY sub "Pharmacy", it
can book into **Health › Pharmacy** instead. Example: Tachipirina 500 mg,
€4.50. **Recommended: Pharmacy.** Doctor visits then stay separate in
Health › Doctor & Tests.

A change of mapping only affects new purchases. Old purchases change
only if you press "Apply the mapping to past purchases", which only ever
moves SHOP lines (decision 18).

### 2. Baby: create it now or later?

**Example:** "Pampers Baby Dry taglia 4, 46 pz", €12.90 → HOME: Baby ›
Diapers.

| Option | What happens | Pros | Cons |
|---|---|---|---|
| **A. Create now (Recommended)** | `024` creates HOME "Baby" with Diapers, Baby Wipes, Baby Food, Formula and Baby Care. Keywords work straight away. | Done once, with fixed ids, so keywords always point to the right sub. No second SQL run later. | One more main ("Baby") in every category list, and 5 empty subs in HOME Manage until you need them. |
| **B. Prepare now, create later** | The keyword rules are added now but do nothing (the app ignores rules for categories that don't exist). The Baby part of the SQL goes into its own file, `025_baby.sql`, that you run when you need it. | No empty categories now. | You have to remember to run a second file. If someone creates "Baby" in the app instead, the subs get random ids and the sub-level keywords stop working (they fall back to the main). |
| **C. Main only** | Create the HOME "Baby" main now, without subs. | The least clutter. | "Pannolini" and "omogeneizzato" can only suggest "Baby", never a sub, until the subs are made. |

**Recommendation: A.** One extra line in the lists is a small price for
categories that are ready the day you need them. The MONEY side is
separate. A MONEY main "Baby" is in the Optional list (decision 6). Until
it exists, HOME Baby books into Groceries (or Personal Care, if you
prefer). Optional HOME sub: Baby › Feeding (bottles, teats, dummies).

### 3. The old hidden ids "baby" and "automotive"

`HIDDEN_CATEGORY_IDS = ['baby', 'automotive']` hides any category with
those ids, and its subs as well. The live database has no row with
either id: `006` deleted them.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| **A. Reuse "baby" (Recommended)** | The new HOME main keeps the id `baby`. `'baby'` is removed from `HIDDEN_CATEGORY_IDS`. "+ New category" never picks a hidden id ("Automotive" would get `automotive-2`). | The Baby icon and amber colour already exist for `baby` (`CategoryIcon.jsx`, `categoryColors.js`). It also fixes the invisible-category bug. | You must reload both iPhones after the deploy. An old app version would hide Baby until it is reloaded. |
| **B. New id "baby-care"** | Leave the hidden list as it is, but still fix "+ New category". | No reload needed. | Needs a new icon and colour entry, and "baby" stays a trap in the code. |
| **C. Remove both ids and the hidden list** | Delete `HIDDEN_CATEGORY_IDS` and its code. | The simplest code. | The protection against an old stale row is gone. It isn't needed today, but costs nothing to keep. |

**Recommendation: A.** I also recommend not reusing `automotive`: see
decision 5 (Car Care goes under Household Supplies).

### 4. Asian and world foods

**Example:** you buy "Nori Sushi Seaweed 10 fogli" (€2.49), "Kimchi"
(€3.90) or "Tofu" (€1.89). Today none of them gets any suggestion,
because there is no keyword for them.

| Option | What changes | Pros | Cons |
|---|---|---|---|
| A. Keywords only | Asian sauces, noodles and snacks get more keywords in their existing subs (Sauces & Condiments, Pasta & Noodles, Savory Snacks, Sweet Snacks). Nori, kimchi and tofu still have no place. | No new category. | Things that are neither a sauce, a noodle nor a snack still get "No category". |
| **B. A + one sub "World Foods" under Pantry Staples (Recommended)** | Everything in A, plus one sub for nori, rice paper, kimchi, tofu, tteokbokki, dashi, tapioca pearls… | Every Asian product you buy has a place, and the structure stays "by product type". | One more sub. |
| C. A main "World Foods" with subs | Sauces, noodles and snacks are also split by cuisine. | Matches the "etnico" shelf. | Two ways to file the same thing: is soy sauce a Sauce or World Foods? Many guesses would be "unclear". |

**Recommendation: B.** Sauces and noodles stay in their product-type
subs: Sauces & Condiments already holds 26 items and works well.

### 5. Optional HOME subs: which ones do you want?

| Sub | Example item | Recommendation |
|---|---|---|
| Household › **Pest Control** | "Zampironi antizanzare", €3.50 | **Yes.** The tiger mosquito season in Emilia means you buy these every summer. |
| Household › **Car Care** | "Liquido lavavetri -20°", €4.90 | **Yes.** It books into MONEY Car / Vehicle by itself through one mapping row, instead of Groceries. |
| Household › **Stationery** | "Carta A4 risma 500 fogli", €4.99; ink cartridges | **Yes.** Ink cartridges are classed as a durable appliance today, so they can never be stocked (see C.3). |
| Household › Air Fresheners | "Glade Sensations", €5.90 | Only if you buy them regularly. |
| Household › Plants & Garden | "Terriccio universale 20 L", €6.90 | Only if you keep plants. |
| Toiletries › Shaving | "Lamette Gillette Mach3 x4", €11.90 | Only if you buy razors often. Without it, razors stay in Toiletries with no sub, as today. |
| Baby › Feeding | "Biberon Chicco 250 ml", €9.90 | Later, with the baby. |
| Pantry Staples › World Foods | see decision 4 | Yes (decision 4). |

### 6. Optional MONEY categories: which ones do you want?

| Category | Example | Recommendation |
|---|---|---|
| Health › **Dentist** | "Igiene dentale", €90 | **Yes.** Private dental care is a common yearly cost in Italy. |
| Bank & Fee › **Taxes & Fines** | "F24", "Multa ZTL" €83 | **Yes.** |
| Bank & Fee › **Documents & Permits** | "Rinnovo passaporto", "Kit permesso di soggiorno" | **Yes, if** either of you renews a passport or a permesso di soggiorno. |
| Subscription › **Software & Apps** | "Duolingo Super", "Microsoft 365" | **Yes, if** you have app subscriptions besides cloud storage. |
| Health › Glasses & Lenses | "Lenti a contatto mensili", €35 | Only if you wear them. |
| Pets › Pet Sitting | "Cat sitter 5 days", €75 | Useful when you travel abroad with the cat at home. Optional. |
| Entertainment › Books & Hobbies | "Libro Feltrinelli", €18 | Optional. |
| Baby (main) | "Asilo nido", "Passeggino" | Later, with the baby (decision 2). |
| Education (main) | "Corso di italiano", €120 | Optional. |
| Family Support (main) | Money sent to family | Optional. Only if you want to track it apart from bank fees. |
| Home Supplies (main) | see decision 1 C | Only with decision 1 option C. |

### 7. Two places where "A–Z everywhere" needs a yes

**Example:** the SHOP list has category chips (All · Fruit & Vegetables
· Pantry Staples · …), shown today in the supermarket's aisle order.

1. **SHOP list chips.** Your rule 1 ("filters A–Z") applies, so they
   would become A–Z. Shop mode keeps the aisle route either way.
   **Recommended: A–Z, as you decided**, so every filter behaves the same.
   The alternative is to keep aisle order only for these chips.
2. **Income categories (MONEY → Income).** Same screens and same
   component as expenses. **Recommended: the same A–Z with "Other"
   last.** Only the order changes; no income category is created, renamed
   or deleted.

### 8. How to create the categories

| Option | Pros | Cons |
|---|---|---|
| **A. One SQL file, `supabase/024_categories.sql` (Recommended)** | Fixed ids, so the keywords point exactly at the right sub. One run, safe to repeat, with a check at the end. | You run one file in the Supabase SQL Editor. |
| B. Create them by hand in the app (HOME Manage, MONEY Manage, HOME → Categories) | No SQL. | About 40 taps. Subs made in the app get random ids, so the keywords for them can only suggest the main. |

**Recommendation: A** (details in step 4).

---

## Step 0: housekeeping (done in round 6C)

- `tmp-export/` was added to `.gitignore`. Nothing from it is committed.
- `git status` before starting: clean except the untracked `tmp-export/`.
  Branch `main`; last commit `71e4c35` (round 6B).
- `npm test`: **85 test files, 1089 tests, all passed** (45 s). Nothing
  was fixed or changed.

## Step 1: how categories work in the code (checked, not changed)

| Topic | What the code does | Where |
|---|---|---|
| HOME ids | Seeded categories use `main` and `main:sub` (e.g. `frozen:fish`). The column default is `gen_random_uuid()::text`. A sub made in the app has **no id sent**, so it gets a uuid. A main made in the app gets a slug of its name ("Gluten free" → `gluten-free`), numbered when the id is taken. | `supabase/005_home_inventory.sql:14`, `src/hooks/useInventoryCategories.js:96-144` |
| Hidden HOME ids | `HIDDEN_CATEGORY_IDS = ['baby', 'automotive']`. `visibleInventoryCategories` drops a row whose id **or parent** is hidden. | `src/data/constants.js:116`, `src/lib/inventoryCategoryEdit.js:210-215` |
| **Confirmed:** "baby" and "automotive" no longer exist | `006` moved their items to `misc` and deleted them. The live export has 0 rows with either id or as a parent. | `supabase/006_backfill_inventory_data.sql:162-166`, `tmp-export/1_home.csv` |
| **Confirmed:** a new "baby" or "automotive" would be invisible | `addCategory("Baby")` builds the id `baby` (it only avoids ids among existing rows), and the hidden list then filters it out. The name check doesn't see hidden ids either, so nothing warns you. This is a live bug for "+ New category". | `useInventoryCategories.js:124-127` |
| Ready-made look for `baby` and `automotive` | Icon `Baby` / `Car`, colour amber / violet. | `src/components/ui/CategoryIcon.jsx:38-42`, `src/lib/categoryColors.js:55-59` |
| Display name override | `personal-care` is shown as "Beauty Care" only while the stored name is still "Personal Care & Beauty". The live name is already "Beauty Care". | `constants.js:121-122` |
| Durable | `DURABLE_CATEGORY_IDS = ['appliances']`: never stocked in HOME, and booked to MONEY "Home & Appliances" (or its sub with the same name as the HOME sub). | `constants.js:111-112`, `src/lib/budgetMap.js:19-29` |
| HOME names | Unique across all HOME levels, ignoring capitals, accents and extra spaces. Checked in app code only; there is no database index. | `inventoryCategoryEdit.js:19-57` |
| Similar names | `nameDistance`: Damerau-Levenshtein on `nameKey` (no accents, "&" = "and", plural removed). At most 1 typo for names of 4 letters or fewer, 2 for longer ones. It is only a warning. | `src/lib/categoryNames.js:42-85` |
| New-category row | `checkNewName`, `defaultNewBudget`: a MONEY main with exactly the same name, else what its main books to, else Groceries. A mapping row is stored only when it differs from that default. | `src/lib/newCategory.js` |
| Keyword rules | `[categoryId, subcategoryId \| null, 'kw\|kw…', { weak, kind }]`. A rule whose main doesn't exist is ignored before scoring. If only its sub is missing, it suggests the main. | `src/data/categoryKeywords.js`, `src/lib/categoryGuess.js:115-146` |
| Suggestions | memory → HOME item → keywords (up to 3) → similar name. A MONEY row with Add to HOME off gets budget chips: the remembered budget, then the HOME chips through the mapping, then a similar MONEY name. **There are no MONEY keywords at all.** | `src/lib/categorySuggest.js:118-156` |
| Synonyms | 20 pairs, offered only when a new name is already taken. | `src/data/categorySynonyms.js` |
| Mapping | `category_budget_map(id → expense_category_id)`: the sub's choice, else its main's, else the default. | `budgetMap.js:41-47` |
| MONEY by name | **Groceries** (`budgetMap.js:13,28`, `newCategory.js:60`, `ReceiptsView.jsx:24`), **Other** (`useExpenses.js:69`), **Home & Appliances** (`constants.js:112`). All three are locked in `CategoryManager.jsx:13-23`. Income: "Salary" and "Other" (`incomeCategories.js`). | |
| MONEY ids | uuid. `expense_categories.name` has a **case-sensitive unique constraint**; the app also refuses the same name in other capitals. | `supabase/schema.sql:78-81` |

**Finding in the keyword engine** (it affects how new rules must be written):
a word listed both among the keywords **and** in `weak` counts as a normal
keyword, because `buildIndex` adds it twice. 15 existing rules do this,
for example `hp` and `tv` in electronics or `finish` and `fairy` in
dishwashing. So "Cartucce HP" is guessed as an appliance today.

I **don't** recommend changing the engine: brand names like "Fairy
Platinum" and "Dash Pods" are only recognised because of it. Instead,
every proposed rule below lists a word that should really be weak **only**
in `weak`. I checked this for every rule.

## Step 2: proposed categories

Name rules checked for every proposal:

- English, Title Case, "&" style, at most 19 characters.
- Unique within HOME or within MONEY. There is **no exact clash** for any
  proposed name.
- The similar-name check (`nameDistance`, run with the real
  `lib/categoryNames.js` against all live names and all proposals) found
  **one near-duplicate**: MONEY "Vet" ~ "Pets" (distance 1). It was
  renamed to **"Veterinary"**, which has no near-duplicate.
- HOME "Perfume" doesn't clash with "Laundry Fragrance".
- The same name in HOME and MONEY is allowed: "Toiletries", "Baby". The
  two lists never check each other.

### A. HOME (`inventory_categories`)

R = Recommended, O = Optional.

| # | Category | Id | Under | R/O | Example items | Why |
|---|---|---|---|---|---|---|
| 1 | **Baby** (main) | `baby` | — | R | — | A baby is possible. Italian chains have a separate "Infanzia" aisle. |
| 2 | Diapers | `baby:diapers` | Baby | R | Pampers Baby Dry 4; Huggies Pull-Ups; pannolini costumino | The biggest recurring baby cost. |
| 3 | Baby Wipes | `baby:wipes` | Baby | R | WaterWipes; salviettine Chicco; Pampers Sensitive | Bought separately from diapers and for longer. |
| 4 | Baby Food | `baby:food` | Baby | R | Omogeneizzato Plasmon mela; pappa Mellin; biscotti per bambini | From weaning on. |
| 5 | Formula | `baby:formula` | Baby | R | Aptamil 1; Mellin 2 latte in polvere; Humana 3 | A large, regular cost of its own. |
| 6 | Baby Care | `baby:care` | Baby | R | Pasta cambio Fissan; baby shampoo; olio bambini | Hygiene and skin care for the baby. |
| 7 | Feeding | `baby:feeding` | Baby | O | Biberon; tettarelle; ciuccio | Small consumables. Create it later. |
| 8 | **Perfume** | `personal-care:perfume` | Beauty Care | R | Chanel Coco Mademoiselle EDP; Acqua di Gio; body mist | Asked for. Today perfume is guessed as Makeup. |
| 9 | **Frozen Meat** | `frozen:meat` | Frozen Food | R | Hamburger di bovino surgelati; polpette surgelate; Frozen Chinese Chicken Sausage | 3 live items are raw frozen meat filed under "Frozen Meals & Pizza". |
| 10 | **Feminine Care** | `toiletries:feminine` | Toiletries | R | Assorbenti Lines Seta; Tampax; detergente intimo Saugella | A monthly purchase. Today it sits in Toiletries with no sub, next to diapers and razors. |
| 11 | Shaving | `toiletries:shaving` | Toiletries | O | Lamette Gillette; schiuma da barba Proraso; strisce depilatorie Veet | Today these are in Toiletries with no sub. |
| 12 | World Foods | `pantry-staples:world` | Pantry Staples | O* | Nori; kimchi; tofu; rice paper; tteokbokki | Decision 4 (*Recommended there). |
| 13 | Stationery | `household:stationery` | Household Supplies | O* | Carta A4; penne a sfera; ink cartridges; nastro adesivo | Decision 5 (*Recommended there). |
| 14 | Car Care | `household:car-care` | Household Supplies | O* | Liquido lavavetri; Arbre Magique; olio motore 1 L | Decision 5. Books to MONEY Car / Vehicle. |
| 15 | Air Fresheners | `household:air` | Household Supplies | O | Glade; Air Wick diffusore; candele profumate | Decision 5. |
| 16 | Pest Control | `household:pest` | Household Supplies | O* | Zampironi; Autan; piastrine antizanzare | Decision 5 (*Recommended there). |
| 17 | Plants & Garden | `household:garden` | Household Supplies | O | Terriccio; concime; vaso per piante | Decision 5. |

**Total HOME: 17 (9 Recommended, 8 Optional).** With only the
Recommended ones, HOME goes from 19 to 20 mains and from 75 to 83 subs.
Why this number is right:

- Every Recommended category is either asked for (Baby, Perfume) or fixes
  live items that sit in the wrong place today (Frozen Meat, and Feminine
  Care for the sub-less Toiletries rule).
- Every Optional one has no item yet, so it is only worth creating when
  you need it.
- No new catch-all is proposed, and no main grows past 9 subs.

Not proposed, on purpose:

- **Meat Snacks** for "Chicken Feet Snack": Savory Snacks already fits,
  and a keyword now sends it there.
- **Asian Snacks**: snacks stay by product type.
- **Noodles** apart from Pasta & Noodles: that sub has only 1 item.
- **Party & Gifts**: "Gifts & Party" already exists.
- **Office** as a main: one Stationery sub is enough.
- A **car main** reusing `automotive`: too few items to justify a main.

**Home & Appliances (durable, locked): flagged only, nothing proposed.**
Durable subs that are missing are "Home Textiles" (towels, bed sheets),
"Furniture & Decor" and "Tools & DIY". If you want them later, each needs
a HOME sub **and** a MONEY Home & Appliances sub with exactly the same
name. That is how `pickDurableCategory` finds where a durable purchase
goes.

### B. MONEY (`expense_categories`)

A = Already approved, R = Recommended, O = Optional.

| # | Category | Under | A/R/O | Example expenses | Why |
|---|---|---|---|---|---|
| 1 | Flights | Trips & Holidays | **A** | Ryanair BLQ–BCN; Emirates BLQ–CGK; bagaglio extra | Approved. Long flights are the biggest trip cost. |
| 2 | Souvenirs | Trips & Holidays | **A** | Oleh-oleh; calamita; cartoline | Approved. |
| 3 | Insurance & Visas | Trips & Holidays | **A** | Assicurazione viaggio; visa on arrival; ESTA | Approved. |
| 4 | **Personal Care** (main) | — | R | — | Decision 1 B. |
| 5 | Beauty & Perfume | Personal Care | R | Perfume €80; Sephora; Kiko | Where HOME Beauty Care books. |
| 6 | Toiletries | Personal Care | R | Shampoo; toothpaste; razors | Where HOME Toiletries books. |
| 7 | Hairdresser | Personal Care | R | Parrucchiere €35; barbiere; estetista | A service, not a HOME item. |
| 8 | Streaming | Subscription | R | Netflix; Spotify; Disney+ | The usual monthly subscriptions. |
| 9 | Cinema & Events | Entertainment | R | Cinema UCI; concerto; museo | Entertainment has no sub today. |
| 10 | Fuel | Car / Vehicle | R | Benzina Eni €60; diesel | The most frequent car cost. "Gas" is home gas. |
| 11 | Maintenance | Car / Vehicle | R | Tagliando €220; cambio gomme; revisione; car wash | Yearly car costs. |
| 12 | Insurance & Tax | Car / Vehicle | R | RC auto €480; bollo auto €190 | Yearly car costs. |
| 13 | Parking & Tolls | Car / Vehicle | R | Telepass; autostrada; strisce blu | Frequent small costs. |
| 14 | Pharmacy | Health | R | Farmacia; Tachipirina | Medicine (also HOME Health, decision 1). |
| 15 | Doctor & Tests | Health | R | Visita dermatologo €120; ticket analisi | Health has no sub today. |
| 16 | Veterinary | Pets | R | Veterinario €60; vaccino gatto | The cat's biggest cost besides food. |
| 17 | Dentist | Health | O | Igiene dentale €90 | Decision 6. |
| 18 | Glasses & Lenses | Health | O | Occhiali; lenti a contatto | Decision 6. |
| 19 | Pet Sitting | Pets | O | Cat sitter while travelling | Decision 6. |
| 20 | Software & Apps | Subscription | O | Duolingo; Microsoft 365 | Decision 6. |
| 21 | Books & Hobbies | Entertainment | O | Libri; Lego; videogame | Decision 6. |
| 22 | Taxes & Fines | Bank & Fee | O | F24; multa; marca da bollo | Decision 6. |
| 23 | Documents & Permits | Bank & Fee | O | Passaporto; permesso di soggiorno | Decision 6. |
| 24 | Baby (main) | — | O | Asilo nido; passeggino | Decisions 2 and 6. |
| 25 | Education (main) | — | O | Corso di italiano | Decision 6. |
| 26 | Family Support (main) | — | O | Money sent to family | Decision 6. |
| 27 | Home Supplies (main) | — | O | Cleaning and laundry | Only with decision 1 C. |

**Total MONEY: 27** (3 Approved, 13 Recommended, 11 Optional). With the
Approved and Recommended ones, MONEY goes from 15 to 16 mains and from 29
to 44 subs. Every main that had no sub gets 1–4 subs, except Bank & Fee,
Cigarettes & Vape and Groceries:

- **Bank & Fee:** its own name already says "fees", so its subs are
  Optional.
- **Cigarettes & Vape:** a split adds nothing for budgeting. It does get
  a MONEY keyword rule, so "IQOS Terea" and "liquido svapo" find it.
- **Groceries:** no subs, because its detail lives in HOME.

No new catch-all is proposed.

**If decision 1 is A:** items 4, 6 and 7 are dropped, and "Beauty &
Perfume" goes under Shopping. **If C:** add item 27.

**Mapping rows** (`category_budget_map`). They are only written when they
differ from the default:

| HOME category | Books today | Proposed | Condition |
|---|---|---|---|
| `personal-care` Beauty Care | Groceries | Personal Care › Beauty & Perfume | Decision 1 B or C (A: Shopping › Beauty & Perfume) |
| `toiletries` Toiletries | Groceries | Personal Care › Toiletries | Decision 1 B or C |
| `health` Health & Medicine | Health | Health › Pharmacy | Decision 1, extra choice |
| `household:car-care` Car Care | Groceries (via Household) | Car / Vehicle | If created |
| `baby` Baby | Groceries | Baby (MONEY) | Only when MONEY "Baby" exists |
| `cleaning`, `laundry`, `household` | Groceries | Home Supplies | Only with decision 1 C |
| `pet` Pet Supplies | Pets | unchanged | — |

### C. Keywords

#### C.1 HOME rules (format of `data/categoryKeywords.js`)

These go before the "Home & Appliances" block, so consumables still win
ties against appliances.

- Rule 8 (Cotton Pads & Buds) and the last 11 rules fill gaps in
  **existing** subs. Four of them target live uuid sub ids (Cotton Pads &
  Buds, Laundry Fragrance, Color Care, Pet Treats & Care). That works
  because the rule engine compares ids, and if such a sub is ever deleted
  the rule falls back to its main.
- Rules for Optional categories only work once those categories exist.
  Until then the app ignores them, so they can go in together.

```js
  ['baby', 'baby:diapers', 'diaper|nappy|nappies|pannolino|pannolini|pannolini mutandina|mutandine assorbenti bambini|swim diaper|pannolini costumino|popok|popok bayi|pampers|huggies|mamypoko|merries|chicco pannolini|fater|baby dry', { weak: 'sweety|progressi', kind: 'diaper|nappy|pannolino|pannolini|popok' }],
  ['baby', 'baby:wipes', 'baby wipes|salviette bambini|salviette neonato|salviettine bambini|salviettine neonato|salviettine umidificate bambini|tisu basah bayi|pampers wipes|pampers salviette|huggies wipes|huggies salviette|chicco salviette|waterwipes|water wipes', { weak: 'salviettine', kind: 'baby wipes' }],
  ['baby', 'baby:food', 'baby food|omogeneizzato|omogeneizzati|pappe|pappa pronta|liofilizzato|liofilizzati|crema di riso bambini|crema di cereali bambini|biscotti per bambini|pastina per bambini|merenda bambini|svezzamento|makanan bayi|mpasi|bubur bayi|plasmon|hipp|nipiol|nestum|puffs bambini', { weak: 'pappa|biscottini|gerber', kind: 'baby food|omogeneizzato|omogeneizzati' }],
  ['baby', 'baby:formula', 'infant formula|baby formula|baby milk|latte in polvere|latte di crescita|latte di proseguimento|latte per neonati|latte artificiale|susu formula|susu bayi|aptamil|mellin|humana|nidina|blemil|neolatte|nan optipro', { kind: 'infant formula|baby formula|latte in polvere|latte di crescita|susu formula' }],
  ['baby', 'baby:care', 'baby shampoo|shampoo bambini|bagnetto|bagnoschiuma bambini|baby bath|baby lotion|baby cream|crema cambio|pasta cambio|nappy cream|diaper cream|fissan|pasta di fissan|baby oil|olio bambini|olio per bambini|baby powder|borotalco bambini|johnson baby|johnsons baby|mustela|bepanthenol|minyak telon|bedak bayi|sapone bambini|crema bambini', { weak: 'talco|telon', kind: 'baby shampoo|baby lotion|baby cream|crema cambio|pasta cambio' }],
  ['baby', 'baby:feeding', 'baby bottle|biberon|tettarella|tettarelle|ciuccio|ciucci|succhietto|pacifier|bavaglino|bavaglini|dot bayi|botol susu|empeng|sterilizzatore|philips avent|chicco biberon', { weak: 'bib|nuk|avent' }],
  ['personal-care', 'personal-care:perfume', 'perfume|profumo|profumi|parfum|eau de parfum|eau de toilette|cologne|colonia|acqua di colonia|body mist|fragrance|fragranza|minyak wangi|chanel|dior|armani|acqua di gio|versace|dolce gabbana|gucci|yves saint laurent|ysl|lancome|calvin klein|hugo boss|burberry|carolina herrera|paco rabanne|jo malone|acqua di parma|tom ford|narciso rodriguez|mugler|bvlgari|bulgari|marc jacobs|byredo|le labo', { weak: 'edp|edt|creed|valentino|kenzo|prada', kind: 'perfume|profumo|parfum|eau de parfum|eau de toilette|cologne' }],
  ['personal-care', 'dd8d720d-b911-4f55-af65-661ac7685eeb', 'cotton pad|dischetti|dischetti di cotone|dischetti struccanti|cotton bud|cotton fioc|bastoncini cotonati|cotton swab|q tips|batuffoli|kapas wajah|cotton ball|makeup remover cotton|makeup remover pad', { weak: 'cotone|kapas' }],
  ['frozen', 'frozen:meat', 'frozen meat|frozen chicken breast|frozen chicken wings|petto di pollo surgelato|frozen beef|frozen burger|frozen sausage|frozen meatballs|carne surgelata|pollo surgelato|hamburger surgelati|hamburger di bovino surgelati|polpette surgelate|polpette di bovino surgelate|cotolette surgelate|daging beku|ayam beku', { kind: 'frozen meat|carne surgelata' }],
  ['toiletries', 'toiletries:feminine', 'sanitary pads|assorbenti|assorbente|assorbenti notte|assorbenti interni|tampons|panty liners|pantyliner|proteggislip|salvaslip|menstrual cup|coppetta mestruale|period pants|mutande mestruali|intimate wash|detergente intimo|pembalut|nuvenia|tampax|carefree|laurier|softex|saugella|lactacyd', { weak: 'lines|charm|always|chilly', kind: 'assorbenti|sanitary pads|tampons|panty liners|pembalut' }],
  ['toiletries', 'toiletries:shaving', 'razor|rasoio|rasoi|lamette|razor blades|silet|pisau cukur|shaving foam|schiuma da barba|shaving gel|gel da barba|aftershave|dopobarba|beard oil|olio da barba|crema depilatoria|strisce depilatorie|wax strips|ceretta|veet|gillette|wilkinson|proraso', { weak: 'bic' }],
  ['pantry-staples', 'pantry-staples:world', 'nori|alga nori|seaweed|alghe|rumput laut|rice paper|carta di riso|kimchi|tteokbokki|tteok|tofu|tempeh|seitan|instant miso|miso soup|dashi|katsuobushi|furikake|pickled ginger|zenzero marinato|dried shiitake|shiitake secchi|black fungus|funghi neri|tapioca pearls|perle di tapioca|glutinous rice flour|farina di riso glutinoso|tepung ketan|tofu powder|cibo etnico|asian food|world food', { weak: 'tahu' }],
  ['household', 'household:stationery', 'stationery|cancelleria|penna|penne a sfera|biro|pencil|matita|matite|evidenziatore|highlighter|quaderno|quaderni|post it|sticky notes|envelope|buste da lettera|printer paper|carta per stampante|carta a4|risma|scissors|forbici|stapler|spillatrice|graffette|paper clips|correction tape|bianchetto|cartellina|raccoglitore|etichette|stabilo|staedtler|pritt|uhu|colla stick|glue stick|nastro adesivo|scotch tape|selotip|lakban|ink cartridge|cartuccia|cartucce|toner stampante|tinta printer|pulpen|buku tulis', { weak: 'pen|tape' }],
  ['household', 'household:car-care', 'car care|engine oil|motor oil|olio motore|olio per motore|oli mesin|oli motor|antifreeze|antigelo|liquido tergicristalli|liquido lavavetri|wiper fluid|screen wash|car shampoo|shampoo auto|car wax|cera auto|air radiator|air aki|deodorante auto|car air freshener|profumatore auto|arbre magique|pengharum mobil|spugna auto|wiper blades|spazzole tergicristallo|adblue', { weak: 'lavavetri' }],
  ['household', 'household:air', 'air freshener|room spray|deodorante per ambienti|deodorante ambienti|profumatore per ambienti|profumo per ambienti|diffusore|diffusore per ambienti|bastoncini profumati|candela profumata|candele profumate|scented candle|incense|incenso|toilet deodorizer|deodorante wc|tavolette wc|pengharum ruangan|pewangi ruangan|deodoran ruangan|glade|air wick|ambi pur|stella pengharum|bayfresh|febreze'],
  ['household', 'household:pest', 'insect spray|insetticida|insetticidi|zanzare|anti zanzare|anti zanzara|antizanzare|zampirone|zampironi|mosquito|mosquito repellent|repellente|autan|vape zanzare|vape magic|piastrine antizanzare|baygon|hit spray|obat nyamuk|trappola topi|mouse trap|esca formiche|ant bait|antitarme|naftalina|mothballs', { weak: 'raid' }],
  ['household', 'household:garden', 'plant|pianta|piante|terriccio|potting soil|fertilizer|concime|fertilizzante|flower pot|vaso per piante|semi da piantare|bulbi|giardinaggio|annaffiatoio|watering can|pupuk|pot bunga|cactus|orchidea|substral', { weak: 'cifo' }],
  ['laundry', 'e8e447c7-3b68-4eee-81e8-86915839565f', 'laundry perfume|laundry fragrance|laundry scent|scent booster|profumo bucato|profumo per bucato|profumatore bucato|profuma bucato|perle profumate|perle di profumo|essenza bucato|essenza lavatrice|cristalli profumati|unstoppables|air fresh essence'],
  ['laundry', '01386438-f2d4-418b-bcd6-082874075213', 'color catcher|colour catcher|acchiappacolore|catturacolore|salvacolore|foglietti salvacolore|ravviva nero|ravviva colori|black reviver|clothing reviver|color fade|dr beckmann'],
  ['pet', '3d924169-d334-44ee-947a-3e3a498706fc', 'cat treats|dog treats|snack per cani|snack per gatti|catnip|erba gatta|erba per gatti|cat grass|hairball|anti hairball|antibolo|pasta al malto|malto per gatti|dreamies|cat toy|gioco per gatti', { kind: 'catnip|hairball|erba gatta' }],
  ['cleaning', 'cleaning:surface', 'washing machine cleaner|pulizia lavatrice|anticalcare lavatrice|igienizzante lavatrice|calgon|dishwasher cleaner|pulizia lavastoviglie|curalavastoviglie'],
  ['snacks', 'snacks:savory', 'chicken feet snack|ceker snack|ceker pedas|beef jerky|jerky|dendeng|seaweed snack|nori snack|rice crackers|senbei'],
  ['snacks', 'snacks:sweet', 'pocky|mochi|yan yan|hello panda|koala march|choco pie|lotte'],
  ['pantry-staples', 'pantry-staples:pasta', 'glass noodles|vermicelli di riso|spaghetti di riso|noodles di riso|shirataki|somen|mi goreng|mie goreng|ramyeon|ramyun|samyang|nongshim|shin ramyun|nissin|cup noodles|soun|misoa|yakisoba|buldak'],
  ['pantry-staples', 'pantry-staples:sauces', 'gochujang|hoisin|char siu|ponzu|doubanjiang|black bean sauce|tom yum paste|curry paste|pasta di curry|wasabi|sweet chili sauce|sambal oelek'],
  ['personal-care', 'personal-care:deodorant', 'deodorante profumato'],
  ['frozen', 'frozen:meals', 'frozen onion rings|anelli di cipolla'],
  ['produce', 'produce:herbs', 'basilico in vaso|basil plant|herb pot'],
```

#### C.2 MONEY rules (new file `data/budgetKeywords.js`)

MONEY ids are uuids, so these rules use **names**: `[main name, sub name |
null, keywords, options]`, resolved by name. That is the same way the
code already finds Groceries and Other.

- Same matching engine (step 4 explains the small refactor).
- Used only for budget chips: a MONEY row with Add to HOME off, and later
  the Trips suggestions in round 7.
- 18 rules give keywords to **existing** MONEY categories: Cloud Storage,
  Memberships, Bank & Fee, Cigarettes & Vape, and the last 14 rules for
  Going out, Housing & Utilities and Shopping. Rules for Optional
  categories are ignored until they exist.

```js
  ['Car / Vehicle', 'Fuel', 'fuel|benzina|diesel|gasolio|carburante|rifornimento|gpl|bensin|pertamax|petrol|distributore|enilive|tamoil|agip|totalerg', { weak: 'eni|ip|api|shell|esso|q8|metano' }],
  ['Car / Vehicle', 'Maintenance', 'tagliando|meccanico|officina|car service|oil change|cambio olio|pneumatici|tyres|tires|cambio gomme|gommista|revisione|carrozzeria|carrozziere|car repair|riparazione auto|batteria auto|bengkel|ganti oli|norauto|euromaster|lavaggio auto|car wash|autolavaggio', { weak: 'gomme' }],
  ['Car / Vehicle', 'Insurance & Tax', 'rc auto|assicurazione auto|car insurance|polizza auto|bollo auto|tassa automobilistica|pajak mobil|asuransi mobil|prima assicurazioni|genertel|direct line|linear assicurazioni|conte it|allianz direct', { weak: 'bollo|verti' }],
  ['Car / Vehicle', 'Parking & Tolls', 'parking|parcheggio|strisce blu|easypark|telepass|unipolmove|pedaggio|autostrada|toll|casello|parkir', { weak: 'sosta|tol|ztl' }],
  ['Trips & Holidays', 'Flights', 'flight|volo|voli|biglietto aereo|plane ticket|airline|ryanair|easyjet|wizz air|wizzair|ita airways|lufthansa|emirates|qatar airways|turkish airlines|air france|singapore airlines|garuda indonesia|batik air|lion air|airasia|vueling|volotea|tiket pesawat|pesawat|baggage fee|bagaglio extra', { weak: 'klm|scoot' }],
  ['Trips & Holidays', 'Souvenirs', 'souvenir|ricordino|oleh oleh|calamite|cartolina|postcard|keychain|portachiavi', { weak: 'magnet|calamita' }],
  ['Trips & Holidays', 'Insurance & Visas', 'travel insurance|assicurazione viaggio|evisa|e visa|visa on arrival|schengen visa|asuransi perjalanan|heymondo|world nomads|safetywing|allianz travel|axa travel', { weak: 'visa|esta|visto' }],
  ['Personal Care', 'Hairdresser', 'hairdresser|parrucchiere|parrucchiera|barbiere|barber|haircut|taglio capelli|colore capelli|estetista|beautician|manicure|pedicure|nail salon|massage|massaggio|potong rambut', { weak: 'piega|salon' }],
  ['Personal Care', 'Beauty & Perfume', 'profumeria|sephora|cosmetici|cosmetics|acqua e sapone|tigota', { weak: 'douglas|kiko' }],
  ['Subscription', 'Streaming', 'netflix|disney plus|prime video|amazon prime|spotify|apple music|youtube premium|dazn|now tv|paramount plus|apple tv|crunchyroll|vidio|iqiyi|wetv|tidal|deezer|audible', { weak: 'sky|disney|viu' }],
  ['Subscription', 'Software & Apps', 'microsoft 365|office 365|adobe|canva|chatgpt|claude pro|notion|duolingo|nordvpn|vpn|1password|app store|apple one|software'],
  ['Subscription', 'Cloud Storage', 'icloud|google one|google drive|dropbox|onedrive'],
  ['Subscription', 'Memberships', 'gym|palestra|abbonamento palestra|membership|quota associativa|tessera'],
  ['Entertainment', 'Cinema & Events', 'cinema|movie|biglietto cinema|the space|uci cinemas|concert|concerto|spettacolo|teatro|theatre|museo|museum|mostra|exhibition|festival|ticketone|vivaticket|ticketmaster|stadio|bioskop|konser', { weak: 'film|show' }],
  ['Entertainment', 'Books & Hobbies', 'libro|libri|feltrinelli|mondadori|kindle|videogame|videogioco|playstation|nintendo|hobby|lego|puzzle|buku', { weak: 'steam|book' }],
  ['Health', 'Pharmacy', 'farmacia|pharmacy|parafarmacia|apotek|ticket farmacia'],
  ['Health', 'Doctor & Tests', 'doctor|medico|visita medica|specialist|specialista|analisi|esami del sangue|blood test|ecografia|ultrasound|radiografia|x ray|ticket sanitario|ospedale|hospital|poliambulatorio|dokter|rumah sakit|laboratorio analisi|fisioterapia|physiotherapy|ginecologo|dermatologo|oculista', { weak: 'visita' }],
  ['Health', 'Dentist', 'dentista|dentist|igiene dentale|pulizia denti|dental cleaning|otturazione|ortodonzia|dokter gigi'],
  ['Health', 'Glasses & Lenses', 'occhiali|lenti a contatto|contact lenses|ottico|optician|salmoiraghi|grandvision|lensa kontak|kacamata', { weak: 'lenti|glasses' }],
  ['Pets', 'Veterinary', 'veterinario|veterinary|clinica veterinaria|visita veterinaria|vaccino gatto|sterilizzazione gatto|microchip|dokter hewan', { weak: 'vet' }],
  ['Pets', 'Pet Sitting', 'pet sitter|cat sitter|pensione per gatti|pensione gatti|pet hotel|penitipan kucing'],
  ['Bank & Fee', null, 'bank fee|commissione|commissioni|canone conto|bonifico|transfer fee|western union|remitly|card fee|costo carta|interessi|biaya admin|biaya transfer', { weak: 'wise' }],
  ['Bank & Fee', 'Taxes & Fines', 'tax|tasse|imposta|f24|irpef|commercialista|marca da bollo|multa|multe|sanzione|pajak|denda|agenzia delle entrate', { weak: 'caf' }],
  ['Bank & Fee', 'Documents & Permits', 'permesso di soggiorno|kit permesso|passport|passaporto|carta d identita|codice fiscale|ambasciata|embassy|consolato|kbri|paspor|traduzione giurata|apostille|legalizzazione'],
  ['Cigarettes & Vape', null, 'sigarette|cigarettes|tabacco|tobacco|iqos|heets|terea|svapo|liquido svapo|e liquid|vape|vape liquid|marlboro|camel|chesterfield|rokok|tabaccheria'],
  ['Education', null, 'education|course|corso|corso di italiano|lezione|lezioni|scuola|school|universita|university|tuition|tasse universitarie|libri di testo|textbook|kursus', { weak: 'les' }],
  ['Baby', null, 'asilo nido|babysitter|baby sitter|pediatra|passeggino|seggiolino auto|culla|stroller|car seat'],
  ['Going out', 'Restaurant', 'ristorante|restaurant|pizzeria|trattoria|osteria|sushi restaurant|all you can eat|rumah makan'],
  ['Going out', 'Bar & Coffee', 'caffe al bar|cappuccino|cornetto al bar|colazione al bar|pasticceria', { weak: 'bar' }],
  ['Going out', 'Aperitivo', 'aperitivo|spritz|apericena'],
  ['Going out', 'Takeaway & Delivery', 'deliveroo|glovo|just eat|justeat|uber eats|takeaway|asporto|kebab'],
  ['Housing & Utilities', 'Rent', 'rent|affitto|canone affitto|sewa'],
  ['Housing & Utilities', 'Electricity', 'electricity|luce|bolletta luce|energia elettrica|enel|hera luce|listrik'],
  ['Housing & Utilities', 'Gas', 'bolletta gas|gas bill|hera gas'],
  ['Housing & Utilities', 'Water', 'bolletta acqua|water bill|servizio idrico'],
  ['Housing & Utilities', 'Waste Collection', 'tari|rifiuti|waste'],
  ['Housing & Utilities', 'Internet & Phone', 'internet|fibra|wifi|fastweb|vodafone|iliad|windtre|ho mobile|very mobile|kena mobile|ricarica|phone plan|pulsa', { weak: 'tim' }],
  ['Shopping', 'Clothing', 'clothes|vestiti|maglia|maglietta|pantaloni|jeans|giacca|cappotto|zara|ovs|uniqlo|primark|shein|bershka|pull bear|baju', { weak: 'h m' }],
  ['Shopping', 'Shoes & Accessories', 'shoes|scarpe|sneakers|stivali|borsa|zaino|cintura|orologio|sepatu', { weak: 'tas' }],
  ['Shopping', 'Electronics', 'mediaworld|unieuro|euronics|apple store|cuffie|charger|caricatore'],
  ['Shopping', 'Gifts', 'gift|regalo|regali|kado|hadiah'],
```

#### C.3 Conflicts with existing rules and how they're resolved

Every new keyword was compared with every existing rule, after the
removals below. **No new keyword is still claimed by another rule.**

| Keyword(s) | Today in | Moves to | Why |
|---|---|---|---|
| diapers, pannolini, popok, pampers, huggies, mamypoko, sweety, merries | Toiletries (no sub) | Baby › Diapers | Baby products. |
| baby wipes | Toiletries › Toilet Paper & Tissues | Baby › Baby Wipes | "Salviette" and "salviette umidificate" **stay** in Toiletries (adult wipes). Only baby-specific phrases and brand + wipes ("Huggies salviette") go to Baby. |
| baby oil, olio per bambini | Beauty › Skincare | Baby › Baby Care | |
| plasmon | Snacks › Sweet Snacks | Baby › Baby Food | "Plasmon" alone → Baby Food. "Plasmon biscotti" still → Sweet Snacks (biscotti is a "kind" word and wins). |
| perfume, profumo, parfum, eau de toilette, cologne, colonia, body mist | Beauty › Makeup | Beauty › Perfume | "Profumo per ambienti" stays air freshener (3 words win). |
| deodorante profumato | Beauty › Makeup | Beauty › Deodorant | It's a deodorant. |
| cotton pads, dischetti di cotone, cotton buds, cotton fioc, bastoncini cotonati, kapas | Toiletries › Toilet Paper & Tissues | Beauty › Cotton Pads & Buds (live sub) | That sub exists since 19/10, but no keyword pointed to it. |
| cotton, q tips | Toiletries (no sub) | Beauty › Cotton Pads & Buds | "cotone idrofilo" stays First Aid. |
| sanitary pads, assorbenti, tampons, panty liners, lines, nuvenia, tampax, charm, laurier, softex… | Toiletries (no sub) | Toiletries › Feminine Care | |
| intimate wash, detergente intimo | Toiletries › Soap & Shower Gel | Toiletries › Feminine Care | Saugella and Chilly are feminine hygiene. |
| razor, rasoio, lamette, gillette, bic, schiuma da barba, dopobarba… | Toiletries (no sub) | Toiletries › Shaving | **Only if Shaving is created.** Otherwise they stay. "Rasoio elettrico" stays an appliance (2 words win). |
| cat treats, dog treats, snack per cani/gatti | Pet › Pet Food | Pet › Pet Treats & Care (live sub) | Matches the sub's name. "Catnip Snack Hairball Remover" was guessed as a human snack. |
| engine oil, antigelo, liquido tergicristalli, car shampoo, lavavetri… | Miscellaneous (no sub) | Household › Car Care | Only if Car Care is created. Otherwise they stay. |
| air freshener, deodorante per ambienti, glade, air wick, ambi pur… | Household (no sub) | Household › Air Fresheners | Only if created. |
| insect spray, zanzare, autan, baygon, zampirone… | Household (no sub) | Household › Pest Control | Only if created. **"vape" is dropped** (it is also the e-cigarette, see MONEY Cigarettes & Vape). Only "vape zanzare" and "vape magic" remain. |
| glue, colla, tape, nastro adesivo, scotch tape, selotip, lakban | Household (no sub) | Household › Stationery | Only if created. |
| ink cartridge, cartuccia, cartucce, toner stampante | Home & Appliances › Electronics (**durable**) | Household › Stationery | Ink is a consumable. Today it can never be stocked. "Cartucce HP" stays ambiguous because of the `hp` finding above; both chips are offered. |
| washing machine cleaner, pulizia lavatrice, calgon | (none: "washing machine" → Cleaning Appliances, durable) | Cleaning › Surface Cleaners | Your "Washing Machine Cleaner" is guessed as an appliance today. Surface Cleaners is where you put it. |
| basilico in vaso | (basilico → Spices) | Fruit & Vegetables › Fresh Herbs | A supermarket basil pot is a fresh herb. |
| frozen chicken (bare) | — | **Not added** | It would have sent "Frozen Chicken Ravioli" to Frozen Meat. Only "frozen chicken breast / wings" are used. |
| pen, tape, salviettine, pappa, talco, telon, cotone, kapas, sweety, edp, edt, prada… | — | `weak` only | Ambiguous words that only count as the whole name (see the finding in step 1). |

Words checked and deliberately kept where they are:

- **penne**: still pasta. Only "penne a sfera" is stationery, and "Penne
  Barilla" stays pasta.
- **bastoncini**: still fish sticks.
- **formula**: stays a toothpaste brand (weak). The baby rule only uses
  "infant formula", "baby formula" and "latte in polvere".
- **latte 1 / latte 2**: **not** used. The app strips numbers, so
  "latte 1" would become "latte" and fight with milk.

MONEY ambiguities resolved with `weak`:

- **bar**: "protein bar" mustn't become Bar & Coffee.
- **visa**: the payment card.
- **bollo**: "marca da bollo" goes to Taxes & Fines, "bollo auto" to Car.
- **eni, ip, shell, sky, wise, vet, tas, tim**: short names that also
  appear inside other names.
- **nido** is not used, because Nido is also a milk-powder brand. Only
  "asilo nido" is used.

**Result on the live data** (all 238 HOME items, real
`guessCategory`): the guess changes for **14 items**, and each change is
an improvement.

| Item (where it is now) | Guess before | Guess after |
|---|---|---|
| Makeup Remover Cotton (Skincare) | Skincare | Cotton Pads & Buds |
| Cotton bud (Cotton Pads & Buds) | Toilet Paper & Tissues | Cotton Pads & Buds |
| Laundry Perfume - Coccolino (Laundry Fragrance) | none | Laundry Fragrance |
| Laundry Freshener Air Fresh Essence Cristalli profumati | Detergent | Laundry Fragrance |
| Clothing Reviver (Black Color) / Color Fade Prevention Sheet (Color Care) | none | Color Care |
| Catnip Snack Hairball Remover (Pet Treats & Care) | Savory Snacks | Pet Treats & Care |
| Chicken Feet Snack (Snacks) | none | Savory Snacks |
| Snack - Bulk Beef Jerky Sweet Chilli (Savory Snacks) | none | Savory Snacks |
| Washing Machine Cleaner (Surface Cleaners) | Cleaning Appliances (durable!) | Surface Cleaners |
| Hamburger di bovino surgelati / Beef MeatBall - Polpette di bovino surgelate (Frozen Meals) | Beef & Meat | Frozen Meat |
| Instant Tofu Powder (Flour & Baking) | Spices | World Foods |
| Toilet Deodorizer Gel (Surface Cleaners) | none | Air Fresheners |

For an item that already exists, its own category still comes first,
because the HOME-item layer is tried before keywords. These guesses
matter for new names and for SHOP entries.

### D. Existing items that look misplaced (a list only; nothing is moved)

| Item | Now in | Better in | Reason |
|---|---|---|---|
| Makeup Remover Cotton | Beauty Care › Skincare | Beauty Care › Cotton Pads & Buds | It's cotton pads, and that sub exists. |
| Chicken Feet Snack | Snacks (no sub) | Snacks › Savory Snacks | The only item in Snacks without a sub. |
| Hamburger di bovino surgelati | Frozen Food › Frozen Meals & Pizza | Frozen Food › Frozen Meat (new) | Raw frozen meat, not a ready meal. |
| Beef MeatBall - Polpette di bovino surgelate | Frozen Meals & Pizza | Frozen Meat (new) | Same. |
| Frozen Chinese Chicken Sausage | Frozen Meals & Pizza | Frozen Meat (new) | Same. |
| "Wheat Dry Bread" Wasa Original fette croccanti di segale | Bakery › Bread | Bakery › Rusks & Breadsticks | Wasa is crispbread. The keyword "wasa" already points there. |
| Gochujang - Hot Red Pepper Paste | Pantry › Spices & Seasonings | Pantry › Sauces & Condiments | A paste used like a sauce (low priority). |
| Toilet Deodorizer Gel | Cleaning › Surface Cleaners | Household › Air Fresheners | Only if Air Fresheners is created. |
| Instant Tofu Powder (Soyspring) | Pantry › Flour & Baking | Pantry › World Foods | Only if World Foods is created. |
| Psyllium Fiber (NaturaleBio) | Pantry › Flour & Baking | Health › Vitamins & Supplements | Taken as a fibre supplement (low priority; keep it if you bake with it). |
| Fontana Water Filter / Fontana Water Pump Filter | Pet › Litter & Hygiene | Pet › Pet Treats & Care | Parts for the cat's water fountain, not litter (low priority). |
| Big Cordon Blue 1 time buy / Cordon bleu XXL | Meat › Chicken & Poultry | Frozen Food › Frozen Meat (new) | **Only if** they are the frozen kind. |

Not about categories, but noticed: "Tooth Paste" and "Toothpaste",
"Peanut Butter" and "Peanut butter - Maribel Crema di arachidi 100%",
"Iceberg" and "Iceberg Salad (pack)" may be duplicate items.

## Step 3: category order (decided by Irene; planned, not built)

Irene's rules:

1. Wherever a category is **searched or picked**: mains A–Z, subs A–Z
   under their main.
2. Catch-alls last: "Other", "Others", "Miscellaneous / Seasonal".
3. Shop mode keeps `inventory_categories.sort_order`.
4. The MONEY charts sort by amount.
5. Suggestion chips keep their own order.

### 3.1 Every place categories are listed or picked

| # | Where | File:line | Sorted today | Rule |
|---|---|---|---|---|
| 1 | Source of all HOME lists: `parents`, `pantryParents`, `subsByParent` | `src/hooks/useInventoryCategories.js:84-94` (from `inventoryCategoryStore`, `src/lib/stores.js:50-56`) | `sort_order`, then name | 1 (and keep a separate shop order for 3) |
| 2 | HOME category + sub selects (HOME item editor, SHOP "More options", MONEY row "Add to HOME", Order "Arrived") | `src/components/inventory/CategoryFields.jsx:53,75`, used at `ItemEditor.jsx:247`, `AddItemForm.jsx:152`, `PurchaseForm.jsx:356`, `ArrivedDialog.jsx:73` | shop order | 1 |
| 3 | HOME filter (category + sub) | `src/pages/PantryPage.jsx:295,305` | shop order | 1 |
| 4 | HOME Manage: list, "+ Add sub-category" parent, Move target, Delete "Move items to…" | `src/components/inventory/InventoryCategoryManager.jsx:325,309,171,213` | shop order | 1 + 2 |
| 5 | HOME → Categories (mapping): HOME list | `src/components/inventory/BudgetMappingView.jsx:108,128` (parents from `PantryPage.jsx:402`) | shop order | 1 + 2 |
| 6 | HOME → Categories (mapping): budget select | `BudgetMappingView.jsx:41-42,74` | MONEY name order, "Other" mid-list | 1 + 2 |
| 7 | "+ New category" row: "Sub-category of …" list | `src/components/ui/CategoryChips.jsx:125` (`homeMains`/`moneyMains` from `src/hooks/useCategoryCreation.js:21-22`) | HOME shop order / MONEY name order | 1 + 2 |
| 8 | "+ New category" row: budget select | `CategoryChips.jsx:137-146` | MONEY name order | 1 + 2 |
| 9 | SHOP list category chips (filter) | `src/pages/GroceryPage.jsx:193,349` | shop order | 1 (decision 7) |
| 10 | Source of all MONEY lists: `categoryTree` (`mainCategories`, `subsOf`) | `src/lib/moneyList.js:90-98` (from `expenseCategoryStore`, `stores.js:105-110`) | name (`localeCompare`), "Other" mid-list | 1 + 2 |
| 11 | MONEY pickers: MONEY purchase-form budget select, edit expense, Order form, SHOP Order online | `src/components/expenses/PurchaseForm.jsx:374-379`; `ExpenseCategoryPicker.jsx:18,31` used at `ExpenseForm.jsx:115`, `OrderForm.jsx:283`, `src/components/grocery/OrderOnlineDialog.jsx:79` | name | 1 + 2 |
| 12 | MONEY Manage (and Income Manage, same component): list, "Main category" select, Move select | `src/components/expenses/CategoryManager.jsx:52-53,245,224,131` | name | 1 + 2 |
| 13 | Income pickers | `src/components/expenses/IncomeForm.jsx:66,81` (`incomeCategoryStore`, `stores.js:158-164`) | name | 1 + 2 (decision 7) |
| 14 | Opened MONEY purchase: sections per main | `src/lib/moneyList.js:175` (`purchaseSections`) | A–Z, "Uncategorized" last | 1 + 2 ("Other" last too) |
| 15 | **Shop mode** route and "By category" | `src/components/grocery/ShoppingMode.jsx:47,56-57`; `src/lib/shopMode.js:18-49` | saved positions (`shop_order`, 012), else `defaultOrder` = parents in `sort_order` | **3: unchanged** |
| 16 | MONEY charts / "Totals per category" | `src/lib/moneySummary.js:10-23` (used by `MoneyExplorer.jsx:62`) | amount, largest first | **4: unchanged** |
| 17 | Suggestion chips | `src/lib/categorySuggest.js:118-156`, `categoryGuess.guessCategories` | best match first | **5: unchanged** |
| 18 | MONEY list "Sort by → Category" | `src/lib/moneyList.js:52-62` | newest activity first | unchanged: a list of expenses, not a picker (flagged below) |

Options such as "All", "Uncategorized", "No sub-category", "Main
category", "New main category" and "+ New category…" are **not**
categories. They stay where they are (first, or last for "+ New…").

**What `sort_order` is used for (confirmed):**

- `inventoryCategoryStore` reads rows ordered by `sort_order` then name.
  That order flows into every HOME list today (rows 1–9).
- `ShoppingMode` uses it as `defaultOrder`, the place of a category that
  has no saved position in `shop_order`. This is the **only** use that
  means "the shop route".
- `addCategory` gives a new main `max + 1` (the end of the route), and
  `addSubcategory` gives a sub `count + 1`.
- No database function reads it. It appears only in the seeds
  (005/006/010).
- A sub's `sort_order` has no route meaning: Shop mode groups by main
  category only. After the change it only matters for a tie.

So after the change `sort_order` = the default shop route, and nothing
else.

### 3.2 Build plan

**One shared helper**, new `src/lib/categoryOrder.js` (+ test):

```js
// Catch-all categories: always last, whatever their letter.
export const CATCH_ALL_IDS = ['misc']                       // HOME "Miscellaneous / Seasonal"
export const CATCH_ALL_NAMES = ['Other', 'Others', 'Miscellaneous / Seasonal']
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true }) // ignores capitals and accents
export const isCatchAll = (c) => CATCH_ALL_IDS.includes(c.id) || CATCH_ALL_NAMES.some((n) => sameName(n, c.name))
export const compareCategories = (a, b) => isCatchAll(a) - isCatchAll(b) || collator.compare(a.name ?? '', b.name ?? '') || String(a.id).localeCompare(String(b.id))
export const sortCategories = (list) => [...list].sort(compareCategories)
// Flat list → mains A–Z, each followed by its subs A–Z (catch-alls last at both levels).
export function sortCategoryTree(categories) { … }
```

Where it is used:

- **`useInventoryCategories`**: `parents`, `pantryParents` and each
  `subsByParent` list become A–Z. A **new** `shopOrder` (main ids in
  `sort_order`) is returned for Shop mode. This way every current and
  future picker gets rule 1 by default, and only the route needs to ask
  for the exception. `ShoppingMode.jsx:47` changes to
  `const defaultOrder = shopOrder`.
- **`categoryTree`** (`moneyList.js:90`): `mainCategories` and `subsOf`
  come out sorted. This covers rows 10, 11 and 13.
- **`CategoryManager.jsx:52-53`**: `parents` and `subsOf` are sorted.
  This covers MONEY Manage and Income Manage.
- **`BudgetMappingView.jsx:41-42`**: the options. Its HOME list comes from
  the hook, so it is already covered.
- **`useCategoryCreation.js:22`**: `moneyMains`. The budget select in
  `CategoryChips.jsx:137` sorts the subs per main with the helper.
- **`purchaseSections`** (`moneyList.js:175`): `compareCategories` with
  "Uncategorized" still last.
- **Not changed:** the store `compare` functions (they are data, not
  screens), `shopMode.js`, `moneySummary.categoryTotals`, `categorySuggest`
  and `moneyList.byCategory`.

Tests to add:

- `src/lib/categoryOrder.test.js`:
  - A–Z ignores capitals and accents ("éclair" sorts with "e").
  - "Other" is last among MONEY mains, "Others" last among Shopping subs,
    and `misc` last among HOME mains even after a rename (found by id).
  - Numbers sort naturally ("Size 2" before "Size 10").
  - Equal names keep a stable order.
  - The input list is not changed.
- `src/hooks/inventoryCategories.test.jsx`:
  - `parents` is A–Z.
  - `shopOrder` keeps `sort_order`: a category with a low `sort_order`
    and a late letter is first in `shopOrder` and later in `parents`.
- `src/lib/shopMode.test.js`: `groupByCategory` with `shopOrder` still
  follows the route.
- `src/lib/moneyList.test.js`: `categoryTree` mains are A–Z with Other
  last; `purchaseSections` puts Other before Uncategorized at the end.
- Render tests:
  - `categoryFields.test.jsx`: option order.
  - `categoryManager.test.jsx` (HOME) and `categoryManager.similar.test.jsx`
    (MONEY): the list order, with Other / Miscellaneous last.
  - `pages.render.test.jsx`: the HOME filter and the SHOP chips.

**Flagged places where A–Z might be a bad idea:**

1. **SHOP list chips.** They are used in the shop. Aisle order could be
   handier, but your rule 1 includes filters, and Shop mode keeps the
   route anyway → decision 7, recommended A–Z.
2. **HOME Manage.** After the change no screen shows the default route
   order. That's fine: the route is changed in Shop mode (saved
   positions), never in Manage. Note that a new main still gets the last
   `sort_order`, so it appears at the end of the Shop mode route.
3. **MONEY "Sort by → Category" list** (row 18). It is a list of expenses
   ordered by most recent activity. Making it A–Z would hide what was
   spent recently, so I recommend keeping it. Say if you want A–Z there
   too.
4. **Income** follows the same rule (decision 7).

## Step 4: how the build stage would add the categories (described; no SQL written)

### 4.1 `supabase/024_categories.sql` (Recommended: decision 8)

File rules:

- Insert-only. `on conflict do nothing`, plus a name check, so it is safe
  to run again.
- No deletes and no updates. No renames of existing rows.
- Never touches income.
- Ends with a verification SELECT.
- Never run by Claude. Irene runs it in the SQL Editor.

How each part works:

1. **HOME mains** (`inventory_categories`): `insert (id, name, parent_id,
   type, sort_order) … on conflict (id) do nothing`. A row is skipped when
   any HOME row already has the same name (`lower(trim(name))`), for
   example when you created "Baby" by hand in the meantime. Ids are in
   table A.
   - **Baby `sort_order` = 14**, the same as Beauty Care. Ties sort by
     name, so in Shop mode Baby comes **after Toiletries (13) and before
     Beauty Care**, where the "infanzia" shelf usually is. No existing row
     has to be renumbered.
   - No Shop mode position is saved for it. `shop_order` (012) came after
     `006` deleted the old `baby` row, so no old position can exist. If
     you have moved categories by hand in Shop mode, Baby takes its
     default place among them.
2. **HOME subs**: the same pattern, with
   `where exists (select 1 from inventory_categories where id = <parent>)`.
   `sort_order` = the next number in that main (Perfume 5, Frozen Meat 5,
   Feminine Care 5, Shaving 6, World Foods 9, Stationery 4, Car Care 5,
   Air Fresheners 6, Pest Control 7, Plants & Garden 8, Baby subs 1–6).
   After step 3 this number only matters for ties.
3. **MONEY mains** (`expense_categories`): insert `(name, type 'parent',
   parent_id null)` `where not exists` a row with the same name in any
   capitals, then `on conflict (name) do nothing`. The id comes from the
   database (uuid). The app gives new mains a colour on first open
   (`useCategoryColors`), and subs take their main's colour.
4. **MONEY subs**: `insert … select v.name, 'sub', p.id from (values …)
   v(name, parent) join expense_categories p on p.name = v.parent and
   p.parent_id is null`, with the same `where not exists`. The parent is
   found **by name** ("Trips & Holidays", "Car / Vehicle", "Personal
   Care"…). If the parent was renamed, that sub is skipped and the
   verification shows it.
5. **Mapping rows** (`category_budget_map`): `insert (id,
   expense_category_id) select '<home id>', e.id from expense_categories e
   join … on <name path> … on conflict (id) do nothing`. An existing hand
   choice is never overwritten. Rows only for the decision 1 option chosen
   (table B).
6. **Verification SELECT**: one row per proposed category and per
   mapping, with `ok` / `missing` / `skipped: name exists`. Also the total
   number of HOME and MONEY rows, and a check that no HOME name and no
   MONEY name appears twice (except the known old "Frozen Vegetables" in
   HOME, if it is still there).

Optional categories go in the same file, each block commented with
"Optional: delete this block if not wanted", and the build only keeps the
ones Irene ticks (decisions 2, 4, 5 and 6). If decision 2 is B, the Baby
part goes into `025_baby.sql` instead.

**In the app instead (decision 8 B):** possible, but:

- HOME subs would get uuids, so the sub-level keyword rules for them can
  only suggest the main.
- "Baby" made in the app is invisible until the hidden-id fix ships.
- It takes about 40 taps on the phone.

### 4.2 Code changes the build stage needs

| File | Change |
|---|---|
| `src/data/constants.js` | `HIDDEN_CATEGORY_IDS = ['automotive']` (decision 3 A). `SUGGESTED_UNITS.baby = ['pack', 'pcs', 'gr', 'jar', 'btl']`. |
| `src/hooks/useInventoryCategories.js` | `addCategory` treats hidden ids as taken (`automotive` → `automotive-2`). A–Z `parents`/`subsByParent` plus a new `shopOrder` (step 3). |
| `src/components/grocery/ShoppingMode.jsx` | `defaultOrder = shopOrder`. |
| `src/data/categoryKeywords.js` | Add the C.1 rules before the appliances block; remove the C.3 keywords from their old rules; update the header comment to say weak words must be listed **only** in `weak`. |
| new `src/data/budgetKeywords.js` | The C.2 rules (by name). |
| `src/lib/categoryGuess.js` | A small refactor: `buildIndex`/`findMatches` already take the rules; export a `createGuesser(rules)` so the same engine serves both lists. `guessCategory`/`guessCategories` stay exactly as they are for HOME. |
| `src/lib/categorySuggest.js` | `suggestBudgetCategories`: after the remembered budget, a new layer `keywords` from `budgetKeywords` (names resolved to ids among the existing MONEY categories; missing ones ignored), then the HOME chips through the mapping, then the similar name. |
| `src/data/categorySynonyms.js` | A few pairs for the new names: perfume → Fragrance, Scents; diapers → Nappies; fuel → Petrol; vet → Veterinary; pharmacy → Chemist; hairdresser → Hair Salon, Barber; streaming → TV & Music; toiletries → Hygiene. |
| new `src/lib/categoryOrder.js` + the places in 3.2 | Ordering. |
| `docs/plan-oct-2026.md` | Add an "As built 6C" section. **Round 7 note:** the plan says the MONEY main is "Trips", but it is now **"Trips & Holidays"**. Round 7 must find it by that name (or lock it by id) and not rename it again. |

Not needed: `CategoryIcon.jsx` and `categoryColors.js` already know
`baby`. New subs need no icon or colour. No database function changes.

### 4.3 Tests the build stage adds

- `src/lib/categoryGuess.test.js`: a table of names with the expected
  category. From this round's checks:
  - "Pannolini Pampers Baby Dry taglia 4" → Baby › Diapers
  - "Huggies salviette" → Baby › Baby Wipes, but "Salviette umidificate"
    → Toiletries › Toilet Paper & Tissues
  - "Plasmon" → Baby Food, but "Plasmon biscotti" → Sweet Snacks
  - "Latte in polvere Mellin 1" → Formula
  - "Acqua di Gio" → Perfume, but "Acqua naturale" → Water
  - "Laundry Perfume - Coccolino" → Laundry Fragrance
  - "Profumo per ambienti" → Air Fresheners (or Household)
  - "Hamburger di bovino surgelati" → Frozen Meat, but "Frozen Chicken
    Ravioli" ≠ Frozen Meat
  - "Penne a sfera" → Stationery, but "Penne Barilla" → Pasta
  - "Vape" → not Pest Control
  - "Washing Machine Cleaner" → Surface Cleaners
  - "Chicken Feet Snack" → Savory Snacks
  - "Basilico in vaso" → Fresh Herbs
- The same file: **every rule's ids exist** among the seeded ids + the 024
  ids + the three live uuids, so a typo in an id is caught.
- The same file: **no word is both a keyword and weak** in the new rules
  (a guard for the finding in step 1; the 15 old rules are listed as
  known exceptions).
- `src/lib/categorySuggest.test.js`: budget chips:
  - "Benzina" → Car / Vehicle › Fuel
  - "Netflix" → Subscription › Streaming
  - "Veterinario" → Pets › Veterinary
  - "Marca da bollo" → Taxes & Fines (if it exists, else nothing)
  - "Bollo auto" → Insurance & Tax
  - "Protein bar" → not Bar & Coffee
  - A rule for a MONEY category that doesn't exist is ignored.
- `src/hooks/inventoryCategories.test.jsx`: "Baby" is visible; adding
  "Automotive" gives `automotive-2` and it is visible.
- The ordering tests in 3.2.
- `supabase/migrations.test.js`, block "024":
  - Run twice → the same rows.
  - A name that already exists in other capitals (e.g. a hand-made
    "perfume") is skipped, not duplicated.
  - No existing row changes (names, parents, `sort_order`).
  - Mapping rows never overwrite an existing choice.
  - Income tables untouched.
  - The verification SELECT reports `ok` for everything.

---

## Sources (research for step 2)

The online research was thin: Italian chains don't publish their aisle
lists in a form search engines index well. The aisle structure above
("Infanzia", "Cura persona", "Cura casa", "Animali", "Etnico") is the
usual layout of Conad, Coop, Despar and Lidl stores. The budget split
follows common household-budget guidance: keep groceries apart from
personal care, and treat cleaning supplies as a judgment call.

- [Rocket Money: budget categories](https://rocketmoney.com/learn/personal-finance/budget-categories): Groceries and Personal Care as separate categories
- [Gerald: modern household budget guide](https://joingerald.com/learn/money-basics/modern-household-budget-guide)
- [Money Crashers: home budget categories](https://www.moneycrashers.com/home-personal-budget-categories-monthly/)
- [Greenlight: budget categories](https://greenlight.com/blog/budget-categories): household supplies with or apart from groceries is a judgment call
- [Quicken: budget categories](https://quicken.com/blog/?p=1210)
- [Budget Utopia: the ultimate list](https://budgetutopia.beehiiv.com/p/budget-categories-the-ultimate-list-and-how-to-customize-yours): 10–15 categories for most budgets
- [Everyeye: Conad spesa online guide](https://tech.everyeye.it/notizie/come-spesa-online-conad-guida-completa-718810.html): ethnic food as its own group
- [Altroconsumo: Coop products](https://www.altroconsumo.it/alimentazione/fare-la-spesa/speciali/prodotti-testati-coop): home care and personal care groups
- [eFarma: Mellin range](https://www.efarma.com/mellin.html): formula 1/2/3, omogeneizzati, pappe
- [Mark Up: non-food in Italian retail (PDF)](https://mark-up.it/wp-content/uploads/sites/3/2014/07/06_09_MKUP178_NonFood.pdf): diapers and wipes sold together with the other baby products
