# Durable lock — analysis and proposal (read-only round, 25/10/2026)

Written for Zidane and Irene (decisions) and for the next build round
(Claude). Nothing in the app changed in this round: this file and the
query files in `tmp-export/` (not committed) are the only output.

**Words used in this document**

- **Durable** — something you buy once and keep (towel, sandals, vacuum
  cleaner, cat fountain). **Consumable** — something used up and bought
  again (paper towel, cat food, vacuum bags, fountain filter).
- **HOME stock** — the items in HOME (`pantry_items`) with a quantity.
- **SHOP entry** — a row on the SHOP list (`grocery_items`).
- **Purchase line** — one line of a confirmed purchase
  (`shopping_trip_items`); each line makes one expense.
- **HOME category / MONEY category** — the item categories of HOME/SHOP
  (`inventory_categories`, ids like `pet:food`) and the budget categories
  of MONEY (`expense_categories`, uuids).
- **Mapping** — the link HOME category → MONEY category
  (`category_budget_map`, edited in HOME → Categories).
- **Remembered name** — `category_memory`: what was picked by hand for a
  name, tried first next time.
- **Chip** — a category suggestion button under a name field.
- **The appliances tree** — the HOME main "Home & Appliances" (id
  `appliances`) and its subs. Today it is the only "durable" HOME
  category (`DURABLE_CATEGORY_IDS = ['appliances']`).
- **026** — the next SQL file (`supabase/026_…`), written in the build
  round, never in this one.

---

## 1. Summary

**The rule (Zidane, final).** HOME stock is only for consumables. Durable
items are MONEY expenses only: never in HOME stock, never 1×. The rule is
per item (cat fountain = durable, its filter = consumable). The category
decides: an item with a durable category has "Add to HOME" off and locked;
change the category and the lock goes.

**What the code does today.** The lock already exists, but only for the
appliances tree: `isDurable()` (`src/lib/inventory.js`) is true only when
an item's HOME main is `appliances`. Everything else — towels, bras, cat
toys — is treated as a consumable, so SHOP Confirm purchase puts it into
HOME. That is exactly what happened in the Action purchase of 17/10
(fixed by hand in 025). After 025, typing "bra" in SHOP again still puts
it into HOME, because 025 remembered "bra" only with a MONEY category,
which SHOP never looks at.

**The proposal (one recommendation per question).**

1. **One durable tree.** Put the missing durable kinds as new subs of the
   existing HOME "Home & Appliances": Clothing, Footwear, Accessories, Pet
   Accessories & Toys (fixed ids `appliances:clothing`,
   `appliances:footwear`, `appliances:accessories`, `appliances:pet`).
   Everything that already protects the appliances tree (SHOP's separate
   section, Confirm "expense only", MONEY's locked switch, the SQL
   functions that refuse moving stock in or out of it, the HOME editor
   that doesn't offer it) then works for clothes and pet toys with no
   new mechanism. Each sub books to its MONEY sub by a **mapping row by
   id** (rename-safe), so SHOP does not need MONEY chips.
2. **The MONEY side of the lock** is a constant list of MONEY ids in code
   (like `TRIPS_CATEGORY_ID`): Home & Appliances (with all its subs),
   Shopping › Clothing, Footwear, Accessories, Electronics, and Pets › Pet
   Accessories & Toys. Mixed ones (Gifts, Others, Souvenirs, Glasses &
   Lenses) are not locked.
3. **Keywords.** About 300 durable words (Italian, English, Indonesian) in
   the durable subs, plus consumable phrases that must win ("carta
   asciugatutto", "sacchetti aspirapolvere", "filtro fontanella",
   "Dishwasher Detergent", "poke bowl"…). Tested in a throwaway script:
   all 31 Action lines come out right (12 durable, 19 consumable), all 13
   extra test names too, and on the 238 item names of the 21/10 export only
   6 guesses change — all improvements, none turns a consumable into a
   durable.
4. **The 3 problems of the 025 report** are fixed together: mapping rows
   by id for every appliances sub (problem 3), the six Shopping / Pets
   durables of the Action purchase get a durable HOME category in 026 so
   Reopen and "Apply the mapping…" see them as durables (problems 1 and
   2), and "Apply the mapping…" stops moving lines that have no HOME
   category at all (problem 1, for every other purchase).
5. **Electronics.** One electronics category for everything (Home &
   Appliances › Electronics & Work Equipment); the MONEY keyword rule of
   Shopping › Electronics goes, so SHOP and MONEY give the same answer.

Section 10 lists the 12 decisions waiting for Zidane, each with examples
and options. Section 11 describes the build round. Section 9 lists the
query files Irene runs (after Claude checks them) so the cleanup list of
durables already in HOME can be made.

---

## 2. Map — every place the lock touches (Part A)

Each row: where (file · function), what it does today, what changes when
the lock is built. "→" marks the change.

### 2.1 Where "Add to HOME" exists or is decided

| Where | Today | When the lock is built |
|---|---|---|
| `src/lib/moneyPurchase.js` · `homeLocked(row)` | `isDurable({ category_id: row.categoryId })`: true only for the appliances tree. | → also true when the row's budget category is in the durable MONEY list (decision 3), so a row with Add to HOME off and budget "Shopping › Footwear" can't be switched on. |
| `src/lib/moneyPurchase.js` · `addsToHome(row)` | `!homeLocked(row) && (row.addToHome ?? Boolean(row.categoryId))`: on by default with a HOME category, off without one. | Unchanged formula; the new `homeLocked` does the work. |
| `src/lib/moneyPurchase.js` · `moneyPurchasePayload` | Each line sends `durable: !line.home` (Add to HOME off = expense only). | Unchanged. |
| `src/lib/moneyPurchase.js` · `homeNote(line)` | Locked: "Home & Appliances never go into HOME — expense only."; off: "Expense only — nothing changes in HOME." | → locked text names the real category, e.g. "Durable item (Footwear) — expense only, never in HOME." (wording: decision 2). |
| `src/lib/moneyPurchase.js` · `rowProblem` | A new HOME item without a HOME category: "Pick a HOME item category, or turn Add to HOME off." | Unchanged. |
| `src/components/expenses/PurchaseForm.jsx` · `ItemRow` | The "Add to HOME" checkbox, `disabled={locked}`, note from `homeNote`; 1× and "Min" only for a new HOME item. | → passes the budget context to `homeLocked`; 1× can't appear for a locked row (it is only shown when Add to HOME is on). |
| `src/lib/purchase.js` · `purchaseLine` | `durable = isDurable(item)` (SHOP entry's HOME main is `appliances`); a durable line gets no HOME item and adds 0. | Unchanged code: with option A the new subs are in the appliances tree, so it covers them. |
| `src/lib/purchase.js` · `confirmationPayload` | Sends each line's `durable`. | Unchanged. |
| `supabase/023…` · `confirm_shopping_trip` (newest: 023) | Trusts the `durable` flag of each line: `durable` true → expense only (no HOME item, no name match, no stock). It never looks at categories. | Unchanged (no 026 change needed). |

### 2.2 Every use of `DURABLE_CATEGORY_IDS` / the appliances tree

App code (all checked with a search of `src/`):

| Where | What it does |
|---|---|
| `src/data/constants.js` · `DURABLE_CATEGORY_IDS = ['appliances']`, `DURABLE_EXPENSE_CATEGORY = 'Home & Appliances'` | The definition. |
| `src/lib/inventory.js` · `isDurable(row)` | `DURABLE_CATEGORY_IDS.includes(row.category_id)` — by the **main** id only, so every sub of the tree (also new ones) is durable. |
| `src/lib/inventory.js` · `pickDurableCategory(rows, subName)` | The MONEY "Home & Appliances" sub **with the same name** as the HOME sub, else Home & Appliances itself (MONEY found by name). |
| `src/lib/budgetMap.js` · `defaultBudgetCategory` | Uses the two above for appliances; Groceries for everything else. |
| `src/hooks/useInventoryCategories.js` | `pantryParents` = mains without the appliances tree (used by the HOME page and `ArrivedDialog`). `parents` (with it) is used by SHOP and MONEY. |
| `src/hooks/useGroceryList.js` | Reason `'durable'`; `groceryItems` / `durableItems` split. |
| `src/pages/GroceryPage.jsx` | The separate SHOP section titled "Home & Appliances" with "… to buy · not in the grocery budget · logged under Home & Appliances, not added to the pantry". |
| `src/components/grocery/ShoppingMode.jsx` | `budgetLeft` leaves durables out. |
| `src/lib/inventoryCategoryEdit.js` · `APPLIANCES_ID`, `inAppliancesTree`, `renameProblem`, `moveProblem`, `deleteProblem`, `mergeProblem`, `mergeTargets` | HOME Manage: the main can't be renamed, moved or deleted; nothing moves into or out of the tree. |
| `src/components/inventory/InventoryCategoryManager.jsx` | Rename button disabled with a lock for `appliances` (title "Can't be renamed"). Note: plan section 3 says "`appliances` can be renamed" — the code does not allow it. |
| `src/hooks/useCategoryCreation.js` · `homeMains` | "+ New category" never offers Home & Appliances as the main of a new sub. |
| `src/components/expenses/CategoryManager.jsx` / `src/hooks/useExpenses.js` | MONEY "Home & Appliances" locked by name (`PROTECTED`). |
| `src/data/categoryKeywords.js` | The durable block, last, "so consumables win". |
| `src/components/ui/CategoryIcon.jsx`, `src/lib/categoryColors.js`, `SUGGESTED_UNITS` | Icon, colour and units of `appliances`. |

SQL (newest definition of each function):

| Function (file) | Durable logic |
|---|---|
| `confirm_shopping_trip` (023) | None of its own: the `durable` flag of the payload. |
| `reopen_shopping_trip` (023) | None: it undoes what each line did (a durable line did nothing in HOME) and puts every SHOP entry back in the cart with the category it has. |
| `merge_inventory_category` (023) | Refuses `appliances` itself and any merge into or out of the tree (`coalesce(parent_id, id) = 'appliances'`). |
| `move_inventory_subcategory` (023) | Refuses moving `appliances` and moving a sub into or out of the tree. |
| `arrive_order` / `unarrive_order` (021) | None: they add/remove stock on the item id the app sends. |
| `supabase/008_durable_category.sql` | Creates the MONEY "Home & Appliances". |

→ With option A (new subs inside the tree) none of these needs a change.
With option B or D (other durable mains, or durable subs in consumable
mains) every "appliances" check above, app and SQL, must be generalised.

### 2.3 SHOP

| Place | Today | Lock |
|---|---|---|
| `src/components/grocery/QuickAdd.jsx` · `entryFor` | Category = tapped chip, else `suggest(name)` (memory → HOME item → keywords), else none ("No category"; toast `Added "…" · 1 pcs · no category yet`). Uses all `parents`, so durable chips already appear. | No change: a durable keyword gives a durable sub, the entry goes to the durable section. |
| `src/components/grocery/AddItemForm.jsx` (More options) | Same suggestion; chips + `CategoryFields`; 1× toggle (`OneTimeToggle`) for a new entry not in HOME. | → hide the 1× toggle while the category is durable. |
| `src/components/grocery/FixCategory.jsx` | Chips for an entry with "No category"; saves with `updateCategory` and remembers the pick. | No change. |
| `src/hooks/useGroceryList.js` / `GroceryPage.jsx` | Durable entries: own section, reason `'durable'` = no label (no "New Item"), tile in the category colour. | → section title and text follow decision 2. |
| `src/components/grocery/ShoppingMode.jsx` | Durables in the cart don't count against the budget. | No change. |
| `src/components/grocery/ConfirmPurchase.jsx` · `PurchaseLine` | Second line of each item: category · price · `restocks "…"` / "expense only" / "new in the pantry". A line without a category shows "No category" (tap → `FixCategory`). | → for "new in the pantry" without a category, the note "Is this a consumable? Durable items don't go into HOME stock." under it. |
| `src/hooks/usePurchase.js` · `expenseCategories` → `budgetResolver` | Each line's budget = `budgetCategoryFor(entry)`: mapping of its sub, of its main, else the default (Groceries; appliances: H&A sub with the same name). | Unchanged; the new mapping rows by id give the right MONEY sub. |

**How a SHOP line becomes "expense only" today:** only when its entry's
HOME main is `appliances`. Its budget category: the mapping row of its sub
(none exist today for appliances subs), else of its main, else the
Home & Appliances MONEY sub with the same name (e.g. HOME "Kitchenware &
Utensils" → MONEY "Kitchenware & Utensils"), else Home & Appliances.

### 2.4 Order online and Orders

| Place | Today | Lock |
|---|---|---|
| `src/components/grocery/OrderOnlineDialog.jsx` | Budget category prefilled with `budgetCategoryFor(entry)`; note for an entry not in HOME: "Not in HOME yet. Saving adds the expense now; when it arrives you can add it to HOME." | → for a durable entry: "Durable item — saving adds the expense; it never goes into HOME." |
| `src/components/expenses/OrderForm.jsx`, `src/hooks/useOrders.js` · `createOrder`, `orderRowFrom`, `src/lib/orders.js` · `expenseRowForOrder` | The order keeps a MONEY category (`orders.category_id`); the expense is made at once. | No change. |
| "Arrived" — `GroceryPage.jsx` `arrive()` and `OrdersSection.jsx` | A linked order (it has a HOME item) opens `LinkedArrivedDialog` ("Arrived — add to HOME" / "Arrived, but don't add anything to HOME"). An unlinked one is marked arrived and opens `ArrivedDialog`: "Add to an existing item", "Add to a variant of an item group", "Create a new item", "Don't add to HOME". | → **Yes, "Arrived" can add HOME stock today.** The lock goes here: when `orders.category_id` is in the durable MONEY list, mark it arrived and don't open either dialog (toast: "… arrived — durable, nothing added to HOME"). |

A durable SHOP entry has no HOME item, so its order is never "linked";
the only way into HOME is `ArrivedDialog` → that is the place to lock.

### 2.5 HOME editor and HOME Manage

- `src/components/inventory/ItemEditor.jsx` gets `pantryParents` from
  `PantryPage.jsx` (no appliances tree), so **an appliance can't be made in
  HOME**. But a durable can, under any consumable category (e.g. "Towel"
  under Household Supplies): nothing stops it. → Proposed: a warning when
  the name's keyword guess (on all categories) is durable: "“handuk” looks
  like a durable item (Home & Appliances › Home Textiles). Durable items
  don't go into HOME stock — record it in MONEY instead." Saving stays
  possible (the user decides).
- The editor's suggestion: `suggestCategory` with `pantryParents` drops a
  durable keyword answer (`fit()`), so "handuk" gets no category today.
- HOME Manage: the new subs appear under Home & Appliances with 0 items;
  they can be renamed (only the main is locked), never moved out.
- Import (`DataView` → `usePantryItems.importItems`, `inventoryBackup.
  csvRowsToItems`) resolves category names among all HOME categories,
  appliances included, so **an import can create durable HOME items**. →
  skip rows whose category is durable and say how many were skipped.
  "Restore" of a backup stays an exact restore.

### 2.6 Chips, remembered names, the durable keyword block

- `src/lib/categorySuggest.js` · `suggestCategories` (HOME chips): memory →
  HOME item → keywords (up to 3) → similar name. `suggestCategory` (the
  auto-fill) uses memory → HOME item → keywords only.
- `suggestBudgetCategories` (MONEY "Add expense", Add to HOME off):
  remembered budget category → MONEY keywords (`budgetKeywordPicks`) →
  the HOME chips through the mapping → similar MONEY name.
  `budgetAutoFill` fills the first one unless it is a "similar name" chip.
- `src/hooks/useCategorySuggestions.js` · `remember` writes
  `category_id`/`subcategory_id` (HOME side), `rememberBudget` writes only
  `expense_category_id` (MONEY side, `category_id` stays null). Each side
  never overwrites the other. **The HOME layers ignore a row whose
  `category_id` is null** (`fit()` needs a main). This is why "bra",
  "Satin Bonnet", "hair clip", "Headband", "Cat House Christmas Tree" and
  "cat toy", remembered by 025 with a MONEY category only, still get no
  durable HOME category in SHOP.
- `src/data/categoryKeywords.js` durable block: Kitchen Appliances,
  Kitchenware & Utensils, Cleaning Appliances, Air & Climate, Electronics
  & Work Equipment (no rules yet for Home Textiles and Home Decor, added
  by 025).
- → New rules (section 5); 026 moves the six 025 memory rows to the new
  durable subs (keeping their MONEY category).

### 2.7 budgetMap

- `budgetCategoryFor(item)`: sub's mapping → main's mapping → default.
- `effectiveBudget(category)` (HOME → Categories, grey/white): own / main
  / default; an appliances sub defaults to its same-name MONEY sub.
- `previewPastPurchases` (`src/hooks/useBudgetMap.js`) +
  `purchasedItemsByExpense` + `pastPurchaseChanges` = "Apply the mapping
  to past purchases…" (`BudgetMappingView.jsx`): for SHOP lines it reads
  the category kept in the line (`grocery_snapshot`); MONEY lines are
  skipped (decision 18). A line with no HOME category gets the default,
  Groceries → problem 1.
- **Link by name:** an appliances sub books to the MONEY Home & Appliances
  sub with exactly the same name (`pickDurableCategory`). Renaming MONEY
  "Kitchenware & Utensils" would send every HOME Kitchenware purchase to
  Home & Appliances itself → problem 3.

### 2.8 Reopen, then Confirm again

`reopen_shopping_trip` deletes the line's expense, takes back the stock it
added (none for a durable line) and puts the SHOP entry back in the cart
with **its current category**. Confirm then works it out again from that
category. For the Action durables after 025: big/small towel, toy elf,
incense holder have a durable category → "expense only" again (correct);
bra, Satin Bonnet, hair clip, Headband, Cat House Christmas Tree, cat toy
have **no** category → "new in the pantry" → back into HOME → problem 2.

### 2.9 Offline queue, import, Undo

- Offline queue (`src/lib/offlineActions.js`: `queueCart`,
  `queueQuantity`, `queueStock`) only changes existing entries and items:
  it can't create a HOME item. A stock change on a durable that is
  already in HOME still works (the cleanup in 026 removes those items).
- Import: see 2.5. Restore of a backup: exact, left alone.
- Undo: "Undo" of a deleted item (`deleteWithUndo`) restores exactly what
  was deleted (correct by design). Undo of a purchase = Reopen (2.8).
- `useGroceryItems.updatePricing` on an already bought entry can create an
  expense (`createExpense`, budget by the mapping) — no HOME stock.
- `syncShoppingForItem`: a durable still in HOME at stock 0 gets an
  automatic SHOP entry and is bought again → one more reason for the
  one-time cleanup.

---

## 3. D2 — which categories are durable (Part B)

Names below are as in the code / seed files; live names may differ
(renamed by hand) — not verified, needs the CSV.

### 3.1 MONEY (ids in `src/data/moneyCategories.fixture.js`, 024 and 025)

| MONEY main › sub | Kind | Real examples | Proposed lock |
|---|---|---|---|
| Groceries | consumable | milk, cat food, dish soap | no |
| Home & Appliances (main) | durable | a lamp, a drying rack | **yes** |
| › Kitchen Appliances | durable | air fryer, kettle, moka | **yes** |
| › Kitchenware & Utensils | durable | ceramic bowl, liquid measuring glass, pan | **yes** |
| › Cleaning Appliances | durable | vacuum cleaner, iron, steam mop | **yes** |
| › Air & Climate | durable | fan, dehumidifier, heater | **yes** |
| › Electronics & Work Equipment | durable | laptop, mouse, printer | **yes** |
| › Home Textiles (025) | durable | big towel, bed sheets, curtain | **yes** |
| › Home Decor (025) | durable | toy elf Christmas, incense holder, photo frame | **yes** |
| Shopping (main) | mixed | (only when no sub fits) | no |
| › Clothing | durable | bra, jeans, socks | **yes** |
| › Footwear (was Shoes & Accessories, 025) | durable | sandals, slippers, Shoe Deodorizer (decided: here, not HOME) | **yes** |
| › Accessories (025) | durable | Satin Bonnet, hair clip, Headband, bag | **yes** |
| › Electronics | durable | headphones, charger, smartwatch (batteries are HOME › Batteries & Bulbs) | **yes** (see 7.1) |
| › Gifts | mixed | a scarf (durable), chocolates (consumable) | no |
| › Others | mixed | anything else | no |
| Pets (main) | mixed | — | no |
| › Pet Accessories & Toys (025) | durable | cat toy, Cat House Christmas Tree, fountain, litter box | **yes** |
| › Veterinary (024), › Pet Sitting (024) | service | vaccine visit, cat sitter | no |
| Personal Care (024, main) › Beauty & Perfume, › Toiletries | consumable | perfume, eye mask, shower gel | no |
| › Hairdresser | service | haircut | no |
| Health (main) › Pharmacy | consumable | Electrolytes Powder, paracetamol | no |
| › Doctor & Tests, › Dentist | service | blood test, cleaning | no |
| › Glasses & Lenses | mixed | glasses (durable), contact lenses (consumable) | no |
| Trips & Holidays › Transport, Accommodation, Food & Drinks, Activities, Flights, Insurance & Visas | service | train, hotel, tour, Ryanair | no |
| › Souvenirs (024) | mixed | fridge magnet (durable), local snacks (consumable) | no |
| Going out › Restaurant, Bar & Coffee, Takeaway & Delivery, Aperitivo | service (eaten on the spot) | dinner, cappuccino, Glovo | no |
| Housing & Utilities › Rent, Apartment Maintenance, Electricity, Gas, Water, Waste Collection, Internet & Phone | service | rent, bills, plumber | no |
| Subscription › Cloud Storage, Memberships, Streaming, Software & Apps | service | iCloud, gym, Netflix | no |
| Entertainment › Cinema & Events | service | cinema, concert | no |
| Car / Vehicle › Fuel | consumable (not HOME) | benzina | no |
| › Maintenance, › Insurance & Tax, › Parking & Tolls | service | tagliando, RC auto, parking | no |
| Bank & Fee › Taxes & Fines, › Documents & Permits | service | F24, passport | no |
| Cigarettes & Vape | consumable (not HOME) | IQOS, tobacco | no |
| Savings & Investments › Pension Fund, Emergency Fund | not a purchase | — | no |
| Family Support (024) | not a purchase | Remitly | no |
| Other | mixed | — | no |

A durable MONEY **main** (Home & Appliances) locks all its subs, also
ones made later by hand. A durable **sub** locks only itself; a new sub
made by hand under Shopping is not locked until it is added to the list.

### 3.2 HOME (010, 024, 025; hand-made ones from the 21/10 export)

| HOME main › sub | Kind | Examples / note |
|---|---|---|
| Home & Appliances (`appliances`) and all its subs: Kitchen Appliances, Kitchenware & Utensils, Cleaning Appliances, Air & Climate, Electronics & Work Equipment, Home Textiles (025), Home Decor (025) | durable | the whole tree never has stock |
| Fruit & Vegetables, Meat & Seafood, Dairy & Eggs, Deli & Cold Cuts, Bakery & Bread, Frozen Food (all subs, incl. Frozen Meat 024), Pantry Staples (incl. World Foods 024), Canned & Preserved Goods, Beverages, Snacks | consumable | food and drink |
| Cleaning Supplies › Surface Cleaners, Dishwashing | consumable | Oven Detergent, Dish soap |
| › Sponges & Cloths | mixed | sponges (consumable); mop, broom, bucket, toilet brush (durable — their keywords are still here, see 5.5) |
| Laundry Supplies › Detergent, Fabric Softener, Stain Removers; hand-made Color Care, Laundry "Perfume"/Laundry Fragrance | consumable | Stain Remover Powder |
| Toiletries (incl. Feminine Care 024) | consumable | Toilet Paper; razors (no sub) |
| Beauty Care › Skincare, Makeup, Deodorant, Perfume (024); hand-made Cotton Pads & Buds, Hair Care (was Hair Water, 025) | consumable | eye mask, face serum milk, hair oil |
| Health & Medicine › Medicine, Vitamins & Supplements, First Aid | consumable | Electrolytes Powder |
| Pet Supplies › Pet Food, Litter & Hygiene; hand-made Pet Treats & Care | consumable | Cat wet food, Fontana Water Filter; "cat toy" is a keyword of Pet Treats & Care today (moved, see 5) |
| Household Supplies › Paper Towels & Foil, Trash Bags | consumable | Scottex, sacchetti aspirapolvere |
| › Batteries & Bulbs | mixed | batteries, bulbs (consumable); extension cord, power strip (durable keywords still here) |
| › Stationery (024) | mixed | pens, tape (consumable); scissors, stapler (durable) |
| › Car Care (024), › Air Fresheners (024), › Pest Control (024) | consumable | incense sticks (but "incense holder" is decor) |
| › Plants & Garden (024) | mixed | soil, fertiliser (consumable); pots, watering can (durable: moved to Home Decor in 5) |
| Miscellaneous / Seasonal › Gifts & Party | mixed | balloons, cards (consumable) |
| › Seasonal | mixed | Easter eggs (consumable); Christmas tree, decorations (durable: moved to Home Decor in 5) |
| Baby (024) › Diapers, Wipes, Baby Food, Formula, Baby Care | consumable | — |
| › Feeding | mixed | bottles, pacifiers (durable) — MONEY "Baby" was declined in 6C, so no durable target yet |
| `automotive` | hidden | never shown (`HIDDEN_CATEGORY_IDS`) |

Hand-made categories made after 21/10 — not verified, needs the CSV
(query 3).

### 3.3 Where the "durable" mark lives — options

| | A. Constant by id in code | B. `household_settings` | C. A column on the categories (026) |
|---|---|---|---|
| What | `DURABLE_CATEGORY_IDS = ['appliances']` (HOME, unchanged) + new `DURABLE_MONEY_CATEGORY_IDS` (uuids) in `src/data/constants.js` | a row `durable_money_categories` = JSON list of ids | `inventory_categories.durable`, `expense_categories.durable` booleans, a toggle in Manage |
| Rename-safe (9C) | yes (ids) | yes (ids) | yes |
| Changing the list | a code change (rare) | needs a screen, or the SQL Editor | a toggle per category |
| SQL / tests | none / a test that every mapping target in 026 is in the list | none / harder to test | 026 + UI + checks everywhere |
| Risk | a new hand-made durable sub isn't locked until added | a wrong edit locks e.g. Groceries | most code and most to test |

**Recommendation: A**, the same pattern as `TRIPS_CATEGORY_ID` and
`budgetKeywords.js`. If round 7 moves the Trips id to
`household_settings`, the durable list can move with it later. MONEY ids
only, never names (9C rule); the HOME side stays the one id `appliances`
(its whole tree).

---

## 4. The SHOP route for non-appliance durables (Part C)

### 4.1 The options

**A. One durable tree (recommended).** New subs under the existing HOME
"Home & Appliances": Clothing, Footwear, Accessories, Pet Accessories &
Toys. Each has a mapping row by id to its MONEY sub (Shopping › Clothing,
Shopping › Footwear, Shopping › Accessories, Pets › Pet Accessories &
Toys).

**B. Separate durable HOME mains** (e.g. "Clothing & Accessories" with
Clothing / Footwear / Accessories, and a durable "Pet Accessories" main),
`DURABLE_CATEGORY_IDS` = several main ids.

**C. MONEY chips in SHOP.** When the guess is durable, QuickAdd / More
options / FixCategory show MONEY budget chips; the SHOP entry keeps a MONEY
category (new column `grocery_items.expense_category_id`, 026).

**D. A durable flag per HOME category** (any main or sub, e.g. a durable
sub "Pet Accessories & Toys" inside the consumable "Pet Supplies").

### 4.2 What each option means on screen

| | A. One tree | B. Several mains | C. MONEY chips | D. Flag per category |
|---|---|---|---|---|
| QuickAdd "sandali" | Chip "Home & Appliances › Footwear", added at once | Chip "Clothing & Accessories › Footwear" | Chip "Shopping › Footwear" (a MONEY name in SHOP) | Chip "<wherever Footwear lives> › Footwear" |
| More options | The same chip; 1× toggle hidden | same | MONEY chips + the MONEY `MoneyCategorySelect` | same as A |
| SHOP tile | In the "Home & Appliances" section, no "New Item" label | needs the durable section to cover several mains | needs a new "durable" state on entries | the section must look at subs too |
| Shop mode | Not counted in the budget (as today) | same, after generalising `isDurable` | needs the new column | needs a sub-aware `isDurable` |
| Confirm purchase | "Home & Appliances · €… · expense only" | "… · expense only" | needs a new branch for the MONEY category | "… · expense only" |
| Budget category | mapping row by id → Shopping › Footwear | mapping rows | the entry's own MONEY category | mapping rows |
| Remembered per name | HOME side (`category_id` `appliances`, sub `appliances:footwear`), the existing `remember` | HOME side | MONEY side, and SHOP would have to read `expense_category_id` | HOME side |
| "New Item" / "No category" | durables never "New Item"; "No category" unchanged | same | new rules needed | same |
| SQL functions (merge/move refuse crossing the tree) | **already right**, no 026 change | must refuse every durable tree → 026 replaces both functions | not touched, but `confirm_shopping_trip` would have to read the new column → 026 | must refuse moving a stocked sub into a durable one → 026 |
| HOME Manage | 4 more subs under the locked main, renamable | new mains, each must be locked like `appliances` | nothing | a durable toggle per row |
| HOME → Categories | 4 more white (own) rows | new rows | nothing | a mark per row |
| Code to change | keywords, mapping rows, texts | every `APPLIANCES_ID`/`'appliances'` check, app and SQL | forms, entries, Confirm, Reopen, Shop mode, orders | all of B plus a flag store |

### 4.3 Walkthroughs with option A (real names)

- **QuickAdd "handuk"** → keywords: Home Textiles → chip "Home & Appliances
  › Home Textiles" → toast `Added "handuk" · 1 pcs` → the tile is in the
  SHOP section "Home & Appliances" → tap it into the cart → Confirm
  purchase: "Home & Appliances · <unit price> · expense only" → e.g. a
  MONEY expense "handuk" €2.99 in Home & Appliances › Home Textiles. HOME
  unchanged.
- **QuickAdd "sandali"** → "Home & Appliances › Footwear" → durable section
  → Confirm: expense only → Shopping › Footwear (mapping row by id).
- **QuickAdd "cat toy"** → today: "Pet Supplies › Pet Treats & Care"
  (consumable → into HOME, as on 17/10). With A: "Home & Appliances › Pet
  Accessories & Toys" → expense only → Pets › Pet Accessories & Toys.
- **QuickAdd "carta asciugatutto"** → today: no chip, "no category yet",
  then "new in the pantry" without a category. With A: "Household Supplies
  › Paper Towels & Foil" → HOME stock as a normal consumable.
- **MONEY "Add expense", "sandali"** → HOME category filled with
  Home & Appliances › Footwear → "Add to HOME" off and greyed (locked) →
  budget Shopping › Footwear. Change the HOME category to e.g. Household
  Supplies → the lock goes, Add to HOME can be turned on.
- **Wrong guess, e.g. "Tenda doccia"** (shower curtain, durable) vs a
  user who wants it in HOME: they change the category (chip or select);
  the pick is remembered for the name; the lock follows the new category.

**Recommendation: A.** It reuses the one durable mechanism the app already
has and tests, needs no change to the SQL functions, and needs no new
column. Its only downside is the name "Home & Appliances" on clothes and
cat toys (decision 2).

---

## 5. Keyword list (Part D)

### 5.1 How matching works today (`src/lib/categoryGuess.js`)

1. **Cleaning the name** (`normalizeName`): accents removed, lower case,
   apostrophes → space, amounts removed (a number with an optional unit:
   "500g", "2 x", "x 3"…), every other non-letter/number → space, and the
   unit words `pcs pz pezzi pack conf confezione kg gr ml lt x` dropped.
   "Ice-Cream 500g" → "ice cream"; "booking.com" → "booking com".
2. English plurals → singular (`singular`: towels → towel, berries →
   berry), for names and keywords alike. Italian / Indonesian plurals must
   be listed ("scarpe" and "scarpa").
3. A keyword of several words also matches written together ("ice cream"
   = "icecream"). A trailing `*` matches any ending.
4. **Score** = number of words of the keyword; +0.5 for a `kind` word
   (what the product is); a `weak` word counts only when it is the whole
   name (−0.5). After a linking word (di, al, with, of, gusto, rasa…) a
   match counts at most 0.75 ("chips … al sale" are chips).
5. A keyword inside a longer match doesn't count ("cream" in "ice cream").
6. **Two words beat one.** The best score wins; if the best matches point
   to **different main categories**, the guess is "unclear" → no
   category. If they point to the same main, the earliest rule wins.
7. Rules for categories that don't exist are ignored first (`ruleFor`).
8. `guessCategories` gives the best 3 distinct ones (the chips).

What this means for the proposal:

- All durable subs are in **one main** (option A), so two durable rules
  never make a guess "unclear": "Cat House Christmas Tree" matches "cat
  house" (Pet Accessories, 2 words) and "christmas tree" (Home Decor, 2
  words) — same main, the earlier rule (Pet Accessories) wins.
- A consumable exception must have **more words** than the durable word
  inside it: "carta asciugatutto" (2) vs nothing; "sacchetti
  aspirapolvere" (2) vs "aspirapolvere" (1); "filtro fontanella" (2) vs
  "fontanella" (1); "cat litter box" (3, durable) vs "cat litter" (2).
- A tie between a durable and a consumable word of the same length gives
  no guess: Add to HOME stays on in SHOP, with the note (section 10,
  decision 11). That is the safe side for food; the note warns for the
  rest.
- The app tries the remembered name and the HOME item first; keywords
  only decide for names not seen before. So the keyword change never
  moves an existing HOME item by itself.

### 5.2 Proposed durable rules (all in the appliances tree)

| Sub (id) | Words (Italian · English · Indonesian), weak words in *italics* |
|---|---|
| Pet Accessories & Toys (`appliances:pet`, new) — **first**, so it beats Home Decor | cat toy, gioco per gatti, giochi per gatti, giocattolo gatto, mainan kucing, dog toy, scratching post, tiragraffi, cat tree, albero per gatti, cat house, cat bed, cuccia, cucce, casetta gatto, lettino gatto, pet bed, kasur kucing, rumah kucing, cat carrier, trasportino, kandang kucing, gabbia, leash, guinzaglio, collare, cat bowl, ciotola gatto, ciotola per gatti, mangkuk kucing, water fountain, cat water fountain, cat fountain, pet fountain, fontanella, fontanella gatto, fontanella per gatti, fontana per gatti, litter box, cat litter box, lettiera chiusa, cassetta lettiera, toilette per gatti, bak pasir kucing, toy, giocattolo, giocattoli, mainan, peluche, plush; *fontana* |
| Home Decor (`appliances:decor`, 025) | decoration, decorazione, decorazioni, addobbi, ornament, dekorasi, hiasan, christmas tree, albero di natale, presepe, toy elf, statuetta, statue, soprammobile, figurine, vaso decorativo, cornice, photo frame, bingkai foto, poster, quadro, candle holder, portacandele, incense holder, portaincenso, porta incenso, incense burner, wreath, ghirlanda, fairy lights, luci di natale, string lights, lucine, wall clock, orologio da parete, jam dinding, flower pot, vaso per piante, pot bunga, annaffiatoio, watering can |
| Home Textiles (`appliances:textiles`, 025) | towel, tea towel, asciugamano, asciugamani, telo mare, telo bagno, accappatoio, bathrobe, handuk, bed sheet, lenzuola, lenzuolo, copripiumino, duvet, piumone, piumino letto, pillow, cuscino, cuscini, pillowcase, federa, blanket, coperta, selimut, bantal, sprei, curtain, tenda, tende, gorden, tablecloth, tovaglia, tappeto, rug, carpet, karpet, bath mat, tappetino bagno, doormat, zerbino, keset; *plaid* |
| Footwear (`appliances:footwear`, new) | shoe, shoes, scarpe, scarpa, sneakers, scarpe da ginnastica, stivali, boots, sandali, sandalo, sandal, ciabatte, slippers, pantofole, infradito, flip flops, sandal jepit, sepatu, sendal, crocs, birkenstock, havaianas, tacchi, heels, mocassini, loafers, solette, insoles, lacci scarpe, shoelaces, tali sepatu, shoe deodorizer, deodorante scarpe, shoe spray |
| Clothing (`appliances:clothing`, new) | clothes, clothing, vestiti, abbigliamento, maglia, maglietta, t shirt, shirt, camicia, felpa, hoodie, sweater, maglione, cardigan, pantaloni, trousers, pants, jeans, leggings, gonna, skirt, dress, vestito, abito, giacca, jacket, cappotto, coat, piumino, giubbotto, underwear, intimo, mutande, boxer, bra, reggiseno, calze, calzini, socks, collant, tights, pigiama, pajamas, costume da bagno, swimsuit, bikini, baju, kaos, celana, kemeja, jaket, kaus kaki, kaos kaki, piyama; *slip, bh, costume* |
| Accessories (`appliances:accessories`, new) | accessories, accessori, bonnet, satin bonnet, hair bonnet, cuffia per capelli, hair clip, clip capelli, pinza capelli, mollettine, fermaglio, fermacapelli, jepit rambut, headband, hairband, cerchietto, fascia capelli, bandana, scrunchie, elastico capelli, ikat rambut, hair tie, borsa, zaino, backpack, handbag, tote bag, wallet, portafoglio, dompet, belt, cintura, sunglasses, occhiali da sole, kacamata hitam, umbrella, ombrello, payung, hat, cappello, berretto, beanie, scarf, sciarpa, syal, watch, orologio, jam tangan, jewelry, gioielli, collana, necklace, kalung, bracciale, bracelet, gelang, orecchini, earrings, anting, anello, cincin, keychain, portachiavi, mollette; *bando, tas, cuffia* |
| Kitchenware & Utensils (existing) | + bowl (was weak: "ceramic bowl" had no guess from the word), mangkuk, bicchiere graduato, measuring glass, caraffa graduata |
| Cleaning Appliances (existing) | + mollette bucato, clothes pegs, jepitan baju, stendibiancheria, drying rack, jemuran |

Moved out of consumable rules (they are durables): "christmas tree,
albero di natale, presepe, addobbi, decorations, decorazioni" (out of
Seasonal), "cat toy, gioco per gatti" (out of Pet Treats & Care), "flower
pot, vaso per piante, annaffiatoio, watering can, pot bunga" (out of
Plants & Garden).

### 5.3 Consumable exceptions (they must win)

Placed before the durable block, each with more words than the durable
word inside it:

| Rule → category | Words |
|---|---|
| Household Supplies › Paper Towels & Foil | carta asciugatutto, asciugatutto, rotolo asciugatutto (paper towel, kitchen roll, Scottex, carta forno, alluminio are already there) |
| Household Supplies › Trash Bags | filtro aspirapolvere, vacuum filter, hepa filter, kantong vacuum (vacuum bags, sacchetti aspirapolvere are already there) |
| Pet Supplies › Litter & Hygiene | fountain filter, water fountain filter, fontana filter, fontana water filter, pump filter, filtro fontanella, filtro fontana, collare antipulci, flea collar; *filtro, filtri, filter* (lettiera, cat litter are already there) |
| Pet Supplies › Pet Food | wet food, cat wet food, dry food, cat dry food, makanan basah kucing |
| Cleaning Supplies › Dishwashing | dishwasher detergent, detergente lavastoviglie, dishwasher pods, dishwasher powder |
| Cleaning Supplies › Surface Cleaners | oven detergent, detergente forno, sgrassatore forno, oven spray, descaler, decalcificante, anticalcare bollitore, coffee machine descaler |
| Cleaning Supplies › Sponges & Cloths | guanti nitrile, nitrile gloves, guanti monouso, latex gloves |
| Laundry Supplies › Detergent | washing machine powder, washing machine detergent, washing machine liquid |
| Toiletries › Oral Care | testine spazzolino, brush heads, toothbrush heads, replacement heads |
| Beauty Care › Skincare | eye mask, under eye mask, eye patch(es), maschera occhi, sleeping mask, face serum, serum milk, siero viso |
| Beauty Care › Hair Care (hand-made id `3ff635c0-…`) | hair water, hair mist, hair tonic, acqua per capelli |
| Health & Medicine › Vitamins & Supplements | electrolytes powder, electrolyte powder, eletrolytes powder, elettroliti, sali minerali, oralit |
| Beverages › Coffee & Tea | coffee syrup, sciroppo caffe, macinato moka, caffe moka |
| Deli & Cold Cuts › Ready Meals & Dips | poke, poke bowl, acai bowl, buddha bowl |

Batteries (batterie), sponges (spugne), carta forno, alluminio need no new
rule: they already win.

### 5.4 Expected results (run in a throwaway script, deleted)

"Before" = today's rules on today's categories (21/10 export + 024 + 025);
"after" = the proposal with the 4 new subs. Keyword layer only (a
remembered name or an existing HOME item would answer first).

**The 31 Action lines** (names as in the 025 test fixture; old names
noted):

| Line | Before | After | Durable |
|---|---|---|---|
| big towel | — | Home & Appliances › Home Textiles | yes |
| small towel | — | Home & Appliances › Home Textiles | yes |
| toy elf Christmas | Misc / Seasonal › Seasonal | Home & Appliances › Home Decor | yes |
| incense holder | Household › Air Fresheners | Home & Appliances › Home Decor | yes |
| bra | — | Home & Appliances › Clothing | yes |
| Satin Bonnet (fixture: old name "bonnet hair cover for sleeping": — → Accessories) | — | Home & Appliances › Accessories | yes |
| hair clip | — | Home & Appliances › Accessories | yes |
| Headband (fixture: old name "hairband": — → Accessories) | — | Home & Appliances › Accessories | yes |
| Cat House Christmas Tree | Misc / Seasonal › Seasonal | Home & Appliances › Pet Accessories & Toys | yes |
| cat toy | Pet Supplies › Pet Treats & Care | Home & Appliances › Pet Accessories & Toys | yes |
| ceramic bowl | Home & Appliances › Kitchenware & Utensils | the same | yes |
| liquid measuring glass | Home & Appliances › Kitchenware & Utensils | the same | yes |
| cheesy chili sauce | Pantry Staples › Sauces & Condiments | the same | no |
| Spicy truffle sauce | Pantry Staples › Sauces & Condiments | the same | no |
| cleaning sponges | Cleaning Supplies › Sponges & Cloths | the same | no |
| inox sponges | Cleaning Supplies › Sponges & Cloths | the same | no |
| Dish soap | Cleaning Supplies › Dishwashing | the same | no |
| coffee syrup | — (syrup vs coffee: unclear) | Beverages › Coffee & Tea | no |
| Stain Remover Powder (fixture: old name "washing machine powder": **Home & Appliances › Cleaning Appliances, durable!** → Laundry › Detergent) | Laundry › Stain Removers | the same | no |
| Dishwasher Detergent | **Home & Appliances › Kitchen Appliances (durable!)** | Cleaning Supplies › Dishwashing | no |
| Oven Detergent | **Home & Appliances › Kitchen Appliances (durable!)** | Cleaning Supplies › Surface Cleaners | no |
| Toilet Paper | Toiletries › Toilet Paper & Tissues | the same | no |
| shower gel | Toiletries › Soap & Shower Gel | the same | no |
| perfume | Beauty Care › Perfume | the same | no |
| powder set makeup | Beauty Care › Makeup | the same | no |
| face serum milk | — (milk vs serum: unclear) | Beauty Care › Skincare | no |
| eye mask (under-eye skincare) | — | Beauty Care › Skincare | no |
| hair oil | Toiletries › Shampoo & Conditioner | the same (025 put the item in Beauty Care › Hair Care: memory decides, see 7.2) | no |
| hair water | **Beverages › Water** | Beauty Care › Hair Care | no |
| Electrolytes Powder (fixture: old name "eletrolytes powder": Spices → Vitamins) | Pantry Staples › Spices & Seasonings | Health & Medicine › Vitamins & Supplements | no |
| Cat wet food | — | Pet Supplies › Pet Food | no |

Result: 12 durable, 19 consumable, as Zidane decided. The two detergents
(today wrongly durable through "dishwasher" / "oven") are fixed — that is
probably how they became expense-only lines on 17/10 (their lines had
Home & Appliances › Kitchen Appliances).

**The other test names:**

| Name | Before | After | Durable |
|---|---|---|---|
| paper towel | Household › Paper Towels & Foil | the same | no |
| carta asciugatutto | — | Household › Paper Towels & Foil | no |
| asciugamano | — | Home & Appliances › Home Textiles | yes |
| handuk | — | Home & Appliances › Home Textiles | yes |
| sacchetti aspirapolvere | Household › Trash Bags | the same | no |
| aspirapolvere | Home & Appliances › Cleaning Appliances | the same | yes |
| vacuum cleaner | Home & Appliances › Cleaning Appliances | the same | yes |
| cat water fountain | **Beverages › Water** | Home & Appliances › Pet Accessories & Toys | yes |
| fontanella gatto | — | Home & Appliances › Pet Accessories & Toys | yes |
| filtro fontanella | — | Pet Supplies › Litter & Hygiene | no |
| sandali | — | Home & Appliances › Footwear | yes |
| ciabatte | — | Home & Appliances › Footwear | yes |
| Shoe Deodorizer | — | Home & Appliances › Footwear (→ Shopping › Footwear, not HOME) | yes |

### 5.5 The 21/10 export (old: 21/10/2026, before 024 and 025)

All 238 item names of `tmp-export/4_items_grouped.csv` were run. Only 6
results change, all improvements, none becomes durable:

| Item (21/10) | Before | After |
|---|---|---|
| COFFE Grandaroma macinato MOKA | — (moka vs macinato: unclear) | Beverages › Coffee & Tea |
| "TOOLS & SUPPLIES" Tulip Top Black guanti nitrile | — | Cleaning Supplies › Sponges & Cloths |
| Cat Dry Food | — | Pet Supplies › Pet Food |
| Cat Wet Food | — | Pet Supplies › Pet Food |
| Fontana Water Filter | Beverages › Water | Pet Supplies › Litter & Hygiene |
| Fontana Water Pump Filter | Beverages › Water | Pet Supplies › Litter & Hygiene |

These items exist in HOME, so their own category (HOME item layer) is used
anyway; the change matters only for a new name.

### 5.6 Risky words (could catch consumables)

| Word | Risk | What the proposal does |
|---|---|---|
| bra | "Bra" is also a Piedmont cheese | "Bra formaggio" becomes unclear (no chip) instead of Cheese; accepted (rare). |
| ciabatta / ciabatte | "ciabatta" is bread and "ciabatta elettrica" a power strip | only "ciabatte" (slippers) is a footwear word; both "ciabatta" cases unchanged (tested). |
| bowl | "poke bowl" is food | "poke / poke bowl / acai bowl / buddha bowl" → Ready Meals (tested). |
| towel | "paper towel" | the 2-word phrase wins (tested); "tea towel" → Home Textiles (tested). |
| toy | "Toy Story yogurt" | yogurt still wins (kind word); generic "toy" → Pet Accessories & Toys (decision 5). |
| tenda | also a tent | still durable, only the sub is debatable. |
| piumino | down jacket vs duvet | "piumino" → Clothing, "piumino letto" → Home Textiles. |
| slip, intimo | "salvaslip", "detergente intimo", "period pants" | the feminine-care phrases win (tested); "slip" is weak. |
| collare | flea collar | "collare antipulci / flea collar" → Litter & Hygiene (tested). |
| mollette | hair clips vs clothes pegs | both durable; "mollette bucato" → Cleaning Appliances. |
| fontana | a surname / brand | weak (whole name only). |
| guanti, gloves, bag, ring, topi | cleaning gloves, freezer bags, onion rings, "topi" = mice | **left out on purpose**. |
| cuffia | shower cap vs "cuffie" (headphones) | weak; "cuffie" stays Electronics. |
| Words still in consumable rules that are durables | mop, broom, bucket, toilet brush (Sponges & Cloths); extension cord, power strip, adapter (Batteries & Bulbs); scissors, stapler (Stationery); baby bottle, pacifier (Baby › Feeding) | **not moved** in this proposal (decision 5): moving them needs a target category for each, and they are rare. |

---

## 6. The 3 problems of the 025 report (Part E)

### 6.1 "Apply the mapping to past purchases…" moves 6 durables to Groceries

Example (Action, 17/10/2026, shared): bra €1.74, Satin Bonnet €0.35,
hair clip €0.35, Headband €0.41, Cat House Christmas Tree €1.74, cat toy
€0.29 = **€4.88** would move from Shopping / Pets to Groceries. Cause:
their lines have no HOME category, and `budgetCategoryFor` gives such an
item the default, Groceries.

| Option | Pros | Cons |
|---|---|---|
| A. App: a SHOP line without a HOME category is left alone by "Apply the mapping…" (in `purchasedItemsByExpense` / `pastPurchaseChanges`) | Fixes it for every old purchase, not only Action; a line with no category tells nothing about where it belongs | Old lines that really should be Groceries aren't moved (they already are: Confirm booked them there) |
| B. Data (026): the 6 lines get a durable HOME category (Clothing, Accessories, Pet Accessories & Toys) | The mapping then gives exactly their current MONEY category | Only these 6 lines |
| C. Skip lines that were expense-only (no HOME item, no stock) | Close to the meaning | Also skips real appliance lines that should follow the mapping |

**Recommendation: A + B.** A protects every purchase; B makes the Action
lines consistent with the new tree (it is also what fixes 6.2).

### 6.2 Reopen, then Confirm again, puts the six back into HOME

Example: Reopen the Action purchase → 31 entries back in the cart → bra
has no category → Confirm → "new in the pantry" → a HOME item "bra".

| Option | Pros | Cons |
|---|---|---|
| A. 026 gives the six SHOP entries and their lines the new durable HOME subs, and moves their remembered names (`category_memory`) to the same subs, keeping the MONEY category | Reopen then puts them back as durables; typing "bra" in SHOP again also finds the durable sub | Data change (by id, guarded like 025) |
| B. App: Confirm also treats a line as durable when the name is remembered with a durable MONEY category | No data change | A second durable rule next to the category (two sources of truth) |
| C. Reopen keeps a "durable" mark on the entry | Exact | New column + new SQL function version (026) for one case |

**Recommendation: A.** After it, the category is again the only thing that
decides (D1). The new keywords give the same subs for new names.

### 6.3 Appliances subs are linked to MONEY subs by the same name

Example: Irene renames MONEY "Kitchenware & Utensils" to "Kitchen Tools"
→ every later SHOP purchase in HOME Kitchenware & Utensils (ceramic bowl
€0.45, liquid measuring glass €1.04) books to Home & Appliances itself;
"Apply the mapping…" would move the old ones there too. Same for all 7
appliances subs (and the 4 new ones).

| Option | Pros | Cons |
|---|---|---|
| A. 026 inserts a mapping row by id for every appliances sub (HOME sub → MONEY sub uuid) | Uses the existing mechanism; visible and changeable in HOME → Categories (shown white, "own"); used by Confirm, Order online and "Apply the mapping…" | The rows show as "own" instead of "default" |
| B. A constant map HOME sub id → MONEY sub id in code | No SQL | Invisible in HOME → Categories, can't be changed by the user, two places to keep in step |
| C. Keep the name link, lock MONEY renames of those subs | Nothing to build | Breaks the 9C rule "Irene may rename any MONEY category" |

**Recommendation: A.** The name match stays only as the default for a
sub made later without a row. Rows (HOME → MONEY): `appliances:kitchen` →
Kitchen Appliances `4125ed9e-…`, `appliances:kitchenware` → Kitchenware &
Utensils `a364fa44-…`, `appliances:cleaning` → Cleaning Appliances
`83c6b924-…`, `appliances:air` → Air & Climate `7d226f51-…`,
`appliances:electronics` → Electronics & Work Equipment `2a05cb39-…`,
`appliances:textiles` → Home Textiles `f924edef-…`, `appliances:decor` →
Home Decor `3472a299-…`, and the new `appliances:clothing` → Shopping ›
Clothing `732af8e0-…`, `appliances:footwear` → Shopping › Footwear
`0f7f387b-…`, `appliances:accessories` → Shopping › Accessories
`b13b4e6b-…`, `appliances:pet` → Pets › Pet Accessories & Toys
`d0c05f29-…` (full ids in the fixture and in 025). Insert only when
missing and when both ends exist, so a row chosen by hand is never
overwritten.

---

## 7. Category check (Part F)

### 7.1 Electronics: Shopping › Electronics vs Home & Appliances › Electronics & Work Equipment

Keywords today:

- MONEY `budgetKeywords.js`, Shopping › Electronics: mediaworld, unieuro,
  euronics, apple store, cuffie, charger, caricatore.
- MONEY, Home & Appliances › Electronics & Work Equipment: none.
- HOME `categoryKeywords.js`, Home & Appliances › Electronics & Work
  Equipment: laptop, computer, pc, monitor, keyboard, mouse, printer,
  stampante, headphones, cuffie, earphones, charger, caricatore,
  caricabatterie, cable, cavo usb, power bank, hard disk, usb stick,
  tablet, smartphone, phone, tv, speaker, desk, office chair, lamp,
  smartwatch, hair dryer, piastra capelli, electric toothbrush, shaver…
  (it books to MONEY Home & Appliances › Electronics & Work Equipment).

| Item | SHOP (HOME keywords → mapping) | MONEY row, Add to HOME off (first chip) |
|---|---|---|
| charger | H&A › Electronics & Work Equipment | **Shopping › Electronics** |
| cuffie | H&A › Electronics & Work Equipment | **Shopping › Electronics** |
| cavo USB | H&A › Electronics & Work Equipment | H&A › Electronics & Work Equipment |
| mouse | H&A › Electronics & Work Equipment | H&A › Electronics & Work Equipment |
| laptop | H&A › Electronics & Work Equipment | H&A › Electronics & Work Equipment |
| stampante | H&A › Electronics & Work Equipment | H&A › Electronics & Work Equipment |
| batterie | Household › Batteries & Bulbs (consumable, HOME) | Groceries (through the mapping) |

The overlap: the same headphones or charger go to two MONEY categories
depending on the screen.

| Option | Pros | Cons |
|---|---|---|
| A. One electronics category: H&A › Electronics & Work Equipment; drop the Shopping › Electronics keyword rule; Irene merges or keeps Shopping › Electronics by hand | Same answer everywhere; one place to look | "Work equipment" in the name for headphones |
| B. Two meanings: personal gadgets (headphones, phone, smartwatch, charger, cables) → Shopping › Electronics with a new HOME durable sub "Personal Electronics"; home/work (laptop, printer, monitor, router, desk) → H&A | Matches the two MONEY names | Many words fit both; two subs to keep apart |
| C. Keep both, only make the MONEY keywords agree with HOME | Smallest | Shopping › Electronics stays unused and confusing |

**Recommendation: A.** How many expenses Shopping › Electronics has —
not verified, needs the CSV (query 4).

### 7.2 Other duplicates / near-duplicates

| What | Where | Note | Proposal |
|---|---|---|---|
| Gifts: HOME Misc › Gifts & Party (no mapping → Groceries) vs MONEY Shopping › Gifts | "regalo" from SHOP books to Groceries, from MONEY to Shopping › Gifts | inconsistent | map HOME Gifts & Party → Shopping › Gifts (a row in HOME → Categories, Irene can do it in the app) — decision 9 |
| Hair: HOME Toiletries › Shampoo & Conditioner (`toiletries:hair`) vs Beauty Care › Hair Care (hand-made, was Hair Water) | "hair oil" keyword → Toiletries, 025 put the item in Beauty Care › Hair Care | near-duplicate | decision 9: keep both (Toiletries = washing, Hair Care = treatments) or merge in HOME Manage |
| Perfume: HOME Beauty Care › Perfume (024) and Laundry › "Perfume" (hand-made `e8e447c7-…`, renamed Laundry Fragrance?) | the 21/10 export still says "Perfume" under Laundry | not verified — needs the CSV (query 3) | — |
| Seasonal vs Home Decor | decorations were Seasonal keywords | moved to Home Decor (section 5) | — |
| Frozen Fruit & Vegetables (`frozen:vegetables`) and the hand-made "Frozen Vegetables" under Fruit & Vegetables | known since round 1 (not in the 21/10 export any more) | not verified — needs the CSV | — |
| MONEY Housing & Utilities › Apartment Maintenance vs Home & Appliances | a plumber (service) vs a new tap (durable) | fine as they are | — |
| MONEY Trips & Holidays › Souvenirs vs Shopping › Gifts | a gift bought on a trip | round 7 decides | — |
| HOME "Home & Appliances" vs MONEY "Home & Appliances" | same name, different jobs | HOME and MONEY never check each other's names (by design) | decision 2 |

---

## 8. Interplay with later rounds (Part G)

- **Round 6D ("one item, many names", replaces groups).** A durable must
  never become one of the names of a HOME item. Today the order is right:
  `purchaseLine` decides "durable" before it looks for a HOME item by name,
  and `confirm_shopping_trip` matches names only for non-durable lines.
  6D must keep that order. Groups/variants can't be durable (no stock in
  the tree). Query 1 already lists `is_group`, `group_name`, `variants`
  so it can be reused for 6D if the data is still current.
- **Round 7 (Trips).** Plan section 8: "Add to HOME starts off during a
  trip; turning it on for a new item turns 1× on automatically." With the
  lock: a durable's switch is locked off, so it never gets 1× (Zidane's
  rule holds). The automatic 1× applies only when the switch can be
  turned on, i.e. a consumable. The budget of a durable bought on a trip
  follows the round-7 rule (Trips sub), not the durable mapping — to
  confirm in round 7 (decision 12).
- **Round 8 (AI).** AI answers names the keywords don't know (it may
  answer a durable sub; the lock follows). "Review all categories with AI"
  must not move a HOME item into the durable tree (that changes only the
  category, the stock would stay): a durable proposal should become "remove
  from HOME" for the same approval list used for 026.

---

## 9. Query files (Part H)

In `tmp-export/` (ignored by git, never committed). Each is one read-only
SELECT, at most 90 rows, with a total column in every row. All were run
against the PGlite database built like `supabase/migrations.test.js`
(025 block) with sample data: each runs, writes nothing, returns ≤ 90
rows. Every table and column was checked against the migrations; all
asked-for columns exist (an "ordered online" column doesn't exist on
SHOP entries: it is worked out from `orders` with status `on_the_way`).

| File | Reads | Expected rows |
|---|---|---|
| `check-durable-1-items-p1.sql` … `-p4.sql` | ALL HOME items (stock 0, finished 1×, groups, variants), rows 1–90 / 91–180 / 181–270 / 271–360, ordered by HOME main, sub, name, id; category names and ids, durable tree yes/no, group, stock, unit, minimum, 1×, price, created_at, number of purchase lines and the last date, the MONEY category of the last line's expense, open SHOP entries; `total_items` | about 238 on 21/10 minus the 10 removed by 025: p1 90, p2 90, p3 ~50–60, p4 0 |
| `check-durable-2-shop-entries-p1.sql`, `-p2.sql` | Open SHOP entries: name, quantity, HOME category, durable tree yes/no, linked HOME item and its category, in cart, ordered online, 1×, auto, created_at; `total_entries` | usually < 90: p1 all, p2 0 |
| `check-durable-3-home-categories-p1.sql`, `-p2.sql` | ALL HOME categories (hidden marked): id, name, parent, type, sort_order, durable tree, items, open SHOP entries, remembered names, budget (MONEY path) and own / main / default; `total_categories` | about 110: p1 90, p2 ~20 |
| `check-durable-4-money-categories-p1.sql`, `-p2.sql` | ALL MONEY expense categories: id, name, parent, type, number of expenses and the last date, orders, HOME categories mapped to it; `total_categories` | about 71: p1 all, p2 0 |

If a total is above what the pages cover, the comment at the top says to
tell Claude (one more page is needed).

---

## 10. Decisions for Zidane

### Decision 1 — where non-appliance durables live in SHOP

| Example (Action 17/10) | Today | A. one tree | C. MONEY chips |
|---|---|---|---|
| bra €1.74 | no category → into HOME | Home & Appliances › Clothing → Shopping › Clothing | chip "Shopping › Clothing" in SHOP |
| cat toy €0.29 | Pet Treats & Care → into HOME | Home & Appliances › Pet Accessories & Toys → Pets › Pet Accessories & Toys | chip "Pets › Pet Accessories & Toys" |
| sandali (new) | no category → into HOME | Home & Appliances › Footwear → Shopping › Footwear | chip "Shopping › Footwear" |

- **A. New subs under HOME Home & Appliances** — pros: everything already
  works for that tree (SHOP section, Confirm, MONEY lock, SQL guards), no
  new column; cons: clothes appear under a "Home & Appliances" name.
- **B. Separate durable HOME mains** — pros: clearer names; cons: every
  appliances check in app and SQL must be generalised (026 replaces two
  functions).
- **C. MONEY chips in SHOP** — pros: one category list (MONEY) for
  durables; cons: new column, new branches in Confirm, Reopen, Shop mode,
  orders; SHOP shows MONEY names.
- **D. A flag per HOME category** — most flexible; most work.

**Recommendation: A.**

Small decisions with it: (a) the 4 subs and their names: Clothing,
Footwear, Accessories, Pet Accessories & Toys; (b) a fifth "Other
Durables" → Shopping › Others for things that fit nowhere — recommended
**no** for now (the AI round can propose one); (c) the subs can be renamed
in HOME Manage (only the main is locked).

### Decision 2 — the name of the HOME durable tree and the SHOP texts

| Screen | Today | If renamed "Durables" |
|---|---|---|
| Chip in SHOP | "Home & Appliances › Footwear" | "Durables › Footwear" |
| SHOP section | "Home & Appliances" · "… to buy · not in the grocery budget · logged under Home & Appliances, not added to the pantry" | "Durables" · "… to buy · not in the grocery budget · expense only, never in HOME stock" |
| MONEY row note | "Home & Appliances never go into HOME — expense only." | "Durable item (Footwear) — expense only, never in HOME." |

- A. Keep "Home & Appliances" — pros: nothing to rename; cons: confusing
  for clothes and cat toys.
- B. Rename the HOME main (same id `appliances`) to "Durables" (or
  another name) in 026, by id, only while it is still "Home & Appliances"
  — pros: says what it is; cons: the MONEY main stays "Home & Appliances"
  (it is found by name and must keep it).
- C. Allow renaming in HOME Manage (today the button is locked) — pros:
  Irene chooses later; cons: code change in the lock rules.

**Recommendation: B** with the name "Durables", and the SHOP section text
above in any case (the old text is wrong for clothes: they are logged
under Shopping, not Home & Appliances). Edge case: the HOME name must be
unique among HOME categories ("Durables" is free in the seed files; live —
needs the CSV).

### Decision 3 — the MONEY categories that lock "Add to HOME"

| Example (MONEY "Add expense", Add to HOME off) | Budget category | Locked? |
|---|---|---|
| "Zara" €29.90 | Shopping › Clothing (MONEY keyword "zara") | yes |
| "Cuffie Sony" €49 | Shopping › Electronics today (H&A › Electronics & Work Equipment after decision 9) | yes (both) |
| "Regalo compleanno" €15 | Shopping › Gifts | no (mixed) |
| "Souvenir Bali" €3 | Trips & Holidays › Souvenirs | no (mixed) |
| "Occhiali" €120 | Health › Glasses & Lenses | no (mixed) |

- A. Lock: Home & Appliances (main, all subs), Shopping › Clothing,
  Footwear, Accessories, Electronics, Pets › Pet Accessories & Toys —
  pros: covers every durable seen so far; cons: a new hand-made durable
  sub needs a code change.
- B. Also Gifts and Others — cons: chocolates as a gift could never go
  into HOME.
- C. Only Home & Appliances (as today) — cons: no lock for clothes in
  MONEY.

**Recommendation: A.** Small decisions: (a) what a locked MONEY row says
(decision 2's note); (b) when the budget category is changed from durable
to e.g. Groceries, the switch unlocks and goes back to its default (on
only if there is a HOME category).

### Decision 4 — where the durable mark is kept

| Example | A. code constant | B. household_settings | C. column |
|---|---|---|---|
| Irene renames "Footwear" to "Scarpe" | still locked (by id) | still locked | still locked |
| Irene adds a MONEY sub "Bags" under Shopping | not locked until the code adds it | locked once added to the setting (needs a screen) | locked with a toggle |

**Recommendation: A** (section 3.3).

### Decision 5 — the keyword list

| Example | Before | After |
|---|---|---|
| handuk | — | Home Textiles (durable) |
| Dishwasher Detergent | Kitchen Appliances (durable, wrong) | Dishwashing (consumable) |
| carta asciugatutto | — | Paper Towels & Foil |
| filtro fontanella / fontanella gatto | — / — | Litter & Hygiene / Pet Accessories & Toys |

Options: A. the list of section 5 as it is; B. A without the generic toy
words; C. A plus moving the durable words still in consumable rules (mop,
broom, bucket, extension cord, scissors, baby bottle…).

**Recommendation: A.** Small decisions: (a) generic "toy / giocattolo /
mainan / peluche" → Pets › Pet Accessories & Toys (the household has a
cat, no children) — recommended yes; (b) live plants ("pianta", "cactus")
stay Plants & Garden (consumable) while pots move to Home Decor —
recommended yes; (c) "bra" makes "Bra formaggio" unclear — accept; (d) C's
words wait for the AI round.

### Decision 6 — fix for "Apply the mapping to past purchases…"

Example: 6 Action lines, €4.88, would go to Groceries. Options in 6.1.
**Recommendation: A + B** (lines without a HOME category are left alone;
026 gives the six a durable sub). Edge case: an old SHOP line without a
category whose expense was changed by hand later is no longer moved back
to Groceries (that is the point).

### Decision 7 — fix for Reopen + Confirm again

Example: Reopen Action → Confirm → "bra" back in HOME. Options in 6.2.
**Recommendation: A** (026 moves the six entries, lines and remembered
names to the new durable subs).

### Decision 8 — the link HOME appliances sub → MONEY sub by id

Example: renaming MONEY "Kitchenware & Utensils" sends ceramic bowl
(€0.45) and liquid measuring glass (€1.04) to Home & Appliances.
Options in 6.3. **Recommendation: A** (11 mapping rows by id in 026).
Edge case: if a row was already chosen by hand in HOME → Categories, 026
leaves it.

### Decision 9 — Electronics and the other duplicates

| Example | Today |
|---|---|
| charger in SHOP / in MONEY | H&A › Electronics & Work Equipment / Shopping › Electronics |
| regalo in SHOP / in MONEY | Groceries / Shopping › Gifts |
| hair oil (keyword / item) | Toiletries › Shampoo & Conditioner / Beauty Care › Hair Care |

**Recommendations:** Electronics A (7.1: one category, drop the MONEY
rule); map HOME Gifts & Party → Shopping › Gifts (Irene can do it in HOME
→ Categories, no code); hair: keep both subs for now and decide with the
CSV (query 3 shows how many items each has).

### Decision 10 — cleanup of durables already in HOME (outside Action)

Process: Irene runs the query files (after Claude checks them) → Claude
lists every HOME item that looks durable (keywords + names), with stock,
purchases and the MONEY category → Zidane approves or strikes each line →
026 removes the approved ones exactly like 025 step 9 (lines made
expense-only, history deleted, SHOP entries unlinked, item deleted;
expenses kept; groups, items in a cart or on the way left alone and
reported).

| Example (21/10 export) | Looks | Proposal |
|---|---|---|
| Fontana Water Filter, Fontana Water Pump Filter | consumable (filters) | stay |
| a towel or a toy added since 21/10 | durable | remove (only if approved) |

Options: A. the list above (by id, approved); B. remove everything the
keywords call durable without a list — not recommended; C. leave old
ones, lock only new purchases. **Recommendation: A** (Zidane won't do it
by hand). Small decisions: (a) a durable that is a group or in a group is
left and reported; (b) its past expenses stay where they are (the mapping
fix, decision 6, protects them).

### Decision 11 — unknown names: the note

| Screen | Example "Bonne Maman" (no chip) |
|---|---|
| SHOP QuickAdd | added with "No category" (as today) |
| Confirm purchase | "No category · new in the pantry" + note "Is this a consumable? Durable items don't go into HOME stock." |
| MONEY "Add expense" | Add to HOME is already off without a HOME category (today's default); no note needed |

Options: A. note on the Confirm line (and in More options while no
category is chosen); B. also a toast in QuickAdd; C. no note.
**Recommendation: A.** Edge case: once a category is chosen (FixCategory
or the chips), the rule applies at once (durable → expense only).

### Decision 12 — Order online, Arrived, and trips

| Example | Today | Proposal |
|---|---|---|
| Order "Sneakers" €80 −30% (Shopping › Footwear), Arrived | `ArrivedDialog` asks where to put it in HOME | marked arrived, no question, toast "… arrived — durable, nothing added to HOME" |
| Sandals bought in Bali during a trip (round 7) | — | Add to HOME locked off, no 1×; budget follows the round-7 trip rule |

Options: A. lock at Arrived by the order's MONEY category (recommended);
B. keep asking but hide "Create a new item"; C. no lock for orders.
**Recommendation: A**, and confirm in round 7 that a durable bought on a
trip books to the trip like everything else.

---

## 11. What the build round will contain

Described only — nothing here is built yet.

**Files to change (option A, decisions as recommended)**

- `src/data/constants.js` — `DURABLE_MONEY_CATEGORY_IDS` (uuids; a durable
  main covers its subs), the 4 new HOME sub ids.
- `src/lib/inventory.js` — `isDurableBudget(expenseCategoryId,
  expenseCategories)`; `isDurable` unchanged.
- `src/data/categoryKeywords.js` — section 5 (durable rules, exceptions,
  moved words; header comment for the durable block).
- `src/data/budgetKeywords.js` — Footwear words (sandali, ciabatte…), a new
  Accessories rule (borsa, zaino, cintura, orologio move there from
  Footwear), Pet Accessories & Toys, Home Textiles, Home Decor; drop the
  Shopping › Electronics rule (decision 9).
- `src/lib/moneyPurchase.js` — `homeLocked(row, ctx)` with the budget
  category; `homeNote` wording.
- `src/components/expenses/PurchaseForm.jsx` — passes the context.
- `src/components/grocery/AddItemForm.jsx` — 1× hidden for a durable
  category; the unknown-name note.
- `src/components/grocery/ConfirmPurchase.jsx` — the unknown-name note.
- `src/pages/GroceryPage.jsx` — the durable section title and text.
- `src/components/grocery/OrderOnlineDialog.jsx` — the durable note.
- `src/pages/GroceryPage.jsx` `arrive()` and
  `src/components/expenses/OrdersSection.jsx` — no `ArrivedDialog` for a
  durable order.
- `src/lib/budgetMap.js` — "Apply the mapping…" skips SHOP lines without a
  HOME category.
- `src/components/inventory/ItemEditor.jsx` — warning for a durable-looking
  name.
- `src/hooks/usePantryItems.js` / `src/lib/inventoryBackup.js` — import
  skips durable rows and says how many.
- `docs/plan-oct-2026.md` — an "as built" section.

**Tests**

- `categoryGuess.test.js` / `categorySuggest.test.js`: every name of the
  tables in 5.4 and the risky cases of 5.6.
- `budgetKeywords.test.js`: the MONEY rules point at existing ids.
- `moneyPurchase.test.js`: lock by HOME category and by budget category;
  unlock on change; no 1×.
- `purchase.test.js`: a line in each new sub is "expense only".
- `budgetMap.test.js`: a line without a category isn't moved; mapping rows
  by id survive a MONEY rename.
- Render tests: Add to HOME locked in the purchase form, the Confirm note,
  the SHOP section text, Arrived without the dialog.
- `supabase/migrations.test.js` block "026": run on the 025 fixture, run
  twice, a MONEY rename before/after, a mapping row chosen by hand kept,
  Reopen of the Action purchase after 026 puts nothing into HOME, "Apply
  the mapping…" moves none of the 31 expenses.

**Outline of `supabase/026_durable_lock.sql`** (one transaction, by id,
guarded like 025, ends with a check SELECT):

1. HOME: insert `appliances:clothing` "Clothing", `appliances:footwear`
   "Footwear", `appliances:accessories` "Accessories", `appliances:pet`
   "Pet Accessories & Toys" under `appliances` (skip a name that exists).
2. HOME (decision 2B): rename `appliances` to "Durables" only while it is
   "Home & Appliances".
3. Mapping rows by id for the 11 appliances subs (6.3), only when missing
   and both ends exist.
4. Action, 6 lines: the category kept in the line, the SHOP entry's
   category, and the remembered name → the new subs (only while they still
   hold 025's values); `expense_category_id` kept.
5. Durables already in HOME: the approved list by id, as 025 step 9.
6. No function, table, policy or grant changes (option A needs none).
7. The check SELECT: every row ok / skipped / CHECK, under 100 rows.

---

## 12. What I need from the CSVs

Results of the query files (section 9), all pages:

1. Query 1 (items): to make the cleanup list (decision 10) — every HOME
   item with its stock, purchases and last MONEY category; and to see
   whether durables entered HOME after 21/10.
2. Query 2 (SHOP entries): durables on the list now (they must get a
   durable category or leave HOME when bought).
3. Query 3 (HOME categories): the live names (is "Durables" free? the
   Laundry "Perfume"/Laundry Fragrance name, the hair subs, any hand-made
   category since 21/10), and the mappings in use.
4. Query 4 (MONEY categories): live names and ids (is Footwear still
   `0f7f387b-…`, do the 025 subs exist?), how many expenses Shopping ›
   Electronics and Gifts have (decision 9), and whether any MONEY category
   was made by hand since 21/10 that should be durable.

Also: whether 024 and 025 have been run (the queries show it: the 025
subs and `appliances:textiles` / `appliances:decor` exist or not).
