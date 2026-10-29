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
   - 9G. Similar-name safety net (decided 26/10, as built)
   - 9H. Pack size per purchase (decided 27–28/10, as built)
   - 9I. Order groups (decided 29/10, as built)
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
- Also in 6D (moved from 9G, decision 7): a name made with "Create new"
  stays linked to what was typed then ("Pumpkin" → "Frozen Pumpkin
  Cubes"), as one of the item's names (aliases), for all devices.
- Pack size (decided 27–28/10, section 9H): every name line under one item
  gets its own pack field ("pcs per box"), exactly as a purchase line does
  since 9H. "Cat Wet Food" is ONE HOME item: different brands are names
  under it, not separate items. Two packages of different sizes on one
  item (e.g. 1 box of 24 and 1 pack of 4 bought together) are solved
  there, as two name lines; until 6D the user types the total in the
  stock unit.

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

**Zidane's answers to the 14 doubt words (25/10, after 026 was run: all 43
checks ok).** Keywords and tests only, no SQL:

1. "bag" alone: no guess.
2. "case" alone: no guess. Phone case, phone cover, custodia / cover
   telefono, cover / casing HP → Durables › Electronics.
3. "cover" alone: no guess.
4. "lenses" / "lenti" alone: no guess.
5. "filter" / "filtro" alone, water filter, filtro / filtri acqua, Brita:
   no guess (a "not this" phrase, never Beverages › Water). The Fontana pet
   filters stay Pet Supplies › Litter & Hygiene.
6. adapter, adaptor, adattatore (presa) → Durables › Electronics (out of
   Batteries & Bulbs).
7. Bulbs (lampu LED, lampadina/e, bohlam, LED bulb, light bulb, lampadina
   LED) → Household Supplies › Batteries & Bulbs. Lamp phrases (lampu meja
   / tidur / belajar, lampada da tavolo / da terra / da scrivania, table /
   desk / floor / bedside lamp) → Durables › Home Decor. "lampu",
   "lampada", "lamp", "Lampada LED" alone: no guess.
8. The mop as a tool (mop, mocio, pel lantai, spazzolone) → Durables ›
   Cleaning Appliances; what wears out (kain pel, panni Swiffer, refill,
   ricarica, ricambio mocio, ricambi) → Cleaning Supplies › Sponges &
   Cloths. "Swiffer", "Vileda" alone: no guess.
9. "figurine", "sleeping mask": no guess.
10. "ear plug", "tappi orecchie": no HOME guess ("Working Ear Plug" is Work
    in MONEY through "working").
11. Party and gift things → Durables › Gifts & Party (balloons, palloncini,
    candeline, birthday candles, flowers, fiori, bunga, carta regalo, gift
    wrap, birthday card, biglietto (di) auguri, kartu ucapan, party, festa,
    and the old list's kertas kado, party supplies, lilin ulang tahun,
    bouquet, mazzo di fiori). Food wins with its own phrase: fiori di zucca
    → Fresh Vegetables, bunga lawang → Spices & Seasonings, party mix /
    party pack → Snacks. None of the 253 live names clashes (only "Fontana
    Water (Pump) Filter" share a word, "filter", and stay Litter & Hygiene).
12. Baby › Feeding (biberon, ciuccio): unchanged.
13. MONEY: "Office" as the whole name ("Office 365" reads "office": numbers
    are dropped), "Microsoft 365", "Microsoft Office" → Subscription ›
    Software & Apps `d9c27fc6-378b-475b-b4e9-097b6e448a27`; "office" next to
    other words ("Office Chair", "office desk") → Work.
14. Family words inside shop or brand names: accepted as they are.

Kept as approved: sapu / ember → Cleaning Appliances, kabel roll →
Electronics, pomade / minyak rambut / gel capelli → Hair Care, calgon /
pulizia / igienizzante lavatrice → Washing Machine Care, "holder" → Home
Decor, "mat" alone → Home Textiles.

Engine changes for this (`lib/categoryGuess.js`): a rule option
`notAlone` (its words count only next to other words: the Work "office");
and unit words ("pack", "pz", "kg"…) now stay in the words a name is READ
by, so "Party pack" is not "Party", while they never count towards the
whole name ("Ace pz" is still the weak "Ace"). `normalizeName` — the key
of a remembered name — is unchanged.

**Decisions 14a and 14b (25/10, second follow-up; code and tests only).**

- 14a. MONEY "Add expense": with Add to HOME on and NO HOME category, the
  budget filled in from the name stays (e.g. "Marlboro" → Cigarettes &
  Vape, on or off); it no longer becomes Uncategorized. With a HOME
  category the mapping decides, as before (purpose words first); a budget
  picked by hand always wins (`lib/moneyPurchase.js` budgetOf).
- 14b. Services and subscriptions lock Add to HOME like durables, with
  their own note "Service ({category}) — expense only, never in HOME
  stock." `SERVICE_MONEY_CATEGORY_IDS` (data/constants.js), next to the
  unchanged durable list: Subscription, Housing & Utilities, Going out,
  Bank & Fee, Savings & Investments, Entertainment (mains), Health ›
  Doctor & Tests / Dentist, Personal Care › Hairdresser, Pets › Veterinary /
  Pet Sitting, and only the four Car / Vehicle subs (Fuel, Maintenance,
  Insurance & Tax, Parking & Tolls) — never the main, so Household
  Supplies › Car Care stays a consumable. Same lock in Order online and
  Arrived.

**For round 7 (Trips).** Family Support and Work are never put into a trip
automatically (like Housing & Utilities, Subscription, Savings &
Investments). A durable bought on a trip stays locked (Add to HOME off, no
1×), whatever budget the trip gives it.

**Next rounds, in this order.**

1. ~~A small "similar name safety net" round: when adding in SHOP or in
   MONEY (Add to HOME on), warn "Similar item in HOME: …" / "Already on
   your SHOP list" and offer to use the existing item, even when its stock
   is high.~~ **Done 26/10 — section 9G.**
2. ~~Small round: pack size per purchase (e.g. 1 box = 40 pcs for this
   purchase only, without changing the item's usual 48).~~ **Done 28/10 —
   section 9H.** (What follows is the report of 26/10, before 9H.) Today (checked
   26/10, see 9G "Follow-up 26/10", step 8): the pack size lives only on
   the HOME item (`pantry_items.packaging_unit` + `quantity_per_pack`, set
   in the HOME editor's multipack fields). Buying in that unit always uses
   it (`toBaseQuantity` / `purchasedQuantity`): Confirm purchase and MONEY
   ask "How many pcs are in 1 …?" only when the unit can't be converted,
   and the answer is then saved on the item (`packSizePatch`) unless the
   item already has another packaging unit (then it counts for that
   purchase only). Order online and Arrived have no pack-size field
   (Arrived: quantity in the item's pack unit or its stock unit). So a
   40-pcs box can only be recorded as "40 pcs" today; a 4-pcs pack as
   "1 pack" + the answer 4 (kept for that purchase, because the item's
   unit is "box") or as "4 pcs". The expense is always the price typed,
   never computed from the pack.
3. Round 6D (section 9D).
4. Later: a "Kids" durable sub under Durables when the household has a
   child (baby bottles, pacifiers… today Baby › Feeding).
5. Later (not scheduled): adding to the SHOP list while offline needs a
   new offline queue; not built.

### 9G. Similar-name safety net (decided 26/10, as built)

Code and tests only: no SQL, no new column, no browser storage. It only
reads what is already on the phone (`pantryStore`, `groceryStore`,
`orderStore`), so it works offline exactly like online, and the same on
all six devices.

**What the code did before (round 9G, step 1).**

- SHOP quick add (`QuickAdd`): suggestions while typing already existed
  (`lib/quickAdd.js` `buildSuggestions` / `matchSuggestions`: names
  starting with the text, then a word starting with it, then containing
  it; from HOME items without variants, SHOP entries and this phone's
  quick-add history). Enter / + added the highlighted suggestion (the
  first one) or, with none, the typed text. The HOME link came from the
  suggestion (exact name, capitals and outer spaces ignored: `normName`).
  An open entry with exactly that name (not one ordered online) got one
  more step at once, toast "… was already on the list — now 2 pcs".
- SHOP More options (`AddItemForm`): `pantryByName.get(normName(name))`,
  exact only, never a group; nothing checked the SHOP list (a second
  entry could be made).
- MONEY "Add expense" (`PurchaseForm`): `moneyPurchase.homeItemFor`,
  exact only (`normName`; a normal item before a group). The SHOP entry
  texts existed and worked (`listEntryFor` / `listEntryNote`): "On your
  SHOP list — it will leave the list." (sent as `list_entry_id` only when
  the line really adds stock and the entry is still to buy; 023 checks
  again), "It's in the cart in SHOP — it stays there.", "It's ordered
  online (on the way) — it stays on the SHOP list." and "On your SHOP list
  — it stays there (Add to HOME is off)." They are kept unchanged.
- HOME add / edit (`ItemEditor`): no name check at all (only the round-9F
  durable-name warning, which stays).
- SHOP Confirm purchase (`purchase.pantryItemFor`): not changed (not in
  this round).

**Matching (`src/lib/similarItems.js`, one path for every screen).**

- `exactKey`: lower case, accents off, punctuation as a space, single
  spaces, every word singular with the keyword list's `singular`
  (`NOT_PLURAL` kept: "glasses"). Numbers and units stay: "Milk 1L" and
  "Milk 500ml" are not exact.
- `countedWords`: the same words without numbers / amounts ("500",
  "1l", "x2"), unit words (the keyword engine's list, exported from
  `lib/categoryGuess.js` as `isUnitWord` / `isAmountWord`: kg, g, gr, mg,
  ml, cl, dl, l, lt, litri, pz, pcs, pezzi, pack, conf, confezione, x, oz…)
  and linking words (di, de, del, della, delle, dei, degli, la, le, il, lo,
  al, alla, e, and, with, con, per, for, of, the, a, yang, dan, untuk,
  dengan, "&", "-").
- `matchKind`: **exact** (same exactKey); **typo** (as many counted words,
  each the same or typo-equal, at least one typo); **words**, the
  half-name rule (every word of the shorter name equal or typo-equal to
  its own word of the longer one, and shorter × 2 ≥ longer). Words are
  paired one to one.
- Typo-equal, item words only (category names keep the round-5 rule):
  4 letters or fewer identical; 5–8 letters at most 1 step
  (Damerau-Levenshtein, `nameDistance` on single words); 9 or more at most
  2. The shorter of the two words decides ("Pear" / "Pearl": no).
- `matchHomeItems(name, items, { exceptId })` → `{ exact, similar }`:
  every pantry item (finished 1× items, groups, variants), never a durable
  (`isDurable`); best class first, then Out / Low first (`stockStatus`; a
  finished 1× item is Out, another 1× item never Low/Out), then fewer
  counted words, shorter name, A–Z; at most 3. An exact match never asks
  (a normal item before a group of the same name).
- `shopEntryFor({ item, name }, entries, { orderedIds })`: the open entry
  (to buy, in the cart, ordered online — never bought) linked to the item,
  or an entry without a HOME item whose name matches (exact, typo or
  words); to buy first, then in the cart, then ordered online. The SHOP
  durable section counts too.
- `moneyPurchase.homeItemFor` now finds the HOME item by exactKey too
  ("cucumbers" → "Cucumber"), after the old exact name. `listEntryFor`
  compares names without a HOME item by exactKey (it was capitals only).

**Order of the checks everywhere.** (1) Durable / service lock first:
SHOP, an entry whose HOME category is in the Durables tree; MONEY, a row
with Add to HOME off or locked → no HOME check, only the SHOP list check
(SHOP). (2) Exact → that item, no question. (3) Similar → ask. (4)
Nothing → as before.

**SHOP quick add and More options** (on + / Enter / "Add to list"):

- Exact → the entry is that HOME item (its name; More options also its
  category unless one was picked by hand). Not on the list → added, toast
  "Added “cucumber” · in HOME: 2 pcs" (`formatStock`; stock 0 "· out of
  stock"; finished 1× "· finished 1× item, it comes back").
- Similar → nothing is saved. Under the name: "Similar item in HOME:", up
  to 3 buttons "Use Fresh Pumpkin · 2 pcs at home" ("· out of stock",
  "· finished 1× item, it comes back"; on the list "· already to buy",
  "· already in the cart", "· ordered online") and "Create new “Pumpkin”".
  "Use …" = exact for that item. "Create new" keeps the field editable
  with "Similar names can mix up later — make it clearer, e.g. “Frozen
  Pumpkin Cubes”."; the next press adds the name as it is; a changed name
  is checked again. Typing closes an open question.
- On the list already → no second entry: "Already on your SHOP list: Dish
  soap — in the cart" (or "— to buy" / "— ordered online") with "OK"
  (nothing changes) and "Add 1 more (now 2 pcs)" (to buy / in the cart;
  the to-buy or in-cart entry when there are several; More options adds
  the quantity typed when it is in the entry's unit or converts —
  `convertQuantity`, with the HOME item's pack — e.g. "Add 3 more (now 4
  pcs)") or, ordered online, "Add anyway" (a new entry to buy).
- Groups (until 6D): "Use" on a variant → that variant's entry; "Use" on
  the group → exactly as when its name is typed by hand (quick add links
  the group as before; More options doesn't link it, as before).
- The question scrolls into view once (the button may be lower down).

**MONEY "Add expense"** (rows with Add to HOME on and not locked):

- `moneyPurchase.similarAsk`: the question shows when typing pauses
  (`hooks/useTypingPause.js`, the same 400 ms as `useLastPrice`) and
  always after Save; Save is blocked while a row has one, the row is
  highlighted and says "Choose “Use …” or “Create new” for this item."
  (also next to Save).
- Exact → the row is that item (as before) and says "In HOME: 2 pcs".
  "Use …" → the row's name becomes the HOME item's name (unit, category,
  group variant as for a typed HOME name). "Create new" → hint;
  `row.similarAnswer` keeps the answered name (its exactKey), so a changed
  name asks again.
- SHOP entry texts: unchanged (found working, see above).

**HOME add / edit** (`ItemEditor` with `homeItems`, from `PantryPage`;
the Arrived dialog's editor passes none, unchanged):

- Exact → not saved: "“cucumber” is already in HOME" + "Go to cucumber"
  ("Go to Balloons (finished 1×)").
- Similar → not saved: "Similar item in HOME:" + up to 3 "Go to Fresh
  Pumpkin" + "Create new “Pumpkin”" (same hint; a changed name asks
  again).
- "Go to …" closes the form without saving anything (a stock typed there
  is not used) and opens the existing item's editor (`key` per item).
- An edited item is checked only when its name changes (exactKey), and
  never against itself.

**Not built: decision 7** ("Create new" names offered again for the text
typed then). It needs a record kept for all devices ("Pumpkin" →
"Frozen Pumpkin Cubes"): there is no table for it (no SQL / column
allowed), browser storage is excluded, `category_memory` would change the
category suggestions and `household_settings` is a settings table with no
store in the app. In SHOP the new item doesn't even exist in HOME yet
when "Create new" is pressed. Best done with the aliases of round 6D —
moved there on 26/10 (see the follow-up below).

**Deviations / open points** (open questions in the round summary):
quick add with nothing alike still adds the first suggestion under the box
("mil" → Milk, but also "Chicken" → Chicken Feet Snack), as before; "Add 1
more" on a gr / ml / kg / L entry adds one step of the + button (100 gr,
100 ml, 0.5 kg, 0.5 L: "Add 100 more (now 600 gr)"); MONEY counts an entry
without a HOME item only by the same name (it may be closed), SHOP also by
a similar one; the quick-add suggestion label "on list · +1" is now "on
list" (tapping asks).

**Analysis of the 253 live names (25/10).** Single words that still match
more than 3 items: frozen (5: Frozen Shrimp, Broccoli, Cauliflower,
Mushroom, Pumpkin), hair (4: hair oil, hair water, Hair Conditioner, Hair
Gel), powder (4: Electrolytes, Garlic, Onion, Turmeric Powder), sauce (7:
BBQ, Fajita, Fish, Oyster, Soy, Teriyaki, Tomato Sauce). Pairs of HOME
names that match each other (all "words"): Duck Eggs / Eggs, Milk /
coconut milk, Chicken Sausage / Frozen Chinese Chicken Sausage, Soy Sauce
/ Sweet Soy Sauce, Fontana Water Filter / Fontana Water Pump Filter. No
exact or typo pairs.

**Tests:** 1570 → 1615 (91 → 93 files). New `lib/similarItems.test.js`
(every case of the brief, ordering, finished 1×, groups, durables, the SHOP
entry rule, texts, "Add … more", the whole fixture) and
`components/similarItems.render.test.jsx` (quick add: similar, Use, Create
new, exact, finished 1×, in the cart OK / Add 1 more, ordered Add anyway,
durable, nothing alike; More options: similar, Add 3 more, durable; MONEY:
pause, Save blocked, Create new, Use, exact note, check 2 texts, Add to
HOME off; HOME: exact + Go to, finished 1×, similar + Create new, rename).

### Follow-up 26/10 (as built)

Code and tests only (no SQL, no new column, no browser storage). The
changes 1–7 decided after testing 9G:

1. **SHOP list: one button "+ Add to SHOP list".** The quick-add box and
   "More options" are gone from the List view (`GroceryPage`); the button
   opens the form that "More options" opened (`AddItemForm`), titled "Add
   to SHOP list", unchanged otherwise (name, category chips, category and
   sub-category, price per unit / total, unit, 1×, Paid by). **Shop mode
   keeps its quick-add box** (`QuickAdd`, the only other place it was
   used; HOME never had it), with its suggestions and this phone's
   quick-add history as before; its "More options" still opens the form,
   which is shown in the List view (as before). Offline: the form saves
   exactly as quick add did — both call `addItem`, which refuses offline
   with the usual toast (nothing is queued; only cart, quantity and stock
   changes are, `lib/offlineActions.js`). No code became completely unused
   apart from "Add … more" (below).
2. **Name suggestions in the form**, under the name while typing
   (`components/grocery/NameSuggestions.jsx`, shared with quick add; list
   logic `lib/quickAdd.js` `buildSuggestions` / `matchSuggestions`: starts
   with, a word starts with, contains). Sources: every HOME item (variants
   and groups too; never a durable) and the open SHOP cards (to buy, in
   the cart, ordered online) — not this phone's history (left stored, not
   read by the form). Tapping one fills the name as if typed (category,
   unit and last price as the form already fills them) and hides the
   list. Never picked by itself: Enter / "Save" use the name as typed.
3. **"Save" and "Save & add another".** Both run the same safety-net
   questions. When a question ends — saved, or "OK" with nothing saved —
   "Save" closes the form and "Save & add another" keeps it open with
   every field emptied (unit back to pcs) except "Paid by". "Go to card"
   always closes it.
4. **"Already on your SHOP list"** (check 2): "Add 1 more / Add N more
   (now …)" is removed with its logic (`similarItems.addMore`, QuickAdd's
   `updatePricing` / `totalFor`, AddItemForm's `onAddMore`) and tests. To
   buy / in the cart: "Already on your SHOP list: Dish soap — to buy" (or
   "— in the cart"), "Change the quantity or price on its card.", "OK"
   (nothing changes) and "Go to card": the form closes without saving
   (what was typed is not used); the list scrolls to the card and outlines
   it for 3.5 s (`data-spot`, the OrdersSection pattern) — also in the
   cart, and the group's card for a variant; a search or category filter
   that hides it is cleared first. In Shop mode the same, on the Shop-mode
   card (arranging stops). Ordered online: "OK" and "Add anyway" — a new
   card to buy with what the form says (quantity, unit, price, category,
   1×, Paid by; the name is the HOME item's when one is linked, as every
   save). With several open cards the preferred one (to buy, then in the
   cart, then ordered — `shopEntryFor`) is named and shown.
5. **More than 3 similar items** (`matchHomeItems` now also gives `more`):
   under the 3 buttons "4 more — type more of the name" (the number not
   shown), in the SHOP form, quick add, the MONEY row
   (`moneyPurchase.similarAsk` → `{ similar, more }`) and the HOME editor.
6. **MONEY: a similar SHOP card without a HOME item**
   (`moneyPurchase.similarListEntry`): a row with Add to HOME on and not
   locked, and an open card (to buy, in the cart, ordered online) with no
   HOME item whose name is similar but not exact (typo or half-name) →
   "Similar on your SHOP list: Pumpkin — it stays there." The card is
   never closed or changed (`list_entry_id` still only for the exact name,
   `listEntryFor`).
7. **Confirmed, nothing to fix:** the safety net searches groups and
   variants (all three screens pass every HOME item: `usePantryItems` /
   `withGroupTotals`); check 1 is skipped for a durable SHOP category
   (`isDurable`) and for a MONEY row that is locked or off (`similarAsk`
   needs `line.home`), and check 2 still runs for them (SHOP:
   `listCheck`; MONEY: `listEntryFor` + `listEntryNote`, "On your SHOP
   list — it stays there (Add to HOME is off)."). New tests prove both.

**Decision 7** ("Create new" names offered again for what was typed)
moved to round 6D: it is the aliases' job (section 9D).

**Step 8, pack size today (report only).**

- *Where it is stored:* only on the HOME item —
  `pantry_items.packaging_unit` + `quantity_per_pack` (null = none).
  What was bought is kept per line (`grocery_items.quantity` / `unit`,
  `shopping_trip_items.quantity` / `unit` / `stock_added`,
  `orders.quantity` / `unit`); the item's pack before a purchase is in
  `shopping_trip_items.pantry_before` (Reopen puts it back).
- *Where it is set:* HOME editor (`ItemEditor`, multipack: "pcs per box",
  quick chips); Confirm purchase and MONEY "Add expense" only by the
  inline question "How many pcs are in 1 pack?", shown only when the unit
  can't be converted (`purchaseLine.needsPackSize`, `rowLine` /
  `rowProblem`). The SHOP form, Order online (`orderUnits`: the entry's
  unit, the item's pack unit, its stock unit) and Arrived
  (`LinkedArrivedDialog` → `RestockForm`: pack unit × stored size, or the
  stock unit) never set it.
- *Stock:* `purchasedQuantity(pantry, line, packSize)` = `toBaseQuantity`
  (same unit → as is; the item's pack unit → × `quantity_per_pack`; kg ↔
  gr…) else × the answer; sent as `add`; `confirm_shopping_trip` adds it
  to `current_stock`, writes one `stock_logs` row (change = add, stock
  unit, reason 'purchased') and the line keeps quantity/unit as bought +
  `stock_added`. Arrived: `arrive_order(add_qty)` the same way. The
  expense is `line_total` (the price typed, after discounts; an order's
  expense was made when ordering) — never computed from the pack. The
  item's last price becomes the entry's price per its price unit.
- *One purchase only:* not possible in the item's own pack unit (the
  stored size is always used, no question). The question's answer is
  saved on the item (`packSizePatch`) when the item has no packaging unit
  or the same one; it is used for that purchase only when the item already
  has another packaging unit, or the unit is kg / gr / ml / L.

| Cat wet food (stock pcs, usually 1 box = 48 pcs) | What to type today | Stock added | Item's 48 |
|---|---|---|---|
| 1 box = 48 pcs | 1 box | 48 pcs (stored size, no question) | kept |
| 1 box = 40 pcs | 40 pcs (SHOP card, Confirm, MONEY row or Arrived) — "1 box" would add 48 | 40 pcs | kept |
| 1 pack = 4 pcs | 1 pack + answer 4 to "How many pcs are in 1 pack?" (Confirm / MONEY), or 4 pcs; Arrived: 4 pcs | 4 pcs | kept (pack ≠ box) |

**Tests:** 1615 → 1634 (93 → 94 files). Removed: the "Add … more" unit
test and the two "Add 1 more" / "Add 3 more" render tests. New / changed:
`pages/shopAdd.render.test.jsx` (the button and the form "Add to SHOP
list", no quick add on the list, Go to card in the cart and for a group
variant, a filter cleared, Shop mode keeps quick add and its Go to card);
`components/similarItems.render.test.jsx` (suggestions from HOME / SHOP
not history, never auto-picked, a tapped suggestion, Save & add another
keeps only Paid by, OK after both buttons, Go to card, Add anyway with
the typed quantity, "2 more — type more of the name" in SHOP, MONEY and
HOME, MONEY "Similar on your SHOP list", check 2 for a durable and a
locked row); `lib/similarItems.test.js` (`more`, the new texts); the
"Add to list" button is "Save" in the older form tests.

### iPhone checklist for the 26/10 follow-up

1. SHOP → List: no "Add an item…" box, no "More options"; "+ Add to SHOP
   list" opens "Add to SHOP list".
2. Type "pum" → HOME and SHOP names under the field; tap one → the name,
   category and unit fill in. Type "mil" and press Save → saved as "mil".
3. "Save & add another" → saved; the form stays, empty, Paid by kept.
4. An item in the cart → "Already on your SHOP list: … — in the cart" →
   "Go to card" → the form closes, the card is outlined.
5. An item ordered online → "Add anyway" → a new card with the quantity
   typed.
6. "Sauce" (or "Frozen") → 3 buttons and "… more — type more of the name".
7. MONEY → Add expense → a name like a SHOP card typed by hand (not in
   HOME) → "Similar on your SHOP list: … — it stays there."; after saving
   the card is still on the list.
8. Shop mode: the quick-add box is still there. (Changed 27/10: Shop mode
   has "+ Add to SHOP list" too, see below.)
9. 375 px: no sideways scroll; both Save buttons fit.

### Follow-up 27/10 (as built)

Code and tests only (no SQL, no new column, no browser storage).

1. **Shop mode: the same "+ Add to SHOP list"; quick add removed
   everywhere.** Shop mode's quick-add box and its "More options" are
   gone. In their place, above the Shop-mode cards, the same button "+ Add
   to SHOP list" opens the same form (`AddItemForm`, title "Add to SHOP
   list"), shown in Shop mode itself — no switch to the List view
   (`GroceryPage` builds the button and form once, `addSection`, and shows
   it in both views). Everything works as on the List view: the name
   suggestions (HOME items with group variants and groups, open SHOP
   cards; never picked by themselves), the whole safety net (exact match,
   "Similar item in HOME:", "Create new “…”" with its hint, "… more — type
   more of the name", "Already on your SHOP list: …" with "Change the
   quantity or price on its card.", "OK" / "Go to card", "Add anyway" for
   ordered online), "Save" and "Save & add another" (the form stays open,
   every field emptied except "Paid by"). "Go to card" in Shop mode closes
   the form without saving, scrolls to the Shop-mode card and outlines it
   for 3.5 s (a group variant: the group's card; arranging stops; a search
   that hides it is cleared). Checked: every card "Go to card" can name (to
   buy or in the cart, durables too) is shown in Shop mode, so there is no
   case without a card. Deleted: `components/grocery/QuickAdd.jsx` and its
   tests (`quickAdd.render.test.jsx`, the quick-add block of
   `similarItems.render.test.jsx`, the quick-add render test in
   `grocery.render.test.jsx`); the per-phone history (`readHistory`,
   `rememberAdded`, the history source of `buildSuggestions`) — the key
   `nutrihub-quick-add-history` already stored on the phones is left alone
   and never read or written again; `NameSuggestions` lost the arrow-key
   props only quick add used. `lib/quickAdd.js` (+ test) is now
   `lib/nameSuggestions.js` (`suggestionFrom`, `buildSuggestions`,
   `matchSuggestions`), used by the form only. Offline: as on the List
   view — `addItem` refuses with the usual toast; nothing is queued.
2. **A toast after every successful save** ("Save", "Save & add another",
   "Add anyway"; List view and Shop mode): a HOME item (linked, or a group
   used with "Use …", as before) → "Added “cucumber” · in HOME: 2 pcs" (or
   "· out of stock" / "· finished 1× item, it comes back",
   `similarItems.addedMessage`); a new name not in HOME → "Added “Napkins”"
   (`similarItems.addedNameMessage`). No toast for "OK" or "Go to card"
   (nothing is saved); no new Undo (adding never had one). On a failed save
   only the error toast shows and the form keeps what was typed.

**Tests:** 1634 → 1634 (94 → 93 files: `quickAdd.render.test.jsx` deleted;
15 quick-add tests removed, 15 new). `pages/shopAdd.render.test.jsx`: Shop
mode has no quick-add box and no "More options", the button opens the form
in Shop mode, "Similar item in HOME:" + "Use …" with its toast, "Create new"
hint, "Save & add another" with "Added “Napkins”", "OK" without a toast,
"Go to card" for a card in the cart and a group variant, a search cleared.
`components/similarItems.render.test.jsx` (form): "Create new" (a changed
name asks again, the same name saves as typed), exact name, finished 1×, a
similar item already on the list, the toast texts after "Save", "Save & add
another" (linked and new) and "Add anyway", no toast after "OK" or "Go to
card". `lib/similarItems.test.js`: `addedNameMessage`.

### iPhone checklist for the 27/10 follow-up

1. SHOP → Shop: no "Add an item…" box, no "More options"; "+ Add to SHOP
   list" opens "Add to SHOP list" and you stay in Shop mode.
2. In Shop mode type "Pumkin" → "Similar item in HOME:"; "Use …" → toast
   "Added “…” · in HOME: …".
3. In Shop mode an item in the cart → "Go to card" → the form closes, the
   Shop-mode card is outlined.
4. A new name (e.g. "Napkins") → "Save" → toast "Added “Napkins”"; "Save &
   add another" → the same toast, the form stays open.
5. "OK" → no toast.
6. 375 px: no sideways scroll in Shop mode with the form open.

### iPhone checklist for round 9G

1. SHOP quick add "Pumkin" (with Fresh/Frozen Pumpkin in HOME) → "Similar
   item in HOME:" and the buttons; nothing added. "Use …" → added with the
   HOME name and "in HOME: …".
2. Again, "Create new “Pumkin”" → the hint; change the name to "Frozen
   Pumpkin Cubes" → + → added.
3. Quick add an item that is in the cart → "Already on your SHOP list: … —
   in the cart"; "Add 1 more (now 2 pcs)" → its quantity is 2.
4. More options → a similar name → asked; an item to buy with quantity 3
   → "Add 3 more (now …)".
5. MONEY → Add expense → "Pumkin", price → the question after a moment;
   Save → "Choose “Use …” or “Create new” for this item."; answer → saved.
6. MONEY → an item in HOME → "In HOME: 2 pcs"; on the list → "On your SHOP
   list — it will leave the list."
7. HOME → Add item "cucumber" (exists) → "“cucumber” is already in HOME" →
   "Go to cucumber" opens it; nothing new in HOME.
8. HOME → edit an item, rename it to an existing name → refused.
9. Airplane mode: the same questions appear.
10. 375 px: no sideways scroll; long names wrap in the buttons.

### 9H. Pack size per purchase (decided 27–28/10, as built)

Round of 9F "Next rounds" item 2 (and 9G "Follow-up 26/10", step 8). One
SQL file, `supabase/027_order_pack_size.sql` (not run yet; Irene runs it
after review). The app is deployed before it and works before and after.
No new browser storage, no new offline queue, no database function
changed.

**The goal.** For EVERY item bought in a package (box, pack, case…), the
number of stock units in 1 package can differ per purchase (an emergency
store, an offer, another brand). The user types it for THIS purchase only
(any positive number, comma or dot, `parseDecimal`) without changing the
item's usual size — except the first time. "Usual size" = `pantry_items.
packaging_unit` + `quantity_per_pack` (the HOME editor's multipack fields,
the only place where it is changed). "Pack field" = the new per-purchase
field.

**Checked first (27–28/10, nothing changed there).**

- Purchases need no SQL: `confirm_shopping_trip` (023) writes
  `packaging_unit` / `quantity_per_pack` only when the line sends them
  (`coalesce`), so the first-time rule lives in the app
  (`packSize.firstTimePatch`, which replaces `purchase.packSizePatch`;
  that one could overwrite a usual size). Reopen / Undo purchase / the
  Undo toast remove exactly `stock_added` and put the usual size back
  from `pantry_before` (tested again, block "027").
- A new HOME item made by a purchase takes the line's unit as its stock
  unit, so it never gets the field.
- Orders: `arrive_order` adds the stock the app sends (already the pack
  field × quantity); "Put back on the way" (`unarrive_order`) removes
  exactly `stock_added`. Neither needs a change.
- The gap: "Put back on the way" could not undo a first-time save of an
  Arrived, because nothing kept the item's usual size from before. **Zidane
  chose solution A**: a second nullable column on orders,
  `arrival_pack_before`, like `pantry_before` on purchase lines. Why: the
  undo stays exact and local to the order, without changing a database
  function (B — a function doing arrive + save in one step — would have
  needed a new or replaced function; C — never saving at Arrived — breaks
  the first-time rule for things that are only ever ordered).

**Where the field is** (`components/ui/PackSizeField.jsx`, one component):
SHOP Confirm purchase (every line that adds stock, group variant lines
too), MONEY "Add expense" rows with Add to HOME on and not locked, the
order form (SHOP "Order online" and MONEY Orders, creating and editing,
only for an order linked to a HOME item and not durable / service), and
Arrived (`LinkedArrivedDialog` → `RestockForm` with `packs`, and
`ArrivedDialog` for orders not linked to HOME; `GroceryPage.arrive` and
`OrdersSection.arrive` only open these). Not in "Add to SHOP list", not in
HOME's own restock (+ / `RestockForm` without `packs`), never for durable
or service rows and orders (durable Arrived still has no dialog, 9F). It
replaces the old inline question "How many pcs are in 1 pack?" in Confirm
and MONEY: one way everywhere.

**When** (`packSize.hasPackField`): the line's unit is not the item's stock
unit and does not convert by measure (kg ↔ gr, L ↔ ml). Same-unit and
measure-convertible lines never get it; a line without a HOME item neither.

**Start value** (`packStartText`, `packTextFor`): the line's unit is the
item's `packaging_unit` and `quantity_per_pack` is set → that number,
editable; otherwise empty. What was typed is kept for the unit it was typed
for: another unit starts the field again. Required (saving blocked, as the
other row problems) everywhere except Order online. Arrived starts with
the order's own `pack_size` (for the order's unit), else the usual-size
rule; required. `RestockForm` (Arrived) also offers the order's unit when
it is such a package (e.g. ordered "1 pack" of an item usually bought by
the box, or a box with no usual size yet).

**Texts** ({s} = the item's stock unit, {u} = the line's unit):

| When | Text |
|---|---|
| Field label | "{s} per {u}" ("pcs per box") |
| Under it, with a value | "= {total} {s}" ("= 60 pcs" for 2 box × 30) |
| Value differs from the usual size | "This purchase only — usual: {usual} {s} per {u}." |
| Empty and required | "Type how many {s} are in 1 {u}." (also the MONEY row problem next to Save) |
| Order online, empty | "You can fill this in when it arrives." |
| First-time save, before saving | "It will be saved as the usual size for next time." |

**Stock, money, usual size.**

- Stock added = quantity × pack field, in the stock unit
  (`purchase.purchasedQuantity`, used by Confirm and MONEY; `RestockForm`
  for Arrived). The expense is always the typed price (`line_total`, the
  order's price); discounts, coupons and "Last price" unchanged.
- First-time rule (`packSize.savesUsualSize`): saved as the usual size only
  while the item has none — `packaging_unit` and `quantity_per_pack` both
  empty, or `packaging_unit` = this unit and no size. Never over an
  existing usual size, never on an item whose packaging unit is another
  unit, never for a measure unit. Saved when stock is really added
  (Confirm, MONEY save, Arrived), never at Order online. A line that
  counts with an old group-level entry (group) never saves one on the
  variant (`canSave` only when the item restocked is the item itself).
- Arrived (`useOrders.rememberArrivalPack`, after `arrive_order` added the
  stock): the order keeps the value (`pack_size`); a first-time save writes
  `arrival_pack_before = { packaging_unit, quantity_per_pack, saved: {
  packaging_unit, quantity_per_pack } }` (what the item had, and what this
  arrival wrote), then the item, guarded (`quantity_per_pack is null` and
  the same `packaging_unit` as before); if that guard finds the item
  already has a usual size, `arrival_pack_before` is emptied again. Only
  for an item (not a group) and only when the order shows the 027 columns
  (`orders.packColumnsReady`: every order is read with all its columns).
  A failure here is a follow-up toast with Retry; the arrival stays.

**Undo is exact.** Reopen purchase / Undo purchase / the MONEY Undo toast:
exactly `stock_added`, usual size from `pantry_before` (unchanged, tested).
"Put back on the way" (`useOrders.unarriveOrder` → `restoreArrivalPack`):
`unarrive_order` removes exactly `stock_added`; then, when that arrival
saved a first-time size, the item gets back the values in
`arrival_pack_before` — only while it still has exactly `saved` (changed
meanwhile, e.g. in the HOME editor: left as it is) — and
`arrival_pack_before` is emptied. `pack_size` stays (the next Arrived
starts with it); a later Arrived follows the first-time rule again.
Orders not linked to HOME (`ArrivedDialog`) still have no Arrived undo, so
they never save a usual size.

**Before 027 is run.** Saving or editing an order with a pack size: the
database answers PGRST204 / 42703 for the column (`orders.
missingPackColumn`), the row is written again without it
(`useOrders.writeOrderRow`), no error toast. Arrived: the right stock, no
first-time save (no `arrival_pack_before` to undo it with), nothing else
written.

**History.** HOME stock history unchanged ("+30 pcs"). MONEY opened
purchase row and Receipts, for a line bought in packages
(`packSize.purchasedPackLabel`, from `shopping_trip_items.quantity` /
`unit` / `stock_added` and the HOME item's stock unit): "1 box · 30 pcs",
"2 box · 30 pcs each · 60 pcs"; an old line (no quantity, no stock added)
or a deleted HOME item shows as before. Order cards (MONEY Orders card,
SHOP "On the way") with a pack size: "1 box · 24 pcs" (same format,
`orderPackLabel`).

**Not changed.** Two packages of different sizes on ONE card: the user
types the total in the stock unit (round 6D solves it with name lines).
Offline: unchanged (no new queue). Safety net, durable lock, categories:
unchanged.

**SQL `supabase/027_order_pack_size.sql`.** Only `alter table orders add
column if not exists pack_size numeric check (pack_size > 0)` and `…
arrival_pack_before jsonb`; safe to run twice; no function, policy, grant
or data change, nothing for anon. Ends with one check SELECT (3 rows: the
two columns and the check, each "ok").

**Files.** New: `src/lib/packSize.js` (+ test), `src/components/ui/
PackSizeField.jsx`. Changed: `lib/purchase.js` (`purchasedQuantity`,
`purchaseLine.pack`, `confirmationPayload`; `packSizePatch` removed),
`lib/moneyPurchase.js` (`emptyRow.packUnit`, `rowLine.pack`,
`rowProblem`, payload), `lib/orders.js` (`missingPackColumn`,
`withoutPackColumns`, `packColumnsReady`), `hooks/useOrders.js`
(`orderRowFrom.pack_size`, `writeOrderRow`, `arriveLinkedOrder`,
`rememberArrivalPack`, `unarriveOrder`, `restoreArrivalPack`),
`grocery/ConfirmPurchase.jsx`, `expenses/PurchaseForm.jsx`,
`expenses/OrderForm.jsx` (`packItem`), `grocery/OrderOnlineDialog.jsx`,
`expenses/OrdersSection.jsx`, `inventory/RestockForm.jsx` (`packs`,
`canSaveUsual`), `expenses/LinkedArrivedDialog.jsx`,
`expenses/ArrivedDialog.jsx`, `expenses/ExpenseGroup.jsx` (`itemOf`),
`pages/ExpensesPage.jsx`, `grocery/ReceiptsView.jsx`,
`expenses/OrderCard.jsx`, `grocery/OnTheWay.jsx`.

**Open (asked in the round summary, not decided here).** (1) A line in
pcs or in a measure unit for an item whose stock unit can't take it (an
item in gr bought "2 pcs", an item in pcs bought "1 kg") had the old
question; it now gets the same pack field so it can still be saved (a
measure unit is never saved as the usual size; "pcs" for a gr item may be,
as the HOME editor allows it). (2) Groups: counted with the group's size,
never a first-time save (until 6D).

**Tests:** 1634 → 1714 (93 → 98 files). New `lib/packSize.test.js` (the
rules, every text, labels, Confirm and MONEY payloads: box 48 typed 30,
2 × 30, no usual size typed 12 then prefilled 12, usual box bought 1 pack
typed 5, pcs / kg / durable / new item → no field, groups, order rows and
the missing column), `hooks/orderPackSave.test.js` (order save and edit
before and after 027, Arrived with and without a first-time save, the
guard, groups, before 027; "Put back on the way" restore, "box" without a
size, nothing saved, before 027), `components/packSize.render.test.jsx`
(Confirm, MONEY, the order form creating and editing, Arrived: empty →
required → 20; 24 → 22; an old order; before 027; pcs; ArrivedDialog),
`components/packSizeUndo.render.test.jsx` ("Back on the way" on the
Orders card: −12 and usual empty again; usual changed to 15 → stays 15;
nothing saved; the card labels), `components/packSizeHistory.render.test.jsx`
(MONEY purchase row, deleted item, Receipts) and `supabase/migrations.test.js`
block "027" (only two columns, before 027, run twice with every check ok,
the check constraint, MONEY purchases with the app's own payloads and
Undo: +30 / +60 with usual 48, +12 saved then undone, 2 pack × 5 = +10;
Arrived / unarrive with the app's guarded writes: −12 and usual empty
again, usual changed to 15 kept, 2 × 30 = +60 −60). Changed: the old pack
question in `purchase.test.js`, `moneyPurchase.test.js`,
`grocery.render.test.jsx`.

### iPhone checklist for round 9H

1. SHOP → Confirm purchase with Cat Wet Food (usual box 48) "1 box":
   "pcs per box" shows 48; type 30 → "= 30 pcs" and "This purchase only —
   usual: 48 pcs per box."; Confirm → HOME +30, the usual size is still 48.
2. An item with no usual size bought "1 box": empty field, "Type how many
   pcs are in 1 box.", Confirm locked; type 12 → "It will be saved as the
   usual size for next time."; next purchase starts at 12.
3. MONEY → Add expense, the same two cases; Undo in the toast → stock back.
4. SHOP → Order online in box: field may stay empty ("You can fill this in
   when it arrives."); Arrived asks it; type 20 → +20.
5. Order online 24 → Arrived starts at 24; change to 22 → +22. The cards
   say "1 box · 24 pcs".
6. (After 027) an item with no usual size: Arrived 1 box typed 12 → usual
   box 12; "Back on the way" → −12, usual empty again.
7. MONEY → open a purchase bought in packages: "2 box · 30 pcs each · 60
   pcs"; Receipts the same.
8. 375 px: no sideways scroll with the field open.

### 9I. Order groups (decided 29/10, as built)

Analysis: `tmp-export/amazon-readonly-report.md` (29/10, read only). Zidane
chose option B on option A's data model, with decisions K1–K9 below; where
they differ from the report, they win. SQL: `supabase/028_order_groups.sql`
(not run yet; Irene runs it after Claude has checked it). The app is
deployed before 028 and works before and after it. No new browser storage
(the group table is not kept on the phone; the orders, which already are,
carry what the cards show), no new offline queue, no existing database
function changed.

**The idea.** Online orders stay ONE order per item (Money → Orders → "Add
order", Shop → "Order online"), exactly as before. Several orders of the
same store, order date and payer can form ONE "order group", and a group
can have ONE discount for the whole order (Amazon's "Promotion Applied
−€3.23"), spread over its orders. Purchases ("Confirm purchase", "Add
expense" with "Purchase discount") are unchanged.

**Data (028).** New table `order_groups` (`id, shop_id → shops, order_date,
paid_by, discount_kind ('percent' | 'amount' | null), discount_value,
discount_total (€, default 0), created_at`; check `order_groups_discount_ok`
= the rule of `orders_discount_ok`; RLS on, one policy `household_only`,
nothing for anon, realtime on). `orders.group_id → order_groups` (on delete
set null; index `orders_group_id_idx`), `orders.group_share numeric not null
default 0 check (>= 0)`. `orders.price` stays what is really paid (= the
expense); the order's **base** = its price before the group discount =
`price + group_share`; its own discount (`list_price`, `discount_kind/value`)
works as before and comes first (K8). Store `orderGroupStore`
(`lib/stores.js`, optional, not persisted).

**`save_order_group(payload)`** (new, `search_path = public`, household
check 42501, closed to anon/public, all or nothing). The app sends the whole
state it wants (`lib/orderGroups.js` `groupPayload` / `undoGroupPayload`):

```js
{ id,                                   // the group (made by the app)
  shop_id, order_date, paid_by,         // the group's; every order in it takes them
  discount_kind, discount_value, discount_total,
  orders:  [{ id, base, share, was: { price, group_share, group_id } }],  // in the group afterwards
  leaving: [{ id, base, was }],         // out of it afterwards (share 0, price = base)
  undo, created_at }                    // an Undo may make a group of one again
```

It refuses (nothing written) when: an order changed meanwhile (`was` is
not what the database has: "\"X\" changed meanwhile (on the other phone?) —
open Orders again. Nothing was changed."), an order was deleted, the group
has orders the request doesn't name, an order is in another group, a
joining order has another store / date / payer, no store ("Set the store on
the order first."), a new group of fewer than 2 (unless Undo), a share below
0 or above its base, the shares don't add up to `discount_total`, the total
doesn't match what was typed (amount: ≤ the value and ≤ the bases; percent:
within 1 cent of the percent of the bases), a percent above 100. Then it
writes the group row (or deletes it when no orders are left), every order's
`group_id / group_share / price` (and store, date, payer for orders in the
group), and each order's expense: the amount only while it still equals the
order's previous price (else it is left and returned in `kept`, and the app
says "\"X\": its expense was changed by hand (€20.00), so it was left as it
is."); for orders in the group also `expense_date / shop_id / paid_by` when
the order's own changed. An order whose expense was deleted just keeps its
share. Sent again when everything is already as asked: nothing is written,
the same answer comes back (idempotent). → `{ group, orders, expenses,
kept }`.

**Rules as built.**

- K1 Spread with `spreadCoupon` (the purchase coupon's rule) over the
  orders' bases, in the order they were saved (`created_at`, then `id`):
  rounded to cents, leftover cents on the order saved last (or the one
  before if it can't take them). % 0–100; € bigger than the bases → capped.
- K2 New order (Money "Add order" and Shop "Order online"), with a store:
  every group and every single order (no group, any status) of the same
  store, order date and payer is offered as a tick box "Same order as:
  {up to 3 names, then +N more} ({store} · {dd/mm})" — ticked when it is
  the only one; several: none ticked (only one can be ticked). Changing
  store, date or payer redoes the offer. No store, or before 028: none.
  Saving with it ticked (`createOrder` → `joinWith`): the expense and the
  order are saved, then the order joins (a single order: a new group of
  the two, id made once per form) in one more step; if the join is
  refused, the new order and its expense are undone and the form keeps
  what was typed. A group with a discount: "The order discount will be
  spread again over N items." before saving.
- K3 Shares are recomputed only when: the discount is typed/changed
  ("Save" in the sheet), a member's price or own discount is edited (Edit
  order → `editGroupMember`: the order's own fields first, then
  `save_order_group` with the new base; Undo of the first step if it is
  refused), an order joins or leaves. Always over ALL orders of the group,
  cancelled and returned ones too, so Cancel / Return never moves anything.
- K4 Cancel / Return of a member: unchanged. "Delete the expense" deletes
  its expense (its paid price after the share, e.g. €8.25); the other
  orders and expenses never change; Undo as before. The group keeps showing
  the discount given and the total of the expenses still there.
- K5 Deleting a member (`removeGroupMember`): it first leaves the group
  (share 0, price and expense back to its base, the discount spread again
  over the rest; the last one out removes the group), then the order (and
  its expense if asked) is deleted. The delete dialog adds "It leaves its
  order group: its part of the order discount (€0.24) is spread again over
  the other orders." Undo: expense, order, then every share exactly
  (`undoGroupPayload`). "Take out of the group" (sheet) does the same
  without deleting, with its own Undo.
- K6 "Ungroup": every share 0, every price and expense back to its base
  (same guard), group row deleted; Undo makes the same group again.
- K7 Edit order of a member: store, order date and payer are shown
  read-only with "Store, date and payer are set on the order group."; they
  are changed in the sheet, for all members and their expenses, in one
  transaction.
- K8 Own discount first, then the share: the line reads "€80.00 → €56.00
  (−30%) · order discount −€1.20 → €54.80" (`orders.orderPriceNote`);
  without an own discount "€10.99 → €10.68 (order discount −€0.31)".
- K9 Money → Expenses: the expenses of a group are ONE row
  (`PurchaseGroup` with the group's icon): "{store} · {date}", one dot per
  main category, "{N} items", the total of its existing expenses, "(order
  discount −€3.23)" under it (= the sum of all members' shares). Opened:
  by main category with subtotals; each item with its sub-category, amount,
  edit / delete, and its line (hidden when the expense was edited by hand);
  "Open the order group". Category filter: only that part, "of total €…".
  The same in the three "Sort by" views (`bundleTrips(entries,
  orderGroupOf)`, a `TripRow` with the group's note). Charts, totals,
  filters, Select (no tick box for order expenses), "Apply the mapping to
  past purchases…" and Receipts: unchanged.

**Where (final labels).**

- Money → Orders: "Group orders" (left of "Add order"; only after 028).
  It opens History and puts a tick box on every card (on the way and in
  History). The card "Group orders" says how many are ticked and offers
  "Group as one order" (a new group; its sheet then opens to type the
  discount) or, when a group of the same store, date and payer exists,
  only "Add to {store} · {dd/mm} ({N} items)" (with the re-spread note when
  it has a discount). Refusals: "Tick at least two orders to group them as
  one order.", "Only orders of the same store can be one order — these are
  from A and B.", "… of the same order date … — these are on …", "… paid by
  the same person … — these are paid by … and …", "\"X\" has no store. Set
  the store on the order first.", "\"X\" is already in another order
  group.", "These orders are already one order.". "Paid by" not on
  Everyone: "\"Paid by\" shows only {name}: some orders may be hidden.
  Choose Everyone to see them all."
- Every member card (on the way and in History): tag "Order: {store} ·
  {dd/mm} ({N} items)" → the sheet; the share line; the price before the
  discount crossed out. Shop → "On the way": the share line too.
- Sheet "Order group": the members (name, status, "no expense" when it was
  deleted, base −share, paid, its line, "Take out of the group"), "Order
  discount" (−% / −€, € first; live line per item, "Paid €… (order discount
  −€…)"), "Store", "Order date", "Paid by" (with a warning that saving
  changes all N orders and their expenses), "Ungroup", "Save". "Take out"
  and "Ungroup" ask first (confirm "Take out" / "Ungroup") and have Undo.
- Toasts: "N orders grouped as one order", "N order(s) added to the order
  …", "Order group saved", "\"X\" taken out of the order group",
  "Ungrouped — the N orders are on their own again", each with Undo;
  "Saved — an expense edited by hand was left as it is" (+ which).
- Offline: grouping, the discount, take out and ungroup need a connection
  (the merge message). Before 028: nothing of it shows; a group request that
  still fails says "This needs the database update
  supabase/028_order_groups.sql".
- Everything else about orders is as before (Arrived in all its forms,
  Cancel / Return, Back on the way, durable / service lock, pack size, Edit
  order of orders in no group, reminders).
- An older app version on the other phone deletes a member without
  re-spreading (its share is simply gone): reload both iPhones after the
  deploy.

**Files.** New: `supabase/028_order_groups.sql`, `src/lib/orderGroups.js`
(+ test), `src/hooks/useOrderGroups.js`, `src/components/expenses/
OrderGroupSheet.jsx`. Changed: `lib/orders.js` (`orderBase`,
`orderDiscount` paid = base, `orderPriceNote`, `orderNormalPrice`,
`expenseDiscountNote`), `lib/stores.js` (`orderGroupStore`),
`lib/moneyList.js` (`groupPurchases` / `bundleTrips` with
`orderGroupOf`), `hooks/useOrders.js` (`createOrder` + `joinGroup`,
`editGroupMember`, `removeGroupMember`), `hooks/orderActions.js` (delete
dialog), `expenses/OrderCard.jsx`, `expenses/OrdersSection.jsx`
(`GroupOrdersBar`), `expenses/OrderForm.jsx`, `grocery/OnTheWay.jsx`,
`expenses/ExpenseGroup.jsx` (`PurchaseGroup`: `icon`, `note`, `noteOf`,
`extra`), `expenses/EntryRows.jsx` (`TripRow`: same), `pages/
ExpensesPage.jsx`. Four render tests got one mock line (the order form now
reads the groups).

**Tests: 1714 → 1796 (98 → 101 files).** `lib/orderGroups.test.js` (17/10:
shares 0.87, 0.75, 0.62, 0.24, 0.31, 0.14, 0.30, paid €110.61, Pets 2.54 →
€86.83, the return of Working Ear Plug → €102.36 left, still −€3.23;
30.79 + 4.99 with −€1 → 0.86 / 0.14; −10%; own −30% + share; a third order
joining; a member's new base; the cap; take out / ungroup / new group and
their Undo; K2 with 0, 1, 2 candidates; every "Group orders" refusal; the
sheet preview; messages; K9 grouping). `hooks/orderGroups.test.js` (the
hooks against a fake `save_order_group`: group + Undo, discount + Undo,
expense edited by hand, take out / ungroup + Undo, a third order added,
offline, before 028, refused; K2 join to a group and to a single order, a
refused join undone; K3 edit; delete a member both ways + Undo).
`components/orderGroups.render.test.jsx` (tag, share line, tick box, SHOP
card, K2 offer 0 / 1 / 2 / before 028, K7 lock, the sheet, K9 row and
filter, "Group orders" mode, the "Paid by" hint, before 028).
`supabase/migrations.test.js` block "028" (only new objects; before 028 the
app's message; run twice, every check ok, existing functions, policies,
grants and data unchanged, anon nothing; stranger refused; 17/10 with the
app's own requests, idempotent, the return; arrive / unarrive on a member;
the other cases; refusals change nothing).

**Version 2 (not built).** If a store refunds the FULL price of a returned
or cancelled item (e.g. €8.49 instead of €8.25), the whole discount should
stay on the remaining items and be spread again over them (remaining
€102.12 instead of €102.36), re-spreading only when "Delete the expense"
is chosen. Zidane chose Version 1 on 29/10; switch only if real refunds
show Version 2 is right.

**Later (not scheduled).** "Back on the way" does not restore
`pantry_items.last_purchased_at` (and Reopen restores it without a guard).
Fix only when a feature shows or uses the date (report of 29/10, section
D, options D1 / D2 / D3). Checked 29/10, every place in `src/` that reads
the column: `lib/inventoryBackup.js` (`CSV_COLUMNS`: the CSV / Excel export
in Home → Import / Export writes it out; the JSON backup reads all
columns), `hooks/usePantryItems.js` (`ITEM_FIELDS` / `pickFields`: copies it
when an item is saved or a backup is restored — a pass-through, no logic),
`lib/inventory.js` (`OPTIONAL_COLUMNS`: only the name, to leave it out
before migration 006/007). No sorting, suggestion, filter, label or
screen uses it.

**Next round (small, right after this one).** An Undo on the toast after
"Arrived", and stock added through the "It arrived!" dialog recorded on
the order, so "Back on the way" removes it exactly.

### iPhone checklist for round 9I

Written by Claude after 028 has been checked and run.

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
