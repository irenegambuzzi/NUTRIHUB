# NUTRIHUB build plan — October 2026 (rounds 2–8)

Written in round 1 (19/10/2026). Every later round starts in a fresh chat with
no memory: **read this whole file first**, then only the files your round's
section names. Everything the database needs for rounds 2–8 is already in
`supabase/023_oct_2026_features.sql`; if a round truly needs more SQL, it goes
in a new `supabase/024_<name>.sql` for review — never edit 002–023,
`schema.sql`, `fix_access.sql` or `015_ROLLBACK.sql`, and never run SQL
against Supabase yourself.

Contents

0. Rules for every round
1. What round 1 checked in the code (and what differs from the brief)
2. The database after 023 (reference)
3. Round 2 — HOME Manage, MONEY lock, colours, unique names, keyword check
4. Round 3 — Cart order (A), one-time purchases (B), group variants in SHOP (NOTE 1)
5. Round 4 — Purchases with several items in MONEY (NOTE 2), merging old expenses (NOTE 3)
6. Round 5 — Category suggestions while typing (NOTE 4), creating categories (NOTE 5)
7. Round 6 — Discounts (NOTE 6)
8. Round 7 — Trips (travel mode)
9. Round 8 — AI structure (NOTE 7)
   - 9C. Round 6C — categories, keywords, A–Z order, SQL 024 (as built)
   - 9D. Decided 21–22/10 for later rounds (Trips, round 7, round 6D)
   - 9E. Data fix 025 (Action 17/10/2026)
   - 9F. Durable lock (decided 25/10, as built)
10. Risks and decisions

---

## 0. Rules for every round

**Who reads what.** Irene tests on her iPhone. Talk to her in simple
Indonesian (or Italian if she writes Italian). Everything in the app — labels,
toasts, code, comments, commit messages — is English.

**Before you start.**

- `supabase/023_oct_2026_features.sql` must have been run in Supabase (Irene
  runs it after the round-1 review, before round 2 is deployed). The code of
  rounds 2–8 may assume it. If a query still fails because a table or column
  is missing (`isMissingTable(error)` in `lib/tableStore.js`, or PostgREST
  `PGRST204` / Postgres `42703` for a column), show one clear message — "This
  needs the database update supabase/023_oct_2026_features.sql" — instead of
  crashing. Don't build a second code path for "before 023".
- Run `npm test` before changing anything: on 19/10/2026 it was 51 files,
  624 tests, all passing (598 before round 1 + 26 new 023 tests).

**How this codebase is written (match it).**

- Comments say in plain words what happens and why, above the code; no
  jargon, no "TODO". Look at `src/hooks/usePurchase.js` for the tone.
- Data access goes through the shared live table stores in `src/lib/stores.js`
  (built by `createTableStore` in `src/lib/tableStore.js`): read with
  `store.useRows()`, after a write call `upsertLocal` / `patchLocal` /
  `removeLocal` so the screen updates without waiting for realtime. A new
  table gets a new store there.
- Writes use `attempt()` (toast + Retry on failure), `must()` (throws a
  Supabase error), `inSteps()` (undo earlier steps if a later one fails),
  `followUp()` (a non-critical step after a saved change) and
  `deleteWithUndo()` — all in `src/lib/db.js`. Toasts and dialogs:
  `showToast`, `askDialog`, `confirmDialog` in `src/lib/feedback.js`.
- Every "Undo" restores exactly; nothing is ever lost silently.
- Pure logic goes in `src/lib/*.js` with a `*.test.js` next to it; components
  get render tests where there are some already (`*.render.test.jsx`).
- Money: amounts are euros with 2 decimals; round with
  `Math.round(x * 100) / 100`; parse typed numbers with `parseDecimal`
  (comma or dot) and show the hint with `DecimalInput` / `DecimalHint`.
- Dates: `DateField` everywhere (typed DD/MM/YYYY), stored as `YYYY-MM-DD`
  local dates (`localDateString`).
- Payers: `PAID_BY_OPTIONS` = irene, akbar, shared.
- Phone first: tap targets ≥ 36 px (`min-h-9`), no horizontal scroll, inline
  rows rather than popups where the brief says "no popups".

**Finish every round with:** `npm test` (all green), `npm run lint`,
`npm run build`; then commit only your files with a clear message (end it
with the attribution line the session gives you) and push to `main` (GitHub
Pages deploys it). Tell Irene in Indonesian what changed and give her your
section's iPhone checklist.

---

## 1. What round 1 checked in the code

Everything in the brief was checked against the code on 19/10/2026. All of it
holds, with these differences and details (none blocks the plan):

1. **Cart order today** — `groceryStore` (`lib/stores.js`) keeps
   `grocery_items` newest first by `created_at`; `useGroceryList` builds
   `cartItems` from it; `sortItems(…, 'recent')` and the List view sink
   in-cart items to the bottom in `created_at` desc order; `ShoppingMode`
   lists `inCart` in store order; `ConfirmPurchase` uses `cartItems`. So yes:
   created_at desc everywhere. True.
2. **`confirm_shopping_trip` makes one expense per line** — only when
   `line_total > 0`; a line with total 0 makes no expense (but still adds
   stock). Unchanged by 023.
3. **`grocery_items.price`** is the price for `price_qty` × `price_unit`
   (e.g. €2.50 per 500 gr), not always per single unit; `lineTotal()` in
   `lib/pricing.js` converts. Same for `pantry_items.price`.
4. **Expense details** — expenses really have no item/quantity/unit/price,
   but a SHOP purchase line already kept a `grocery_snapshot` (quantity,
   unit, price) per expense. 023 adds explicit columns to
   `shopping_trip_items` so SHOP and MONEY lines read the same way.
5. **MONEY "Home & Appliances"** — today it is locked from rename and move
   (`EXPENSE_LOCKED` in `CategoryManager.jsx`) but **can be deleted**
   (`PROTECTED` is only Other and Groceries). Round 2 adds the delete lock.
6. **HOME category names** — today nothing checks HOME names at all
   (`useInventoryCategories.addCategory` only numbers the id). The duplicate
   "Frozen Vegetables": one is the seeded `frozen:vegetables` (010), the
   other (under Fruit & Vegetables) was made by hand, so it is not in the
   repo. Round 2's Manage can merge it (see there).
7. **HOME display names** — `CATEGORY_NAME_OVERRIDES` shows `personal-care`
   as "Beauty Care" whatever the database says, and `HIDDEN_CATEGORY_IDS`
   (`baby`, `automotive`) are never shown. Round 2 must handle both (a
   rename of personal-care would otherwise look like it did nothing).
8. **Keyword list** — `suggestCategory` already drops a keyword answer whose
   main category isn't on offer, and a sub-category that isn't under it
   (`fit()` in `lib/categorySuggest.js`). But `guessCategory` decides
   *before* that: a rule pointing to a missing category can still tie with a
   valid one and make the guess "unclear" (null). Round 2 fixes this.
9. **QuickAdd** asks with a popup when no category is found
   (`askDialog` in `components/grocery/QuickAdd.jsx`). NOTE 5 replaces that
   with chips / "No category" (round 5).
10. **HOME editor requires a category** (`ItemEditor` refuses to save
    without one). NOTE 5's grey "No category" is for SHOP and MONEY; items
    that reach HOME through a purchase without a category show as "No
    category" too (the database allows it). Decision: the HOME editor keeps
    requiring a category.
11. **Appliances** (`DURABLE_CATEGORY_IDS = ['appliances']`) never go into
    HOME (no stock). So in MONEY "Add to HOME" is off and disabled for them.
12. **"Holiday"** — no code looks for the name "Holiday" (searched all of
    `src/`). Code finds MONEY categories by name only for "Groceries",
    "Other" and "Home & Appliances" (and "Groceries" in `ReceiptsView`).
13. **"New Item" label** — derived, not stored (`lib/newItems.js`): an item
    created after `NEW_ITEM_SINCE` is new until it is bought/restocked again
    (a purchase that creates it counts as part of creating it). So an item
    created by a MONEY purchase gets the label by itself.
14. **MONEY list today** shows a shopping trip as one row **per budget
    category** (`ExpensesPage.expenseGroups`, key `trip|id|main`). NOTE 2
    wants one row per purchase — round 4 changes that.
15. **Live database** (from the brief): 25 tables = the 24 in the repo +
    `weekly_planner` (not in the repo; 023 doesn't touch it). Live functions
    match the repo exactly.
16. **Grey is free?** SHOP tiles today: red Out, yellow Low, purple
    Expired, **blue New Item**, category colour for stocked items. "Light
    blue Not urgent" must be visibly different from the blue "New Item":
    use sky (`rgba(56,189,248,…)`) plus the words "Not urgent".

---

## 2. The database after 023 (reference)

All new tables: RLS on, one policy `household_only` (for all, to
authenticated, `is_household_member()`), nothing for anon, live sync on.
All new/replaced functions: `search_path = public`, household check
(`42501`), anon/public can't run them.

### New columns

| Table.column | Meaning |
|---|---|
| `grocery_items.cart_added_at timestamptz` | When the entry went into the cart. Set/cleared **by the database** (trigger `grocery_items_cart_time`) on every path: a tap, the offline queue, Reopen, Confirm, Order online, Arrived. If the app sends a value with `in_cart: true` (the tap time, e.g. from the offline queue) that value is kept. Leaving the cart → null. Backfill: entries in the cart at 023 time got `created_at`. |
| `grocery_items.one_time boolean default false` (nullable; null = false) | A SHOP entry for something not in HOME yet that is 1×. When Confirm creates the HOME item it inherits it. |
| `pantry_items.one_time boolean not null default false` | One-time purchase. Constraint `pantry_items_one_time_not_group`: a group can't be 1× (variants can). "Finished" is derived: `one_time and current_stock <= 0`. |
| `pantry_items.shop_dismissed_at timestamptz` | **Unused since round 3B (20/10/2026).** Was: a group variant taken off the SHOP list by hand (the × per variant, removed). The column and its trigger `pantry_items_shop_dismissed` stay in the database; the app neither reads nor writes it, and existing values are ignored. |
| `shopping_trips.source text` (`shop` default, `money`, `merged`) | Where the purchase was made: SHOP Confirm purchase, the MONEY purchase form, or by merging old expenses. Every existing trip is `shop`. |
| `shopping_trips.coupon_kind` (`percent`/`amount`), `coupon_value`, `coupon_total` (€, default 0) | The coupon of the whole purchase. |
| `shopping_trip_items.line_kind` (`shop` default, `money`) | A line from a SHOP entry, or typed in MONEY. |
| `shopping_trip_items.quantity`, `unit` | What was bought (filled for both kinds by Confirm). |
| `shopping_trip_items.list_total` | The **normal** price of the line as on the receipt, before any discount (null = no discount info: same as `line_total`). |
| `shopping_trip_items.item_discount_kind` (`percent`/`amount`), `item_discount_value` | The line's own discount. |
| `shopping_trip_items.coupon_share` (€, default 0) | The line's part of the purchase coupon. |
| `expenses.merged_at`, `expenses.shop_before_merge` | Set when a single expense is merged into a purchase; `shop_before_merge` is the store it had (Split puts it back). |
| `expenses.travel_id → travels` | The trip away it belongs to (on delete: set null, the expense stays). |
| `orders.list_price`, `discount_kind`, `discount_value` | An order's normal price and its discount. `orders.price` stays the **paid total** (= the expense). |
| `category_memory.expense_category_id → expense_categories` | The budget category remembered for a name (for things bought in MONEY that aren't HOME items). |
| `category_memory.source` (`user` default, `ai`) | Who chose the remembered category. |

Discount checks (constraints `shopping_trip_items_discount_ok`,
`shopping_trips_coupon_ok`, `orders_discount_ok`): kind is `percent`
(0–100) or `amount` (≥ 0).

### New tables

- **`travels`** — `id, name, kind ('holiday' | 'short'), start_date, end_date,
  ended_on (null, or start ≤ ended_on ≤ end_date), created_at`. The period of
  a trip is `start_date … coalesce(ended_on, end_date)`. "Trip" in the UI;
  `travel` in code because `trip` already means a shopping trip
  (`shopping_trips`, `expenses.trip_id`, `lib/trips.js`).
- **`household_settings`** — `key text primary key, value jsonb, updated_at`.
  Seeded: `ai_suggestions = false`.
- **`ai_model_chain`** — `level ('light' | 'medium' | 'heavy' | 'photo'),
  position (1, 2, …), model, active, web_search, note`; unique per
  (level, position) and (level, model). **The app can only read it**
  (authenticated has SELECT only). Seeded, insert-only-if-missing:
  light: claude-haiku-5-5 → claude-sonnet-5-5 → claude-opus-5-5;
  medium (web search): claude-sonnet-5-5 → claude-opus-5-5;
  heavy: claude-opus-5-5; photo (later): claude-sonnet-5-5.
  New models are added in the SQL Editor at the next position.
- **`ai_category_proposals`** — one proposal of "Review all categories with
  AI": `run_id, pantry_item_id, item_name, from_category_id,
  from_subcategory_id, to_category_id, to_subcategory_id, new_category_name,
  new_category_parent_id, reason, model, status ('pending' | 'approved' |
  'rejected'), created_at, decided_at`.

### Functions (call with `supabase.rpc(name, args)`)

**`confirm_shopping_trip(payload)`** → the `shopping_trips` row. Unchanged for
SHOP payloads (see "every changed line" below). New, all optional:

```js
{
  id, trip_date, at, photo_ids, shop_id, paid_by,      // as before
  source: 'money',                                      // only for the MONEY form
  coupon_kind: 'amount' | 'percent', coupon_value, coupon_total,
  items: [{
    // SHOP line (as before): grocery_item_id, line_total, payer, expense_category_id,
    //   durable, pantry_item_id, add, discard_expired, expiry_date, packaging_unit, quantity_per_pack
    // new on any line:
    travel_id, min_stock, list_total, item_discount_kind, item_discount_value, coupon_share,
    // MONEY line (source 'money'), instead of grocery_item_id:
    name, category_id, subcategory_id, quantity, unit, price, price_qty, price_unit, payer, one_time,
    list_entry_id,   // an open SHOP entry for it: it leaves the list if stock really went into HOME
  }],
}
```

- MONEY line with "Add to HOME" off → send `durable: true` (an expense only,
  exactly like an appliance in SHOP).
- MONEY line, existing HOME item → `pantry_item_id` and `add` (in the item's
  own unit — convert like `purchasedQuantity()` in `lib/purchase.js`); a
  group needs a variant chosen first (as in SHOP).
- MONEY line, new HOME item → `pantry_item_id: null`; the function first
  looks for a non-group item with the same name (that's how a finished 1×
  item is revived, never duplicated), else creates one with `category_id`,
  `subcategory_id`, `unit`, the normal `price` / `price_qty` / `price_unit`,
  `one_time` and `min_stock`.
- `price` / `price_qty` / `price_unit` are the **normal** price (before
  discounts): they become the HOME item's last price. `line_total` is what
  was really paid (the expense).
- `list_entry_id` closes that SHOP entry only if it is still "to buy" (not in
  a cart, not ordered online, not bought) **and** the line really added stock.
- Same `id` sent twice → saved once (both kinds).

**`reopen_shopping_trip(trip_id)`** → number of lines undone (for a SHOP
purchase: items back in the cart, as before; 0 = no longer there).
SHOP lines exactly as before. MONEY lines: stock, history and expense undone,
an item it created deleted, a SHOP entry it closed is "to buy" again
(`in_cart` false); nothing goes into a cart. **Never deletes a merged
expense** (they become single expenses again with their old store). A
purchase with `source = 'merged'` is **refused** ("use Split").

**`merge_expenses_into_purchase(payload)`** → the `shopping_trips` row.

```js
{ id /* new purchase, made by the app */, expense_ids: [uuid, …], shop_id /* optional */ }
// or, to add to an existing purchase:
{ trip_id, expense_ids: [uuid, …] }
```

Refuses (and changes nothing): fewer than 2 (new) / 0 (existing); an expense
deleted meanwhile; an expense already in a purchase (or referenced by a
purchase line); an expense of an order; different days; different payers; an
existing purchase on another day or paid by someone else. Amount, category,
date, payer and `travel_id` never change; each expense takes the purchase's
store (its old one goes to `shop_before_merge`). A new purchase has
`source = 'merged'`, its store is `shop_id`, or the one store all the
expenses share. `total` grows by the merged amounts. Sent twice → once.

**`split_merged_purchase(trip_id, expense_ids = null)`** → how many expenses
were split off. Null = all merged expenses of that purchase. Each gets back
its old store; a `merged` purchase with nothing left is deleted.

**`merge_inventory_category(from_id, to_id)`** → `{ items, list_entries,
memory, subcategories }`. Moves everything of `from_id` to `to_id`, then
deletes `from_id`: HOME items, open/closed SHOP entries, remembered names
(`category_memory`). Main → main: its sub-categories move along with their
items. Main without subs → a sub. Sub → sub or main. The deleted category's
budget mapping row disappears (the items then follow the target's mapping).
Stock, expenses, colours and icons never change. Refuses: `appliances` itself;
anything into or out of the appliances tree; a main with subs into a sub; a
main into its own sub; the same category; missing ones.

**`move_inventory_subcategory(sub_id, parent_id)`** → `{ items, list_entries,
memory }`. A sub moves under another main (its items' main category
follows); `parent_id = null` makes it a main; a main **without** subs can
become a sub (its items get main = new parent, sub = it). Refuses: a main with
subs becoming a sub, `appliances`, crossing the appliances tree, a category
into itself. Same place → nothing happens.

**Triggers:** `grocery_items_cart_time` (before insert/update on
`grocery_items`), `pantry_items_shop_dismissed` (before insert/update on
`pantry_items`). Both have the household check, but only for the app's roles
(`anon`, `authenticated`), so maintenance in the SQL Editor is never blocked;
the tables' own policy protects them anyway.

### Every changed line in the two replaced functions

`confirm_shopping_trip` (compared with 022, which it replaces):

| Change | For a SHOP payload today |
|---|---|
| New variables `v_money` (payload.source = 'money'), `v_entry`, `v_entry_id`. | `v_money` is false. |
| The trip insert also writes `source`, `coupon_kind`, `coupon_value`, `coupon_total`. | `'shop'`, null, null, 0 — the column defaults. |
| The three line checks (entry exists / already bought / ordered online) are now inside `if not v_money then … end if`, same order, same messages. A MONEY line instead builds an in-memory `grocery_items` record from what was typed (never written) and refuses an empty name. | Same checks, same order. |
| `v_entry_id := null` per line. | Unused. |
| The expense insert also writes `travel_id` (from the line, else null). | null. |
| The comment on name matching mentions the finished 1× item. | Comment only. |
| A new HOME item also gets `one_time = entry.one_time` and `min_stock = line.min_stock` (default 0). | `one_time` false for every existing entry (new column, default false); `min_stock` 0 = the column default. Feature B.1: an entry marked 1× now makes a 1× item. |
| New block: a MONEY line that added stock closes `list_entry_id`. | Skipped (`v_money` false). |
| The line insert also writes `line_kind`, `quantity`, `unit`, `list_total`, `item_discount_kind`, `item_discount_value`, `coupon_share`; `grocery_item_id` is `v_entry_id` for MONEY lines. | `'shop'`, the entry's quantity and unit, null, null, null, 0; `grocery_item_id` = the entry, as before. |
| The update marking the entry bought is inside `if not v_money`. | Runs as before. |

`reopen_shopping_trip` (compared with 015):

| Change | For a SHOP purchase today |
|---|---|
| `perform 1 … for update` became `select t.source into v_source … for update` (same lock, same "not found → 0"). | Same. |
| New: `source = 'merged'` → refuse with "use Split". | Never `merged`. |
| The expense delete got `and merged_at is null`. | Purchase lines' expenses are never merged (merge refuses them), so the same expenses are deleted. |
| New first branch for `line_kind = 'money'` (entry back to "to buy", nothing re-inserted). | Lines are `shop`: the old two branches run unchanged. |
| New last step: expenses merged into the purchase become single again, old store back. | No merged expenses: updates nothing. |

Tests (`supabase/migrations.test.js`, block "023"): a full SHOP purchase
under 023 gives exactly the same stock, history, expenses and Reopen result
as the 014 tests; "already ordered online" and "never stock to a group by
name" still hold; a snapshot from before 023 is still put back by Reopen.

---

## 3. Round 2 — HOME Manage, MONEY lock, colours, unique names, keyword check

### Files

- `src/hooks/useInventoryCategories.js` — add `renameCategory(id, name)`,
  `moveSubcategory(id, parentId)` (rpc `move_inventory_subcategory`),
  `deleteCategory(id, targetId)` (plain delete when nothing uses it, else rpc
  `merge_inventory_category`), all with the name checks below; after each,
  `inventoryCategoryStore.refresh()`, `pantryStore.refresh()`,
  `groceryStore.refresh()`, `categoryMemoryStore.refresh()`,
  `budgetMapStore.refresh()`.
- new `src/lib/inventoryCategoryEdit.js` (+ test) — pure rules, like
  `lib/categoryEdit.js`: `homeNameKey(name)` (trim, lower case, accents off,
  spaces collapsed), `homeNameTaken(categories, name, exceptId)`,
  `renameProblem`, `moveProblem`, `deleteProblem`, `usageOf(category, items,
  entries, memory)`.
- new `src/components/inventory/InventoryCategoryManager.jsx` — the Manage
  screen (bottom sheet like `CategoryManager.jsx`).
- `src/components/inventory/BudgetMappingView.jsx` — a "Manage categories"
  button at the top (HOME → Categories is where it lives).
- `src/data/constants.js` / `useInventoryCategories.visibleCategories` — the
  name override only while the stored name is still the old default (see
  rules).
- `src/components/expenses/CategoryManager.jsx` — `PROTECTED` gets
  "Home & Appliances"; its hint says "Locked: it can't be renamed, moved or
  deleted."; `src/hooks/useExpenses.js` `deleteCategory` refuses it too.
- `src/hooks/useCategoryColors.js`, `src/lib/expenseColors.js` — sub colour
  = main colour.
- `src/components/expenses/ExpenseGroup.jsx`, `CategoryManager.jsx` (and any
  other place drawing a sub-category dot) — sub dot half size.
- `src/lib/categoryGuess.js`, `src/lib/categorySuggest.js` — keyword check.

### Data used

`inventory_categories`, `pantry_items.category_id/subcategory_id`,
`grocery_items.category_id/subcategory_id`, `category_memory`,
`category_budget_map`; rpc `merge_inventory_category`,
`move_inventory_subcategory`; `expense_category_colors` (read only).

### Rules

**HOME Manage screen**

- Lists main categories in shop order with their subs indented; each row
  shows its item count ("12 items" = HOME items in it, sub items counted in
  their main too) and buttons Rename · Move · Delete. "+ Add category" /
  "+ Add sub-category" at the top.
- **Rename** main or sub: same id, so items, colours, icons, budget mapping
  and the shop order stay. `appliances` can be renamed.
- **Move** a sub to another main (or make it a main) with its items:
  `move_inventory_subcategory`. A main with subs can't become a sub (the
  button explains it). A main without subs can become a sub. `appliances`
  can't be moved; nothing moves into or out of Home & Appliances.
- **Delete**: if nothing uses it (no items, no SHOP entries, no remembered
  names, no subs) → plain delete with Undo. Otherwise ask inline "Move items
  to…" (a select of other categories; main with subs → mains only) and call
  `merge_inventory_category`. Toast: "Moved 12 items to Snacks · Sweet
  Snacks. 'Biscotti' deleted." (No Undo for a merge: say so before
  confirming.) `appliances` can't be deleted.
- Old expenses, stock, colours and icons never change (the function doesn't
  touch them).
- **Unique HOME names**: a HOME category name must be unique across ALL HOME
  categories, main and sub, under any main, ignoring capitals, accents and
  extra spaces. Checked in app code on add and rename (also in
  `addCategory` / `addSubcategory` used by SHOP and the item editor). **No
  database unique index** — the live data still has the duplicate "Frozen
  Vegetables", so an index would fail. Hidden categories (`baby`,
  `automotive`) don't count. The existing duplicate must not block anything
  else: the check only looks at the name being typed.
- HOME and MONEY never check each other's names.
- **Name override**: show `personal-care` as "Beauty Care" only while its
  stored name is still the original "Personal Care & Beauty"; after a rename
  in Manage show the stored name. (Otherwise a rename looks ignored.)
- Merging "Frozen Vegetables": Irene deletes the hand-made one under Fruit &
  Vegetables and moves its items to Frozen Food › Frozen Vegetables (or the
  other way round). The function re-points memory and SHOP entries.

**MONEY**

- "Home & Appliances" locked from delete as well (button disabled with the
  lock hint), like Groceries and Other.
- **Sub-category colour = its main's colour.** `styleFor(subId)` returns the
  main's style. Colours are no longer generated or saved for subs
  (`assignCategoryColors` only for mains); old saved sub colour rows stay in
  the table, unused. Apply to income categories too (same component, same
  rule — see Risks).
- Sub dot ≈ half the main dot: main `w-2.5 h-2.5` (10 px) → sub
  `w-[5px] h-[5px]`, in the opened expense row (`ExpenseGroup` section
  headers) and in Manage (`CategoryManager` rows).

**Keyword check**

- `guessCategory(name, available)` gets the set of existing category ids
  (main and sub) and ignores rules whose **main** doesn't exist *before*
  scoring; a rule whose sub is missing but main exists counts as main-only.
  So a missing category can't make a clear guess "unclear". `suggestCategory`
  passes `parents` / `subsByParent`; `fit()` stays as a second guard.
- Rules pointing to missing categories are silently ignored (no error, no
  console noise).

### Edge cases

- Rename "Snacks" to "snacks " (only case/space) → allowed (same category),
  saved trimmed.
- Rename "Snacks" to "Sweet Snacks" while a sub "Sweet Snacks" exists →
  refused: "'Sweet Snacks' already exists (under Snacks)."
- Delete sub "Ice Cream" with 5 items → asks "Move 5 items to…"; pick
  "Frozen Food" (main) → items keep main Frozen Food, no sub.
- Delete main "Garden" with subs Seeds, Tools → only mains offered; after
  moving to "Outdoor", Seeds and Tools are under Outdoor.
- Delete "Garden" while the other phone adds an item to it → the function
  runs in one transaction: either the item was there and moved, or it comes
  after the delete (then it is "No category"); never lost stock.
- A keyword rule for `frozen:vegetables` after that sub was merged away →
  the guess falls back to main "Frozen Food".

### iPhone checklist

1. HOME → Categories → Manage categories: every main shows its item count.
2. Rename a sub (e.g. "Cheese" → "Cheese & Dairy"): items in it still show
   it; the budget mapping for it is unchanged.
3. Try to rename a category to a name used elsewhere (e.g. "Frozen
   Vegetables" → "Fresh Fruit"): refused with the place it is used.
4. Move a sub to another main: its items now show under the new main
   (filter HOME by category).
5. Delete the hand-made "Frozen Vegetables" → choose Frozen Food › Frozen
   Vegetables → items moved, only one "Frozen Vegetables" left.
6. Home & Appliances: rename works, Move/Delete are disabled.
7. MONEY → Manage: "Home & Appliances" can't be deleted.
8. MONEY: open an expense day with a sub-category: the sub dot has the main
   colour and is half the size; same in Manage.
9. SHOP quick add "pizza": still suggests Frozen Food › Frozen Meals.

---

## 4. Round 3 — Cart order (A), one-time purchases (B), group variants in SHOP (NOTE 1)

### Files

- `src/hooks/useGroceryList.js` — `cartItems` sorted oldest in cart first;
  `reasonOf` knows `not-urgent` and 1×; `PRIORITY` puts `not-urgent` last.
- `src/hooks/useGroceryItems.js` — `toggleCart` sends
  `cart_added_at: inCart ? new Date().toISOString() : null` and patches it
  locally; `addItem` accepts `oneTime`.
- `src/lib/offlineActions.js` — `queueCart` keeps the tap time and sends it
  as `cart_added_at` (the trigger keeps a sent time).
- `src/pages/GroceryPage.jsx`, `src/components/grocery/ShoppingMode.jsx`,
  `src/components/grocery/ConfirmPurchase.jsx` — cart lists in cart order.
- `src/lib/inventory.js` — `restockReason` / `displayReason` / stats for
  1×; `syncShoppingForItem` → `syncGroup` (round 3B: one entry per variant,
  see NOTE 1); `stockChangeWithLog` / `undoStockChange` (Undo leaves no
  trace).
- new in 3B: `src/lib/groupShop.js` (+ test) — `planGroupEntries`,
  `groupsToTidy`, `shopUnits` (cards), `addableVariants`, `variantPurchase`;
  `src/hooks/useShopTidy.js`; `src/components/grocery/GroupShopCard.jsx`,
  `EntryControls.jsx`, `src/hooks/useEntryEditing.js`;
  `src/lib/stockUndo.test.js`.
- new `src/lib/oneTime.js` (+ test) — `isOneTime`, `isFinished(item)`,
  `splitFinished(items)`.
- `src/hooks/usePantryItems.js` — `ITEM_FIELDS` + `one_time` (3B: no
  `shop_dismissed_at`); "finished" toast with Undo; flagging takes the item
  off "to buy"; deleting an item takes its automatic "to buy" entries with
  it (Undo puts them back).
- `src/components/inventory/ItemEditor.jsx` — 1× toggle (new and edit, not
  for groups), minimum field hidden while on.
- `src/pages/PantryPage.jsx` — collapsed "Finished one-time items".
- `src/components/inventory/ItemTile.jsx`, `GroupTile.jsx` — grey 1× label;
  finished 1× variants hidden in the group.
- `src/components/grocery/AddItemForm.jsx` (More options) — 1× toggle for a
  new SHOP entry not in HOME.
- `src/components/grocery/GroceryItemTile.jsx`, `ShoppingMode.jsx`
  (`ShopTile`, `ShopGroupCard`), `ConfirmPurchase.jsx` — "1× purchase"
  label; one card per group with a row per variant (3B; the round-3 group
  row "— out: …" and × per variant are gone).
- `src/lib/inventoryStyles.js` — `not-urgent` style (sky) and a neutral
  grey `oneTime` badge.
- `src/lib/purchase.js` — prefill the variant of a group line with the
  first out variant.

### Data used

`grocery_items.cart_added_at` (trigger keeps it right), `grocery_items.one_time`,
`pantry_items.one_time`, constraint `pantry_items_one_time_not_group`;
`grocery_items.pantry_item_id` = the variant for group entries (3B);
`stock_logs` rows deleted by Undo (3B). `pantry_items.shop_dismissed_at` is
**not used** (3B);
`confirm_shopping_trip` (inherits 1× for new items; revives a finished 1× item
by name).

### Rules

**A. Cart order**

- Cart list, ShoppingMode "in the cart" and Confirm purchase: oldest in cart
  first — `cart_added_at` ascending, then `created_at` ascending (items
  reopened together share one time).
- "To buy" lists keep their own sorting.

**B. One-time purchases ("1×")**

1. The flag can be set in the HOME editor (new and edit), and on a new SHOP
   entry (More options) for something not in HOME. A SHOP entry linked to a
   HOME item shows (and changes) the HOME item's flag. Confirm purchase makes
   a new HOME item 1× when its entry was (023 does it).
2. Finished = 1× and stock ≤ 0. A finished item is hidden from the HOME grid
   and listed in a collapsed section "Finished one-time items (N)" at the
   bottom; never deleted. When a stock change makes a 1× item finished, toast
   "'Sun cream' is finished — moved to Finished one-time items" with Undo.
   **3B:** Undo puts the stock back and deletes the history row(s) of the
   change (`undoStockChange`); it never writes an "Adjusted" row, so History
   shows nothing for it. A row already gone (deleted on the other phone) is
   skipped without an error. Offline: the queued change is taken out of the
   queue (never sent); sent meanwhile, its row is looked up and deleted. The
   same holds for every Undo that changes stock (also "Discard expired").
   An undone 1× item goes back to the normal grid.
3. The flag can be removed any time, also from the Finished section ("Not
   one-time"). Then the item is a normal item again: at stock 0 it is Out and
   goes on the SHOP list like any Out item (say so in the button's hint).
4. Grey "1× purchase" label (3B; was "1×") in HOME tiles, SHOP list, cart,
   ShoppingMode and Confirm purchase: neutral grey, and exactly the size,
   weight and padding of "New Item" (shared `SMALL_LABEL`, so it is shown in
   capitals like NEW ITEM). A 1× item never turns yellow/red: `restockReason` and
   `displayReason` return null for it; its minimum is ignored; the minimum
   field is hidden in the editor while 1× is on (the stored value is kept).
   1× items don't count in the Low/Out stat tiles; finished ones don't count
   in "Total items".
5. Flagging an item that is on the SHOP list: its open entries that are
   neither in a cart nor ordered online are removed (with Undo) — manual
   entries too. In the cart or on the way: they stay.
6. A variant may be 1× (finished → hidden inside the group; the group stays).
   A group can never be 1× (toggle not shown; the database refuses it too).
7. Bought again by the same name → the finished item comes back (the
   database matches by name; keep finished items in `pantryItems` so
   `pantryItemFor` and QuickAdd suggestions find them).
8. No existing item becomes 1× by itself (023 changed none).
9. MONEY expenses and trips are always kept (nothing here deletes them).

**NOTE 1. Group variants in SHOP** (rewritten in round 3B, 20/10/2026,
after the iPhone test: one card per group, one row per variant)

- **Entries.** Every variant at stock 0 that is not 1× has its OWN SHOP
  entry (`grocery_items.pantry_item_id` = the variant, `auto_generated`).
  The group itself never gets an entry. A variant's entry asks for 1 of its
  purchase unit (its pack when it has one) at its last price
  (`variantPurchase`). The minimum stays on the group.
- **Group low without a variant at 0** (total ≤ minimum, every variant still
  has some): the variant with the least stock gets an entry, unless one of
  the group's variants is already on the list (so the row doesn't jump from
  variant to variant); it goes when the group is above its minimum again.
- **Which entries go** (`planGroupEntries`): a variant restocked loses its
  automatic entries (an order on the way stays; a 1× variant's entry in the
  cart stays); entries typed by hand ("+ Add another variant") are never
  removed by the list.
- **Never a second entry for the same variant**: before adding, any open
  entry of the variant counts (to buy, in the cart, on the way, typed by
  hand). Two automatic "to buy" entries for one variant (two phones at the
  same moment) → the oldest stays; next to an entry in the cart / on the way
  / typed by hand, the automatic "to buy" one goes. After every insert the
  group is judged again, so a race converges on one. Normal items get the
  same clean-up. Every path goes through `syncShoppingForItem` → `syncGroup`:
  stock changes (also from the offline queue), "Add all…", Reopen,
  Confirm, Arrived / Cancel / Return (`syncListFor`), import.
- **The list shows ONE card per group** "to buy" (and one in the cart),
  grouping the entries by their variant's group (`shopUnits`), placed where
  its first entry sorts. Same in Shop mode (one card, a big tappable row
  per variant; placed in the shop by the group's name and category) and
  Confirm purchase (one card, one line per variant). Inside a card: variants
  at 0 first, then lowest to highest stock (a group-level entry last).
- **A row** = one variant: name, its stock at home, quantity −/+ (its own
  unit), price (prefilled from its last price, editable with payer), its
  own tap → cart, its own "Order online", its own budget mark. Tap only
  "Patatine teriyaki" → only that goes to the cart; "Chips & Snacks" stays
  in "to buy" with "Chips - Patatine Peperoncino", and the card in the cart
  shows only "Patatine teriyaki".
- **Colour / label follow the GROUP**: red total 0, yellow total ≤ minimum,
  sky + "Not urgent" when the total is above the minimum but a variant is at
  0. Priority sort / budget plan: the entries of a group take the group's
  reason, so "Not urgent" cards sink to the bottom.
- **"+ Add another variant"** (card "to buy" only): a variant of the group
  with stock above 0 that isn't listed yet (e.g. on offer) → an entry typed
  by hand for it (`addVariant`); only these rows have ×.
- **No × per variant, no delete for the card** (the round-3 × and its
  `shop_dismissed_at` are gone; the card's trash icon is removed rather than
  limited to added rows, because those already have their own ×). A variant
  at 0 always stays visible until it is bought or its stock goes above 0. To
  stop it coming back: mark it 1× or delete it in HOME (deleting an item
  takes its automatic "to buy" entries with it; Undo puts them back).
- **HOME "Add to grocery list" on a group** adds an entry for the variant
  that needs it most and isn't listed yet (never a group entry).
- **Confirm purchase**: each variant is its own line → its own stock
  increase and its own expense (e.g. €2.49 for Patatine teriyaki), never a
  group total. Stock always goes to a variant (022).
- **Old group-level entries** (round 3 and before): the ones still "to buy"
  (automatic) are replaced by per-variant entries; those in a cart, ordered
  online (on the way) or bought are never touched — they are shown as a row
  of the group's card ("You choose the variant when confirming") and bought
  exactly as before (Confirm asks the variant, pre-selecting the first out;
  Reopen of an old trip puts the group-level entry back in the cart, which
  still works). A group entry typed by hand (e.g. QuickAdd "Chips & Snacks")
  is shown the same way and never removed by the list.
- **Data clean-up of the live data is app code, no SQL** (`useShopTidy`):
  when the SHOP list is open, the app works out from the rows already on the
  phone which groups are not right (`groupsToTidy`: a group-level automatic
  entry "to buy", a variant with two entries, a variant at 0 with none) and
  judges only those groups again, each at most once per app start. Nothing
  is read or written when the list is already right, so in practice it runs
  once; it is safe to repeat. No `supabase/024` was needed.

### Edge cases

- Two phones tap Milk then Bread 2 s apart → cart shows Milk, Bread on both.
- Tapped offline at 10:00, sent at 10:30 → its time is 10:00.
- Reopen puts 5 items back → all get the reopen time; they keep their list
  order between them (created_at).
- 1× "Sun cream" stock 1 → use 1 → finished, toast with Undo → Undo → stock
  1, visible again.
- 1× "Party hats" finished, SHOP quick add "party hats" → links to the
  finished item → Confirm → stock 2, one item, back in the grid.
- 1× flag on "Batteries", which has an open auto entry in the cart → entry
  stays in the cart.
- Group "Chips & Snacks" min 4: Lays 5, Pringles 0, Tuc 0 → total 5 > 4 →
  one sky "Not urgent" card with two rows, Pringles and Tuc, each 1 pcs at
  its last price. Tap Tuc → Tuc in the cart's "Chips & Snacks" card,
  Pringles stays "to buy". Confirm → Tuc +1, one expense for Tuc.
- Same group, Lays 3, Pringles 0 → total 3 ≤ 4 → yellow card, row Pringles.
- Lays 3, Pringles 1 (nothing at 0), min 4 → yellow card, row Pringles (the
  least); Lays then drops to 0.5 → the row stays Pringles (it doesn't jump).
- The live duplicate "Chips & Snacks" (two group-level entries "to buy") →
  both replaced by a row per variant at 0, once.
- A 1× variant at 0 → never listed; hidden in the group.

### iPhone checklist

1. Put three items in the cart in the order Bread, Milk, Eggs → the cart and
   Confirm purchase show Bread, Milk, Eggs.
2. HOME → Add item with "One-time purchase (1×)" on: the minimum field
   disappears; the tile shows a grey "1×".
3. Use it down to 0 → it moves to "Finished one-time items" with a toast;
   press Undo → it is back.
4. In Finished, press "Not one-time" → it shows as Out and appears on the
   SHOP list.
5. SHOP → More options → new item "Balloons" with 1× → Confirm purchase →
   HOME has "Balloons" with 1×.
6. Mark an item that is "to buy" in SHOP as 1× → it leaves "to buy".
7. (3B) A group with variants at 0 → ONE card, each variant at 0 its own
   row with quantity and price; sky "Not urgent" at the bottom when the
   total is above the minimum.
8. (3B) Tap one variant → only it goes to the cart; the card stays in "to
   buy" with the others.
9. (3B) "+ Add another variant" adds a variant with stock; × removes it.
10. (3B) A 1× item at 1 → − → Undo → stock 1, nothing in History.

---

## 5. Round 4 — Purchases with several items in MONEY (NOTE 2), merging old expenses (NOTE 3)

### Decision: MONEY purchases reuse `shopping_trips` / `shopping_trip_items`

A purchase typed in MONEY is a `shopping_trips` row with `source = 'money'`,
one `shopping_trip_items` line per item (`line_kind = 'money'`) and one
expense per line, saved by the same `confirm_shopping_trip` in one
transaction. Why: SHOP trips already have everything a multi-item purchase
needs — one store, one payer, one date, one expense per line, stock per line,
exact Undo (`reopen_shopping_trip`), receipt photos, the "Change the store of
the whole trip" action, Receipts, and the MONEY list grouping by `trip_id`.
A parallel table would have to copy all of it and would drift; with one
structure "MONEY purchases and SHOP trips look and work the same" comes for
free. The item details (quantity, unit, normal price, discounts) live on the
**line**, next to the expense id, for both kinds. A plain single expense
(edited with the old Edit expense form) stays a plain expense.

### Files

- new `src/components/expenses/PurchaseForm.jsx` — the "Add expense" button
  opens it (one item row to start, "+ Add item").
- new `src/lib/moneyPurchase.js` (+ test) — rows → `confirm_shopping_trip`
  payload; Add-to-HOME default; which HOME item / SHOP entry a row matches.
- `src/hooks/usePurchase.js` — `recordMoneyPurchase()` (like `confirmCart`:
  id made once per form, Undo toast = `reopenTrip`), `reopenTrip` wording by
  `source`; `deleteTripRecord` splits merged expenses first.
- new `src/hooks/useMerge.js` — `mergeExpenses`, `addToPurchase`,
  `splitPurchase` (rpcs), Undo toasts.
- `src/pages/ExpensesPage.jsx` — one row per purchase; Select mode; delete
  dialog per kind.
- `src/components/expenses/ExpenseGroup.jsx`, `EntryRows.jsx` (`TripRow`) —
  the purchase row and its opened view (shared component for both lists).
- new `src/components/expenses/MergeDialog.jsx` — store / date / payer form.
- `src/lib/moneyList.js` (+ test) — `groupPurchases()` instead of the
  per-category trip key; `purchasePart()` for the category filter.
- `src/lib/trips.js` (+ test) — `tripState` counts merged expenses too.
- `src/components/grocery/ReceiptsView.jsx` — label per source: Reopen
  (shop) / Undo purchase (money) / Split (merged).
- `src/hooks/useBudgetMap.js` — `previewPastPurchases` reads only
  `line_kind = 'shop'` lines (and orders).

### Data used

`shopping_trips` (`source`), `shopping_trip_items` (`line_kind`, `quantity`,
`unit`, `list_total`…), `expenses` (`trip_id`, `merged_at`,
`shop_before_merge`), rpcs `confirm_shopping_trip` (source 'money'),
`reopen_shopping_trip`, `merge_expenses_into_purchase`,
`split_merged_purchase`; `category_budget_map` via `lib/budgetMap.js`.

### Rules — NOTE 2 (the purchase form)

- Top: store (`ShopPicker`), date (`DateField`), payer (Irene / Akbar /
  Shared). Rows: name, price (as on the receipt), quantity + unit (default
  1 pcs), HOME item category › sub (round 4: the existing `CategoryFields`
  select prefilled by `useCategorySuggestions`; round 5 turns it into chips),
  budget category (follows the HOME category through the mapping, changeable),
  "Add to HOME" toggle; for a new HOME item also "1×" toggle and a small
  "Min" field (default 0). No popups: everything inline.
- One item row = one normal expense (one line). Several rows = one purchase.
- Item category from the name, then budget category =
  `budgetCategoryFor({ category_id, subcategory_id })` (existing mapping).
- "Add to HOME": on by default when the row has a HOME item category (and it
  isn't Home & Appliances); off otherwise; can be switched off. Off → the line
  is `durable: true` (expense only). On: an existing HOME item (same name,
  not a group; or picked) → stock goes up by the quantity converted to its
  unit (`purchasedQuantity`; ask the pack size inline if needed, as Confirm
  does); a finished 1× item comes back; a group → pick a variant inline
  (never stock to the group itself).
- **Groups (since round 3B): one line per variant.** Every line has its own
  quantity, price and expense; two variants of one group bought together
  are two lines, never one group line or a group total. A variant's SHOP
  entry is its own (`pantry_item_id` = the variant), so the `list_entry_id`
  of a line restocking "Patatine teriyaki" is that variant's entry, and
  closing it leaves the other variants' rows in the group's card. The
  purchase row's opened view lists the variants as separate items.
  New → created in HOME (gets "New Item" by itself) with 1× and Min.
- If that HOME item has an open SHOP entry still "to buy", send it as
  `list_entry_id`: it leaves the SHOP list only if the stock really went into
  HOME (023 checks). Show it on the row: "On your SHOP list — it will leave
  the list". An entry in a cart or ordered online is never closed (say "It's
  in the cart in SHOP" on the row).
- MONEY expenses are never deleted by any of this.
- Saved with one press; same id if pressed again (no double purchase).
  Toast "Purchase saved · 3 items · €33.40" with Undo (= reopen).
- Before AI: the AI hooks are prepared in round 8; nothing here waits for it.

**In the list (one row per purchase, SHOP and MONEY alike)**

- Collapsed: store · date · total · one colour dot per main category in it
  (main colour), payer(s). Opened: items grouped by main category with a
  subtotal each; every item shows its name, sub-category, quantity/unit, and
  amount (and in round 6 its discount history); edit/delete per item as
  today; "Change the store of the whole purchase".
- "By category" chart and filters stay per category: they count expenses, so
  nothing changes there. With a category filter on, the purchase row shows
  only that category's part and "of total €80" (the purchase's full total =
  sum of all its loaded expenses).
- Deleting an expense of a purchase asks: SHOP → "Reopen purchase" or
  "Delete expense only" (as today); MONEY → "Undo the whole purchase" or
  "Delete expense only"; merged → "Take it out of the purchase (Split)" or
  "Delete expense only".

### Rules — NOTE 3 (merge)

- Expenses → "Select" → tick single expenses (purchase expenses and order
  expenses show no tick box) → "Merge into one purchase" → inline form:
  store (prefilled when they share one; must be chosen when they differ or
  are empty — "Choose the store for this purchase"), date and payer shown
  (read-only). Allowed only if all have the same date and the same payer;
  the button says why when not.
- "Add to an existing purchase": lists purchases (SHOP or MONEY or merged) of
  the same day whose expenses are all paid by the same person.
- Amounts, categories, charts' category totals and HOME stock never change.
  The store of each merged expense becomes the purchase's store (its old
  store is kept and comes back on Split) — so "By store" can change for
  those expenses (see Risks — confirm with Irene).
- Undo (toast) and "Split" (button on a merged purchase; "Take it out" per
  merged expense) call `split_merged_purchase`.
- **Safety (critical).** A merged expense is never a line of the purchase:
  the purchase only points to it (`expenses.trip_id` + `merged_at`), so the
  code that deletes a purchase's expenses (`reopen_shopping_trip`) can't
  reach it. On top: (1) Reopen of a `merged` purchase is refused in the
  database ("use Split"); (2) Reopen of a SHOP/MONEY purchase that has merged
  expenses turns them back into single expenses (old store) instead of
  deleting them; (3) the delete in Reopen skips any expense with `merged_at`.
  The app never shows Reopen for a merged purchase, and "Delete record" on a
  purchase with merged expenses first splits them (so their stores come
  back). Tested in `supabase/migrations.test.js` (023 block).

### Edge cases

- Conad, 14/10, Irene: "Cat food" €20 (Pets), "Bread" €2.50 (Groceries) →
  one row "Conad · 14/10 · €22.50" with an orange and a green dot; opened:
  Groceries €2.50 · Bread; Pets €20 · Cat food. Chart: Groceries +2.50,
  Pets +20.
- With the Pets filter on: the row shows "Cat food €20 · of total €22.50".
- "Bread" is in HOME and on the SHOP list (to buy) → after saving: stock +1,
  the entry is bought. With Add to HOME off → the entry stays on the list.
- "Dinner at Mario's" (no HOME category) → Add to HOME off by default.
- "Laptop" (Home & Appliances) → Add to HOME off and disabled.
- Merge 3 expenses of 14/10 by Irene, stores Conad / none / Lidl → store
  must be chosen; choose Conad → all three show Conad; Split → back to
  Conad / none / Lidl.
- Merge an expense of Akbar with one of Irene → refused before sending.
- Merge an order's expense → no tick box (the database refuses it anyway).
- Undo of a MONEY purchase that created "Sun cream" in HOME → the item is
  deleted again; the expenses are gone; stock of others back.

### As built in round 4 (20/10/2026)

Built as above, with these details (decided while building; none changes
the database — no `supabase/024`):

- **Files**: as listed, plus `src/lib/merge.js` (+ test: `selectBlock`,
  `mergeProblem`, `mergeStore`, `joinablePurchases`, `mergeErrorMessage`),
  `budgetMap.purchasedItemsByExpense` (decision 18, tested), `trips.purchaseUndo`
  (Reopen / Undo purchase / Split by source), `PurchaseGroup` in
  `ExpenseGroup.jsx` (the purchase row; `TripRow` stays for the sorted lists,
  with "of total"), `SelectExpenses` + `MergeForm` in `MergeDialog.jsx`,
  `addExpenseOnce` in `useExpenses.js`, `askUndoPurchase` in `usePurchase.js`.
  `supabase/migrations.test.js` has a block "round 4" that sends the payload
  built by `lib/moneyPurchase.js` to the real `confirm_shopping_trip`.
- **One row = one normal expense** (item 21): a form with **one row and Add to
  HOME off** is saved as one plain expense (no trip), exactly like the old
  Add expense — editable with the old form, mergeable later; the name may be
  empty as before. One row with Add to HOME on is a one-line MONEY purchase
  (stock needs the purchase function). Two rows or more: one purchase. Both
  have a fixed id per form (pressed twice → saved once) and a toast with Undo.
- **Price 0** is accepted only with Add to HOME on ("Free: stock only, no
  expense"; no expense row, as in SHOP — risk 29).
- **Unit**: typing a name that is a HOME item (or group) takes its unit until
  the unit is picked by hand, so the stock converts without asking; the pack
  size is asked inline only when it still can't convert.
- **Expired HOME item**: MONEY doesn't ask "throw away / keep" like SHOP; the
  stock is added and the row says "Its stock in HOME has expired — check it
  there after saving."
- **Groups**: the variant select lists the existing variants (first at 0
  pre-selected); a new variant is made in HOME, not in the form.
- **The opened purchase row** also has Reopen purchase (SHOP) / Undo purchase
  (MONEY) / Split (merged), each asking first, and "Split merged expenses" on
  a SHOP/MONEY purchase that has merged expenses. Receipts shows the same
  labels; a merged purchase has no "Delete record" there (Split is the way),
  and lists its merged expenses ("· merged").
- **Select** shows a flat list of the expenses of the period and person on
  screen (charts hidden while selecting); purchase and order expenses have no
  tick box and say why. One ticked expense can only join an existing
  purchase; a new purchase needs two. The store of a new merged purchase must
  be chosen when the expenses don't all share one.
- **Delete record** with merged expenses: split first (stores back); its
  Undo puts the record back (total without them) and merges them in again.

### iPhone checklist

1. MONEY → Add expense → one row → Save: one expense, as before.
2. "+ Add item" → two rows of different categories → one purchase row with
   two dots; open it: two groups with subtotals.
3. Turn on a Pets filter in the chart → the row shows only the Pets part
   "of total …".
4. A row for an item in HOME with "Add to HOME" on → HOME stock went up;
   it was on the SHOP list → it left the list.
5. A new item with 1× and Min 0 → appears in HOME with "New Item" and "1×".
6. Undo in the toast → everything is back as before.
7. Select → tick two old expenses of the same day and payer → Merge →
   choose the store → one purchase row; amounts and the category chart
   unchanged.
8. On that merged purchase: no Reopen, a Split button; Split → the two
   expenses are single again with their old stores.
9. Add one more single expense of that day to an existing SHOP purchase →
   then Reopen that SHOP purchase → the added expense is still in the list.

---

## 6. Round 5 — Category suggestions while typing (NOTE 4), creating categories (NOTE 5)

### Files

- `src/lib/categorySuggest.js` (+ test) — `suggestCategories(name, context,
  { limit: 3 })` → up to 3 chips `{ categoryId, subcategoryId,
  expenseCategoryId, source, label }`, layers memory → pantry → keywords
  (→ AI in round 8). Keep `suggestCategory` (first chip) for existing callers.
- `src/lib/categoryGuess.js` (+ test) — `guessCategories(name, available,
  limit)`: the best distinct rules, best first (today only the single best).
- new `src/lib/categoryNames.js` (+ test) — `similarName`, `findExisting`,
  `freeNameSuggestions(name, main, taken, synonyms)`.
- new `src/data/categorySynonyms.js` — small built-in list (Gifts →
  Souvenirs, Restaurant → Dining, Electronics → Gadgets, Clothes → Apparel,
  Snacks → Treats, Drinks → Beverages, Car → Vehicle, Travel → Journeys,
  Books → Reading, Toys → Games…).
- new `src/components/ui/CategoryChips.jsx` — chips + "✚ New" + the inline
  create row.
- new `src/lib/lastPrice.js` (+ test) — last normal price and unit for a
  name.
- `src/hooks/useCategorySuggestions.js` — memory with `expense_category_id`
  and `source`; `rememberBudget()`.
- Use the chips in: `PurchaseForm.jsx` rows, `ExpenseForm.jsx`
  (description), `components/grocery/AddItemForm.jsx`, `QuickAdd.jsx`
  (replace the category popup), `ConfirmPurchase.jsx` for "No category"
  lines.

### Data used

`category_memory` (+ `expense_category_id`, `source`), `pantry_items`,
`shopping_trip_items` (`name`, `list_total`, `line_total`, `quantity`,
`unit`, `created_at`), `orders` (`list_price`, `price`, `quantity`, `unit`),
`inventory_categories`, `expense_categories`, `category_budget_map`.

### Rules — NOTE 4

- Under the name field: 1–3 chips "Category › Sub" (HOME item categories;
  for an "Add to HOME off" MONEY row: budget categories). Tapping fills HOME
  category, sub and the budget category (mapping), or the budget category
  directly.
- Picking something other than the first chip (or choosing by hand) is
  remembered for that name: `category_memory` upsert, `source: 'user'`; for a
  MONEY-only pick also `expense_category_id`. Memory is tried first next time.
- Same behaviour in SHOP (AddItemForm, QuickAdd).
- Bought before → last price and purchase unit fill in (editable), from the
  most recent of: a purchase line with that name (`list_total ?? line_total`
  for its `quantity` + `unit`), the HOME item (`price` / `price_qty` /
  `price_unit`), an order (`list_price ?? price` for its `quantity` +
  `unit`). Store is never filled. "Last price" is the **normal** price
  before any discount (round 6 stores it; before round 6 `list_total` is
  null and `line_total` is used).

### Rules — NOTE 5

- Always confirmed: a "✚ New" chip next to the existing chips opens a small
  inline row (not a popup): name (editable), budget category, "Create". It
  only adds. Sub missing but main exists: "Dairy & Eggs › ✚ Kefir" (creates
  the sub).
- Before showing "✚ New", compare with all existing categories and subs,
  similar names included (capitals, accents, singular/plural via
  `singular()`, "&"/"and", extra spaces): a match shows that existing chip
  instead.
- "Add to HOME" on → a HOME category (+ its mapping); off → a MONEY category
  only. From the SHOP list always a HOME category.
- Mapping of a new HOME category: if a MONEY **main** category has the same
  or a similar name (e.g. HOME "Pet Supplies" ~ MONEY "Pets", HOME "Health &
  Medicine" ~ MONEY "Health") → that one; otherwise Groceries. Shown in the
  create row and changeable; a `category_budget_map` row is written only when
  the choice differs from the default (Groceries), like the mapping screen.
- Before AI: when nothing matches, no guessed chip — only "✚ New category";
  an item saved without a category shows a grey "No category" label (SHOP
  tile, MONEY row, HOME tile). After AI (round 8): AI may propose a new
  category through the same "✚ New" row; it still needs Create.
- **Name already used** — the create row must say so and offer a free name
  before Create, e.g. "Gifts already exists in Shopping". Name stays
  editable; the app never renames by itself. Before AI: 1–2 suggestions that
  are guaranteed free: "<main name> <name>" ("Holiday Gifts" / "Trips
  Gifts") and a synonym from the built-in list ("Souvenirs"); each checked
  against the uniqueness rule, skipped if taken. After AI: AI suggests the
  best fitting free name (still checked).
- Uniqueness: MONEY keeps its rule (unique across all levels, ignoring
  capitals; the database also has a case-sensitive unique constraint on
  `expense_categories.name`). HOME: the round-2 rule (all levels, app code
  only, no index). HOME and MONEY never check each other.

### Edge cases

- "kefir" → chips "Dairy & Eggs › Yogurt & Desserts", "Dairy & Eggs ›
  ✚ Kefir"; tapping the second opens the row "Kefir" under Dairy & Eggs,
  budget Groceries → Create.
- Typing "Gift" in MONEY with Add to HOME off → chip "Shopping › Gifts"
  (similar to existing) instead of "✚ Gift".
- During a trip, "✚ Gifts" under Trips → "Gifts already exists in Shopping"
  → suggestions "Trips Gifts", "Souvenirs".
- Nutella bought at €6.00 −50% → paid €3.00 → next time the price fills
  €6.00.

### iPhone checklist

1. MONEY → Add expense → type "yogurt" → 1–3 chips; tap one → category,
   sub and budget category filled.
2. Pick a different chip → next time "yogurt" suggests your pick first.
3. Type something you bought before → price and unit filled, store empty.
4. Type a new thing → "✚ New category" only → create it inline; it appears
   in HOME (if Add to HOME on) and in Categories mapping.
5. Try to create "Gifts" under another main → warning with free names;
   pick one → created.
6. SHOP quick add of an unknown word → no popup; it's added with a grey "No
   category"; tap to fix.

### As built in round 5 (20/10/2026)

Built as above, with these details (decided while building; none changes the
database — no `supabase/024`). Irene decided plan item 22: the default budget
category of a **new** HOME category is the MONEY **main** category with
**exactly** the same name (capitals and outer spaces ignored), else
Groceries — no "similar name" guessing (this replaces the "same or similar"
wording of the NOTE 5 rule above).

- **Files**: `lib/categoryNames.js` (`nameKey`, `similarName`, `sameName`,
  `findExisting`, `takenMessage`, `freeNameSuggestions`) + `data/categorySynonyms.js`
  (20 pairs); `lib/newCategory.js` (`checkNewName` for HOME and MONEY,
  `defaultNewBudget`, `mappingToStore`, `titleCase`); `lib/lastPrice.js`
  (`lastPriceFor`, `fetchTripLines`); `categoryGuess.guessCategories`;
  `categorySuggest.suggestCategories` / `suggestBudgetCategories` /
  `suggestCategoriesAsync` / `differsFromFirst` (`suggestCategory` stays);
  hooks `useLastPrice`, `useCategoryCreation`, and `useCategorySuggestions`
  with `suggestions`, `budgetSuggestions`, `remember(…, { chips })`,
  `rememberBudget`; `components/ui/CategoryChips.jsx` (chips + the inline
  "New category" row), `ui/NoCategoryLabel.jsx`, `grocery/FixCategory.jsx`.
- **One door, one shape**: every chip is `{ categoryId, subcategoryId,
  expenseCategoryId, source, label }`. Layers: memory → HOME item (pantry) →
  keywords (up to 3 distinct rules, best first) → an existing category with a
  similar name (source `name`) → AI (`ASYNC_SUGGESTERS`, still empty). Only
  categories that exist are offered. A MONEY row with Add to HOME **off**
  gets *budget* chips instead: the name's remembered budget category
  (`category_memory.expense_category_id`), then the HOME suggestions through
  the mapping, then a similar name among the budget categories.
- **Learning**: a pick (chip, or the selects) that differs from the first
  chip on offer is saved in `category_memory` with `source: 'user'`; a HOME
  pick never overwrites the remembered budget category and the other way
  round. A MONEY-only pick (`rememberBudget`) writes `expense_category_id`
  only (`category_id` stays null; the HOME layers ignore such a row).
- **Last price**: the most recent of a purchase line (`list_total ?? line_total`
  for its `quantity` + `unit`; older SHOP lines from `grocery_snapshot`), an
  order (`list_price ?? price`, only with quantity + unit) and the HOME item
  (`price` per `price_qty` `price_unit`). It fills price, quantity and unit
  until one of them is edited by hand. Store never. Purchase lines are asked
  from the database 400 ms after typing stops (nothing fills offline except
  HOME items and orders). QuickAdd has no price field, so it doesn't use it.
- **"New category" row** (inline, never a popup): name (starts as the typed
  item name in Title Case), "New main category" / "Sub-category of …", and for
  HOME a budget category (starts by the exact-name rule above; a sub-category
  with no exact match starts as its main's budget, not Groceries, so it keeps
  following its main). A mapping row is stored only when the choice differs
  from what the category gets without one. Add to HOME on / SHOP → a HOME
  category; Add to HOME off → a MONEY category only (no HOME row, no mapping).
  Home & Appliances isn't offered as a main for a new sub-category.
- **Name already used**: "Gifts already exists in Shopping" (or "… as a main
  category") shown before Create; Create stays off; the name is never changed
  by the app. Up to 2 tappable free names: "<main name> <name>" (only for a
  sub-category) and built-in synonyms; each is checked against the same
  uniqueness rule before it is shown. A *similar* (not identical) existing
  category is offered as "Use <path>" instead of a near-duplicate. HOME and
  MONEY never check each other.
- **"✚ New" chip with a proposed name**: `CategoryChips` takes `proposals`
  `[{ parentId, name }]` for round 8; nothing passes any, so it is off.
- **No category**: the SHOP add forms no longer insist on a category. QuickAdd
  adds an unknown word at once with no category (no popup); "More options"
  also allows it. Grey "No category" (the shared `SMALL_LABEL` size, grey like
  1×) on a SHOP tile, a HOME tile, a Confirm purchase line (new item) and a
  MONEY purchase line without a budget category. On SHOP tiles and Confirm
  lines it can be tapped to open the chips (`FixCategory`, `updateCategory`).
- **Not done (as the brief said)**: trip-based suggestions (round 7),
  discounts (round 6), AI calls (round 8). `ExpenseForm.jsx` (the form for
  editing one existing expense) has no chips: the brief listed the SHOP forms
  and the MONEY purchase rows.

### iPhone checklist for round 5

See the list in the round's final message: (a) "pizza" chip, (b) an item
bought before fills price and unit, (c) a different pick is learned, (d) a
new sub from SHOP, (e) "Gifts already exists in Shopping".

**Added after the round-5 test (21/10/2026): typos in new category names.**
The similar-name check (`lib/categoryNames.js`) now also catches small typos:
`nameDistance` is a Damerau-Levenshtein distance (letter missing, extra,
wrong, or two neighbours swapped) between the normalized names (`nameKey`:
capitals, accents, "&"/"and", plural gone), at most 1 when the shorter name
has 4 letters or fewer, at most 2 for longer ones. `similarCategories` gives
up to 3, closest first. "Gfits", "Gits" and "Giffts" all show "Similar
category exists: Use Shopping › Gifts". It is a warning only: Create stays on
("Car" and "Cart" are different things); only the exact same name (capitals
and spaces ignored) still says "X already exists in Y" and disables Create.
`checkNewName().similar` is now a list. Used in the "+ New category" rows
(SHOP and MONEY) and, as a plain note (`components/ui/SimilarNote.jsx`: "Similar
category exists: …. You can still use your name."), in HOME Manage and MONEY
Manage (Add and Rename; the category being renamed is never compared with
itself). HOME and MONEY lists are never mixed.

---

## 7. Round 6 — Discounts (NOTE 6)

### Files

- new `src/lib/discounts.js` (+ test with every example below) —
  `applyDiscount(list, { kind, value })`, `spreadCoupon(lines, coupon)`,
  `discountLabel(list, paid, discount)`.
- `src/components/expenses/PurchaseForm.jsx` — per row "−% / −€" inline
  field; at the bottom "Purchase discount" (coupon, % or €).
- `src/components/grocery/ConfirmPurchase.jsx`, `src/lib/purchase.js` — same
  two kinds; the typed total is the **normal** price, the paid amount is
  computed; `confirmationPayload` sends `line_total` (paid), `list_total`,
  `item_discount_*`, `coupon_share`, and the trip's `coupon_*`.
- `src/components/expenses/OrderForm.jsx`, `src/hooks/useOrders.js`
  (`orderRowFrom`, `editOrder`), `src/lib/orders.js` — per-item discount only;
  `list_price`, `discount_kind`, `discount_value`; `price` = paid.
- `ExpenseGroup.jsx`, `EntryRows.jsx` — the history "€6.00 → €3.00 (−50%)"
  on the item, "Conad · €150 (coupon −€50)" on the purchase row.

### Data used

`shopping_trip_items.list_total`, `item_discount_kind`, `item_discount_value`,
`coupon_share`; `shopping_trips.coupon_kind`, `coupon_value`, `coupon_total`;
`orders.list_price`, `discount_kind`, `discount_value`; `expenses.amount`
(always what was really paid).

### Rules

- Per item: percent or € off. Sneakers €80 −30% → €56; Jacket €120 −€25 →
  €95. Shown "€80 → €56 (−30%)", "€120 → €95 (−€25)". A discount larger than
  the price → paid €0 (refuse more than 100 %).
- Whole-purchase coupon (% or €): the user types each price as on the
  receipt, then "Purchase discount". Per-item discounts first, then the
  coupon spread **proportionally by the price after item discounts** over all
  lines; each share rounded to cents, the remaining cents on the **last**
  line, so the total equals the receipt exactly. Example: €200 = Groceries
  €120 + €60, Pets €20; coupon −€50 → €90 + €45 + €15 = €150. Shown
  "Conad · €150 (coupon −€50)". If the last line can't take the remainder
  (it would go below 0) the rest goes to the line before it. A € coupon
  bigger than the total is capped at the total.
- "Last price" for autofill = the normal price: Nutella €6.00, promo −50% →
  MONEY records €3.00, next autofill €6.00; with a coupon: recorded €4.50,
  autofill still €6.00. So the HOME item price (and grocery entry price)
  stay the normal price; only the expense gets the paid amount.
- Where: MONEY purchase form and SHOP Confirm purchase = both kinds; Order
  online / Orders = per-item only (`orders.price` paid, `list_price` normal).
- Groups (round 3B): a line is always one variant, so a per-item discount
  belongs to one variant and the coupon is spread over the variants' lines
  like any other lines (Patatine teriyaki €2.49 −50% and Peperoncino €1.99
  are two lines). The "last price" kept is the variant's own.
- MONEY always records what was really paid; the discount history is visible
  in the opened purchase / expense details.
- Editing an expense amount by hand later doesn't change its line's discount
  fields (they describe the receipt); the row then shows the expense amount.

### Edge cases

- Lines €10, €8.40 (=12 −30%), €20 = €38.40, coupon −€5 → shares 1.30,
  1.09, 2.61 → paid 8.70, 7.31, 17.39 = €33.40 (this exact case is in the 023
  test).
- Coupon −10% on €38.40 → €3.84 spread.
- Coupon on a purchase with a €0 line → that line gets share 0.
- An order "Sneakers" €80 −30% → order price €56, expense €56, list price
  €80; next order autofill €80.

### iPhone checklist

1. MONEY purchase, one item €80 with −30% → shows €56 and "€80 → €56
   (−30%)"; the expense is €56.
2. Three items + coupon −€50 → the total equals the receipt; the row shows
   "(coupon −€50)".
3. SHOP Confirm purchase: Nutella €6, −50% → expense €3; next time Nutella's
   price in SHOP is €6.
4. Order online with −€25 → the order and its expense are the paid amount;
   the order shows the normal price crossed out.

### As built in round 6 (21/10/2026)

Built as above, with these details (none needs SQL — no `supabase/024`):

- **Files**: `lib/discounts.js` (+ test): `applyDiscount`, `discountOff`,
  `discountProblem`, `discountLabel`, `spreadCoupon`, `priceLines` (item
  discounts first, then the coupon; the whole purchase in one call),
  `lineDiscountFields` / `couponFields` (what the payload sends),
  `lineHistory` / `purchaseCouponNote` (what the purchase row shows);
  `components/ui/DiscountField.jsx` (the "−%" / "−€" buttons + number,
  `LineDiscountNotes`, `PurchaseDiscountBox`); `moneyPurchase.pricedLines`;
  `purchase.purchasePricing`; `orders.orderDiscount`.
- **Typed price = normal price.** In the MONEY form and in Confirm purchase
  the price/total typed is the receipt price before any discount; it is what
  the HOME item and the SHOP entry keep (so the next autofill is €6.00). The
  expense (`line_total`) is the price less the line's discount and its coupon
  share. Every line also sends `list_total` (normal price), and
  `item_discount_kind/value` and `coupon_share` when there are any; the
  purchase sends `coupon_kind/value/total`.
- **Refusals**: a percent above 100 and an amount above the line's price are
  refused where they are typed ("The discount (€25) is bigger than the price
  (€20)." / "A discount can't be more than 100%."), the form can't be saved.
  A coupon in € bigger than the purchase is capped at the total (plan);
  a coupon above 100 % is refused. A line that would pay €0 is refused unless
  it goes into HOME (stock only, no expense — as a free item).
- **Coupon**: shown from two items on ("Purchase discount", coupon in € by
  default). The remainder cents go to the last line; if that line cannot take
  them (it would go below 0) the line before takes them. A line without a
  price yet takes no part.
- **A single expense with a discount** (one row, Add to HOME off) has no line
  to keep the history on, so it is saved as a **one-line MONEY purchase**
  (expense only, `durable`), not as a plain expense; without a discount it is
  still the plain expense of round 4. (It can't be merged later, like any
  purchase line.)
- **Order online**: per-item discount only. The order form's price fields are
  the normal price; the paid price becomes `orders.price` and the expense;
  `list_price`, `discount_kind`, `discount_value` are saved when there is a
  discount (null otherwise, also when it is removed in an edit). The order
  card shows the paid price with the normal price crossed out, and
  "€80.00 → €56.00 (−30%)" on the card itself (round 6B). Editing an order
  shows the normal price and discount again.
- **History**: the opened purchase row shows under an item "€6.00 → €3.00
  (−50%)" (with " · coupon −€1.50" when it had a share); the collapsed row
  shows "(coupon −€50)" under the total. Editing an expense amount by hand
  leaves this text as it was.
- Tested also against the real `confirm_shopping_trip` (migrations test,
  "round 6") with the payload the form builds.

---

## 8. Round 7 — Trips (travel mode)

> **Changed on 21–22/10 — read section 9D first.** The MONEY main is now
> "Trips & Holidays" (renamed by hand, same id). Round 7 does **not** rename
> it and does not find it by name: it stores its id in `household_settings`.
> Where this section says "rename Holiday to Trips", "Set up Trips" or "lock
> Trips by name", section 9D wins.

### Names

UI: "Trips", "Start trip", "🌴 Holiday" / "🚗 Short trip". Code and
database: **`travel`** — table `travels`, column `expenses.travel_id`, store
`travelStore`, files `lib/travels.js`, `hooks/useTravels.js`. Reason: "trip"
already means a shopping trip (`shopping_trips`, `expenses.trip_id`,
`lib/trips.js`, `tripStore`, `TripRow`…); mixing them would be a constant
source of bugs.

### Files

- `src/lib/stores.js` — `travelStore` (all travels), `travelExpenses` family
  (expenses with `travel_id = X`, plus all expenses in its period for the
  summary).
- new `src/lib/travels.js` (+ test) — `periodOf(travel)`, `travelFor(date,
  travels)`, `activeTravel(today)`, `overlaps()`, `totalsByKindAndYear()`,
  `summary(travel, expenses)`.
- new `src/hooks/useTravels.js` — start, edit, end early, delete; set/clear
  an expense's travel.
- new `src/components/expenses/TripsSection.jsx` (list, level 1),
  `TripDetail.jsx` (levels 2 and 3, end summary), `StartTripForm.jsx`.
- `src/pages/ExpensesPage.jsx` — Trips section; one-time "Rename Holiday to
  Trips".
- `src/components/expenses/CategoryManager.jsx` — "Trips" added to the
  locked names (after the rename).
- Forms that set `travel_id`: `ExpenseForm.jsx`, `PurchaseForm.jsx`,
  `ConfirmPurchase.jsx` (+ `lib/purchase.js` payload), `OrderForm.jsx` /
  `OrderOnlineDialog.jsx` (+ `lib/orders.js expenseRowForOrder`).
- `src/lib/categorySuggest.js` — prefer Trips subs while a trip covers the
  date.

### Data used

`travels`, `expenses.travel_id`, `expense_categories` (main "Trips" and its
subs), `confirm_shopping_trip` line `travel_id`.

### Rules

- **Rename** the MONEY main "Holiday" to "Trips" in this round, in the app,
  once: a card "Set up Trips" in MONEY renames it with the existing
  `renameCategory` (same id → colour, subs Accommodation / Activities / Food
  & Drinks / Transport and its expenses stay). If "Trips" already exists,
  nothing to do. Then lock "Trips" like Groceries (code finds it by name).
  Not in SQL (as the brief says).
- **Start trip**: name, start–end date, kind 🌴 Holiday or 🚗 Short trip.
  Both work the same and book into the one main category "Trips". Trips may
  not overlap (checked in the app; the database doesn't).
- While a date is inside a trip (`travelFor(date)`): forms show a small
  marker "🌴 Trip: Bali" (🚗 for a short trip), set `travel_id`, and the
  budget category defaults to a Trips sub (suggested by name: hotel →
  Accommodation, museum → Activities, restaurant/supermarket → Food & Drinks,
  train/taxi/fuel → Transport; else Trips itself); chips prefer Trips subs.
- **All** expenses whose **expense date** is in the trip period go to Trips
  automatically when they are made: MONEY Expenses (single and purchase),
  SHOP Confirm purchase (every line) and Order online. Decided by the
  expense date, not the day of typing (entering on 15/10 an expense dated
  05/10 during Bali → Bali).
- Order online: a toggle "Trip expense: Bali" on by default, one tap off
  (then normal category, no `travel_id`).
- "Add to HOME" during a trip: the expense stays in Trips; Add to HOME starts
  **off**; turning it on for a **new** item turns 1× on automatically (can be
  turned off). An existing HOME item → normal stock increase.
- Editing an expense date later: the app asks — "This date is outside the
  trip Bali. Remove it from the trip?" (Yes → `travel_id` null and choose a
  category, the normal suggestion pre-selected) / "This date is during the
  trip Bali. Add it to the trip?" (Yes → `travel_id` + Trips category). No →
  nothing changes.
- Any expense can be taken out of a trip **on purpose** ("Not a trip
  expense", e.g. rent): `travel_id` null + a category; never automatically.
  The app never puts it back by itself (only creating an expense or changing
  its date sets or asks).
- The trip ends by itself after its end date; "End trip now" sets `ended_on`
  = today (the period then ends today).
- **End summary** (when a trip has ended, and from the trip at any time):
  one screen with ALL expenses dated in the trip period; those not in the
  trip clearly marked ("Rent €700 — not in trip").
- **Three levels**: (1) list of trips with their totals, and per kind per
  year ("Holidays 2026: €2,400 · Short trips 2026: €650", by start year);
  (2) tap a trip → totals per Trips sub-category (a By category chart for
  one trip); (3) every expense in full (name, date, store, payer, amount).
- Starting a trip whose period already has expenses: show them and ask
  "Add these 4 expenses to the trip?" with a tick per expense (all ticked
  except Housing & Utilities / Subscription / Savings, which usually aren't
  trip costs). Nothing moves without that tap (see Risks).

### Edge cases

- Bali 10–20/10; dinner entered on 22/10 dated 15/10 → Bali.
- A SHOP purchase confirmed on 12/10 → every line → Trips › Food & Drinks,
  `travel_id` Bali; "Toothpaste" with Add to HOME? In SHOP, stock goes to
  HOME as always; the expense is a trip expense.
- Rent €700 dated 15/10 → after saving it's in Bali; "Not a trip expense" →
  Housing & Utilities; summary shows "Rent €700 — not in trip".
- End Bali early on 16/10 → an expense dated 18/10 is not in Bali.
- Deleting a trip → its expenses stay (Trips categories), `travel_id` empty.
- Two trips can't overlap: 10–20/10 and 18–25/10 → refused when starting.

### iPhone checklist

1. MONEY → Set up Trips → "Holiday" is now "Trips", same colour and subs.
2. Start trip "Test" today–tomorrow, 🚗 Short trip → marker "🚗 Trip: Test"
   on Add expense.
3. Add an expense today → it is under Trips, in the trip.
4. SHOP Confirm purchase today → its expenses are in the trip.
5. Order online today → "Trip expense: Test" is on; turn it off → not in the
   trip.
6. Edit an expense's date to last month → asked to remove it from the trip.
7. Trip list shows the totals; tap the trip → per sub-category; tap again →
   every expense.
8. End trip now → the summary lists every expense of those days, the ones
   not in the trip marked.

---

## 9. Round 8 — AI structure (NOTE 7), off until there is an API key

### Files

- new `supabase/functions/suggest-category/index.ts` — the Edge Function
  (Deno). Deployed by Irene with the Supabase CLI; the API key is a Supabase
  secret (`supabase secrets set ANTHROPIC_API_KEY=…`), never in the app or
  the repo.
- `src/lib/categorySuggest.js` — `ASYNC_SUGGESTERS = [aiSuggester]`; same
  result shape as the other layers.
- new `src/lib/ai.js` — `aiEnabled()`, `askAi(level, body)` via
  `supabase.functions.invoke('suggest-category', …)`, silent on any failure.
- `src/lib/stores.js` — `householdSettingsStore`, `aiModelChainStore`,
  `aiProposalStore`.
- new `src/components/settings/AiSettings.jsx` (opened from
  `components/auth/AccountSettings.jsx`) — the "AI suggestions" toggle (off
  by default) and the model chain, read-only.
- new `src/components/inventory/AiReview.jsx` — "Review all categories with
  AI": proposals, "Approve all" / one by one, Reject.
- `src/hooks/useCategorySuggestions.js` — AI answers saved to memory with
  `source: 'ai'`.

### Data used

`household_settings` (`ai_suggestions`), `ai_model_chain` (read only),
`ai_category_proposals`, `category_memory` (`source`,
`expense_category_id`), `inventory_categories`, `expense_categories`.

### Rules

- **One suggestion "door"**: `suggestCategories` tries memory → (pantry) →
  built-in keywords → AI (only when `ai_suggestions` is true and nothing above
  answered). Always the same result shape `{ categoryId, subcategoryId,
  expenseCategoryId, source, label }`; AI answers go through the same `fit()`
  (only existing categories) — a proposed new category comes back as a
  "✚ New" chip (round 5 row; still needs Create).
- **The Edge Function**: checks the caller's login and
  `is_household_member()` (rpc with the caller's JWT); without
  `ANTHROPIC_API_KEY` it answers `{ active: false }` (HTTP 200) and the app
  silently uses the other sources. It reads `ai_model_chain` for the level
  (active rows by position) and tries each model in order until one answers.
- **Calling Claude** (checked against the Claude API reference on
  19/10/2026): use the official TypeScript SDK in Deno
  (`import Anthropic from 'npm:@anthropic-ai/sdk'`), not raw fetch. Model IDs
  exactly as in the chain (`claude-haiku-5-5`, `claude-sonnet-5-5`,
  `claude-opus-5-5`; no date suffixes). Ask for JSON with structured outputs:
  `output_config: { format: { type: 'json_schema', schema } }` (the schema
  lists the allowed category ids as an enum) and validate the answer anyway.
  Forced `tool_choice` is not allowed on Opus 5.5 / Sonnet 5.5 — don't use it.
  Thinking can't be turned off on Opus 5.5: use `output_config: { effort:
  'low' }` for the light level. Medium level (web search):
  `tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]`
  (Sonnet 5.5 / Opus 5.5). Always check `stop_reason` (`refusal` → try the
  next model in the chain). The reference recommends also enabling
  server-side refusal fallbacks on Sonnet/Opus requests
  (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`);
  decide in round 8 whether the chain alone is enough, and tell Irene.
- **Setting** "AI suggestions" (off by default) stored in
  `household_settings` (`key = 'ai_suggestions'`, `value = true/false`), shared
  by both phones. The toggle says "Needs an API key in Supabase" while the
  function answers `active: false`.
- **AI called once per new item**: its answer is saved to `category_memory`
  (`source: 'ai'`); next time memory answers. A user pick later overwrites it
  (`source: 'user'`).
- **Model chain** per level is shown, never edited in the app (the database
  allows only reading); new models are added at the end in the SQL Editor.
- **"Review all categories with AI"** (heavy level): the function cross-checks
  all HOME items and writes proposals (`status 'pending'`, one `run_id`); the
  review screen lists them ("Rake: Garden › Seeds → Garden › Tools — reason")
  with "Approve all" and Approve / Reject each. Approving changes only the HOME
  item's category (+ its remembered name); a proposal with a new category goes
  through the "✚ New" create row first. Nothing changes automatically; **old
  expenses never change**.

### Edge cases

- No key: toggle on → the function answers `active: false` → no AI chip, no
  error toast.
- Haiku refuses or fails → Sonnet → Opus; all fail → no AI chip.
- AI proposes a category id that doesn't exist → dropped (`fit`).
- The same new name typed on both phones at once → at most two calls; the
  memory row is an upsert (last wins).

### iPhone checklist

1. Settings → AI suggestions is off; the model chain is listed (light: Haiku,
   Sonnet, Opus …).
2. Turn it on without a key → "Needs an API key in Supabase"; suggestions
   still work from memory/keywords.
3. (After a key is set) type an unknown product → an AI chip; type it again
   → the same chip comes from memory (no second AI call).
4. HOME → Review all categories with AI → proposals listed; Reject one,
   Approve one → only that item changed; MONEY unchanged.

#### Round 6B (21/10/2026) — fixes after testing round 6 on the iPhone

No SQL (no `supabase/024`). What changed:

- **Live coupon preview.** As soon as a coupon is typed, every item row (MONEY
  purchase form and SHOP Confirm purchase, also each variant line of a group)
  says in green: "€120.00 → €90.00 (coupon −€30.00)", and with an item
  discount too "€80.00 → €56.00 (−30%) · coupon −€5.60 → €50.40"
  (`discounts.linePreview`, shown by `LineDiscountNotes`; it wraps, so it is
  not cut off on a narrow screen). The "Purchase discount" box repeats every
  item by name under the coupon, so it can be checked where the coupon is
  typed. The saved purchase row uses the same words (`lineHistory`; with an
  item discount and a share it now ends "… · coupon −€1.50 → €1.50").
- **Order card (cause).** The orders were saved correctly on every path
  (`OrderForm` → `createOrder` / `editOrder` → `orderRowFrom` sends
  `list_price`, `discount_kind`, `discount_value`; Orders in MONEY and "Order
  online" use the same two functions; orders have no offline queue). The
  SHOP "On the way" card (`grocery/OnTheWay.jsx`) is its own component and
  only printed `order.price`, never reading the discount. It now shows the
  paid price with the normal price crossed out and the line "€80.00 →
  €56.00 (−30%)"; the MONEY `OrderCard` shows that line on the closed card
  too (and not twice when opened). The line always has cents.
- **MONEY expense of a discounted order** shows "€80.00 → €56.00 (−30%)"
  (green) under the expense, in the day group (also in its collapsed header
  when it is the only expense), in the single expense rows (category / store
  views). Read from the order with `orders.expense_id`
  (`orders.expenseDiscountNote`), so it follows edits of the order, Arrived,
  and Cancel / Return with the expense kept; it disappears with the expense
  when "Delete the expense" is chosen. If the expense's amount was edited
  by hand to something other than the order's price, no line is shown (it
  would not describe the expense).
- **Receipts** show "(coupon −€50)" under the purchase total and each line's
  history ("€120.00 → €90.00 (coupon −€30.00)", "€80.00 → €56.00 (−30%)"),
  like MONEY. The limitation noted in round 6 is gone.


## 9C. Round 6C — categories, keywords, A–Z order, SQL 024

Design: `docs/categories-proposal-6c.md` (commit fbf3c0b). Irene's answers
to its decisions 1–8 (21–22/10) win where they differ from it.

### As built in round 6C (22/10/2026)

**Decisions taken:** 1 B (new MONEY main "Personal Care"; Cleaning, Laundry
and Household stay in Groceries) plus HOME Health & Medicine → Health ›
Pharmacy · 2 A (HOME "Baby" now) · 3 A (id `baby` reused) · 4 B (one sub
"World Foods") · 5: Pest Control, Car Care, Stationery, Air Fresheners,
Plants & Garden, Baby › Feeding yes; **Shaving no** · 6: Dentist, Taxes &
Fines, Documents & Permits, Software & Apps, Pet Sitting, Glasses & Lenses,
Family Support yes; Books & Hobbies, Education, MONEY Baby, Home Supplies
no · 7: A–Z also for the SHOP chips and Income ("Other" last); MONEY "Sort
by → Category" stays newest activity first · 8 A (one SQL file). MONEY sub
"Vet" is "Veterinary".

**Rename-safety rule.** Irene may rename any MONEY category (main or sub,
old or new) at any time, before or after 024 is run. So:

- 024 and the MONEY keywords (`src/data/budgetKeywords.js`) refer to MONEY
  categories **by id only** (existing ones by their live id from the
  21/10 export, new ones by a fixed id written in both places). Chips show
  the names as they are stored now.
- 024 inserts with `on conflict (id) do nothing` and skips a name that
  exists in any capitals on another row, so a second run after renames
  duplicates nothing and renames nothing back.
- Exception kept: Groceries / Other / Home & Appliances are still found by
  name (locked categories, unchanged).

Fixed ids of the new MONEY categories (024 = `NEW_MONEY_CATEGORY_IDS`; a
test checks they are identical):

| Category | Under | Id |
|---|---|---|
| Personal Care | — | `f194dd95-a6c4-4399-a2ed-2114d6b8a1eb` |
| Family Support | — | `54c1355d-5ebb-4237-ae67-1be0ca593443` |
| Flights | Trips & Holidays | `38455d3e-ab33-4eae-8088-e6c9e4e55b3e` |
| Souvenirs | Trips & Holidays | `a972798e-d08c-4b09-b8cf-cfe5c1724128` |
| Insurance & Visas | Trips & Holidays | `5c21c7eb-281b-46b5-ac2c-d42da39dd548` |
| Beauty & Perfume | Personal Care | `4eb77042-660a-41e9-a1b6-cd2057605256` |
| Toiletries | Personal Care | `01a993f2-d9af-4881-bc8e-1df5af027000` |
| Hairdresser | Personal Care | `d3728a31-bd77-487d-ac80-aaffe90fa5f3` |
| Streaming | Subscription | `a953640c-9716-4f1f-a989-279c03ddba63` |
| Software & Apps | Subscription | `d9c27fc6-378b-475b-b4e9-097b6e448a27` |
| Cinema & Events | Entertainment | `02fd813a-21b8-4d24-91c3-dbb289af07bb` |
| Fuel | Car / Vehicle | `6aedf34e-9f47-48e9-a5ca-7b8b529fa447` |
| Maintenance | Car / Vehicle | `1fe3c787-1e67-4e31-86a1-d6114f2ef473` |
| Insurance & Tax | Car / Vehicle | `90065703-c0e7-436e-9ba3-2992dc819c7c` |
| Parking & Tolls | Car / Vehicle | `e6ce7094-0f5c-49f7-aff4-78e2b9f2e494` |
| Pharmacy | Health | `8fbe343f-6fd9-4c58-874b-d9bd809be461` |
| Doctor & Tests | Health | `cd1ec5e6-4c7e-4f38-a86f-e6d1e42b10f5` |
| Dentist | Health | `3bbb8479-42e4-4f40-b9fb-bacc5d586128` |
| Glasses & Lenses | Health | `f81fa3cb-8dfc-45f5-b351-f22d877761cd` |
| Veterinary | Pets | `b79bd43a-bfa9-4101-93d7-70468af9dcfd` |
| Pet Sitting | Pets | `9d61caa3-80c5-4104-a734-51deca1f19ed` |
| Taxes & Fines | Bank & Fee | `e2fe4339-59ac-4f79-af56-8bb5f3aeac9d` |
| Documents & Permits | Bank & Fee | `f6f56e33-bfc9-426c-9b3d-d1c217620316` |

Existing MONEY parents used by id: Trips & Holidays `dc79f604-…`,
Subscription `688bfedf-…`, Entertainment `744f7d8e-…`, Car / Vehicle
`8b2d4f49-…`, Health `06729df9-…`, Pets `ecd9a924-…`, Bank & Fee
`b498cc5d-…` (full ids in the SQL and in `budgetKeywords.js`).

**What was built**

- `supabase/024_categories.sql` (not run yet; Irene runs it after review):
  - HOME: Baby (`baby`, sort_order 14) with Diapers, Baby Wipes, Baby Food,
    Formula, Baby Care, Feeding; Beauty Care › Perfume; Frozen Food ›
    Frozen Meat; Toiletries › Feminine Care; Pantry Staples › World Foods;
    Household Supplies › Stationery, Car Care, Air Fresheners, Pest
    Control, Plants & Garden (16 rows, ids of proposal table A).
  - MONEY: the 23 rows above.
  - Mapping: Beauty Care → Personal Care › Beauty & Perfume, Toiletries →
    Personal Care › Toiletries, Car Care → Car / Vehicle (insert only); one
    guarded UPDATE: `health` → Health › Pharmacy only while it still points
    at the Health main. Pet Supplies → Pets unchanged. Baby has no mapping
    row (books into Groceries until Irene changes it in HOME → Categories).
  - Ends with one check SELECT (48 rows): every category and mapping with
    its current name and main, status ok / missing / skipped: name exists
    / skipped: parent missing (health: updated / already Pharmacy / left:
    changed by hand), totals and a duplicate-name check.
- Order A–Z (`src/lib/categoryOrder.js`): `sortCategories`,
  `sortCategoryTree`, `compareCategories`; catch-alls last ("Other",
  "Others", "Miscellaneous / Seasonal", and `misc` by id). Used by
  `useInventoryCategories` (`parents`, `pantryParents`, `subsByParent`
  A–Z; new `shopOrder` = main ids by `sort_order`), `ShoppingMode`
  (`defaultOrder = shopOrder`), `moneyList.categoryTree` (every MONEY and
  Income picker), `purchaseSections` ("Other" before "Uncategorized"),
  `CategoryManager` (MONEY Manage and Income Manage), `BudgetMappingView`
  (budget select), `useCategoryCreation` (`moneyMains`) and `CategoryChips`
  (subs in the "+ New category" budget select). The SHOP chips and the
  HOME filter take the hook's lists, so they are A–Z too. Unchanged: Shop
  mode route, MONEY charts, suggestion chips, MONEY "Sort by → Category".
- `src/data/constants.js`: `HIDDEN_CATEGORY_IDS = ['automotive']`,
  `SUGGESTED_UNITS.baby`. `addCategory` treats hidden ids as taken
  ("Automotive" → `automotive-2`, shown).
- `src/lib/categoryGuess.js`: `createGuesser(rules)`; the HOME
  `guessCategory` / `guessCategories` are the same engine on the same list.
- `src/data/categoryKeywords.js`: the proposal C.1 rules (no Shaving rule)
  before the durable block; the C.3 moves (not the shaving row); header:
  weak words go only in `weak`. On the 238 live items the guess changes for
  the same 14 items as the proposal, all improvements; before 024 is run
  they fall back to the main.
- `src/data/budgetKeywords.js` (new): MONEY rules `[mainId, subId | null,
  keywords, options]`, by id, used by `categorySuggest.suggestBudgetCategories`
  as a layer after the remembered budget and before the HOME chips through
  the mapping (`budgetKeywordPicks`). A rule whose main is missing is
  ignored; a missing sub falls back to its main.
- `src/data/categorySynonyms.js`: perfume, diapers, fuel, vet → Veterinary,
  pharmacy, hairdresser, streaming, toiletries.

**Keyword decisions (X1, X2, Family Support)**

- Trips subs: Accommodation (hotel, airbnb, booking.com, b&b, bnb,
  hostel…; "agriturismo" and "booking" weak only), Transport (trenitalia,
  italo treno, frecciarossa, taxi, uber, noleggio auto, rent a car, car
  rental, sewa mobil, sewa motor, traghetto, ferry, flixbus…; "italo",
  "avis", "grab", "gojek" weak), Activities (tour, escursione, guided tour,
  biglietto ingresso, entrance ticket…). Food & Drinks: no keywords (round
  7). Keywords are matched on the cleaned name, where punctuation is a
  space: "booking.com" = "booking com", "B&B" = "b b" (the "&" = "and" rule
  is only for category names, not for keywords); tests cover both.
- "museo" stays Cinema & Events. "taxi" / "uber" are keywords of Trips ›
  Transport because MONEY has no everyday transport category; "Uber Eats"
  stays Takeaway & Delivery (two words beat one). "rent" and "sewa" are
  weak only in Rent ("Rent a car", "Sewa mobil" → Transport; "Affitto" →
  Rent).
- "luce" weak only in Electricity ("Bolletta luce" yes, "Lampadina luce
  LED" no). "plant" weak only in Plants & Garden ("Alpro plant milk" stays
  Milk & Plant Milk). "fragrance" / "fragranza" weak only in Perfume, and
  Laundry Fragrance has Coccolino and bucato phrases ("Fragranza
  Coccolino" → Laundry Fragrance; "Coccolino" alone stays Fabric Softener).
- Family Support: remitly, western union, money transfer, moneygram,
  kirim uang, transfer keluarga, invio denaro; "wise" weak. Removed from
  Bank & Fee: remitly, western union, wise. Bank & Fee keeps commissione,
  bonifico, canone conto, transfer fee… and gets "fee" (weak). Money sent
  plus its fee is one amount → Family Support.

**Deviations from the proposal, and why**

- MONEY in 024 and in the keywords by id with fixed uuids, not by name
  (rename-safety rule).
- One UPDATE in 024 (the guarded health mapping): the row already existed,
  so an insert could not change it.
- No Shaving: razor, lamette, gillette, bic, schiuma da barba… stay in
  Toiletries without a sub, exactly as before.
- Stationery also takes "colla" (keyword) and "glue" / "lem" (weak) from
  Household, as table C.3 says, and phrases like "cartucce stampante":
  without them "Cartucce stampante" tied with Electronics ("stampante") and
  got no guess. World Foods got "nori sushi" / "sushi seaweed" ("sushi"
  alone is a ready meal). "cotton" (weak) moved with the cotton pads.
- MONEY: "x ray" and "office 365" dropped (the app removes "x" and numbers
  from names, so they became "ray" — matching "Ray-Ban" — and "office");
  "microsoft office" instead. A few extra delivery and bill words
  (grabfood, gofood, bolletta elettrica, token listrik, spese bancarie).
- `shopOrder` is sorted by `sort_order` in the hook itself, not taken from
  the store's order.
- Ordering render tests: MONEY Manage has one; the HOME filter, SHOP chips,
  HOME Manage and CategoryFields render the hook's lists as given (their
  tests mock the hook), so their order is tested in
  `inventoryCategories.test.jsx`.
- Tests use `src/data/moneyCategories.fixture.js`, a copy of the live MONEY
  ids and names (tmp-export/ is never committed); when the export is on
  the computer, a test checks the copy against it.

**Tests:** 1089 → 1178 (85 → 87 files). New `categoryOrder.test.js`,
`budgetKeywords.test.js`; additions in `categoryGuess`, `categorySuggest`,
`moneyList`, `shopMode`, `inventoryCategories`, MONEY Manage render and
`supabase/migrations.test.js` ("024": Trips renamed "Travel" before 024,
rename then run again, hand-changed health mapping, names in other
capitals, a deleted MONEY main, existing rows and income untouched, run
twice, all checks ok).

### iPhone checklist for round 6C

Before 024 is run (the app must work as before):

1. HOME → Manage: categories A–Z, "Miscellaneous / Seasonal" last. Shop
   mode: the aisle order is as before.
2. MONEY → Add expense, a row with Add to HOME off, type "Benzina": the chip
   is "Car / Vehicle" (the sub comes with 024). "Remitly": no chip yet.

After 024 (reload both iPhones):

3. HOME → Manage: "Baby" is there with its 6 subs. SHOP → add "Pampers" →
   chip "Baby › Diapers".
4. MONEY → Manage: "Personal Care", "Family Support" and the new subs;
   "Other" is last. MONEY row "Ryanair" → "Trips & Holidays › Flights";
   "Uber Eats" → "Going out › Takeaway & Delivery"; "Lampadina luce LED" is
   not Electricity.
5. HOME → Categories: Beauty Care books to "Personal Care › Beauty &
   Perfume", Health & Medicine to "Health › Pharmacy".
6. Rename "Trips & Holidays" to "Travel" in MONEY → Manage: "Ryanair" now
   shows "Travel › Flights". (Rename it back if wanted.)

### As built in round 6C2 (22/10/2026) — fixes after testing 6C on the iPhone

No SQL, nothing in the database changes.

**Fix 1 — the budget category fills itself in from the first chip.** In
MONEY "Add expense", a row with "Add to HOME" off now gets "BUDGET
CATEGORY" from the first budget chip, shown selected (green), with the note
"Budget category suggested from the name — change it if it's wrong (it will
be remembered)." ("Ryanair" → Trips & Holidays › Flights without a tap.)

- Chip order unchanged (remembered budget → MONEY keywords → HOME
  suggestion through the mapping → similar name). The auto-fill uses
  `categorySuggest.budgetAutoFill(chips)`: the first chip, unless its
  source is `name`. Why: the HOME auto-fill (`suggestCategory`) uses
  memory, pantry and keywords only, never the similar-name layer, so the
  budget one doesn't either; a similar-name chip is still offered.
- The row keeps `autoBudgetId` (`moneyPurchase.emptyRow`), set on every
  name change until a budget category is chosen by hand (chip, the two
  selects, or Manage → `budgetTouched`), exactly like the HOME
  `categoryTouched` rule. No chip → `''` (Uncategorized).
  `moneyPurchase.budgetOf`: picked by hand → that; else, Add to HOME off
  and an `autoBudgetId` → that; else the HOME mapping as before (so Add to
  HOME on is unchanged; a row with a HOME category picked by hand and Add
  to HOME turned off, with no budget chip, still follows the mapping).
- Not a user pick: it is never remembered by itself; a pick by hand is
  remembered only when it differs from the first chip (unchanged).
- Places: budget chips are shown only in the MONEY "Add expense" item rows
  (`components/expenses/PurchaseForm.jsx`, one row = plain expense, more
  rows = purchase). SHOP add, QuickAdd and FixCategory show HOME chips only.

**Fix 2 — one MONEY category picker, main | sub.** New
`components/ui/MoneyCategorySelect.jsx`: two selects side by side (left
main, right its subs with "No sub-category" first, disabled when the main
has none), order from `moneyList.categoryTree` (A–Z, "Other" last), the
optional sliders button (`onManage`) on the right. Still one id:
`onChange(id | null, { mainId, subId })`; "Uncategorized" → null.
`moneyList.splitCategory(id, mains, subsOf)` opens an existing value with
both columns filled. Changing the main always resets the sub (a sub
belongs to one main only). Used in:

| Place | File |
|---|---|
| MONEY "Add expense" item rows (was one long select) | `expenses/PurchaseForm.jsx` |
| Edit expense | `expenses/ExpenseForm.jsx` via `ExpenseCategoryPicker` |
| Order form (MONEY Orders) | `expenses/OrderForm.jsx` via `ExpenseCategoryPicker` |
| SHOP "Order online" | `grocery/OrderOnlineDialog.jsx` → `OrderForm` |
| "+ New category" row: budget of a new HOME category (was one long select) | `ui/CategoryChips.jsx` |
| HOME → Categories (mapping), mains and subs (was one long select) | `inventory/BudgetMappingView.jsx` |
| Income add / edit (no "Uncategorized": a category is required) | `expenses/IncomeForm.jsx` |

SHOP Confirm purchase has no budget select (it books by the mapping).
Not changed (they pick a *main* as a parent, not a category for money):
the "Main category" / "Move to" selects in MONEY and Income Manage.

**Fix 3 — Trips & Holidays locked (move and delete), rename free.**
`data/constants.js`: `TRIPS_CATEGORY_ID` (`dc79f604-…`; round 7 may move
it to `household_settings`); `budgetKeywords.js` uses it. `categoryEdit`
`moveProblem` / `deleteProblem` take `fixedIds` (by id, any name).
`CategoryManager` gets `fixedHints` (expenses: the Trips id; Income
passes none): Move and Delete disabled, Rename on, hint "Locked: it can't
be moved or deleted. You can rename it." Its subs keep all buttons and
other categories can still be moved under it. `useExpenses.deleteCategory`
refuses it, and `moveCategory` refuses putting it under another main.

**Deviations, and why**

- Edit expense, Order form and Income had a "⚙ Manage" text button next to
  a full-width select; it is now the same small sliders button as the
  purchase rows, so two selects fit beside it on a phone (same action).
- "No subcategory" is now "No sub-category" everywhere (as in HOME).
- HOME → Categories: each row's picker moved under its name (two selects
  don't fit next to the name at phone width).

**Tests:** 1178 → 1211 (87 → 88 files). New
`ui/moneyCategorySelect.render.test.jsx`; additions in `categorySuggest`
(auto-fill: Ryanair, Lampadina luce LED → Groceries, memory, none,
similar name not filled), `moneyPurchase` (`budgetOf`), `moneyList`
(`splitCategory`), `categoryEdit`, `expenseCategoryLock`, MONEY Manage
render, the purchase form render (Ryanair, Other by hand then typing,
clearing, Lampadina, Add to HOME on), the "+ New category" row and
edit expense / income.

### iPhone checklist for round 6C2

1. MONEY → Add expense, type "Ryanair": BUDGET CATEGORY shows "Trips &
   Holidays" | "Flights", the chip is green, the wand note is under it.
   Save without tapping: the expense is in Trips & Holidays › Flights.
2. Pick "Other" in the left select, keep typing: it stays Other. Clear the
   name: Uncategorized.
3. "Milk" (Add to HOME on): budget from the HOME mapping as before.
4. Edit an expense, an order, SHOP Order online, Income, HOME →
   Categories, "+ New category": two selects, A–Z, "Other" last.
5. MONEY → Manage: Trips & Holidays has Move and Delete greyed, Rename
   works, the hint is under it; its subs have all buttons.

### As built in round 6C3 (24/10/2026) — one display fix in HOME → Categories

No SQL, nothing in the database changes, no mapping row is added or
changed: what is saved when a category is picked is exactly as before.

**The rule for the whole screen: grey = inherited / default, white =
chosen for this row.** A sub-category with no mapping row of its own (it
follows its main) used to show "Same as Beauty Care: Personal Care › Beauty
& P…" (cut off) on the left and a grey "No sub-category" on the right, which
was wrong: Perfume really books to Personal Care › Beauty & Perfume. Now:

1. A small grey label "Same as <main HOME name>" next to the sub-category
   name (it wraps under it on a narrow phone). It uses the current name of
   the main, so a rename shows at once.
2. Left select: the inherited MONEY main in grey ("Personal Care").
3. Right select: the inherited MONEY sub in grey ("Beauty & Perfume"), or
   grey "No sub-category" only when the inherited value has no sub.
4. The right select is disabled while the row is inherited. Picking a real
   category in the left select makes the row its own choice (white), and
   the right select is enabled, as before.
5. The first option of the left list stays "Same as <main HOME name>"
   (before it read "Same as X: Y"); choosing it removes the row's own
   mapping and the row goes back to grey. The list is otherwise unchanged
   (mains A–Z, "Other" last).
6. The grey values are computed from the main's mapping on every render
   (`budgetMap.effectiveBudget`), so changing the main updates every
   inherited sub row at once, with nothing saved per row.
7. Rows with their own mapping (Household Supplies › Car Care → Car /
   Vehicle) are white, exactly as before. Main rows are unchanged
   ("Default: Groceries" while nothing is chosen). Subs under a main with
   no mapping show label "Same as Household Supplies", grey "Groceries",
   grey "No sub-category".

**How (phone first).** A native select can only show its selected option,
so `ui/MoneyCategorySelect.jsx` has a new prop `inherited = { mainName,
subName }`: while nothing is chosen, each select's own text is made
transparent and the grey name is drawn on top (`pointer-events-none`, so a
tap still opens the select; up to two lines, so nothing is cut off at 375
px; select height stays `min-h-9`, ≥ 36 px). The dropdown list keeps its
normal text colour. The text-transparent class is applied after the
caller's `selectClassName` so the grey caller class cannot show through.
`inventory/BudgetMappingView.jsx` passes `inherited` only for sub rows
that follow their main (`effectiveBudget` source is not `own`) and shows
the label. No other screen passes `inherited`, so they are unchanged.

**Deviation.** None, apart from the label sitting on the sub-category's
name line instead of above the selects (it saves a line per row).

**Tests:** 1211 → 1219 (88 → 89 files). New
`inventory/budgetMappingView.render.test.jsx` (inherited row: label, grey
main and sub, right select disabled, first option; grey "No sub-category";
default main; own mapping stays white and enabled; "Same as <main>" removes
the mapping and goes grey; picking a category saves for that row only; main
change updates inherited rows; rename shows the new name) and one case in
`ui/moneyCategorySelect.render.test.jsx`.

### iPhone checklist for round 6C3

1. HOME → Categories → Beauty Care → Sub-categories → Perfume: label "Same
   as Beauty Care"; grey "Personal Care" and grey "Beauty & Perfume"; the
   right select does not open.
2. Health & Medicine subs: grey "Health" and grey "Pharmacy" (or the
   sub the main is mapped to).
3. Household Supplies › Car Care → "Car / Vehicle": white, right select
   enabled. Open the left list: "Same as Household Supplies" is first;
   choose it: the row turns grey.
4. Change the main's budget category: the grey values of its subs change
   at once.
5. Rename the HOME main (Manage categories): the label shows the new name.
6. No text cut off, no sideways scroll at 375 px.

## 9D. Decided 21–22/10 for later rounds

**Trips (MONEY main).** The MONEY main is now "Trips & Holidays" (renamed
by hand, same id `dc79f604-19fd-4bdd-817e-335816c4afe7`). Irene may rename
it again (for example "Travel"). Round 7 does **not** rename it. It stores
this id in `household_settings` and finds the category by id, so renaming
stays free; only deleting it is locked. Its subs are not locked (a missing
sub → the suggestion falls back to the main). MONEY keywords already use ids
since 6C. Internal names stay `travels` / `expenses.travel_id`; the button
stays "Start trip".

**Round 7, starting a trip with existing expenses in its dates:** a tick
list "Add these N expenses to the trip?". All are ticked except Housing &
Utilities, Subscription and Savings & Investments. Ticked ones move to a
Trips sub (visible, changeable per row). A purchase with several items is
one tick. Making the trip longer asks with the same list; making it shorter
asks "Remove these N expenses from the trip?". Nothing moves silently;
unticked ones show "— not in trip" in the summary.

**Round 7, expenses before the trip:** a trip can be created ahead. While
an upcoming trip exists, expense forms show "For trip: <name> (starts
dd/mm)" (off by default, one tap turns it on). The trip page has "Add
earlier expenses"; the summary labels them "booked before the trip".

**Round 7, during an active trip:** daily categories are suggested as Trips
subs (Restaurant / Bar / Groceries → Food & Drinks, Fuel / Parking →
Transport, Cinema & Events → Activities…). Details are decided in round 7.
Still open: trips must not overlap (point 13).

**DECISION (Irene, 22/10) — new expenses in three categories (was open
point (a)):** A NEW expense in Housing & Utilities, Subscription or Savings &
Investments is NEVER put into a trip automatically, even when it is typed
while a trip is active or its date is inside the trip period. Edge cases
still to discuss in round 7: adding such an expense to the trip by hand
(for example a hotel booked by mistake under Housing & Utilities); a trip
expense whose category is later changed to one of these three.

**OPEN — to discuss before round 7:**

- (b) Since round 6C2, the first MONEY keyword chip auto-fills the budget
  category. Outside any trip, everyday words such as "taxi" / "uber"
  therefore auto-fill Trips & Holidays › Transport. Open: outside an
  active or upcoming trip, should Trips sub-categories only be offered as
  a chip and not auto-filled?
  Irene's wish: while trip mode is active, the app should remember every
  category choice made during earlier trips. Note: today `category_memory`
  keeps ONE category per name, so a later everyday choice (for example
  "Taxi" → another category in Modena) overwrites the trip choice; round 7
  may need a separate memory for trips. To be discussed before the round 7
  prompt.

**Round 6D (before round 7) replaces the group feature with "one item,
many names":**

- HOME: one item (for example "Chips & Snacks", "Pasta") with one stock.
- SHOP: one row.
- At purchase: several name / brand / price lines under it.
- MONEY: separate rows with their real names and prices.
- Minimum stock: on the total.
- The old variant mechanics ("+ Add another variant", a row per variant)
  are removed.
- Existing chips items are merged into "Chips & Snacks" (stock summed; old
  names keep being recognised; MONEY history unchanged).
- Screen details are decided before round 6D.

### 9E. Data fix 025 (Action 17/10/2026)

**Irene's rule (24/10): HOME stock = consumables only (things bought
again); durable items are MONEY expenses only.** Today the app enforces it
only for the HOME appliances tree (`DURABLE_CATEGORY_IDS`); the app-level
lock for other durables is a later round.

`supabase/025_action_17_10_fix.sql` (not run yet; Irene runs it after
review) fixes one SHOP purchase by hand: Action, 17/10/2026, trip
`1d47dd08-f03a-4df8-a214-ac00f671d54f`, 31 lines, € 26.76. Data only, one
transaction, every write by id and only while the row still holds the
value of the 24/10 export (a second run changes nothing; a value changed
by hand is left alone and the check says CHECK). Amounts, dates, payers,
stores, line totals, discounts, coupon shares, quantities, the purchase
row, stock and 1× never change.

- MONEY: "Shoes & Accessories" (`0f7f387b-0c4a-4095-8865-59cfac4c586a`,
  Shopping) → "Footwear". New subs, fixed ids:

  | Category | Under | Id |
  |---|---|---|
  | Accessories | Shopping | `b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e` |
  | Home Textiles | Home & Appliances | `f924edef-bf90-477d-8303-ddc4a2b27391` |
  | Home Decor | Home & Appliances | `3472a299-73f6-4249-bee4-a5469d1c807a` |
  | Pet Accessories & Toys | Pets | `d0c05f29-1418-485f-9433-b4b0e97c2423` |

- HOME: `appliances:textiles` "Home Textiles" and `appliances:decor` "Home
  Decor" under Home & Appliances (no mapping rows: an appliance sub books
  to the Home & Appliances sub with the same name, so renaming one of the
  two MONEY subs breaks that link, as for every appliance sub). Beauty Care
  › "Hair Water" (`3ff635c0-…`) → "Hair Care". The HOME main `clothes`
  (24/10, mapped to Shopping) is deleted when nothing uses it any more.
- Items: eletrolytes powder → "Electrolytes Powder" (Health & Medicine ›
  Vitamins & Supplements, budget Health › Pharmacy); eye mask → Beauty Care
  › Skincare; hair oil → Beauty Care › Hair Care (budget Personal Care ›
  Beauty & Perfume); coffee syrup → Beverages › Coffee & Tea; washing
  machine powder → "Stain Remover Powder". Dishwasher / Oven Detergent:
  budget Groceries, line category Cleaning Supplies › Dishwashing /
  Surface Cleaners (Irene adds the HOME items by hand).
- Durables leave HOME (item, its history and its links deleted; line made
  expense-only like an appliance line; expense kept): big / small towel
  (Home Textiles), toy elf Christmas, incense holder (Home Decor), bra
  (Shopping › Clothing), Satin Bonnet, hair clip, Headband (Shopping ›
  Accessories), Cat House Christmas Tree, cat toy (Pets › Pet Accessories
  & Toys), and a HOME item "Shoe Deodorizer" if there is one.
- Remembered names: 4 old keys forgotten, 18 names set (source `user`).
- **Open for the next round:** "Apply the mapping to past purchases" still
  proposes Groceries for the six Shopping / Pets durables (bra, Satin
  Bonnet, hair clip, Headband, Cat House Christmas Tree, cat toy): their
  lines have no HOME category, and a SHOP line without one defaults to
  Groceries (`budgetMap.budgetCategoryFor`). No data can fix that; until
  the app does, don't apply the mapping (or press Undo).

Tests: `supabase/migrations.test.js` block "025" (own PGlite database with
the live MONEY ids and a fixture of the 31 lines).


### 9F. Durable lock (decided 25/10, as built)

Analysis: `docs/durable-lock.md` (commit dc7eaf2). Zidane's and Irene's
decisions of 25/10 win where they differ from it. SQL:
`supabase/026_durable_lock.sql` (not run yet; Irene runs it after review,
after 024 and 025). The app is deployed before 026 is run and works both
before and after it.

**The rule.** HOME stock is only for consumables (bought again). A durable
(bought once and kept) is a MONEY expense only: never HOME stock, never 1×.

**1. One durable tree: the HOME main `appliances`.** 026 renames it
"Durables" (by id, only while it is still "Home & Appliances"); the MONEY
main "Home & Appliances" keeps its name (the app finds it by name). Every
sub of `appliances` is durable (`isDurable`, unchanged): SHOP's durable
section, Confirm "expense only", the MONEY lock and the SQL guards of
`merge_inventory_category` / `move_inventory_subcategory` all cover it. New
HOME subs (026), each with a mapping row by id:

| HOME id | Name | MONEY target |
|---|---|---|
| `appliances:clothing` | Clothing | Shopping › Clothing `732af8e0-924c-471c-b0e8-ac9286ce074e` |
| `appliances:footwear` | Footwear | Shopping › Footwear `0f7f387b-0c4a-4095-8865-59cfac4c586a` |
| `appliances:accessories` | Accessories | Shopping › Accessories `b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e` |
| `appliances:pet` | Pet Accessories & Toys | Pets › Pet Accessories & Toys `d0c05f29-1418-485f-9433-b4b0e97c2423` |
| `appliances:glasses` | Glasses | Health › Glasses & Lenses `f81fa3cb-8dfc-45f5-b351-f22d877761cd` |
| `appliances:furniture` | Furniture | Home & Appliances › Furniture `f840ec58-7bd7-4ad7-b2d5-b08678ba7439` (new) |
| `misc:gifts` | Gifts & Party (moved, same id) | Shopping › Gifts `3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c` |
| `health:contact-lenses` | Contact Lenses (consumable, under Health & Medicine) | Health › Glasses & Lenses `f81fa3cb-…` |
| `laundry:machine-care` | Washing Machine Care (consumable, under Laundry Supplies) | no row (follows Laundry → Groceries) |

Mapping rows by id also for the existing subs: `appliances:kitchen` →
`4125ed9e-da65-4b76-8e35-cb1239d8093b`, `appliances:kitchenware` →
`a364fa44-7513-47ca-aabc-7c5254c0a961`, `appliances:cleaning` →
`83c6b924-e7cd-4ba6-881d-a1ff1e6385d1`, `appliances:air` →
`7d226f51-f809-494d-92c0-50d9c12f7812`, `appliances:electronics` →
`2a05cb39-e90c-4349-9f77-4b1e679d42b4`, `appliances:textiles` →
`f924edef-bf90-477d-8303-ddc4a2b27391`, `appliances:decor` →
`3472a299-73f6-4249-bee4-a5469d1c807a`. Inserted only when missing and
both ends exist; a row chosen by hand is never changed. A sub without a
row still books to the Home & Appliances sub with the same name (the old
fallback, `budgetMap.defaultBudgetCategory`).

`appliances:electronics` "Electronics & Work Equipment" → "Electronics"
(only while it has the old name).

**Gifts & Party: moved by id, not re-created.** `misc:gifts` gets
`parent_id = 'appliances'` (what the app's own Move does), only while it
is under `misc` and no item, SHOP entry, remembered name or sub uses it.
Why: nothing is deleted (no cascade of a hand-made mapping row or
remembered names), copies kept on old purchase lines keep pointing at an
existing category, and one guarded UPDATE is easy to check. Checked: no
code reads a parent from the part of an id before ":" (searched `src/` and
the SQL; only a helper inside the round-6C keyword test does, for its own
fixture).

**2. MONEY (026, by id, guarded).** New main **Work**
`6faa75ea-ece5-40c9-9e44-75785f59568e` (no subs): a PURPOSE category —
anything bought for work. New sub Home & Appliances › **Furniture**
`f840ec58-7bd7-4ad7-b2d5-b08678ba7439` (main `199ec782-505a-4292-984e-08ae1d76469f`).
Shopping › Electronics `1697124e-22a7-4417-b5b9-0439ccc67e17` is deleted
only while no expense, order, mapping row, remembered name or sub uses it;
then Home & Appliances › "Electronics & Work Equipment" `2a05cb39-…` →
"Electronics" (after the delete: MONEY names are unique), the ONE
electronics category. Its MONEY keywords (mediaworld, unieuro, euronics,
apple store, cuffie, charger, caricatore) moved there. Family Support
`54c1355d-5ebb-4237-ae67-1be0ca593443` gets no subs. New names are skipped
when the name exists (HOME among HOME, MONEY among MONEY, any capitals).

**3. The lock** (`src/lib/durable.js`). A row or line is locked when its
HOME category is durable (the `appliances` tree) OR its budget category is
in `DURABLE_MONEY_CATEGORY_IDS` (`src/data/constants.js`, by id; a main
covers all its subs, also subs made later):

- Home & Appliances main `199ec782-505a-4292-984e-08ae1d76469f`
- Shopping main `654a80a3-2e6f-4ada-b214-0486d91d869c`
- Pets › Pet Accessories & Toys `d0c05f29-1418-485f-9433-b4b0e97c2423`
- Trips & Holidays › Souvenirs `a972798e-d08c-4b09-b8cf-cfe5c1724128`
- Family Support main `54c1355d-5ebb-4237-ae67-1be0ca593443`

Not locked: Work (the lock follows the item: a work laptop is locked
because a laptop is durable; work printer ink may go into HOME) and Health
› Glasses & Lenses (contact lenses are bought again; glasses are locked by
HOME Durables › Glasses). Released only when neither is durable. Changing a
category never moves old purchases into HOME. Where:

- MONEY "Add expense" (`moneyPurchase.lockOf` / `homeLocked(row, ctx)` /
  `rowLine(row, pantry, ctx)`, `PurchaseForm`): "Add to HOME" off and
  disabled; the budget is worked out first (`budgetOf`), the lock from it,
  never the other way round. No 1× (it only shows with Add to HOME on).
- SHOP Confirm purchase: a line is expense only when its HOME category is
  durable, or its budget category (its HOME category's mapping) is durable
  (`purchaseLine(…, { durableBudget })`, `ConfirmPurchase durableBudgetOf`
  from `GroceryPage`).
- Order online (`OrderOnlineDialog`): the durable note.
- "Arrived" (`GroceryPage.arrive`, `OrdersSection.arrive`): a durable order
  (`isDurableOrder`: its MONEY category durable, or its SHOP entry in the
  Durables tree) is marked arrived (`useOrders.markDurableArrived`) without
  `LinkedArrivedDialog` / `ArrivedDialog`, toast "“{name}” arrived —
  durable, nothing added to HOME."
- SHOP More options (`AddItemForm`): no 1× toggle for a durable category.

**4. Texts.** MONEY locked row: "Durable item ({category}) — expense only,
never in HOME stock." ({category} = the HOME sub, or the main when there is
no sub, or the MONEY category when the lock comes from MONEY; current
names). SHOP durable section: title = the stored name of `appliances`
("Home & Appliances" before 026, "Durables" after), text "… to buy · not in
the grocery budget · expense only, never in HOME stock". Confirm purchase
"new in the pantry" line without a category, and More options while no
category is chosen: "Is this a consumable? Durable items don't go into
HOME stock." OrderOnlineDialog: "Durable item — saving adds the expense; it
never goes into HOME." HOME ItemEditor (keyword guess on ALL categories is
durable; saving stays possible): "“{name}” looks like a durable item
({path}). Durable items don't go into HOME stock — record it in MONEY
instead." Import (DataView, `inventoryBackup.withoutDurables`): "{n}
durable rows skipped (durable items don't go into HOME stock)." Restore of
a backup stays exact.

**5. Keywords.** Engine (`lib/categoryGuess.js`): "glasses" is not
singularised (`NOT_PLURAL`: "Glasses" ≠ "Glass"); a rule may have
`priority` (purpose words: they beat every score; after a linking word
they don't count — "Torta della nonna"); a rule without a category only
hides the words inside its phrases ("Mamma Emma" is gnocchi). HOME
(`data/categoryKeywords.js`): docs/durable-lock.md section 5 with the 25/10
changes — consumable phrases first (carta asciugatutto, sacchetti /
filtro aspirapolvere, filtro fontanella, wet/dry food, dishwasher / oven
detergent, wood cleaner, guanti nitrile, washing machine powder, Washing
Machine Care words, ravviva colore, eye mask, Hair Care words, contact
lenses, electrolytes powder, coffee syrup, macinato moka, poke bowl, fiori
di zucca, table salt, tea bags), then the Durables tree: Gifts & Party
(gift words only), Pet Accessories & Toys (+ generic toys), Home Decor (+
lamp, lampada, lampu, flower pots, watering cans, decorations, "holder" as
a kind word), Home Textiles (+ placemat, table mat, tovaglietta, "mat"),
Footwear, Clothing (+ socks, calze, calzini, kaus kaki, collant, tights),
Accessories (+ hats, sunglasses, fashion glasses), Glasses, Furniture,
Kitchen Appliances, Kitchenware (+ glass, wine/drinking glasses,
containers as kind words, bowl), Cleaning Appliances (+ mop, broom,
bucket, scopa, mocio, secchio, scopino, paletta), Air & Climate,
Electronics (everything electronic; + extension cords and power strips;
no work/office words), and the Durables main for tools (scissors, stapler,
silicone gun, screwdriver, hammer, drill, phone case). Moved out of
consumable rules: brooms/mops/buckets (Sponges & Cloths), extension cords
(Batteries & Bulbs), scissors/staplers (Stationery), pots/watering cans
(Plants & Garden), Christmas trees/decorations (Seasonal), cat toys (Pet
Treats & Care), hair treatments (Shampoo & Conditioner → Beauty Care ›
Hair Care `3ff635c0-7fd1-46ff-ac49-8e408c032398`). "Lampada LED" / "Lampu
LED" get no guess (bulb or lamp). MONEY (`data/budgetKeywords.js`):
purpose words first — family (mamma, madre, papà, padre, ibu, bapak,
ayah, sorella, fratello, adik, kakak, nipote, nipoti, keponakan, suocera,
suocero, mertua, nonno, nonna, nenek, kakek, zio, zia, om, tante, cugino,
cugina, sepupu; never the household's own words, never a real name) →
Family Support, then work (work, working, kerja, lavoro, ufficio, office;
"Microsoft Office" stays Software & Apps, "workout" doesn't match) →
Work, then gift words → Shopping › Gifts. Accessories words (borsa, zaino,
cintura, orologio, sunglasses) left Footwear. The purpose words also
override the budget auto-fill with Add to HOME on (`moneyPurchase.budgetOf`,
`isPurposeBudget`), unless the budget was picked by hand; remembered names
stay the first layer.

**6. "Apply the mapping to past purchases…"** (`budgetMap.pastPurchaseChanges`)
never moves a purchase line without a HOME category, nor an expense whose
current category is Work, Family Support or Trips & Holidays (main or any
sub) — `CHOSEN_ON_PURPOSE_IDS`.

**7. 026 data fixes** (by id, only while the value is still the expected
one): the Action purchase of 17/10 (trip
`1d47dd08-f03a-4df8-a214-ac00f671d54f`) — bra (expense
`54dda4c1-dfdc-424a-9578-0e55c2f7d4c5`) → `appliances:clothing`; Satin
Bonnet (`d7575954-3c5e-45d7-aea7-c70189ea18bc`), hair clip
(`df31b3d4-b0ff-4e9b-afbc-dcc871139cb0`), Headband
(`b3154fe2-b92f-4172-be9f-c01db9176963`) → `appliances:accessories`; Cat
House Christmas Tree (`ecb05397-a0a5-4fe3-9545-383e8a5ab49d`), cat toy
(`f5577c71-1527-4f8f-bf9a-f877225b4416`) → `appliances:pet`: the category
kept on the line, its SHOP entry and the HOME side of the remembered name
(its budget category kept); expenses unchanged. HOME item "Washing Machine
Cleaner" `fb053da7-b1e3-49e6-9e15-dab6d5abd6a4`, its open SHOP entry
`d84c6427-edf1-41bf-a588-ab26bef0869a` and its remembered name →
`laundry:machine-care`. HOME item "Hair Gel"
`7f586552-9cbb-449a-a059-a546dabf6f28` (+ remembered name) → Beauty Care ›
Hair Care. Expense "Working Ear Plug" `62babc6c-234a-4549-9136-e8a82d8f1d16`
→ Work. One transaction, safe to run twice, no table / function / policy /
grant; one check SELECT (43 rows: ok / skipped / CHECK).

**Tests.** `src/lib/durableLock.test.js` (the 253 HOME item names of
25/10 — `src/data/liveItemNames.fixture.js` — none durable; every expected
HOME / MONEY / lock result; engine; `lib/durable.js`; import),
`src/data/homeCategories.fixture.js` (HOME categories live + 024 + 025 +
026), `src/components/durableLock.render.test.jsx` (locked row and note,
Confirm note, More options, SHOP section title, Arrived without a dialog,
the HOME editor warning), additions in `moneyPurchase`, `purchase`,
`budgetMap`, `budgetKeywords`, `categoryGuess` tests, and
`supabase/migrations.test.js` block "026" (on the 025 fixture: run twice,
MONEY renames before / after, a mapping row chosen by hand kept, Shopping ›
Electronics kept with an expense, Reopen + Confirm again with the app's
own code puts nothing durable into HOME, "Apply the mapping…" moves none of
the 31 Action expenses nor Working Ear Plug, every check ok). The 025
block's fixture is now shared (`actionDatabase()`), and its "Apply the
mapping" test says the app moves none of the 31 (the six were the known
case this round fixes).

**For round 7 (Trips).** Family Support and Work are never put into a trip
automatically (like Housing & Utilities, Subscription, Savings &
Investments). A durable bought on a trip stays locked (Add to HOME off, no
1×), whatever budget the trip gives it.

**Next rounds, in this order.**

1. A small "similar name safety net" round: when adding in SHOP or in
   MONEY (Add to HOME on), warn "Similar item in HOME: …" / "Already on
   your SHOP list" and offer to use the existing item, even when its stock
   is high.
2. Round 6D (section 9D).
3. Later: a "Kids" durable sub under Durables when the household has a
   child (baby bottles, pacifiers… today Baby › Feeding).

---

## 10. Risks and decisions

**Decisions made in round 1**

1. **MONEY purchases reuse `shopping_trips` / `shopping_trip_items`**
   (`source = 'money'`, `line_kind = 'money'`) — see round 4 for why.
2. **Item details are stored on the purchase line** (`shopping_trip_items`:
   quantity, unit, normal price, discounts), and for orders on `orders`;
   `expenses` gets no item columns. A plain single expense has no details.
3. **`confirm_shopping_trip` was extended, not duplicated**: the MONEY path is
   switched on only by `payload.source = 'money'`; a SHOP payload runs the same
   checks in the same order and writes the same rows (every changed line is in
   section 2). One function = one way to save a purchase.
4. **Merged expenses are marked on the expense** (`merged_at`,
   `shop_before_merge`), never made purchase lines, so Reopen can't delete
   them; plus a refusal for `merged` purchases and a skip in the delete.
5. **Merging sets each expense's store to the purchase's store** (kept for
   Split). Amounts, categories, dates, payers and the By-category chart never
   change, but the **By-store** chart can (an expense with no store, or
   another one, moves to the chosen store). **Please confirm, Irene**: if the
   store of old expenses must never change either, round 4 only sets the
   purchase's store and leaves the expenses' stores (023 supports both).
6. **Reopen of a SHOP/MONEY purchase that has merged expenses** turns those
   back into single expenses (old store) rather than refusing. Safe either
   way; this is the more convenient one.
7. **Two triggers** keep `cart_added_at` and `shop_dismissed_at` right on every
   path (taps, offline queue, Reopen, Confirm, Arrived, imports) without
   touching the other functions. Their household check applies only to the
   app's roles (`anon`, `authenticated`) so the SQL Editor (as in the one-off
   files) is never blocked; RLS already protects the tables.
8. **`grocery_items.one_time` is nullable** (null = not 1×): Reopen puts a
   deleted SHOP entry back from a snapshot that, for purchases made before 023,
   has no value for it; a NOT NULL column would make that Reopen fail.
9. **The AI model chain is read-only for the app** through grants (SELECT
   only); it still has the one `household_only` policy like every table.
10. **HOME category tools are database functions** (`merge_inventory_category`,
    `move_inventory_subcategory`) although the brief expected no SQL for round
    2: deleting a category cascades (its subs, its remembered names, its
    mapping), so moving everything first and deleting last must happen in one
    transaction.
11. **HOME name uniqueness is app code only**, no unique index (live duplicate
    "Frozen Vegetables").
12. **Travel names**: `travels`, `travel_id` (UI "Trips").
13. **No overlapping trips** — checked in the app only (a database exclusion
    constraint would need an extension).
14. **1× "finished" is derived** (`one_time and stock <= 0`), not stored.
15. **The "Not urgent" colour is sky**, so it doesn't look like the blue "New
    Item".
16. **MONEY sub colour = main colour also for income categories** (same
    screens, same rule). Say if income should keep its own sub colours.
17. **Variant order (0 first, then lowest stock)** applies to the rows inside
    a group's SHOP card, Shop mode card and Confirm purchase card; HOME's group tile keeps A–Z. "Not urgent" at the bottom
    applies to the default priority sort and the budget plan, not to A–Z/price
    or the shop route.
18. **"Apply the mapping to past purchases"** must read only SHOP lines from
    round 4 on: MONEY lines had their budget category chosen in the form, and a
    MONEY line without a HOME category would otherwise be moved to Groceries.
19. **"Delete record"** on a purchase with merged expenses splits them first.
20. **Round 8 calls Claude from a Supabase Edge Function** with the official
    SDK; the key stays in Supabase secrets.

**Things that are unclear (asked or assumed)**

21. "One item = a normal expense" is read as: every item row becomes one
    normal expense (a line), and a form with one row behaves like today's Add
    expense.
22. "A HOME category that has its own main category in MONEY → there" is read
    as: a MONEY main with the same or a similar name (round 5).
23. Starting a trip whose dates already have expenses: assumed the app asks
    which to add (none move silently).
24. The rename Holiday → Trips is done by the app in round 7 (one tap, same
    id). If Irene prefers to rename it by hand in MONEY → Manage, round 7 only
    checks that "Trips" exists. **Superseded (21–22/10, section 9D):** renamed
    by hand to "Trips & Holidays"; round 7 finds it by id, never by name.
25. Removing 1× from a finished item makes it Out → it goes on the SHOP list.
    Assumed that's wanted (it's what "normal item" means).
26. Variants: is the 0-first order also wanted in HOME's group tile? Assumed
    no (see 17).

**Risks**

27. 023 must be run before round 2 is deployed; the code assumes it.
28. The live database can't be inspected from here: the verification SELECT at
    the end of 023 lists every new table, column, function and model row with
    `ok`; Irene should send its result after running it.
29. A purchase line's `line_total` 0 makes no expense (old behaviour) — a free
    item in a purchase still adds stock but no expense row.
30. `category_memory` rows are deleted with a HOME category (cascade from 011)
    if a category is deleted by any path other than `merge_inventory_category`
    — round 2 must use the function whenever memory points to the category.
31. Keyword rules for a merged-away category fall back to its main (as the
    brief asks); there is no redirect table.
32. Two phones merging the same expenses at the same time: the second request
    is refused ("already part of a purchase") — correct, but the toast must say
    so clearly.

**Decisions made in round 3B (20/10/2026)**

33. **One SHOP entry per variant, one card per group** replaces the round-3
    group row; `shop_dismissed_at` (and its trigger) stay in the database
    but are unused (item 7's second trigger now does nothing the app needs).
34. **The group card has no delete**: a variant at 0 must stay visible; rows
    added with "+ Add another variant" have their own ×.
35. **A group at/below its minimum with no variant at 0** lists the variant
    with the least stock (one row), so a low group never disappears from
    the list just because nothing is at 0.
36. **Clean-up in app code** (`useShopTidy`, once per group per app start,
    only when something is wrong), not SQL: it uses the same rules as every
    stock change, so it can't disagree with them. No `supabase/024`.
37. **Deleting a HOME item takes its automatic "to buy" SHOP entries** with
    it (Undo puts them back); otherwise a deleted variant would stay on the
    list as an unlinked "New Item".
38. **Undo of a stock change deletes its history rows** instead of writing
    "Adjusted"; offline, the queued change is dropped from the queue.
39. **"1× purchase" uses the shared `SMALL_LABEL`** of "New Item", so it is
    in capitals like it.
40. **An older app version on the other phone** still makes group-level
    entries until it is reloaded; the tidy replaces them (once per app
    start). Reload both iPhones after the deploy.

**Decisions made in round 4 (20/10/2026)** — confirmed by Irene before the
round: decision 5 (option A: merged expenses take the purchase's store,
Split gives each its old one back), item 21, decision 6, decisions 18 and 19.

41. **One row with Add to HOME off is a plain expense**, not a one-line
    purchase (see round 4 "As built"): it is what the old Add expense made.
42. **MONEY doesn't ask about expired stock** (SHOP does); the row warns.
43. **Reopen / Undo purchase / Split are also on the opened purchase row**
    in MONEY, not only in Receipts.

**Decisions made in round 5 (20/10/2026)**

44. **New HOME category → budget category by an exact name** (Irene's answer to
    item 22): a MONEY main category with the same name (case-insensitive,
    trimmed), else Groceries; for a new sub-category, else what its main is
    booked to. Always shown and changeable before Create.
45. **Chips are tried memory → HOME item → keywords → similar name**; the
    similar-name layer is what shows "Shopping › Gifts" for "Gift" instead of
    offering a near-duplicate.
46. **A pick is remembered only when it differs from the first chip** on
    offer; memory rows for MONEY-only picks keep `category_id` null.
47. **SHOP may now save an item without a category** (grey "No category",
    tap to fix); the HOME editor still requires one (item 10).
