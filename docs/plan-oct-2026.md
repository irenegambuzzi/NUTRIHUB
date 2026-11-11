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
   - 9J. Arrived Undo and recorded arrivals (decided 30/10, as built;
     follow-up 31/10: K20, K24, toast durations)
   - 9K. Shared parts (decided 31/10–01/11, as built; NOTE 3 phase 1,
     SQL 029) and the SHOP search field (NOTE 1); follow-up 01/11: K14–K21,
     K8b, and the order of the next rounds
   - 9L. Units for new items (decided 01/11, as built; NEW NOTE 1, SQL 030)
   - 9M. Reopen of items a purchase created (decided 01/11, as built; SQL
     031): K25–K31
   - 9N. One item, many names (round 6D, decided 04–09/11, stages 1–5 as
     built; SQL 032): up to K145
   - 9O. MONEY display round (decided 10–11/11; no SQL): K146–K176, prompt 1
     as built
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

Removed in round 6D stage 5 (section 9N); kept here as history.

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
6. ~~Later: Before round 7 (Trips & Holidays), discuss Zidane's notes of
   31/10: the SHOP search field position, and a real split of "Shared"
   payments between the payers (and a shared bank account).~~ **Discussed
   31/10–01/11; built 01/11 — section 9K** (the search field, and "Shared"
   with each person's part, phase 1). The shared bank account (option B)
   and phase 2 are under 9K "Later".

The order of the rounds from 01/11 on: section 9K, "Follow-up 01/11 to 9K",
"Next rounds".

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
  discount) and, beside it, one "Add to {store} · {dd/mm} ({N} items)" for
  each group of the same store, date and payer (with the re-spread note
  when it has a discount) — changed in the 29/10 follow-up below. Refusals: "Tick at least two orders to group them as
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

**Next round.** Round 9J (an Undo on the toast after "Arrived", and stock
added through the "It arrived!" dialog recorded on the order) is done and
tested (31/10/2026) — see section 9J below. Next: iPhone test of 9K; the
order of the rounds after it (decided 01/11) is in section 9K,
"Follow-up 01/11 to 9K", "Next rounds".

### Follow-up 29/10 to 9I (as built; code and tests only, no SQL)

**Why.** The same store can have two separate orders on the same day (two
Amazon checkouts, only one with a promotion). Before, when the ticked
orders matched an existing group, "Group orders" offered only "Add to
{group}": the second checkout could only join the first one, and its
discount would be spread over orders that were not part of it.

**"Group orders" as built now** (`groupingPlan` in `lib/orderGroups.js`,
`GroupOrdersBar` in `expenses/OrdersSection.jsx`):

- Two or more ticked orders in no group, of the same store, order date
  and payer: "Group as one order" is ALWAYS offered (a new, separate
  group; every existing group stays exactly as it is), and beside it one
  "Add to {store} · {dd/mm} ({N} items)" for EACH existing group of the
  same store, order date and payer, oldest first. Nothing is chosen for
  the user; each button does only what it says. The re-spread note is
  under each "Add to" whose group has a discount.
- One ticked order in no group: one "Add to …" for each such group (a new
  group needs two); no group → "Tick at least two orders…".
- One of a group's own orders ticked with single orders: only "Add to"
  that group (unchanged).
- The refusals are unchanged (fewer than 2 for a new group, different
  store / date / payer, no store, an order already in another group,
  "These orders are already one order.").
- `save_order_group` (028) has no rule against two groups of the same
  store, date and payer, so nothing in the database changes.

**"Same order as: …" in the order form** (Money → Orders → "Add order",
Shop → "Order online"; both use `OrderForm`): checked, already right, not
changed. With two or more candidates (two groups, or a group and a single
order) every tick box starts unticked, with "Same store, order date and
payer as these. Tick one if it was part of the same order — otherwise it
stays a separate order."; saving unticked keeps the order separate. Only
one candidate: ticked, as before (K2).

**Kept as built (Zidane decided 29/10).**

- A group with one order left after "Take out of the group" stays a group
  (its discount stays on that order); a group is removed only when it has
  no orders left. "Ungroup" is there to end it.
- The confirm dialogs before "Take out of the group" and "Ungroup" stay
  (in addition to Undo).
- After "Group as one order" the "Order group" sheet opens at once; its
  "Order discount" starts on −€.
- Changing store / date / payer on the group changes the members'
  expenses' date / store / payer without a guard, exactly like "Edit
  order".

**Tests: 1796 → 1811 (101 files).** `lib/orderGroups.test.js`: the 17/10
case now offers both; one single order beside a group; two Zalando
checkouts on 22/10 paid by Irene (−€5.00 on one): two singles → "Group as
one order" + one "Add to" per group; one single → one "Add to" per group;
a member of checkout B ticked → only checkout B; the new group leaves both
checkouts as they are; the form's four candidates; another day not
offered. `hooks/orderGroups.test.js`: the same two checkouts against the
fake `save_order_group`: a new group touches only the ticked orders (+
Undo); "Add to" checkout B leaves checkout A and its −€5.00; "Add to"
checkout A spreads its −€5.00 over four. `components/orderGroups.render
.test.jsx`: both buttons shown and each sends only its own thing (the
sheet opens only after "Group as one order"); two groups → two "Add to"
buttons; the form with two groups, and with a group and a single order →
nothing ticked, saving unticked sends no join.

**The flaky test of round 9I.** In round 9I one full `npm test` run had 1
failing test that could not be repeated (its name was not recorded). On
29/10 the full suite ran 11 times (once before the change: 1796 / 1796;
10 times after it, one after the other: 1811 / 1811 each, logs kept per
run): every run green, no failure to trace, so nothing was changed for
it. If it shows again, record the test name and the error.

**Open (ask Zidane).** Both were fixed in the second follow-up below.

- Two groups of the same store and date with the same number of items
  have the same label ("Add to Zalando · 22/10 (2 items)", and the same
  card tag "Order: …"), so their buttons can't be told apart. → Fix A.
- A toast with the same text as one still on screen is not shown again
  (`showToast` in `lib/feedback.js`), so grouping two new groups within
  10 seconds shows only the first "2 orders grouped as one order", and its
  Undo undoes the FIRST group. The same for any two equal Undo toasts.
  → Fix B.

### Second follow-up 29/10 to 9I (as built; code and tests only, no SQL)

**Fix A — groups with the same label told apart.** Money → Orders →
"Group orders": under EVERY "Add to {store} · {dd/mm} ({N} items)" button
the item names of that group's orders, in their saved order (`created_at`,
then `id`), at most 3, then "+N more" (`itemNames` in `lib/orderGroups.js`,
the same text as the order form's offer): e.g. "Cat Litter, Bird Seed" /
"Hay Bale, Hamster Wheel, Water Bottle +2 more". Small grey text right
under the button, above the re-spread note when there is one; long names
wrap (no sideways scroll at 375 px). `GroupOrdersBar` in
`expenses/OrdersSection.jsx`.

The order form's "Same order as" offer (Money → Orders → "Add order",
Shop → "Order online"; both `OrderForm`) was checked: every candidate
already reads "Same order as: {up to 3 names, then +N more} ({store} ·
{dd/mm})" (`candidateLabel`), also with 2 or more candidates. Not changed.
The card tag "Order: …" is not changed (it opens the "Order group" sheet,
which lists every item).

**Fix B — an Undo never undoes the wrong thing (app-wide).** `showToast`
(`lib/feedback.js`): a toast whose action is "Undo" is never dropped
because another toast on screen has the same text; it is shown like any
other new toast (its own timer, its own Undo, the toasts stack). Each
Undo undoes only its own change. Toasts without an action, and toasts
with another action (Retry, Log in), keep the old rule: the same text
(and detail and tone) already on screen → not shown again. A `key` still
replaces the toasts with that key, as before. This covers every Undo
toast of the app: order groups ("N orders grouped as one order", "Order
group saved", …), "Order moved to History", "Order deleted", stock
changes ("Discarded …"), "Deleted", "Removed …", "Expense saved · €…",
merges and the rest.

**Tests: 1811 → 1817 (101 files).** `lib/feedback.test.js`: two equal
"Order moved to History" Undo toasts 3 s apart → both shown, the second
Undo runs only its own action, the first closes on its own timer; a plain
toast with the text of an Undo toast on screen and a second equal Retry
toast are still dropped. `hooks/orderGroups.test.js`: two groups made one
after the other at Zooplus on 25/10 (paid by Shared) → two "2 orders
grouped as one order" toasts; the second Undo ungroups only the second
group, the first stays and its own Undo still works; two orders cancelled
one after the other → two "Order moved to History" toasts, the second Undo
puts back only the second order and its expense.
`components/orderGroups.render.test.jsx`: three groups at Zooplus on 25/10
(two of 2 items, one of 5) → three "Add to" buttons, two with the same
label, each with its own names ("Cat Litter, Bird Seed", "Dog Chew, Fish
Flakes", "Hay Bale, Hamster Wheel, Water Bottle +2 more"), and the second
button sends only its own group; the form with the same three groups →
each offer with its own names. Full suite run 3 times: 1817 / 1817 each.

**Open (ask Zidane).** Two failed saves with the same error text show one
"Couldn't save — check your connection." toast; its "Retry" retries only
the FIRST save (the second one's Retry is never shown). Not changed (the
brief said to leave other actions as they are).

### Fix 30/10 to 9I — questions in front of the sheets (as built; code and tests only, no SQL)

**What the iPhone test found.** Money → Orders → the tag "Order: {store} ·
{dd/mm} ({N} items)" → "Order group" → "Take out of the group" (or
"Ungroup"): the question `Take "{name}" out of the group?` / "Ungroup this
order?" stayed hidden; the sheet stayed on screen.

**Cause.** The shared question (`confirmDialog` / `askDialog`, drawn by
`<Feedback />` in `Layout`) was on layer `z-50` inside the app's own
element (`#root`). The "Order group" sheet is put on `document.body` with
`createPortal`, also on `z-50`, so after `#root`. Same layer → the one
later on the page is drawn on top: the sheet covered the question, and
taps went to the sheet.

**Fix (app-wide, `components/ui/Feedback.jsx`).** The question is now put
on `document.body` too (`createPortal`), on its own layer `z-[60]`, above
every sheet; toasts move from `z-[60]` to `z-[70]`, so they stay above the
question as before. Layers, bottom to top: a page's own forms and editors
(`z-30` / `z-40`), sheets on `document.body` (`z-50`), the question
(`z-[60]`), toasts (`z-[70]`). The question no longer depends on which was
opened first. A tap on its dimmed background only cancels it (as before);
nothing reaches the sheet behind. Texts, buttons, numbers, Undo: not
changed. After "Take out" the sheet stays open with the group's new
numbers; after "Ungroup" it closes (as before).

**Every place a question can open over a sheet or form, checked:**

- Money → Orders → tag → "Order group": "Take out of the group",
  "Ungroup" — were hidden (sheet on `document.body`, `z-50`). Fixed.
- Money → Orders → "Edit order" (`z-30`): no question opens from it
  (only "Manage stores", a sheet on `z-50`: in front). Already fine.
- Money → Orders → "Arrived" (`ArrivedDialog`, `LinkedArrivedDialog`):
  no question inside; "Create a new item" swaps it for the HOME item
  editor (below). Already fine.
- Money → Orders / Shop → "On the way" → "Cancel / Return", "Back on the
  way", Delete: asked from the cards, no sheet open. Already fine (now
  also on `z-[60]`).
- Shop → "Confirm purchase" (`z-40`): no question opens from it. Already
  fine. Shop → Receipts → photo viewer (`z-40`) → "Move to another day":
  was already in front (`z-50` over `z-40`).
- Money → "Add expense" form (`z-30`) and Money → Expenses → deleting an
  expense of a purchase ("Part of a purchase"): were already in front.
- Home → item editor (`z-30`): "Count … in kg instead of gr?", "Move into
  …?" — were already in front.
- Manage categories: Money (`CategoryManager`, `z-30`) and Home →
  Categories → "Manage categories" (sheet on `document.body`): no question
  opens from them (inline confirms). Already fine.
- Plan → Profiles → Log out; Home → Import / Export → Import / Restore;
  Shop → an ordered item ticked: no sheet open. Already fine.

**Tests: 1817 → 1822 (102 files).** New
`components/dialogLayers.render.test.jsx`, with the real `<Feedback />`
and the real "Take out" / "Ungroup" (a fake `save_order_group`): the
question opened from "Order group" is drawn in front of the sheet (higher
layer, on `document.body`), its confirm button has the focus; Cancel →
back to the sheet, nothing sent, nothing changed; a tap on its dimmed
background → only the question closes; "Take out" → the sheet stays with
2 of 3 orders and "Paid €47.00 (order discount −€3.00)", toast with Undo;
"Ungroup" → question and sheet closed, toast with Undo. HOME item editor:
the unit question in front of the editor; Cancel keeps "gr"; "Change
unit" converts. Before the fix the "Order group" tests failed (question
behind the sheet). Full suite run twice: 1822 / 1822 each.

### iPhone checklist for round 9I

Written by Claude after 028 has been checked and run.

### 9J. Arrived Undo and recorded arrivals (decided 30/10, as built)

Analysis: `tmp-export/9j-readonly-report.md` (30/10, read only; paths L1,
L2, U0–U4, D). Zidane chose 1-A + 2-A, c1 (Undo and "Back on the way"),
the same for new variants, 3-B, 4-A + 4-C, and decisions K1–K17 below.
**No SQL**: `arrive_order` / `unarrive_order` (021) are used as they are;
no function replaced, no column, no data fix. No new browser storage, no
new offline queue. Deployed at once (nothing waits for SQL); an older app
version on the other phone keeps the old "It arrived!" (marked arrived
first, stock unrecorded) until it is reloaded.

**K1 — every "It arrived!" choice is one `arrive_order` step.**
`OrdersSection.arrive` and `GroceryPage.arrive` open `ArrivedDialog` on the
order still on the way (no `markArrived` first). `ArrivedDialog` calls
`useOrders.arriveLinkedOrder` (the linked path, now for both):

- "Add to an existing item" / an existing variant →
  `arrive_order(order, item, delta, today)`.
- "New variant…" → `newVariant` (row upserted with stock 0, id fixed per
  dialog and per group, then `arrive_order`; deleted again, still at 0,
  when the other phone was first).
- "Create a new item" → the HOME editor's save gives the fields
  (`usePantryItems.pickFields`, now exported) as `newItem`: upserted with
  stock 0 (ignore duplicates, never `addItem`: no "Added" history row, no
  SHOP sync at 0), then `arrive_order(order, newId, typed stock)`. Other
  phone first → deleted again where still 0, toast `"{name}" was already
  marked as arrived (on the other phone?) — nothing was added again.`
  (no Undo). The SHOP list is then synced for the arrived item
  (`syncListFor(order, itemId)`: the linked item, or else the item the
  arrival went to).
- Second step failed: the editor / dialog stays open with what was typed;
  pressing again reuses the same id — when the upsert finds the row
  already there, the fields typed now are written onto it while it is
  still at 0 (a name changed meanwhile). Closed without arriving (×, a tap
  outside, Back + ×): `discardUnusedItem(id)` deletes it as a follow-up,
  only while at 0 with no history row. Also for a new variant, in both
  dialogs (deviation: K1 named the new item only).
- "Don't add to HOME" → `arrive_order(order, null, 0)`.
- `orders.pantry_item_id` is never set by it. Offline: refused before
  writing ("You're offline — this needs a connection."); the old queued
  `adjustStock` of "Add to an existing item" is gone.
- No pack size is written on an order not linked to HOME (its form has no
  pack field; the arrival's pack field counts the stock only).

Dialog text now: `Add "{name}" to HOME? Choose below — that marks it as
arrived. The expense stays as it is — nothing new is added to your
expenses.` (was "… is marked as arrived. Add it to HOME? …").

**K2** × or a tap outside: nothing happens, the order stays on the way (also
the linked dialog, as before).

**K3 / K4 — a new item or variant made by an arrival** goes again with it
only while untouched (`useOrders.madeByArrival`, read before
`unarrive_order` deletes the arrival's row): after taking out
`stock_added` it is at 0; no history row but the arrival's; no SHOP entry
but automatic ones still to buy (not bought, not in the cart); no other
order linked to it or arrived into it. Toast Undo: the app knows the id.
"Back on the way" later: the item's `created_at` is 0–30 s before the
arrival's history row (`ENTRY_GRACE_MS`). Any doubt → kept (its stock is
still reduced exactly). Deleting (`deleteMadeItem`): only while at 0 with
no history row, its automatic "to buy" entries with it, its group judged
again. Same for a linked arrival's new variant.

**K5 — Undo guard (app only).** The order is read first; Undo goes on only
when `status = 'arrived'` and `arrived_log_id` is the one our arrival
wrote (with no stock: no log, the same `arrived_date`, no stock). Else the
toast `"{name}" changed meanwhile (on the other phone?) — nothing was
undone.` (error tone) and nothing is written. Gap of milliseconds
(read-then-act), as chosen.

**K6** "Current stock" 0 is allowed: the order arrives with nothing added
(`stock_added 0`, no item on the order); the item gets its automatic "to
buy" entry (stock 0 = Out, as any new item at 0). The toast Undo deletes it
while untouched; "Back on the way" later leaves it (nothing recorded).

**K7** History reason `purchased` (HOME History "Bought") for every "It
arrived!" arrival with stock — what `arrive_order` writes.

**K8** Toast Undo puts `orders.pack_size` back to what the order had before
(24 at ordering, 22 at arrival → 24) and runs `restoreArrivalPack`. "Back on
the way" keeps the arrival's pack size (9H).

**K9** No data fix: old arrivals stay unrecorded.

**K10 — "Back on the way" on every arrived order uses `unarrive_order`**
(`askBackOnTheWay`, `hooks/orderActions.js`): also no stock, durable,
service, "Don't add to HOME" and old unrecorded arrivals, so the SHOP entry
is `completed = false` again and the card is back under Shop → "On the
way". After it the SHOP list is judged again for the item (new: before 9J
"Back on the way" never synced; this puts back an automatic "to buy" that
the arrival had removed). Cancelled / returned: unchanged
(`putBackOnTheWay`, "Its expense was deleted…"). Deviation by the letter of
K10: an *arrived* order whose expense was deleted is no longer asked "Add
the expense again" (see the round summary). **Put back 31/10 (K20, see
"Follow-up 31/10" below).**

**K11 — Undo on every Arrived toast, 10 s** (`useOrders.arrivedToast`; 20 s since 31/10),
Money and Shop: "Arrived — added {qty} to "{item}"" (and the group texts),
`"{name}" marked as arrived — nothing added to HOME` (linked and, new, "It
arrived!" → "Don't add to HOME"), `Added {qty} to "{item}"`, `Added {n}
{unit} to "{variant}"` / `… to a new variant of "{group}"`, `"{name}" is now
in HOME`, `“{name}” arrived — durable, nothing added to HOME.` / `… —
service, …`. Texts unchanged, only "Undo" added. Undo (`undoArrival`):
guard → `unarrive_order` → `restoreArrivalPack` → pack size back → new
item / variant deleted when untouched → refresh → SHOP sync. Never
`putBackOnTheWay`, never a price, group, share, order group or expense.
Offline: refused. Toast after it: `"{name}" is on the way again`, plus
` — {qty} taken out of "{item}"`; a new item / variant deleted: ` — {qty}
taken out, and the new item "{item}" deleted from HOME` (or `the new
variant`; with no stock ` — the new item "{item}" deleted from HOME`);
kept because used: ` — {qty} taken out of "{item}" (kept in HOME: it
changed meanwhile)`. Durable / service now arrive through `markArrived`
as before; its saved row is the Undo's reference. (Since 31/10 through
`arrive_order` with 0, K24.)

**K12 — the safety net in "Create a new item".** `ArrivedDialog` passes
`homeItems` and `optionLabel = similarItems.arrivalPickLabel` to
`ItemEditor` (new prop `optionLabel`, default `goToLabel`). Exact name →
`“{HOME name}” is already in HOME` + `Add it to {name} · {stock words}`
(e.g. "Add it to Cat Wet Food · 12 pcs at home", "· out of stock", "·
finished 1× item, it comes back"); no "Create new" (HOME names stay unique,
as 9G). Similar → `Similar item in HOME:`, up to 3 `Add it to …`, `{N} more
— type more of the name`, `Create new “{typed}”` with the 9G hint; the next
press saves as typed, a changed name asks again. A button switches the
dialog to "Add to an existing item" with that item chosen (RestockForm:
quantity, unit, pack field); a variant → "Add to a variant of an item
group" with its group and the variant chosen (`RestockForm
initial.variantId`, new); a group → that group. Durables never offered.

**K13** First-time usual pack size from "It arrived!": still off.

**K14 — Retry toasts.** `showToast` no longer drops a toast with "Retry"
because another one has the same text (like "Undo" since a8aaa17): own id,
own timer, own Retry. Plain toasts keep the old rule; keyed toasts (load,
"Log in", offline) unchanged. The toast column (`Toasts`, `data-toasts`):
`max-h-[45vh]`, scrolls inside (`overflow-y-auto`, `overscroll-contain`),
`overflow-x-hidden`, scrolled to the newest when one is added.

**K15 — keyboard in questions** (`ui/Feedback.jsx`): the confirm button has
the focus unless the first field is a select / date / number (they keep
`autoFocus`); Tab / Shift+Tab go round inside the question (`tabStops`; a
radio group counts once); Escape = Cancel; on close the focus goes back to
the element that had it when asked (`askDialog` keeps `opener`; one
question replacing another keeps the first opener) — a button always, a
select only when the question was answered with the keyboard (no
programmatic focus on a drop-down after a tap), never a text field. `#root`
is not inert.

**K16** Only the Undo on the toast; no History opening or highlight after
Arrived.

**K17** "Back on the way" on an arrived order with no stock recorded that is
not durable / service asks: `Put "{name}" back on the way?` — `No stock was
recorded for this order's arrival. If something was added to HOME when it
arrived, it stays in HOME — when it arrives again, choose "Don't add to
HOME".` — "Cancel" / "Put back on the way". Durable / service: no question.
With stock and a new item that will go: `Its arrival added {qty} to HOME
and created "{item}": both are taken out again, so they aren't counted
twice when it really arrives.`

**Files.** Changed: `hooks/useOrders.js` (`markArrived` returns the row,
`markDurableArrived`, `syncListFor(order, itemId)`, `alreadyArrivedMessage`,
`arriveLinkedOrder` with `newItem`, `discardUnusedItem`, `arrivedToast`,
`changedMeanwhileMessage`, `undoArrival`, `madeByArrival`,
`deleteMadeItem`, `itemMadeByArrival`, `unarriveOrder(order, { made })`),
`hooks/orderActions.js` (`askBackOnTheWay`, `NO_STOCK_RECORDED`),
`hooks/usePantryItems.js` (`pickFields` exported),
`expenses/ArrivedDialog.jsx`, `expenses/LinkedArrivedDialog.jsx`,
`expenses/OrdersSection.jsx`, `pages/GroceryPage.jsx`,
`inventory/ItemEditor.jsx` (`optionLabel`), `inventory/RestockForm.jsx`
(`initial.variantId`), `lib/similarItems.js` (`arrivalPickLabel`),
`lib/feedback.js` (Retry rule, `opener`), `ui/Feedback.jsx`. New:
`hooks/arrivalDb.fixture.js` (a database in memory doing what 021 does,
for tests).

**Tests: 1822 → 1874 (102 → 105 files).** New `hooks/arrivalUndo.test.js`
(26: L1 with pack 24 → 22 → 24, first-time usual size undone, L2, linked new
variant deleted, existing item with SHOP sync, existing variant, new variant
kept when used, new item with 2 and with 0, "Don't add to HOME", other
phone first, second step failing + same id + discard, durable, service, K5
twice, offline, an order-group member unchanged; "Back on the way": new item
named and deleted, used → kept, old item, K17 + Cancel, old unrecorded,
durable, cancelled), `components/arrivedUndo.render.test.jsx` (13: × and a
tap outside, every choice's toast with Undo, the new item, other phone
first, second step failing in the editor, K12 exact / similar + Create new /
variant / durable, linked dialog), `components/dialogFocus.render.test.jsx`
(6: confirm focused, Tab round, select keeps focus, Escape, focus back to a
button not a text field, the Flour case, two Retry toasts and the column
limit). `lib/feedback.test.js`: the old Retry test replaced (+2).
`supabase/migrations.test.js` block "9J" (5, PGlite, SQL unchanged: no file
after 028, the 021 functions as written, an unlinked order into an
existing item and into a new item made at 0, stock 0, null/0 and back).
Changed: `components/durableLock.render.test.jsx` (no `markArrived` before
the dialog).

### Follow-up 31/10 to 9J (as built; code and tests only, no SQL)

Decisions of Zidane, 31/10. **K18, K19, K21, K22, K23**: kept exactly as
built in 18dc01e (no change). **K25**: the new top text of "It arrived!"
is approved (no change). **No SQL**: `arrive_order` / `unarrive_order`
(021) are used as they are; no file in `supabase/`, no `.sql` changed.

**K20 — "Back on the way" on an arrived order whose expense was deleted**
(by hand in Money, so `orders.expense_id` is empty): the expense question
from before 9J is back, inside the **one** question (`askBackOnTheWay`,
never two windows in a row). Title `Put "{name}" back on the way?`; the
message is, in this order, the stock text that applies today, then
`Its expense was deleted. Add the expense again (one, for the order date
and price)?` (`EXPENSE_DELETED`, the pre-9J text); then the choice
"Add the expense again" (hint `€{price} on {dd/mm/yyyy}.`, chosen at
first) / "Without an expense"; buttons "Cancel" / "Put back on the way".

- Stock recorded: `Its arrival added {qty} to HOME. That stock is taken
  out again, so it isn't counted twice when it really arrives.` (with a new
  item that will go: `… and created "{item}": both are taken out again …`)
  + the expense part.
- No stock recorded, not durable / service: the K17 text
  (`NO_STOCK_RECORDED`) + the expense part.
- Durable / service: only the expense part (as before 9J).
- Expense still there: exactly as built in 18dc01e (no expense choice;
  durable / service still not asked).

"Put back on the way" → `unarriveOrder` (as built) → only if "Add the
expense again" was chosen, `addExpenseAgain(order)` (new, `useOrders`):
the same expense the pre-9J `putBackOnTheWay` makes (`addExpenseRow`, now
shared by both: `expenseRowForOrder` — amount = order price, date = order
date, category, payer, store, description = order name; id fixed, upsert
ignoring duplicates), then the order gets `expense_id` (and
`expense_outcome` empty, as before). It never writes the order's status, so
it can't undo an Arrived made meanwhile on the other phone. If it fails:
the expense made in the same step is taken back (`inSteps`), toast
"Couldn't save — check your connection." with Retry (same id, so one
expense only); the order stays on the way. No toast when it works (as
before 9J: the expense shows in Money's list). "Cancel" → nothing changes.
Cancelled / returned orders: unchanged (`putBackOnTheWay`, own question).

**K24 — durable and service arrivals through `arrive_order(order, null,
0)`** (`markDurableArrived` → `arriveLinkedOrder` with `syncList: false`):
only the first Arrived counts. The other phone first → toast `"{name}" was
already marked as arrived (on the other phone?) — nothing was added
again.`, no Undo, nothing written. Otherwise the toast `“{name}” arrived —
durable, nothing added to HOME.` / `… — service, …` with Undo, as built.
The SHOP entry (if any) is `completed = true, in_cart = false` as before
(now by `arrive_order`), and the SHOP list is not judged again on arrival
(as before; the Undo and "Back on the way" still do it, 9J). `markArrived`
is gone (nothing else used it). Old durable orders already arrived:
unchanged. Deviation: a failed durable Arrived now shows "Couldn't save —
check your connection." without Retry (the arrival path is `retry: false`);
the order stays on the way and "Arrived" can be pressed again (Kata ragu).

**Toast durations — one rule for every screen** (`lib/feedback.js`):
`TOAST_WITH_ACTION_MS = 20000` (a toast with any button: Undo, Retry, Log
in…) and `TOAST_MS = 15000` (no button). `showToast` and `deleteWithUndo`
no longer take a `duration`; every hard-coded one is gone
(`toastSaveError` / `toastLoadError` 8 s, Cancel / Return 8 s, order
groups 10 s, merge / split 10 s, purchase Undo `UNDO_FOR` 10 s, Reopen
5 / 10 s, budget mapping 10 s, store changes 8 s, "Expense saved" 8 s,
category merge 8 s, cart left 8 s, Arrived Undo 10 s, every
`deleteWithUndo` 5 s). Keyed toasts follow the same rule and are still
replaced by key: offline 15 s, load error (Retry) 20 s, session "Log in"
20 s (before: stayed until closed). × closes any toast at once; the K14
stack is unchanged.

- Checked every Undo before: all write at once and restore on tap (none
  waits for the toast to end), so all are lengthened. The offline stock
  queue sends when the connection is back, not when the toast ends.
- Timers that followed the old window: receipt photo delete
  (`useReceiptPhotos.KEEP_FOR_UNDO`, the file is removed after Undo is no
  longer offered) 7 s → `TOAST_WITH_ACTION_MS + 2000` (22 s). The 9J guard
  (K5) and the "new item untouched" check (`madeByArrival`) have no timer
  (read-then-act); `ENTRY_GRACE_MS` (30 s, item made → arrival) is not
  about the toast: unchanged.

**Files.** Changed: `lib/feedback.js` (the two constants, no `duration`),
`lib/db.js` (`deleteWithUndo`), `lib/session.js`, `hooks/useOrders.js`
(`markDurableArrived`, `arriveLinkedOrder` `syncList`, `addExpenseRow`,
`addExpenseAgain`, `putBackOnTheWay` reuses `addExpenseRow`; `markArrived`
removed), `hooks/orderActions.js` (`askBackOnTheWay`, `EXPENSE_DELETED`,
`expenseChoice`), `hooks/useReceiptPhotos.js`, `hooks/useMerge.js`,
`hooks/useOrderGroups.js`, `hooks/usePurchase.js`, `hooks/useExpenses.js`,
`hooks/useBudgetMap.js`, `hooks/useInventoryCategories.js`,
`components/grocery/ConfirmPurchase.jsx`,
`components/expenses/LinkedArrivedDialog.jsx` (comment).

**Tests: 1874 → 1890 (105 files).** `hooks/arrivalUndo.test.js` +12: K20
(stock + expense deleted with "Add the expense again" — amount, date,
category, payer, store — and a new item named; "Without an expense"; K17
text + expense; durable only the expense; expense still there; Cancel;
the expense step failing → Retry, once; cancelled unchanged), K24 (durable
`arrive_order` with 0 and the SHOP entry; service; other phone first, no
Undo; Undo and offline). The 9J "Back on the way" tests now give their
orders an expense (as real orders have). `lib/feedback.test.js` +4
(15 s, 20 s for Undo / Retry / Log in, × at once, keyed toasts; no file
passes its own duration), its equal-toast tests on the new times.
`lib/db.test.js`: Undo 20 s. `components/packSizeUndo.render.test.jsx`:
the order has an expense. `components/durableLock.render.test.jsx`: no
`markArrived` mock.

### Follow-up 31/10 (2) to 9J (as built; code and tests only, no SQL)

Decisions of Zidane, 31/10. **No SQL**: no file in `supabase/`, no `.sql`
changed; no new browser storage.

**K26 (a) — kept as built.** A failed durable / service Arrived shows
"Couldn't save — check your connection." without Retry (the arrival path
is `retry: false`); the order stays on the way and "Arrived" can be
pressed again. No change.

**K27 (b) — the session "Log in" toast stays until it is closed.** One
explicit option in `lib/feedback.js`: `showToast({ …, untilClosed: true })`
starts no timer, so the toast stays until × or its button. Only the
session toast uses it (`endSession` in `lib/session.js`, key `'session'`):
nothing can be saved or loaded until the user logs in again, so it must
not go away by itself. It still closes when the session comes back (a
renewal that works, or a new sign-in: `dismissToastsByKey('session')` in
`session.js` and `auth.js`, unchanged). "Log in" opens the login as
before; after × it is shown again only when something else fails, as
before. Every other toast keeps the 9J rule: with a button 20 s
(`TOAST_WITH_ACTION_MS`), without 15 s (`TOAST_MS`).

**Files.** Changed: `lib/feedback.js` (`untilClosed`), `lib/session.js`
(`endSession` passes it; comment).

**Tests: 1890 → 1895 (105 files).** `lib/feedback.test.js` +1
(`untilClosed`: still there after 20 s and 10 minutes, no timer, its
button runs once and closes it, × closes it; a toast with a button beside
it closes after 20 s, one without after 15 s); the 20-s test uses an
"Open" button instead of the session toast. `lib/session.test.js` +4 (the
session toast stays past 20 s and 30 minutes while an Undo toast closes
after 20 s and a plain one after 15 s; × closes it and it shows again on
the next failure; "Log in" still opens the login after 5 minutes; it
closes when the session is renewed).

### iPhone checklist for round 9J

Tested on the iPhones and a computer on 31/10/2026 by Zidane:

- **A** (unlinked order → "Create a new item", × keeps it on the way, Undo
  deletes the new item, "Bought" in HOME History, "Back on the way" text
  with the created item), **C** (item used meanwhile is kept at 0 and goes
  on the SHOP list), **D** (Don't add to HOME + Undo, the K17 question,
  expense deleted → one question with K17 text + "Add the expense
  again"), **E** (durable Arrived without dialog + Undo), **F** (linked
  order from SHOP: Arrived, Undo, card back under On the way, Back on the
  way) — all as expected.
- **B** retested with "TEST Zebar Glu" / "test zebra glu": similar and
  exact name handled as expected (note: "Glu" vs "Glue" is NOT similar by
  the 9G rule — words of 4 letters or fewer must be identical — correct).
- **E4** (the second phone's "already marked as arrived") could not be
  reproduced: live sync removes the card from the other phone within a
  second, so the message only appears when two devices press almost at
  the same moment — correct, covered by automated tests.
- **G** (keyboard focus) skipped: the household doesn't count items in
  gr; covered by automated tests.
- Not tested on purpose: K5, K14, "Add to a variant of an item group"
  (covered by automated tests).

### 9K. Shared parts (decided 31/10–01/11, as built)

Analysis: `tmp-export/shared-readonly-report.md` (31/10, read only). The
household chose **option A** ("Shared" + each person's part in €, no 4th
payer) with sub-choice **A1** (a person's pill = their own money out), and
decisions K1–K13 below; where they differ from the report, they win. SQL:
`supabase/029_shared_parts.sql` (not run yet; the household runs it after
Claude has checked it). The app is deployed before 029 and works before and
after it. No new browser storage, no new offline queue. Orders, Order
online, Edit order, order groups, `save_order_group`, `arrive_order` and
`unarrive_order` are not changed (phase 2, see "Later").

Names: the payers are their codes **irene / akbar / shared**; every text
reads the labels from `PAID_BY_OPTIONS` (`{label}` below). The two people
are the payers other than `shared`, in the order of `PAID_BY_OPTIONS`; "the
second person" takes left-over cents.

**Live data (01/11, from the household's query files).** Payer values in
use: only irene, akbar, shared (plus an empty `shopping_trips.paid_by` on
3 mixed SHOP trips). One Shared expense: 27/10/2026 "SPESE CONDOMINIO",
€268.58, a plain expense (not in a purchase, not from an order). No
Shared orders, no Shared income.

**Data (029).** `expenses.part_irene numeric(12, 2)` and
`expenses.part_akbar numeric(12, 2)`, both nullable: what each person paid
of a Shared expense, in cents. Constraint `expenses_parts_ok`: both empty,
or both filled and each ≥ 0. **No** "parts = amount" check and **no**
"paid_by = 'shared'" check: `save_order_group` (028) and Edit order change
an expense's amount, and 028 and the SHOP payer buttons change its payer,
without knowing about parts — such checks would make those saves fail.
The app treats parts as meaningful only while `paid_by = 'shared'`.

Why two numeric columns and not one jsonb keyed by payer code: typed
numbers in cents, one simple constraint the database can enforce (a jsonb
would accept any key and any value unless a longer check is written),
easy to read and add up in the SQL Editor, and no names beyond the
existing payer codes. A new payer code would need a column (none is
planned: option B adds no parts).

**`confirm_shopping_trip` (029 replaces the 023 version; no later file
defines it).** Every line is the 023 version except the expense insert:

| Change | For a payload without parts |
|---|---|
| New comment line `-- 029: also each person's part of a Shared line (both empty unless sent).` | Comment only. |
| `insert into expenses (…, travel_id)` → `(…, travel_id, part_irene, part_akbar)` | — |
| `values (…, nullif(v_item->>'travel_id', '')::uuid)` → `(…, nullif(v_item->>'travel_id', '')::uuid, (v_item->>'part_irene')::numeric, (v_item->>'part_akbar')::numeric)` | Both null = the column default: exactly what 023 writes. |

Same signature, `search_path = public`, household check (42501), security
invoker, grants kept by `create or replace` (closed to anon/public). The
columns, the constraint and the function are in **one transaction**
(`begin; … commit;`), so they are never half applied — the app takes "the
columns are there" to mean "the function writes them". Safe to run twice.
The check SELECT at the end has 5 rows, each "ok": the two columns, the
constraint, the function (writes the parts, search_path, invoker, login
check, anon none), and "expenses with parts (0 the first time)".

**Before 029.** "Shared" works exactly as before: no part fields, no
requirement, no note; a person's pill shows only their own expenses.
029 is found the way 9H finds its columns (`sharedParts.partsColumnsReady`:
an expense read with all its columns carries them). Money uses the
expenses it has loaded; SHOP "Confirm purchase" (and Money with nothing
loaded yet) reads one expense once (`hooks/useExpenseParts.js`); offline
or no expense at all → "not yet" (fields hidden, the safe side). A save
that still meets a database without the columns (a plain expense, Edit
expense) says "This needs the database update
supabase/029_shared_parts.sql" (`db.attempt` got an optional
`messageOf`) and the form keeps what was typed. An older app version on
the other phone saves Shared without parts (K4 covers it); its Edit
expense doesn't send parts, so a changed amount shows the K9 note.

**Rules as built.**

- K1 Option A only; no 4th payer. Option B: see "Later".
- K2 / A1 A person's pill (Money → section Expenses, the pills under the
  title; one shared state with Orders) shows that person's own expenses
  whole **plus their part of every Shared expense that has parts**: one
  mapping in `ExpensesPage.filteredExpenses` (`sharedParts.
  personalExpenses`) passes a copy whose `amount` is the part
  (`sharedPart.real` = the expense, used by Edit, Delete, Select and "Set
  the store of several expenses…"). Every total, the summary card
  ("Expenses · {label}"), the € chip, By category, By store, Trend,
  Totals per category follow unchanged. A Shared row then reads
  "€100.00" with "of €268.58" under it (also on the collapsed category
  row); a purchase: its parts' sum with "of total €…". Everyone and Shared
  stay whole. The Orders filter is unchanged. ~~A part of €0 still lists
  the row ("€0.00 of €…").~~ Changed 01/11 (K14): a part of €0 is not
  listed in that person's pill.
- Under every Shared expense with parts, in every view: "{label} €100.00
  · {label} €168.58" (`partsLine`).
- K3 Parts are **required** for every new Shared expense in Money "Add
  expense" (one expense and a purchase) and SHOP "Confirm purchase".
  Nothing is prefilled. "Split equally" fills both halves, the odd cent to
  the second person. Saving waits until they are typed and add up.
- K4 Shared expenses without parts are in no personal pill. With a
  person's pill and N > 0, the Money top card has one line under the three
  tiles (across the card: a tile is too narrow on a phone): "1 Shared
  expense without parts (€31.42) is not in this total." / "N Shared
  expenses without parts (€…) are not in this total."
- K5 Old Shared expenses stay as they are; parts can be added one by one
  in "Edit expense" (that is how 27/10 gets its €100.00 / €168.58).
- K6 Two fields right under "Paid by" when it is Shared: "{label} paid
  (€)" for each person (`ui/SharedPartsFields.jsx`). Typing one fills the
  other with the rest (total − typed) until the other is typed by hand (a
  cleared field is no longer "by hand"). Each part ≥ 0 and ≤ the total;
  `parseDecimal` / `DecimalInput`, rounded to cents. Refusals: "Type what
  {label} and {label} paid.", "Type what {label} paid too.", "The part of
  {label} (€X) is more than the total (€Y).", "The parts add up to €X, not
  €Y.", "Type each part as a number, like 100 or 168,58."; the one-tap fix
  "Put the difference on {label}" (on the field not typed last; the second
  person when neither was; also for a missing part).
- K7 A purchase with several lines: **one** split for the whole purchase
  (what each paid at the till). The total to split = the sum of the PAID
  amounts (after item discounts and coupon) of its Shared lines; the first
  person's part is spread over them in proportion with the coupon rule
  (`spreadParts` = `spreadCoupon`: cents rounded, the rest on the last
  line or the one before), the second person's part of a line is the rest
  of it — so every line adds up and both totals are what was typed. Free
  lines (€0) take no part. SHOP "Confirm purchase": lines paid by a person
  (per-line pills or "Paid by (everything)") are untouched; the box shows
  only when at least one Shared line costs something ("What each one paid
  of the N Shared item(s) (€…).", under "Shopping day" / "Paid by
  (everything)", above the store). A changed price, discount, coupon or
  payer is checked again (blocked until they add up; the fix works). Each
  line's expense can still be corrected alone in "Edit expense".
- K8 Phase 1 only: Money "Add expense", "Edit expense", SHOP "Confirm
  purchase". An order's expense may get parts in "Edit expense".
- K9 An amount changed by another path: the stored parts stay; the app
  shows them scaled in proportion to the new amount (cents rounded, the
  rest to the second person; `scaleParts`), with the amber note "Parts
  were for €268.58 — the expense is now €260.00. Edit to check." (under
  the row, and in "Edit expense" while the parts don't fit). No database
  trigger.
- K10 A part of €0 is allowed, with "Only {label} paid — you could choose
  Paid by {label} instead."; nothing changes by itself.
- K11 Shared → a person clears the parts (Edit expense saves both empty);
  a person → Shared requires parts. An old Shared expense without parts
  may be saved for another change without parts; once one part is typed
  they must add up. A new amount on a Shared expense with parts must be
  split again (the fix works). A Shared expense with parts keeps requiring
  them in Edit (clearing both is refused).
- K12 Undo toast / Reopen purchase / Undo purchase: the parts go with the
  expenses (deleted by `reopen_shopping_trip`); confirming again needs
  them typed again. Merge / Split: amounts and payers never change, so the
  parts stay; Shared + Shared may be merged. 9J's K20 "Add the expense
  again": a Shared expense without parts (`expenseRowForOrder` unchanged). Income:
  no parts. The "Shared" pill: whole amounts. The SHOP budget card: unchanged.
- K13 NOTE 1 — the SHOP search field ("Search the list and the cart…",
  text unchanged) is now directly above "+ Add to SHOP list" in the List
  view too (after the category chips); Shop mode was already so. One
  `searchBox` in `GroceryPage.jsx` for both views. "Go to card" still
  clears a search (and a chip) that hides the card.

**Files.** New: `supabase/029_shared_parts.sql`, `src/lib/sharedParts.js`
(+ test), `src/hooks/useExpenseParts.js`, `src/components/ui/
SharedPartsFields.jsx`, `src/components/expenses/SharedParts.jsx`
(`SharedPartsNote`, `PartAmount`). Changed: `lib/moneyPurchase.js`
(`moneyPurchasePayload` `lineParts`), `lib/purchase.js`
(`confirmationPayload` `partsByItem`), `lib/db.js` (`attempt`
`messageOf`), `hooks/useExpenses.js` (`updateExpense` / `addExpenseOnce`
`parts`), `hooks/usePurchase.js` (`confirmCart` `partsByItem`),
`expenses/PurchaseForm.jsx`, `expenses/ExpenseForm.jsx`,
`grocery/ConfirmPurchase.jsx`, `pages/ExpensesPage.jsx`,
`expenses/EntryRows.jsx`, `expenses/ExpenseGroup.jsx`,
`expenses/MoneySummary.jsx`, `pages/GroceryPage.jsx` (K13).

**Tests: 1895 → 1961 (105 → 108 files).** New `lib/sharedParts.test.js`
(21: the payers from `PAID_BY_OPTIONS`, 029 seen on rows, stored parts,
the 27/10 personal views both ways round, the K4 note, the parts line,
K9 scaling and note, fill-the-rest, Split equally, required / not
required, the refusals and the fix, €0, the spread over lines: Lidl 33.40
= 20.00 + 13.40, a free line, cents on the line before, 27/10 over two
lines). `components/sharedParts.render.test.jsx` (27: Add expense one
expense both ways, Split equally + fix, €0, a person, before 029; a
purchase with a coupon, the coupon changed after, paid by a person; Edit
expense old without parts, both ways, an amount change, K9, Shared → a
person, a person → Shared, before 029; Confirm purchase with mixed
payers, a discount after, "Paid by (everything)", before 029; the
personal pills both ways — totals, chip, K4 note, "of €268.58", the parts
line, the purchase "of total", Totals per category and the chart — Edit
from a personal view, K9, Add expense after 029, before 029).
`hooks/expenseParts.test.jsx` (5: what is written, the 029 notice, Edit's
three cases, the detection). `pages/shopAdd.render.test.jsx` +3 (the
field right before the button in both views, with the form open, a search
cleared by "Go to card" in the List view). `supabase/migrations.test.js`
block "029" (10, PGlite: only the listed changes in one transaction; the
function is 023 line for line but the insert; before 029 the notice; run
twice, every check ok, other functions / policies / grants / data
unchanged, anon nothing; a stranger refused; a SHOP payload and a MONEY
payload without parts write exactly what 023 writes, Reopen too; a MONEY
and a SHOP purchase with Shared lines keep the parts per expense, each
line adds up, the totals as typed; the constraint), and the 9J check now
allows 029 (it doesn't touch `arrive_order` / `unarrive_order`).

**Later (not scheduled).**

- **Option B — "Shared account"** (a 4th payer for payments from a shared
  bank account, never split): only when such an account is really used
  for things recorded in the app. Needs a short label (the Money pills and
  the SHOP card pills risk sideways scroll at 375 px) and a reload of the
  older app version on the other phone (it shows an unknown payer as
  "Shared" in SHOP and as the raw code in Money).
- **Phase 2 — parts for orders**: Add order, Order online, Edit order and
  order groups (`orders` columns and a replaced `save_order_group` that
  spreads a group's parts like its discount). Moved here by decision K8b
  (01/11, below): built only when a Shared order really happens.
- **A one-tap "use the scaled parts" in "Edit expense"** (K16, 01/11): when
  the amount was changed elsewhere (K9), one button would put the scaled
  parts in the two fields. Not built; today they are typed again or fixed
  with "Put the difference on {label}". With phase 2.
- **A Telegram bot** (K176, 11/11; after the AI round): messages and
  receipt photos in English, Indonesian or Italian go to a Supabase Edge
  Function that calls the Claude API and records expenses and income in the
  app's tables. See 9O K176.
- CSV/Excel export: a 'names' column for the other names (K145).
- The 'It arrived!' toast with the order's other name, e.g. 'Added 1 pcs to "Chips & Snacks" (Corn Snack)' (K145).

### Follow-up 01/11 to 9K (as built; code and tests only, no SQL)

Decisions of the household, 01/11, on the 9K doubts. **No SQL**: no file
in `supabase/` changed; no new browser storage, no new offline queue.
Orders, order groups and their functions are not touched.

**K14 (doubt 1) — a part of €0 is not shown in that person's pill.**
`sharedParts.personalExpenses` passes a Shared expense into a person's
view only when that person's (shown, K9-scaled) part is above €0. Totals
are unchanged (the part was 0). A purchase: its lines of €0 for that
person are left out; when no line of theirs is left (every Shared line €0
and no own line), the purchase row is not shown in that view. A purchase
row that still shows keeps "of total €…" of the whole purchase.
"Everyone" and "Shared" are unchanged.

**K15 (doubt 2) — kept as built.** The parts of a Shared expense that has
them can't be emptied; changing "Paid by" to a person is the way.

**K16 (doubt 3) — kept as built.** A one-tap "use the scaled parts" in
"Edit expense" is under "Later" above, with phase 2.

**K17 (doubt 4) — kept as built.** No split box when every Shared line is
free (€0).

**K18 (doubt 5) — Shared is never saved without parts only because the
app couldn't tell yet that 029 has run.** `hooks/useExpenseParts.js`:
`useExpensePartsReady` now answers **true / false / null** (null = not
known: offline, or the read failed). The read is one small select of the
two part columns (`select('part_…, part_…').limit(1)`): it answers →
true (also with no expense at all); the database says the column doesn't
exist (42703 / PGRST204 naming a part column) → false; anything else →
null. Money's loaded expenses still tell by themselves (read with all
columns). While null the fields stay hidden, and the read is made again as
soon as the connection comes back (`useOnline`), so the box appears without
reopening the screen. Once true it stays known for this app start, and
every screen learns it (one shared answer).
Pressing **"Confirm purchase"** (SHOP, with at least one Shared line that
costs something), **"Add expense · €…" / "Save purchase · €…"** (Money
"+ Add expense", paid by Shared, total above 0) or **"Save"** (Money "Edit
expense", paid by Shared) while it is null: `checkExpenseParts()` reads
once first, then
- 029 there → the box shows (with "Type what {label} and {label} paid."),
  **nothing is saved yet**;
- 029 truly not there → saved exactly as before (no parts);
- no answer → nothing is saved, with the existing messages
  (`refuseUnknownParts`): offline "You're offline — this needs a
  connection."; otherwise "Couldn't save — check your connection.".
"Edit expense" of an expense read with the part columns knows by itself
(the row carries them). Paid by a person: no check. **No new text.**

**K19 (doubt 6) — kept as built.** The K4 note across the Money top card,
under the three boxes.

**K20 (doubt 7) — "Select" in a person's pill lists only their own
expenses**, exactly as before 9K (`ExpensesPage`: the rows without
`sharedPart`). Shared expenses (with or without parts) are merged from
"Everyone" or "Shared", which are unchanged. The totals, charts and "Set
the store of several expenses…" of the pill keep K2.

**K21 (doubt 8) — parts with more than 2 decimals are rounded to cents,
and the "add up" check adds the rounded values.** One rounding for typed
parts (`typedCents` in `lib/sharedParts.js`, half up as written: 100,555 →
100.56, not the 100.55 that 100.555 × 100 = 10055.4999… gave before). So
100,555 + 168,025 (= 268,58 as typed) is 100.56 + 168.03 = €268.59:
refused with "The parts add up to €268.59, not €268.58.", and "Put the
difference on {label}" gives cents that add up. Typing 100,555 fills the
other field with the rest of the rounded part (168.02). What is saved is
always the rounded values.

**K8b (decided 01/11) — phase 2 is moved to "Later".** Parts for orders,
Order online, Edit order and order groups are built only when a Shared
order really happens. Live data 01/11: no Shared orders; exactly one Shared
expense in October (27/10, a plain expense). Until then an order's expense
can get parts with "Edit expense" (K8).

**Files.** Changed: `lib/sharedParts.js` (K14, K21), `hooks/
useExpenseParts.js` (K18: true / false / null, `checkExpenseParts`,
`refuseUnknownParts`, read again when the connection comes back,
`forgetPartsForTest`), `expenses/ExpenseForm.jsx`,
`expenses/PurchaseForm.jsx`, `grocery/ConfirmPurchase.jsx` (K18, each
with a `checkParts` prop for tests), `pages/ExpensesPage.jsx` (K20).

**Tests: 1961 → 1981 (108 files).** `lib/sharedParts.test.js` +5 (K14 a
€0 part both ways round, a purchase with €0 lines and with every line €0;
K21 100,555 + 168,025 refused and fixed, fill-the-rest with the rounded
part). `hooks/expenseParts.test.jsx` 5 → 8 (Money's rows; the two-column
read: true also with no expense, false on "does not exist", null on
another error or none; offline nothing read, the connection back → true
without reopening; `checkExpenseParts` reaches every screen; the two
messages). `components/sharedParts.render.test.jsx` +12 (K14 in the
pills with a vet bill, a purchase with every line €0 and one with one
line of theirs;
K20 Select both ways round, Everyone and Shared; K18 Add expense checked
first → box, then saved with parts; truly not there → saved as before, a
person → no check; offline → nothing saved; Save purchase; Edit expense
with and without the columns, offline; Confirm purchase → box, not there,
offline, no Shared line; opened offline → the box appears when the
connection comes back; K21 on screen). `components/packSize.render.test.jsx`:
its Confirm purchase is "before 029" (`partsReady={false}`), since a
fake database that can't answer now means "not known".

**Next rounds (decided 01/11), in this order.**

1. ~~iPhone test of 9K (after 029 has been checked and run).~~ **Done
   01/11/2026: all OK.**
2. ~~**NEW NOTE 1 — units and pack contents in SHOP "+ Add to SHOP list".**
   The household buys e.g. soft drinks as "1 pack" (4 cans / bottles) but
   wants HOME stock counted in pcs. Today the form has no "pcs per pack"
   field (by design since 9H), the price unit next to "Unit price / Total
   price" seems to follow the quantity unit (not verified), and a NEW item
   created by "Confirm purchase" takes the purchase unit as its stock unit
   (so it counts packs). Read-only analysis first.~~ **Analysed 01/11
   (`tmp-export/units-readonly-report.md`), built 01/11 — section 9L**
   (SQL 030 written, not run yet).
2b. ~~Reopen / Undo purchase of items a purchase created, and unit changes
   after a purchase or an arrival (seen in the iPhone test of 9L).~~
   **Analysed 01/11 (`tmp-export/reopen-history-readonly-report.md`), built
   01/11 — section 9M** (SQL 031 written, not run yet).
3. ~~Round 6D (one item, many names; section 9D). **Next, after 9M.** Started
   06/11: section 9N.~~ **Done — section 9N.**
4. **MONEY display round** (**started 10/11 — section 9O**): notes 4 + 5 (in the plan's "Later" / 9F
   notes) plus NEW NOTES 2 + 3: in Money, the charts first; then "Totals
   per category" as a closed bar that opens on tap (like "History (N)" in
   Orders); then the expenses history (with Sort by) as a closed bar in
   the same way; the Income history also closed until tapped. Only how
   things are shown, not colours or content. Read-only analysis first.
5. Family Tree (another project).

Trips & Holidays (round 7) and AI (round 8) stay postponed.

### iPhone checklist for round 9K

iPhone test of 9K done 01/11/2026: all OK.

Written by Claude after 029 has been checked and run.

### 9L. Units for new items (decided 01/11, as built)

NEW NOTE 1. Analysis: `tmp-export/units-readonly-report.md` (01/11, read
only, sections A–J). The household chose **option B** (ask when a purchase
CREATES the HOME item) and decisions K1–K12 below; where they differ from
the report, they win. SQL: `supabase/030_new_item_units.sql` (not run yet;
the household runs it after Claude has checked it, after 029). The app is
deployed before 030 and works exactly as today until 030 is known. No new
browser storage, no new offline queue. Only `confirm_shopping_trip` is
replaced; `reopen_shopping_trip`, `arrive_order`, `unarrive_order` and every
other function are untouched.

Words: "package unit" = `PACKAGING_UNITS` (pack, box, case, carton, crate,
bag; `data/constants.js`, the existing list, exactly this one; tested by
`lib/newItemUnit.isPackageUnit`). "Stock unit" = `pantry_items.unit`. "Usual
pack size" = `packaging_unit` + `quantity_per_pack` (9H).

**K1 — option B, only where a purchase creates a NEW HOME item.**

- SHOP "Confirm purchase": a line with the grey text "new in the pantry"
  (`purchase.purchaseLine` `isNew`: no linked item and no normal item with
  the same name, capitals and outer spaces ignored, never a group — the way
  `confirm_shopping_trip` decides it).
- MONEY "+ Add expense": a row with "Add to HOME" on, not locked, whose note
  is "New in HOME (shown as New Item)." (`moneyPurchase.rowLine` `isNew`).
- Never on: a restock (the 9H pack field as today), a durable / service
  line, a group or variant line ("New variant…" takes the group's unit), a
  finished 1× item revived by name, "+ Add to SHOP list", Order online,
  MONEY "Add order".

**K2** Only for a package unit: never for pcs, btl, can, jar, roll…, never
for gr / kg / ml / L.

**K3 — no default.** The line can't be saved until a unit is chosen: the
box says **"Choose how to count it at home."** (also next to the MONEY Save
button; in SHOP the bottom says "Answer the question above to confirm.").
The purchase unit itself = exactly today's result (no field, nothing extra
sent). Another unit shows the required pack field of 9H (`PackSizeField`):
"{stock unit} per {purchase unit}", "= {n} {s}", "Type how many {s} are in
1 {u}.", "It will be saved as the usual size for next time.".

**K4 — the units offered** (`lib/newItemUnit.stockUnitChoices`): the
purchase unit, pcs, then btl, can, roll, jar, tube, sachet, tablet, capsule,
sheet, set, pair, shaker (all in the app's unit list; no difference found;
sheet, set, pair, shaker added in the 01/11 follow-up, K15). Never a measure, never
another package. On screen (`components/ui/StockUnitQuestion.jsx`): title
"Count it at home in", two pills [purchase unit] [pcs] (radios, 36 px high)
and a small drop-down "Other…" with the other count units (aria "Other unit
to count {name} in"); it wraps at 375 px, no sideways scroll.

**Result** (soft drink, not in HOME, "1 pack" €3.00, chosen pcs, 4 per
pack): new HOME item counted in pcs, stock 4, usual pack "pack" × 4, last
normal price €3.00 per 1 pack (shown "≈ €0.75 / pcs"), history "+4 pcs"
"Bought", New Item label as today; the line keeps quantity 1, unit pack,
stock_added 4, stock_unit pcs → MONEY opened purchase and Receipts "1 pack ·
4 pcs"; the expense exactly as today (€3.00, discounts, coupon, Shared
parts). MONEY "Min [ ] {unit}" follows the chosen unit (the minimum is sent
in it). Next purchase "2 pack" €6.00 → the item exists → 9H field starts at
4 → +8 pcs. Eggs "1 box" €2.90 → pcs 10 → 10 pcs, usual box 10; tissues "1
pack" €2.40 → roll 6 → 6 roll; beef slices "1 pack" → "pack" → 1 pack, no
usual size (= today); water "1 btl", "500 gr", a durable → no question.

**What is sent.** A line counted in another unit sends `new_stock_unit` and
`new_pack_size` (`newItemKeys`); `add` stays in the unit bought (1 pack), so
the 029 function (030 not run) ignores the keys and makes exactly today's
"1 pack", never a wrong stock. The keys are sent only once 030 is known.

**The same new name twice in one purchase** (new, a safety rule): the first
line makes the item, the next ones add to it. As soon as one of them has the
question, a later one must be counted in the first one's unit (or bought in
it): else it is blocked with `"{name}" is in this purchase twice — count it
in {unit} at home here too.` (`newItemUnit.sameNameProblems`,
`purchase.twiceProblems`, `moneyPurchase.twiceProblems`). Each line may have
its own pack size (pcs × 4 and pcs × 6 → +4 and +12).

**K5 — "It arrived!" → "Create a new item" starts from the order**
(`newItemUnit.arrivalPrefill`, `ItemEditor` `prefill`): an order not in a
package ("3 pcs", "2 btl") → that stock unit (a unit HOME can't count in →
pcs, without the price), "Current stock" = the quantity; an order in a
package ("1 pack") → "Bought in a different unit" on, "Purchase unit" = the
order's unit, "pcs per pack" EMPTY (saving says "Quantity per pack must be
more than 0." until it is typed — already so before 9L: the editor never
saved multipack with an empty size), stock unit pcs, "Current stock" = the
quantity counted in packs ("in pack ⇄"). Turning the multipack section off
there (stock in packs, package unit in HOME's list: pack, box) counts it in
the package: Unit becomes "pack", the stock number stays ("Counted in pack
at home."). Price: the order's normal price (`list_price ?? price`) for its
quantity and unit. Everything else of 9J unchanged (safety net, Undo, the
new item deleted while untouched).

**K6** "+ Add to SHOP list": the price row's unit ("per" [1] [unit]) with
only one option is plain text (aria "Price per unit"), same place, same
saved value (`PriceFields` `plainSingleUnit`, passed only by `AddItemForm`).
The card editor (`EntryControls`) and the HOME editor keep the select.

**K7** "+ Add to SHOP list": no "unusual unit" warning for a package unit
(`isPackageUnit`, was only case / carton / crate / bag). The HOME editor's
warning is unchanged.

**K8 — HOME "Edit item", changing "Unit (what you count stock in)".**

- Old unit a package, new one a count unit of K4 (pack → pcs): the question
  `Count "{name}" in {new} instead of {old}?` also offers **"Convert with the
  pack size"** (hint "Stock and minimum × the {new} in 1 {old} (the same
  amount, counted differently); the price stays per {old}.") with the field
  **"{new} in 1 {old}"** (shown only for that choice, required: "Enter a
  number above 0."; prefilled when the multipack fields hold a size for
  that package). Result: stock × n, minimum × n, multipack on with Purchase
  unit = the old unit and size n, the price still per the old unit (2 pack,
  min 1, €3.00 per 1 pack, 4 → 8 pcs, min 4 pcs, €3.00 per 1 pack ≈ €0.75 /
  pcs). Note: "Converted from pack: stock 8 pcs, minimum 4 pcs. 1 pack = 4
  pcs." "Keep the numbers as they are" unchanged. (`askDialog` fields may
  now have `shownWhen`.)
- Whenever saving would change the price's unit because it is no longer
  offered (a price without a unit was per the item's own unit), a yellow
  line under the price before saving: "The price was €3.00 per 1 pack — it
  will be saved as €3.00 per 1 pcs. Check it."
- Variants and groups: unchanged (the select stays disabled).

**K9 — Confirm purchase blocked by a total that can't be worked out.** The
two cases are told apart: `lineTotal` is `null` for a line WITH a price
whose unit can't be converted ("2 pack" at €0.75 per pcs, no usual size) and
`0` for a line without a price. Only the first blocks "Confirm purchase ·
€…" (the line and the bottom say "The total can't be worked out from the
price's unit — type the total paid."); typing the total frees it. A line
without a price: as today.

**K10 — before 030.** `hooks/useNewItemUnits.js` (like 9K K18): one small
select of `shopping_trip_items.stock_unit`; it answers → true; 42703 /
PGRST204 naming `stock_unit` → false; anything else / offline → null, read
again when the connection comes back; once true, known for the app start.
While null or false the question is hidden. "Confirm purchase" / "Add
expense · €…" / "Save purchase · €…" with a line that WOULD be asked while
it is null: read first — true → the question shows, nothing saved; false →
saved as today; no answer → nothing saved, "You're offline — this needs a
connection." / "Couldn't save — check your connection." (the 9K messages).

**K11 — history of a converted unit.** "Convert with the pack size" and
the kg ↔ gr / L ↔ ml "Convert the numbers" write ONE history row with the
new reason `converted`, label **"Unit changed"**, shown in Home → History
with the new stock only ("→ 8 pcs"), never the difference (the row still
stores it: change 6). Before 9L the kg ↔ gr conversion wrote one "Adjusted"
row ("+1998 gr → 2000 gr"). "Keep the numbers as they are" keeps today's
behaviour: no row while the numbers stay the same; a stock then typed by
hand is one "Adjusted" row. `stock_logs.reason` has no check constraint, so
no SQL; the New Item rule reads only purchased / restocked.

**K12** No data fix: items counted in pack / box are converted by hand with
K8.

**SQL `supabase/030_new_item_units.sql`.** `alter table shopping_trip_items
add column if not exists stock_unit text` (the stock unit of the item when
the line added it, new or existing item; null for a line without an item
and for every line before 030; `purchasedPackLabel` uses it when present,
else the item's current unit as before) and `create or replace function
confirm_shopping_trip` from the 029 version. One transaction (`begin; …
commit;`), checks that 015 and 029 have run, safe to run twice, no data
change, no other function / policy / grant; same signature, `search_path =
public`, household check (42501), security invoker, grants kept (closed to
anon / public). One check SELECT, 9 rows, each "ok": the column; the
function writes stock_unit, has the new-item keys, still writes each
person's part (029), search_path, invoker, household check, anon none; and
"purchase lines with stock_unit (0 the first time)". Last line `-- End of
030`. When the keys are sent but an item with that name is found (an
earlier line of the same purchase, or the other phone): counted in
new_stock_unit → add × new_pack_size; in the line's unit → add as sent;
otherwise the error `"{name}" is in HOME already, counted in {unit} (added
meanwhile?) — check the line and save again.` and nothing is saved (the
screen stays open; after the reload the line shows "restocks …" with the 9H
field). Only one key, the unit bought itself, or a size ≤ 0 → ignored.

Every changed line of `confirm_shopping_trip` (030 compared with 029, from
`diff -U0` of the two function bodies; the test "030" checks the same with
its own line diff):

| Where (line in the 029 function body) | Change | For a payload without the new keys |
|---|---|---|
| declare (after 31) | + comment, `v_new_unit text;`, `v_new_pack numeric;`, `v_stock_unit text;` | — |
| per line, after `v_line := …` (97) | + comment; `v_new_unit := nullif(v_item->>'new_stock_unit', '');`, `v_new_pack := nullif(v_item->>'new_pack_size', '')::numeric;`, both set back to null unless both are there, the unit differs from the line's and the size is > 0; `v_stock_unit := null;` | Both null. |
| existing item, after `v_stock := coalesce(pi.current_stock, 0);` (128) | + `v_stock_unit := pi.unit;` + comment + `if v_new_unit is not null then` (found in that unit → `v_add := v_add * v_new_pack`; not in the line's unit either → `raise exception …`) `end if;` | Skipped (`v_new_unit` null). |
| new item, before its insert (159) | + comment, `v_stock_unit := coalesce(v_new_unit, g.unit);`, `if v_new_unit is not null then v_add := v_add * v_new_pack; end if;` | `v_stock_unit` = `g.unit`, `v_add` unchanged. |
| `insert into pantry_items (…, one_time, min_stock)` (159) | `→ (…, one_time, min_stock, packaging_unit, quantity_per_pack)` | — |
| its values `…, v_add, g.unit,` (161) | `g.unit` → `v_stock_unit` | The same value. |
| its values `…, coalesce((v_item->>'min_stock')::numeric, 0)` (167) | + `, case when v_new_unit is not null then g.unit end, v_new_pack` | Both null = what 029 leaves (no usual size). |
| its history row `values (v_pantry, …, g.unit, 'purchased')` (173) | `g.unit` → `v_stock_unit` | The same value. |
| line insert (196, 200, 206) | + comment; column list `…, coupon_share` → `…, coupon_share, stock_unit`; values `…, 0)` → `…, 0), case when v_pantry is not null then v_stock_unit end` | Only the new column is written (the item's unit, or null without an item). |

Everything else — the expense insert with each person's part (029), the
1× / minimum / price / payer fields, the SHOP checks, the MONEY branch, the
SHOP entry updates, the photos and the total — is the 029 text line for
line. Reopen / Undo purchase / the Undo toast still delete a new item made
by the purchase exactly (`pantry_created`), tested.

**Files.** New: `supabase/030_new_item_units.sql`, `src/lib/newItemUnit.js`
(+ test), `src/hooks/useNewItemUnits.js`, `src/components/ui/
StockUnitQuestion.jsx`. Changed: `lib/purchase.js` (`purchaseLine`
`unitsReady` / `stockUnit` / `isNew` / `asksStockUnit`, `confirmationPayload`,
`twiceProblems`), `lib/moneyPurchase.js` (`emptyRow.newUnit`, `rowLine`
`unitsReady` / `stockUnit` / `minUnit`, `rowProblem`, payload,
`twiceProblems`), `lib/packSize.js` (`purchasedPackLabel` reads
`stock_unit`), `lib/feedback.js` + `ui/Feedback.jsx` (`shownWhen`),
`grocery/ConfirmPurchase.jsx` (K1–K4, K9, K10; props `unitsReady`,
`checkUnits`), `expenses/PurchaseForm.jsx` (K1–K4, K10; same props),
`expenses/ArrivedDialog.jsx` (K5), `inventory/ItemEditor.jsx` (K5, K8,
`onSave(fields, { converted })`), `inventory/PriceFields.jsx` (K6),
`grocery/AddItemForm.jsx` (K6, K7), `hooks/usePantryItems.js` (K11
`updateItem(item, fields, { converted })`), `pages/PantryPage.jsx`,
`inventory/HistoryView.jsx` (K11).

**Tests: 1981 → 2041 (108 → 112 files).** New `lib/newItemUnit.test.js`
(21: the unit lists, when it is asked, no default, the purchase unit = today,
pcs 4 / box 10 / roll 6 / 2 × 4 = 8, answers for another unit, SHOP and
MONEY lines and payloads, every "never asked" case, before 030, labels with
`stock_unit`, the arrival prefill, the column check, the same name twice),
`components/newItemUnit.render.test.jsx` (21: Confirm purchase every state,
the drop-down, eggs / two packs, never asked, before 030, K10 true / false /
no answer / offline / nothing to ask, the same name twice; K9 blocked and
freed, no price not blocked; MONEY every state, Min unit, never asked, K10;
K6 / K7; K8 convert, keep + price warning, kg → gr / pcs → btl / variant;
K5 in the editor; K11 history row), `components/newItemArrival.render.test.
jsx` (2: "It arrived!" → "Create a new item" from "1 pack" and "2 btl",
Undo), `hooks/unitConvertHistory.test.jsx` (3: K11 rows). Changed:
`lib/feedback.test.js` +1 (`shownWhen`), `components/packSizeHistory.
render.test.jsx` (a line with `stock_unit` whose item is gone, MONEY and
Receipts), `supabase/migrations.test.js` block "030" (12, PGlite: only the
listed objects, one transaction; the function = 029 but the listed lines
(line diff); before 030 the column is missing and the 029 function makes
"1 pack" from a payload with the keys; run twice, every check ok, other
functions / policies / grants / data unchanged, anon nothing; a stranger
refused; SHOP and MONEY payloads without the keys = 029 + stock_unit, Reopen
too; with the keys: 4 pcs + usual pack 4 + history in pcs + line "1 pack ·
4 pcs", beef slices in packs, Reopen deletes exactly; the next "2 pack" →
+8; MONEY eggs 10 pcs / tissues 6 roll with Shared parts; the same name
twice, found in the unit bought, found in another unit → refused and
nothing changed; one key alone ignored), and the 9J check allows 030.

**Labels and paths (for Claude's test instructions).** Left menu: Plan,
Shop, Home, Money.

| What | Path | Exact labels |
|---|---|---|
| Question in Confirm purchase | Shop → List → "Confirm purchase ({n} in the cart)" → screen "Confirm purchase" → the line with grey "… · new in the pantry" | box "Count it at home in"; pills "pack" / "pcs" (radios; the first is the line's own unit: "box", "case"…); drop-down "Other…" (aria "Other unit to count {name} in") with btl, can, roll, jar, tube, sachet, tablet, capsule, sheet, set, pair, shaker |
| — not chosen | same | "Choose how to count it at home."; bottom "Answer the question above to confirm."; button "Confirm purchase · €3.00" greyed |
| — purchase unit | tap "pack" | nothing more; Confirm works (= today) |
| — pcs / other | tap "pcs" (or pick from "Other…") | field "pcs per pack" (aria "pcs per pack for {name}"); empty: "Type how many pcs are in 1 pack."; typed 4: "= 4 pcs" and "It will be saved as the usual size for next time." |
| — same name twice | two cart lines, same name | `"{name}" is in this purchase twice — count it in pcs at home here too.` |
| Question in MONEY | Money → section Expenses → "Add expense" → card "ADD AN EXPENSE" → name, €, quantity, unit "pack", HOME item category, "Add to HOME" on ("New in HOME (shown as New Item).") | the same box under "Add to HOME" (aria "pcs per pack for {name}" / with several rows the same with the row's name); "Min [ ] pcs — below this it goes on the SHOP list"; after "Save purchase · €3.00": "Choose how to count it at home." / "Type how many pcs are in 1 pack." next to the row and above the button |
| Before 030 known | — | no box; pressing the button reads first; offline: toast "You're offline — this needs a connection."; other failure: "Couldn't save — check your connection." |
| K14 editor from an order in bag / case / carton / crate | same path as K5, an order "1 bag" | "Bought in a different unit" greyed (can't be tapped); under it "bag can't be a HOME unit — type how many pcs are in 1 bag."; "pcs per bag" empty; "Add to inventory" → "Quantity per bag must be more than 0." until typed (K24; "1 case" → "Quantity per case must be more than 0.") |
| K5 editor from an order | Money → section Orders → an order card "Arrived" (or Shop → List → "On the way" card "Arrived") → "It arrived!" → "Create a new item" → "Add an item" | "Unit (what you count stock in)" = "pieces (pcs)"; "Bought in a different unit" (on); "Purchase unit" = pack; "pcs per pack" empty; "Current stock" with "in pack ⇄" = 1; "Price (e.g. …)" = 3.00 per 1 pack; "Add to inventory" → if empty "Quantity per pack must be more than 0."; toast `"{name}" is now in HOME` + "Undo"; tapping "Bought in a different unit" off → Unit "pack", note "Counted in pack at home." |
| K6 | Shop → List (or Shop) → "+ Add to SHOP list" → "ADD TO SHOP LIST" → unit "pack" for a name not in HOME | price row "€ 0.00" "per" [1] **pack** (plain text, not a drop-down) |
| K7 | same, category Beverages, unit "pack" | no "is unusual for" line (unit "jar": `"jar" is unusual for Beverages (usually btl, can, ml, L).`) |
| K8 question | Home → Items → the item tile → pencil (title "Edit") → "Edit item" → "Unit (what you count stock in)" → "pieces (pcs)" | `Count "{name}" in pcs instead of pack?`; choices "Convert with the pack size" (with field "pcs in 1 pack") and "Keep the numbers as they are"; buttons "Cancel" / "Change unit"; empty field: "Enter a number above 0."; then the note "Converted from pack: stock 8 pcs, minimum 4 pcs. 1 pack = 4 pcs."; "Save changes" |
| K8 price warning | same, "Keep the numbers as they are" | under the price: "The price was €3.00 per 1 pack — it will be saved as €3.00 per 1 pcs. Check it." |
| K23 kg ↔ gr / L ↔ ml | Home → Items → the item tile → pencil (title "Edit") → "Edit item" → "Unit (what you count stock in)" kg → gr → "Keep the numbers as they are" → "Change unit" | note "Quantities weren't converted — check stock and minimum in gr."; price row still "€2.50" "per" [1] kg; no yellow "The price was …" line; saved per 1 kg |
| K24 pack size | "Add an item" (Home → Items → "Add item"), "Edit item" (as above) or "It arrived!" → "Create a new item": "Bought in a different unit" on, "pcs per {purchase unit}" empty or 0 → "Add to inventory" / "Save changes" | red under the form: "Quantity per bag must be more than 0." / "Quantity per case must be more than 0." / "Quantity per box must be more than 0." / "Quantity per pack must be more than 0." (follows "Purchase unit") |
| K9 | Shop → List → "Confirm purchase (…)", a line "2 pack" priced per pcs with no usual size | on the line and at the bottom "The total can't be worked out from the price's unit — type the total paid."; header "· 1 without a total"; "Confirm purchase · €…" greyed until "Total for {name}" is typed |
| K11 | Home → History | row "{name}" · "Unit changed · {date}" and "→ 8 pcs" (no "+6 pcs") |
| "1 pack · 4 pcs" | Money → section Expenses → the purchase row (tap to open) → under the item; Shop → Receipts → the purchase | "1 pack · 4 pcs" (two: "2 pack · 4 pcs each · 8 pcs") |

Not confirmed on a phone: everything in this table (written from the code
and the render tests).

**Decisions on the doubts (01/11): K13–K21.**

- K13: kept as built — an item with that name already in HOME in another
  unit → the 030 error, nothing saved.
- K14: "It arrived!" → "Create a new item" from an order in case, carton,
  crate or bag (not in HOME's unit list): "Bought in a different unit" can't
  be turned off (disabled, with "{unit} can't be a HOME unit — type how many
  {stock unit} are in 1 {unit}."), so "{stock unit} per {unit}" stays
  required. Orders in pack / box: unchanged.
- K15: the count units are ALL count units (pcs, btl, can, roll, jar, tube,
  sachet, tablet, capsule, sheet, set, pair, shaker), one constant
  (`COUNT_STOCK_UNITS`) for "Count it at home in" and for "Convert with the
  pack size"; all 13 are in HOME's unit list (none left out).
- K16: kept as built (the pack-size field of the conversion starts empty).
- K17: kept as built (the conversion replaces an old multipack).
- K18: kept as built (one history row "Unit changed" "→ {n} {unit}", also
  when the stock was edited in the same save).
- K19: "Edit item", kg ↔ gr / L ↔ ml with "Convert the numbers": a price per
  the old unit (also one saved without a price unit) is saved still per the
  old unit (€2.50 per 1 kg stays per 1 kg after kg → gr); no warning then.
  The K8 warning stays where the old price unit can't be kept (pack → pcs
  without a pack size).
- K20: kept — the "same name twice in one purchase" rule.
- K21: kept as built (an unknown order unit → pcs, no price).

SQL 030 checked by Claude on 01/11 with a real diff against 029: only the listed lines differ.

### Follow-up 01/11 to 9L (as built; code and tests only, no SQL)

- K14 (`inventory/ItemEditor.jsx`): `packageLocked` = started from an order
  in a package, multipack on, and the purchase unit not in `UNIT_VALUES`
  (case, carton, crate, bag). The "Bought in a different unit" button is
  disabled and the line under it reads e.g. "bag can't be a HOME unit —
  type how many pcs are in 1 bag."; saving with "pcs per bag" empty still
  says "Quantity per pack must be more than 0." (1 bag, 10 → 10 pcs, usual
  bag 10, price per 1 bag). Changing "Purchase unit" to pack or box frees
  the button (it is then a pack / box order).
- K15 (`lib/newItemUnit.js`): `COUNT_STOCK_UNITS` + sheet, set, pair,
  shaker. "Other…" in Confirm purchase and MONEY lists them after capsule;
  "Edit item" pack → sheet offers "Convert with the pack size" ("sheet in 1
  pack"; 2 pack × 10 = 20 sheet, minimum 1 → 10 sheet). 030 accepts any
  `new_stock_unit` (no unit list in the SQL).
- K19 (`inventory/ItemEditor.jsx` `applyUnit`): a saved item (not a group)
  converted kg ↔ gr / L ↔ ml keeps `price_unit` = the price's unit or, when
  it had none, the old unit ("per 1 kg" / "per 1 L" in the price row,
  saved so). "Keep the numbers as they are" and new items: unchanged.
- Tests 2041 → 2049 (112 files): `lib/newItemUnit.test.js` +1 (K15) and the
  unit list test (13 units, every count unit of the app's list);
  `components/newItemUnit.render.test.jsx` +7 (K15 Confirm and MONEY
  sheet 10; K14 bag and case / pack; K15 Gelatin Sheets and Color Fade
  Prevention Sheet → sheet; K19 kg → gr with "kg" and without a unit; K19
  L → ml and the pack → pcs warning).

Decisions on the doubts (01/11, second): K22 kept as built; K23 price kept
per the old unit for kg↔gr and L↔ml with either choice; K24 the pack-size
error follows the Purchase unit.

SQL 030 run by the household on 01/11/2026: all 9 checks ok (0 of 267
purchase lines with stock_unit).

- K22: kept as built — the lock of "Bought in a different unit" follows the
  Purchase unit currently selected (bag / case / carton / crate locked; pack
  / box free).
- K23 (`inventory/ItemEditor.jsx` `applyUnit`): a saved item (not a group)
  changed kg ↔ gr / L ↔ ml keeps `price_unit` = the price's unit or, when it
  had none, the old unit, also with "Keep the numbers as they are" (2 kg at
  "€2.50 per 1 kg" → gr, keep: stock 2 gr, minimum 1 gr, still "€2.50 per 1
  kg", no warning). The K8 warning stays where the old price unit can't be
  kept (pack → pcs without a pack size: "The price was €3.00 per 1 pack — it
  will be saved as €3.00 per 1 pcs. Check it.").
- K24 (`inventory/ItemEditor.jsx` `handleSubmit`, the only place the text
  is made): "Quantity per {purchase unit} must be more than 0." — "Quantity
  per bag must be more than 0.", "Quantity per case must be more than 0.",
  "Quantity per box must be more than 0.", "Quantity per pack must be more
  than 0.". One editor, so it applies to "Add an item", "Add a variant to
  {group}", "Edit item", "Add a group" / "Edit group" and "It arrived!" →
  "Create a new item" (`expenses/ArrivedDialog.jsx` opens the same editor).
- Tests 2049 → 2056 (112 files): `components/newItemUnit.render.test.jsx`
  +6 (K23 kg → gr with "kg" and without a unit, L → ml with "L" and without
  a unit, pack → pcs still warns and saves per 1 pcs; K24 "Add an item" bag
  / case / box / pack with an empty size and 0, "Edit item" case → box, an
  order "1 case" / "1 box") and the K14 bag test now expects "Quantity per
  bag must be more than 0."; `components/newItemArrival.render.test.jsx` +1
  (the real "It arrived!" dialog, an order "1 bag": "Quantity per bag must
  be more than 0.", then 10 → 10 pcs, usual bag 10, €5.00 per 1 bag).

### iPhone checklist for round 9L

Written by Claude after 030 has been checked and run.

iPhone test of 9L done 01/11/2026: all OK except the leftover history row after Reopen (→ 9M).

### 9M. Reopen of items a purchase created (decided 01/11, as built)

Seen on the iPhone in the 9L test (01/11): SHOP "Confirm purchase" made a
new HOME item (1 pack), "Edit item" converted it to 4 pcs, "Reopen
purchase" deleted the item and its "Bought" row, but the "Unit changed" row
stayed in Home → History. Analysis: `tmp-export/reopen-history-readonly-
report.md` (01/11, read only, A–H). The household chose **option D** and
K25–K31 below; where they differ from the report, they win. SQL:
`supabase/031_reopen_created_items.sql` (not run yet; the household runs it
after Claude has checked it, after 030). The app is deployed before 031 and
works exactly as today until it has run, also with an older app version on
the other phone. No new browser storage, no new offline queue.

Last definitions (checked with `grep` on every `supabase/*.sql`):
`reopen_shopping_trip` — `supabase/023_oct_2026_features.sql` lines
567–648 (024–030 don't touch it); `unarrive_order` —
`supabase/021_connected_flow.sql` lines 336–376 (022–030 don't touch it).
Both are security invoker. 031 replaces only these two.

**K25 — option D.** Reopen / "Undo purchase" / the Undo toast (all
`reopen_shopping_trip`), a line that CREATED its item (`pantry_created`):

- not touched from elsewhere (K26) → the item is deleted with EVERY history
  row of it (`stock_logs.item_id` = the item) and its automatic "to buy"
  SHOP entries (K31): "this purchase never happened";
- touched from elsewhere → the item is KEPT: only this line's stock comes
  out (converted, K27), only this line's own history rows (`log_ids`) go,
  the other rows stay, and a toast says so (see "Texts").

**K26 — "touched from elsewhere"** = any of: a history row of the item that
is not a row of this purchase's lines and put stock in (`change > 0`, any
reason but `converted`: Bought by another purchase or an arrival,
Restocked by "+" / "Add bought stock", Adjusted up); another purchase's line
pointing to the item; ANY order pointing to it (`pantry_item_id` or
`arrived_item_id`, any status). Not elsewhere: Used, Discarded, a "Unit
changed" row that is a plain conversion. A "Unit changed" row whose numbers
are NOT a plain conversion (new stock ≠ old × 1, × 1000, × 0.001 or × the
item's pack size now, within 0.0001 of the new stock — e.g. a stock typed in
the same save, 9L K18) counts as elsewhere: the item is kept (Kata ragu).

**K27 — the stock of a kept item after a unit change.** The line's
`stock_added` is converted from the unit it was counted in —
`shopping_trip_items.stock_unit` (030); for an older line the unit of its own
"Bought" row; without either, the line's own unit, and then ONLY when that
is the item's unit (Kata ragu) — to the item's unit now: same unit → as is;
kg ↔ gr, L ↔ ml → × 1000 / × 0.001; the item's usual pack (`packaging_unit`
= that unit, `quantity_per_pack` = n > 0) → × n. No conversion → nothing is
taken out (the stock is not touched at all) and a toast says to check it.
Example: bought 1 pack, converted to 4 pcs (1 pack = 4), another purchase
+8 pcs → 12 pcs; Reopen of the first → 8 pcs.

**K28** No data fix for history rows that already have no item.

**K29** Home → History: every row whose item no longer exists (`item_id`
empty) shows a small grey **"deleted item"** after the date ("Unit changed ·
1 Nov 2026, 10:00 · deleted item"). App only. The HOME trash stays as it is
(history kept, Undo relinks it).

**K30 — the same conversion for EXISTING items (031).**

- `reopen_shopping_trip`, an item not created by the line: `stock_added`
  (and the expired stock thrown away at the purchase, `stock_discarded`) is
  converted as K27 before it is taken out (put back). Item 1 pack +
  purchase 1 pack = 2 pack, converted to 8 pcs (1 pack = 4), Reopen → 8 − 4
  = 4 pcs. When the unit changed after the purchase (the line's unit ≠ the
  item's unit now), the usual pack size of NOW is kept (never the one in
  `pantry_before`) — and also without a unit change when `pantry_before`
  had a complete usual size (K33, below), and a price that had no unit before the purchase is put
  back per the unit it was counted in then ("€3.00 per 1 pack", not per 1
  pcs; Kata ragu). Price, price quantity, payer, last bought and expiry are
  put back from `pantry_before` as today. No conversion → the stock is not
  touched, toast. Lines without a unit change (also those before 030,
  `stock_unit` empty, with their "Bought" row) → exactly as today.
- `unarrive_order` ("Back on the way", the Arrived Undo): the arrival's
  `stock_added` is converted from the unit of the arrival's own history row
  (`orders.arrived_log_id` → `stock_logs.unit`; that row gone → the item's
  unit, as today). No conversion → nothing taken out, toast. No unit change
  → exactly as today.

**K31** An item deleted by K25 also loses its automatic "to buy" SHOP
entries, the rule of the HOME trash (decision 37): `auto_generated`, not
bought, not in a cart, no order on the way for it — never one typed by hand,
and never the SHOP entry of any line of this purchase. The purchase line's
own entry still goes back to the cart (SHOP purchase) or to "to buy" (MONEY
purchase) as today, no longer linked (the foreign key unlinks it).

**What the app knows (no new return type).** Both functions keep their
return type (`integer` / `orders`), so an older app version works as
before. `usePurchase.reopenTrip` reads the purchase's lines, their HOME
items and the lines' own history rows just before the call, and the items
just after it; `useOrders.unarriveOrder` / `undoArrival` read the arrival's
item and its own history row before, the item after.
`lib/reopenUnits.js` (pure, the rules of 031) then says what to tell:

- a created item still there afterwards was kept — before 031 the database
  always deletes it, so this never shows before 031;
- stock that couldn't be converted is named only when the item's stock is
  what 031 leaves AND not what the database before 031 would have made of
  it — so before 031 nothing new is said.

When a read fails, the purchase is reopened (the order put back) all the
same, without the note.

**Texts** (English, exact):

- `"{item}" stays in HOME — it also got stock or an order from elsewhere;
  this purchase's {qty} were taken out.` ({qty} in the item's unit now, "4
  pcs"; without stock added: `"{item}" stays in HOME — it also got stock or
  an order from elsewhere.`)
- `"{item}": this purchase's stock couldn't be taken out (its unit changed)
  — check it in HOME.`
- kept and not convertible: `"{item}" stays in HOME — it also got stock or
  an order from elsewhere; this purchase's stock couldn't be taken out (its
  unit changed) — check it in HOME.`
- "Back on the way" / the Arrived Undo: `"{item}": this arrival's stock
  couldn't be taken out (its unit changed) — check it in HOME.`
- The "Back on the way" question (K37), when the arrival's own history row
  (`orders.arrived_log_id` → `stock_logs.unit`) was counted in another unit
  than the item's now (K39: the temporary "Until the database update
  supabase/031_reopen_created_items.sql has run, …" sentences were removed
  after 031 ran):
  - convertible: `Its arrival added 1 pack (4 pcs) to HOME. That stock is
    taken out again, so it isn't counted twice when it really arrives.`
  - not convertible: `Its arrival added 1 pack to HOME. That stock won't be
    taken out (its unit changed) — check "{item}" in HOME.`
  - the same unit, the arrival's row gone, or the item / row can't be read:
    the text as before (`Its arrival added {qty} to HOME. That stock is taken
    out again, …`; the same). The variant with a
    new item (`… and created "{item}" …`) and the K20 expense part: as
    before. The Arrived
  Undo toast after a unit change says what really came out (`"Soap" is on
  the way again — 4 pcs taken out of "Soap"`); without a unit change as
  before.
- Each note is its own toast, after "Purchase reopened — the items are back
  in the cart." / "Purchase undone — its expenses are deleted and HOME stock
  is back as before." (unchanged).
- Question "Undo this purchase?" (would now be wrong): "… the stock it added
  to HOME is taken back (an item it created is removed again**, unless it
  also got stock or an order from elsewhere**). …". "Reopen this purchase?"
  ("… the stock, history and expenses from this purchase are undone.") and
  the "Part of a purchase" hints stay: still right.

**SQL `supabase/031_reopen_created_items.sql`.** `create or replace` of
`reopen_shopping_trip` (from 023) and `unarrive_order` (from 021). One
transaction (`begin; … commit;`), checks that 015 and 030 have run
(`shopping_trip_items.stock_unit`), safe to run twice, no data change, no
other function / table / policy / grant; same signatures and return types,
`search_path = public`, household check (42501), security invoker, grants
kept (create or replace keeps them: closed to anon / public, open to
authenticated). One check SELECT, 14 rows, each "ok": per function the 031
part, the return type, search_path, invoker, household check, anon none
(reopen also: all history of an untouched created item, its automatic
entries). Last line `-- End of 031`.

Every changed line of `reopen_shopping_trip` (031 compared with 023 lines
567–648, from `diff -U0` of the two function bodies; the test "031" checks
the same with its own line diff):

| Where (line in 023) | Change | A line without a unit change, an item not created |
|---|---|---|
| declare, after `v_source text;` (576) | + comment, `pi pantry_items;`, `v_unit text;`, `v_factor numeric;`, `v_elsewhere boolean;`, `v_trip_logs uuid[];`, + comment, `v_keep_pack boolean;` (K33) | — |
| after the `merged` refusal (590) | + comment, `select coalesce(array_agg(l.id), '{}') into v_trip_logs from shopping_trip_items i cross join lateral unnest(i.log_ids) …` (the history rows of every line of this purchase) | Read only. |
| inside `if ti.pantry_item_id is not null then` (596–609: `if ti.pantry_created then delete …; else update … end if;`, 14 lines) | replaced by: lock the item (`select * into pi … for update`; gone → skipped, as before); `v_unit` = `stock_unit`, else the line's "Bought" row's unit; `v_factor` (null unit → 1 only when the line's unit is the item's; same unit 1; kg/L → 1000; gr/ml → 0.001; usual pack → its size; else null); `v_unit := coalesce(v_unit, ti.unit)`; `v_elsewhere` (K26); created and not elsewhere → delete its automatic "to buy" entries (K31), all its history, the item; created and elsewhere → `current_stock − stock_added × factor` (nothing when null); otherwise `v_keep_pack := v_unit is distinct from pi.unit or (coalesce(ti.pantry_before->>'packaging_unit', '') <> '' and coalesce((ti.pantry_before->>'quantity_per_pack')::numeric, 0) > 0);` (K33) and the 023 update with `current_stock` = (null → unchanged, else `greatest(0, stock − added × f) + discarded × f`), `price_unit` from `pantry_before` unless the unit changed (then: the price's unit or the unit counted in), `packaging_unit` / `quantity_per_pack` = `case when v_keep_pack then` the item's values of now `else` `pantry_before`'s `end`, `where p.id = pi.id` | `v_factor` = 1, unit unchanged: the same values as 023 (`stock − added + discarded`, every field from `pantry_before`) — except the usual pack size when `pantry_before` had a complete one (K33): the item's of now, which is `pantry_before`'s unless it was changed by hand after the purchase. |

Everything else — the household check, the lock on the purchase, the
`merged` refusal, the order of the lines, `delete from stock_logs where id =
any(ti.log_ids)`, the expense delete, the three SHOP entry branches, merged
expenses split off, the purchase delete and the count — is the 023 text
line for line.

Every changed line of `unarrive_order` (031 compared with 021 lines
336–376):

| Where (line in 021) | Change | No unit change |
|---|---|---|
| declare, after `pi pantry_items;` (344) | + comment, `v_unit text;`, `v_factor numeric;` | — |
| `v_stock := greatest(0, … − o.stock_added);` and its `update` (360–361) | + comment; `v_unit := coalesce((select l.unit from stock_logs l where l.id = o.arrived_log_id), pi.unit);` `v_factor := case …` (same rules as reopen); `if v_factor is not null then v_stock := greatest(0, … − o.stock_added * v_factor); update … end if;` | `v_factor` = 1: the 021 values. |

Everything else (the household check, the lock, "not arrived → as it is",
the arrival's history row deleted, the order back on the way, its SHOP
entry) is the 021 text line for line.

**Files.** New: `supabase/031_reopen_created_items.sql`,
`src/lib/reopenUnits.js` (+ test). Changed: `hooks/usePurchase.js`
(`reopenTrip` reads before / after and shows the notes; the "Undo this
purchase?" text), `hooks/useOrders.js` (`unarriveOrder`, `undoArrival`:
`readArrivalItem`, `arrivalUndone`), `components/inventory/HistoryView.jsx`
(K29), `hooks/arrivalDb.fixture.js` (`{ units: true }` plays 031's
`unarrive_order`).

**Tests: 2056 → 2095 (112 → 115 files).** New `lib/reopenUnits.test.js`
(13: every factor, a line's unit, the "Bought" row, an arrival; the exact
texts; kept with 4 pcs / 1 pack / no stock; kept and not convertible; a
created item gone; not convertible said only with 031's result; converted
or unchanged → nothing; a line before 030 by its "Bought" row; the arrival
note; what really came out), `hooks/reopenNotes.test.js` (8: Reopen with 031
→ kept toast, with 023 → nothing new; not convertible with 031 / 023 (MONEY);
lines not readable → reopened without notes; the two questions; "Back on the
way" 031 converted → 8 pcs, not convertible → toast, 021 → nothing new; the
Arrived Undo "4 pcs taken out" / not convertible), `components/
historyDeletedItem.render.test.jsx` (1: K29). Changed: `supabase/
migrations.test.js` block "031" (17, PGlite: only the two functions, one
transaction, nothing outside them; each = its last version except the listed
lines (line diff), nothing later defines them; before 031 the "Unit changed"
row is left and nothing is said; run twice, every check ok, other functions /
policies / grants / columns / data unchanged, anon refused; a stranger refused
(42501) by both; cases 1–12 below), and the 9J guard allows 031 (it replaces
`unarrive_order`, never `arrive_order`).

Cases checked in block "031" (every number):

1. created "1 pack", "Unit changed" → 4 pcs, Reopen → the item, all its
   history and its automatic "to buy" entry gone; an automatic entry in a
   cart, one ordered online and one typed by hand stay (unlinked); the
   purchase's own entry back in the cart (unlinked); the expense gone.
2. created "2 pack", one "Used" → item and history gone.
3. created 1 pack + another purchase +2 pack, Reopen of the first → kept, 2
   pack; the other purchase's "Bought" row, line and €6.00 expense untouched;
   toast "… this purchase's 1 pack were taken out."
4. created 1 pack, converted (1 pack = 4), another purchase +8 pcs (12 pcs),
   Reopen of the first → 8 pcs, usual pack 4 kept; toast "4 pcs".
5–7. created + "Adjusted" +2 → 2 pack; + "+" restock +1 → 1 pack; + an order
   pointing to it (cancelled) → 0 pack; all kept.
8. existing 1 pack + purchase 1 pack, converted to 8 pcs → 4 pcs, "pack × 4"
   kept, price €3.00 per pack (030: 7 pcs, no usual size, price unit gone).
9. "Keep the numbers as they are", no usual size → 2 pcs stays, toast (030:
   1 pcs, nothing said); a kept created item the same way → kept, toast.
10. lines before 030 (`stock_unit` emptied), no unit change: an existing item
   with expired stock thrown away, a 9H "2 pack" × 4, a new item → exactly
   030's result after the purchase and after Reopen.
10b. a line before 030 whose "Bought" row was deleted by hand, "2 pack" into
   pcs → nothing taken out, toast (030: −8 pcs) (Kata ragu).
11. "Back on the way": +1 pack arrived, converted (1 pack = 4) → 12 → 8 pcs
   (021: 11); "Keep the numbers" → stays 3 pcs, toast (021: 2); no unit
   change → as 021.
12. Shared parts (029), a merged expense, a MONEY purchase closing an
   automatic "to buy" entry (back to "to buy", not deleted), a 9J arrival into
   a new item → exactly 030's result.

**Labels and paths (for Claude's test instructions).** Left menu: Plan,
Shop, Home, Money.

| What | Path | Exact labels |
|---|---|---|
| Receipts Reopen (SHOP purchase) | Shop → "Receipts" → the purchase card | "Reopen purchase" → "Reopen this purchase?" ("The {n} item(s) (€…) go back to the cart, and the stock, history and expenses from this purchase are undone.") → "Cancel" / "Reopen" → toast "Purchase reopened — the items are back in the cart." |
| Receipts Undo (MONEY purchase) | same card, a purchase made in Money | "Undo purchase" → "Undo this purchase?" ("The expenses of its {n} item(s) (€…) are deleted, and the stock it added to HOME is taken back (an item it created is removed again, unless it also got stock or an order from elsewhere). Expenses merged into it stay, as single expenses.") → "Undo purchase" → toast "Purchase undone — its expenses are deleted and HOME stock is back as before." |
| MONEY Undo purchase | Money → section Expenses → the purchase row (tap to open) → bottom of the opened row | "Undo purchase" (MONEY) / "Reopen purchase" (SHOP) / "Split"; the same questions |
| MONEY "Part of a purchase" | Money → Expenses → opened purchase → trash "Delete expense" on one expense | question "Part of a purchase"; choices "Reopen purchase" (SHOP) / "Undo the whole purchase" (MONEY) / "Delete expense only" → "Continue" |
| Undo toast after a purchase | right after Shop → List → "Confirm purchase" / Money → "Add expense" → "Save purchase · €…" | "Purchase confirmed · {n} item(s) · €…" / "Purchase saved · {n} item(s) · €…" with "Undo" |
| New toasts after any of these (031 only) | — | `"{item}" stays in HOME — it also got stock or an order from elsewhere; this purchase's {qty} were taken out.` / `"{item}": this purchase's stock couldn't be taken out (its unit changed) — check it in HOME.` / `"{item}" stays in HOME — it also got stock or an order from elsewhere; this purchase's stock couldn't be taken out (its unit changed) — check it in HOME.` |
| "Back on the way" | Money → section Orders → "History (N)" → an arrived order card → "Back on the way" | question `Put "{name}" back on the way?` → "Put back on the way"; no toast as before, except (031) `"{item}": this arrival's stock couldn't be taken out (its unit changed) — check it in HOME.` |
| Arrived Undo | the toast after Arrived / "It arrived!" → "Undo" | `"{name}" is on the way again — {qty} taken out of "{name}"` (after a unit change: what really came out, e.g. "4 pcs"); (031, not convertible) `"{name}" is on the way again` + the arrival toast above |
| Home → History, K29 | Home → "History" (tab next to "Items") | a row of a deleted item: "{name}" · "Unit changed · {date} · **deleted item**" (grey) "→ 4 pcs" |
| History trash | same, the trash at the end of a row (aria "Delete this entry for {name}") | no question; toast "Deleted" with "Undo" |
| HOME "Edit item" unit conversion | Home → Items → the tile → pencil (title "Edit") → "Edit item" → "Unit (what you count stock in)" → "pieces (pcs)" | `Count "{name}" in pcs instead of pack?` → "Convert with the pack size" + "pcs in 1 pack" / "Keep the numbers as they are" → "Change unit" → "Save changes" |
| "+" restock on a tile | Home → Items → the tile → "+" (title "Add {step} {unit}") or the package button (title "Add bought stock") → "Quantity bought" → "Add to stock" | History "Restocked" |
| "Edit item" stock typing | same editor → "Current stock" → "Save changes" | History "Adjusted" |

Not confirmed on a phone: everything in this table (written from the code
and the tests). The "Back on the way" place ("History (N)" in Money →
Orders) is not confirmed.

**Kata ragu (asked in the round's message, built the safe way).**

1. An old line (before 030) whose "Bought" row was deleted by hand, bought
   in another unit than the item's (9H "2 pack" → +8 pcs): nothing is taken
   out + toast (K27 literally — "else the line's unit", pack → × 4 — would
   take 8 × 4 = 32 pcs instead of 8).
2. A pack size changed by hand after the purchase WITHOUT a unit change:
   Reopen still puts back the one from before the purchase (as today) — the
   database can't tell it from a first-time size the purchase saved (9H).
3. A price that had no unit before the purchase, the unit changed after it:
   put back per the unit counted in then ("€3.00 per 1 pack").
4. Not convertible (existing item): the stock is not touched at all — also
   expired stock thrown away at the purchase is not put back; price, payer,
   last bought and expiry are put back as today.
5. A "Unit changed" row is "elsewhere" unless its numbers are a plain
   conversion — also when a LOWER stock was typed in the same save (kept).
6. "Back on the way" question: "Its arrival added 1 pcs …" after pack → pcs
   (the arrival's number with the item's unit now) — not changed in 9M.
7. An arrival whose own history row was deleted by hand: taken out as today
   (counted in the item's unit now).

**Decisions on the doubts (01/11): K32–K38.**

- **K32** (doubt 1, an old line whose "Bought" row was deleted by hand):
  keep as built.
- **K33** (doubt 2) CHANGED: an existing item (not created by the line)
  whose unit did NOT change gets its usual pack size (`packaging_unit` /
  `quantity_per_pack`) back from `pantry_before` ONLY when `pantry_before`
  had no complete usual size (`packaging_unit` empty or `quantity_per_pack`
  not > 0 — the 9H first-time rule, `lib/packSize.savesUsualSize`) —
  exactly as before. With a complete one, the item keeps its values of now:
  a purchase never overwrites an existing usual size, so a different one
  now was changed by hand. Unit changed → the values of now (as built).
  "1 box = 48", purchase, changed by hand to 40, Reopen → 40; none, the
  purchase saved 12, Reopen → empty; "1 box = 48", nothing changed, Reopen
  → 48. SQL 031 changed in place (not run yet).
- **K34, K35, K36** (doubts 3, 4, 5): keep as built.
- **K37** (doubt 6) FIXED: the "Back on the way" question says what the
  arrival really added, in the unit of its own history row, and what is
  taken out now (see "Texts"). `lib/reopenUnits.backOnTheWayStockText`;
  `hooks/orderActions.askBackOnTheWay` reads the item and that row first
  (`useOrders.readArrivalItem`, now exported).
- **K38** (doubt 7, an arrival whose own history row was deleted by hand):
  keep as built.

Tests of the follow-up: 2095 → 2102 (115 files). `supabase/migrations.test.js`
block "031" + 1 (the three K33 examples, with 030's result next to them:
40 → 48 there); the line diff lists `v_keep_pack`. `lib/reopenUnits.test.js`
+ 3 (same unit / row gone / nothing read; 1 pack = 4 and 0.5 kg → "0.5 kg
(500 gr)"; not convertible). `hooks/reopenNotes.test.js` + 3 (the question,
with 031 and with 021 each: no unit change 3 → 2 pack; 1 pack = 4: 12 → 8
with 031, 12 → 11 before; not convertible: 3 stays with 031, 3 → 2 before).

**SQL 031 run by the household on 03/11/2026: all 14 checks ok.**

**Follow-up 03/11 (K39, K40).** K39: the temporary "Until … 031" sentences
removed after 031 ran (option (a) of Kata ragu 1 below);
`lib/reopenUnits.backOnTheWayStockText` only. K40: K33's "complete usual
size" kept as built (`packaging_unit` filled and `quantity_per_pack` > 0).
Tests unchanged in number (2102, 115 files): the K37 tests now check the
new texts, and the "before 031" runs of the question were dropped (the real
database is 031 now). No SQL.

**Kata ragu (01/11 follow-up).** (Answered 03/11: 1 → K39, 2 → K40.)

1. K37 "before 031, keep today's text": the app only knows whether 031 has
   run AFTER the call (it compares the stock), not before the question. Now
   the question says both what 031 does and what comes out before 031
   (examples in "Texts"). Options: (a) keep it, and drop the "Until …"
   sentence in a small round after 031 has run (recommended); (b) give 031
   a tiny marker the app can read before asking (one more function, e.g.
   `reopen_units_version()` returning 31 — breaks "031 replaces only two
   functions"); (c) show only the 031 text, also before 031 (wrong for 1
   pack = 4: says 4 pcs, 1 pcs comes out).
2. K33 "complete usual size": counted as `packaging_unit` filled and
   `quantity_per_pack` > 0 (as 9H). "1 box = 0" before → put back as today.
   `packaging_unit` empty but `quantity_per_pack` 48 → put back as today too
   (the household's rule as written; 9H would never overwrite it either).

### iPhone checklist for round 9M

Written by Claude after 031 has been checked and run.

iPhone test of 9M done 03/11/2026: all OK.

K41: the old "one-time database update" notices are kept (03/11).

### 9N. One item, many names (round 6D, decided 04–09/11, stages 1–5 and the two stage-4 follow-ups as built)

Analysis: `tmp-export/6d-readonly-report.md` (04/11, read only, A–N). The
household chose **option C** (`pantry_items.names jsonb`) and the decisions
below; where they differ from the report, they win. SQL:
`supabase/032_item_names.sql`. **SQL 032 run on Supabase 06/11/2026: all 9
checks ok.** The app is deployed before 032 and works exactly as today until
it has run. No new browser storage, no new offline queue. Stage 1 changed no
screen and removed no group or variant code. `names` is sent in no plain
update, also after stage 2.

**Decisions.**

- **K42** The later merge puts into "Chips & Snacks": Chips - di verdure al
  sale marino; Chips - Patatine Peperoncino; Chips - Patatine sale olive;
  Nuvole di drago piccanti; Patatine teriyaki; Corn Snack; Kiss Burn Chinese
  Snack; patatine miele; Patatine Sale e Pepe; Tortilla Chips. Live stock
  today: 11 pcs. It is the only group in the database. There is no "Pasta"
  item or group.
- **K43** Nothing else is merged for now; there is no "Pasta" item or group.
  Other items can be merged later with the same action.
- **K44** Different units. A source with stock 0 merges without conversion
  and is never refused for its unit. A source with stock above 0 uses the
  conversions of report H.4 (the same unit, kg/gr, L/ml, the target's usual
  pack); with none, the merge is refused and nothing is written. Real case:
  "Meat Snacks" counts in pcs; Jerky has stock 0 and unit pack. At its first
  later purchase in pack, the pack field asks "pcs per pack" once and the
  value is saved on the name.
- **K45** "Meat Snacks" is made with the normal HOME "Add item". The merge
  function has no "create" part.
- **K46** ONE merge action, on the TARGET item, several sources in one call;
  no "Make it one item". Sources may be normal items or variants of the
  target; a group with variants as source is refused. The target may be a
  normal item or a group row; a group target takes all its variants at once
  (K70) and becomes a normal item. Its minimum stock does not change: no
  `min_stock` in the payload.
- **K47** Merging is an app action backed by a 032 function, not a data fix.
- **K48 + K67 + K68 + K69** No Undo for a merge. Instead a separate action,
  full separation (`separate_item_name`, below), at any time.
- **K49** The target's price, pack size, payer, notes, usual store and 1× stay
  its own. An empty price stays empty.
- **K50** The first name line may keep the item's own name.
- **K51** A new name line starts at quantity 1 and never changes another line.
- **K52** Name lines 2…N are not stored before Confirm.
- **K53** To buy one brand, add it through "+ Add to SHOP list"; the card shows
  the item name with the brand under it.
- **K54** A MONEY row may be attached to an item as a new name.
- **K55** Last price is per name, in the order of report section F.
- **K56** No switch. Every item can have names; they are added at purchase, in
  "Edit item", or by a merge.
- **K57** The HOME tile stays as it is, plus one grey line "also: …"; the full
  list is in "Edit item".
- **K58** A word chosen with "Use …" in the safety net becomes a REAL name;
  there is no weaker "typed" kind. "Create new" with a changed name saves the
  typed word as a real name of the new item. A word belongs to one item only.
  All elements of `names` are of one kind.
- **K59** An exact duplicate of another item's name or other name is refused.
  Similar names are allowed.
- **K60** A first-time pack size is saved on the NAME, never on the item, and
  only while the name has none.
- **K61** Reopen of a purchase that added a name removes that name when no
  other purchase line or order of the item uses it.
- **K62** Merging a 1× source is allowed; the target's 1× does not change. The
  app will say so.
- **K63** `category_memory` is never touched.
- **K64** Restore of a backup made before a merge is handled in stage 4.
- **K65** The five stages, in the order written below.
- **K66** No separate `docs/one-item-many-names-6d.md`; the decisions live in
  this plan.
- **K70** `merge_pantry_items`: when the target is a group row, every variant of
  that group must be in `from_ids`. If any would be left behind, also when
  `from_ids` holds only normal items, the merge is refused and nothing is
  written: `"{target}" still has variants — choose all of them. Nothing was
  changed.` A group row with no variants may be a target. No variant can
  remain, so the target always ends with `is_group = false`.
- **K71** `confirm_shopping_trip`: expired stock is thrown away only on an
  item's FIRST line in the payload, for every payload, also one without name
  lines. Stock 2, two lines of one item +3 and +1, both with `discard_expired`:
  2 discarded once, 0 + 3 + 1 = 4 pcs; the first line has `stock_discarded` 2,
  the second 0; Reopen gives back 2 pcs. This is the ONE exception to "an old
  payload writes what 030 writes" (030: 2 → 3 → 1).
- **K72** `merge_pantry_items`: a source's `expiry_date` counts for the earliest
  date only when that source's stock is above 0. The date stays in `origin`.
- **K73** A moved line's Reopen also puts back `stock_discarded` (− 3 + 2), as
  built.
- **K74** A merged name can't be removed in "Other names"; it leaves with
  `separate_item_name`, as built.
- **K75** `separate_item_name` converts in this order: the same unit; kg/gr and
  L/ml; the name's pack size; the parent's usual pack (`pi.packaging_unit` = the
  old unit and `pi.quantity_per_pack` > 0). 1 pack merged into 1 pack = 3 pcs is
  3 pcs; separating 3 pcs gives back 1 pack, and the old purchase line can then
  be reopened with its stock taken out exactly.
- **K76** After a separation into another unit, Reopen of a moved line that
  can't convert takes nothing out and shows the K27 toast. No reverse
  conversion, as built.
- **K77** `separate_item_name` without `origin`: the new item gets the parent's
  `expiry_date` only when `stock_moved` is above 0, otherwise empty. The name's
  price and pack size are always copied.
- **K78** A name line updates the item's price like every purchase line; Reopen
  puts it back, as built.
- **K79** The payer limit stays and is documented (see "Known limit" below).
- **K80** When two cards of one item get different answers about expired stock,
  only the item's first line decides. Stock 4 expired, first card keep +1,
  second card throw away +2 → nothing thrown away, 4 + 1 + 2 = 7 pcs. Stage 3
  asks once per item, so this case disappears.
- **K81** `merge_pantry_items`: the target's own `expiry_date` counts only when
  the target's stock is above 0, or when no source brings stock above 0 (any
  source above 0 counts, whatever the order). Every other part of K72 stays;
  a source's date stays in `origin`.

  | Target stock / date | Source stock / date | Result date | Result stock |
  | --- | --- | --- | --- |
  | 0 / 2020 | 5 / 2027 | 2027 | 5 |
  | 0 / 2020 | 5 / empty | empty | 5 |
  | 0 / 2020 | 0 / 2027 | 2020 | 0 |
  | 3 / 2026 | 5 / 2027 | 2026 | 8 |
  | 3 / 2026 | 0 / 2020 | 2026 | 3 |

- **K82** Stock rounded to 3 decimals may not return exactly after a later merge
  (2 pcs → 0.667 pack → 2.001 pcs). Accepted.
- **K83** Reopen after a merge may put back an old date (accepted; it can be
  fixed in "Edit item"). Target 0 pcs, 2020; bought 2 dated 2028; merged 5 pcs
  dated 2027 → 7 pcs, 2027; Reopen → 5 pcs dated 2020.
- **K84** A target's old date at stock 0 is not kept after separating
  (accepted). Target 0 pcs, 2020; source 5 pcs, 2027; separated again: the
  source is back with 2027, the target stays at 0 pcs with 2027.
- **K85** A word saved by "Use …" shows a toast with Undo: `"{word}" saved as
  another name of "{item}"`, 20 seconds. Undo removes only that name; the SHOP
  card, expense or arrival stays. A failed save keeps the normal action, and
  the toast offers Retry. Offline the name is simply not saved: no extra toast,
  no queue.
- **K86** Moved to a new chat after the stage-2 test (07/11).
- **K87** "Create new" in SHOP: the first typed word is not saved, only asked
  again next time.
- **K88** "Use …" on a group: the word is not saved until the group is merged.
- **K89** "Use …" then "OK" / "Go to card": nothing is saved.
- **K90** A first-time pack size at a linked arrival under another name is
  saved on the name (never on the item) — built in stage 3.
- **K91** Renaming an item to one of its own other names: allowed.
- **K92** ONE payer per card: the pill stays where it is (line 1); lines 2…N
  have no pill and are sent with line 1's payer at the moment of Confirm.
  "Paid by (everything)" unchanged.
- **K93** No "+ Add another name" on group cards, variant lines, old
  group-level lines ("You choose the variant when confirming") and durable /
  service / "expense only" lines.
- **K94** A line name equal (exactKey) to the name or other name of ANOTHER
  HOME item is refused under that line with `"{name}" is already a name of
  "{item}" in HOME.`, and "Confirm purchase · €…" is locked until the name is
  changed or the line removed. No "Use other item" button. The item's own name
  or one of its own names = a plain line (no add_name); a merely similar name
  is allowed with no question.
- **K95** Undo on the Arrived toast and "Back on the way" put a name's pack
  size saved by that arrival back to empty, only while the name still has
  exactly those values (changed by hand → left as it is). Recorded inside the
  existing `orders.arrival_pack_before` (no new column), like the 9H item case.
- **K96** Counts: a sentence about cards in the cart counts CARDS ("Reopen
  this purchase?" → "The 1 item (€3.87) goes back to the cart, …" for one card
  with 3 name lines); a sentence about items bought or expenses counts LINES
  ("Purchase confirmed · 3 items · €3.87", "Undo this purchase?", the Confirm
  screen's "{n} item · {date}"). The 9M notes after Reopen / Undo: one per
  ITEM, its lines added up; a line with `merged_from` is stock only.
- **K97** Line 1's name changed on "Confirm purchase" is NOT saved as the SHOP
  card's name; after Reopen the card comes back with its old name (as built).
- **K98** Line 1's name changed (chip or typing) to a name with a suggested
  price (K55 order): line 1's price is filled from that name, ONLY while line
  1's price has not been changed by hand on this Confirm screen; once typed by
  hand there, it is never overwritten. The TOTAL for line 1's current quantity
  and unit, converted like lines 2…N (last €1.49 per 1 pcs, line 1 = 2 pcs →
  €2.98). Line 1's quantity and unit never change. A price that can't be
  converted to line 1's unit, or a name with no price: the price stays as it
  is. Back on the card's own name (or the item's own name with no price of its
  own), still untouched by hand: the price of when the screen opened. An
  auto-filled price is saved on the card exactly like a price typed there.
- **K99** A name with no pack size, bought in the item's usual size and left at
  that value: nothing is saved on the name (as built).
- **K100** Lines 2…N of a NEW item: their "pcs per pack" starts empty and is
  required (as built).
- **K101** One new name only once in a purchase. A name line is refused, under
  that line, with `"{name}" is also another line of this purchase — use it only
  once.`, and "Confirm purchase · €…" is locked (bottom: "Answer the question
  above to confirm.") until the name is changed or the line removed. Compared
  with exactKey. (1) The name equals the name of ANOTHER card of this purchase
  that is not linked to a HOME item ("new in the pantry"): new card "Patatine
  Paprika" + card "Chips & Snacks" line 2 "Patatine Paprika"; the refusal is on
  the name line, never on the other card. (2) The same new name (no name of
  any HOME item) on name lines of two DIFFERENT cards: the later line in screen
  order is refused. A name of an existing HOME item stays K94. Two lines of the
  same name in the SAME card are not K101 (as built; see the follow-up below).
- **K102** An old card whose name is not one of its item's names: line 1 is
  sent without add_name (as built).
- **K103** (08/11) A filled-in line-1 price (K98) reaches the SHOP card only at
  Confirm; "Back" without confirming leaves the card as it was (as built).
- **K104** (08/11) After Reopen the card keeps the price used at Confirm,
  exactly like a typed price (as built).
- **K105** (08/11) No price conversion through a pack size for the filled-in
  price: the same unit, kg/gr and L/ml only (as built).
- **K106** (08/11) A filled-in price follows line 1's quantity while it hasn't
  been typed by hand (as built).
- **K107** (08/11) Shop → "Receipts": every line of a purchase card shows its
  quantity under the name, small and grey ("2 pcs", also "1 pcs"), with the
  same rule as Money's opened purchase row; a line bought in packages keeps
  "1 pack · 4 pcs"; an old line without quantity shows what Money shows.
- **K108** The merge button "Merge other items into this one…" sits in "Edit
  item" (and "Edit group") right after "Other names", before Notes. Never in
  "Add an item", "Add a group", "Add a variant", a variant's "Edit item", a
  durable, or while `useItemNamesReady` is not true.
- **K109** The picker, on top of the editor: `Merge into "{target}"`, × (aria
  "Close"), "Search your items…"; empty search = eligible items of the
  target's main category A–Z; typing = every eligible item by `searchRank`
  (other names too); a row per item with a checkbox ("{name} · {stock}
  {unit}", aria "Merge {name} into {target}"); ticked items on top under
  "Chosen ({n})"; at the bottom "Merge {n} items…" ("Merge 1 item…"),
  disabled while nothing is chosen.
- **K110** In the picker: normal items (finished 1× too), a source at 0 in
  another unit, a source with stock whose unit converts (K44, then "(= 0.5
  kg)" / "(= 4 pcs)"). Greyed and not tickable: stock that can't be
  converted, with `Counted in {unit} ({stock} {unit} at home); "{target}"
  counts in {target unit} — convert it first (Edit item → Unit).` Not shown:
  the target, durables, group rows, variants of other groups.
- **K111** The merge question (title `Merge {n} items into "{target}"?`, one
  line per source with its conversion and "(variant)", "Together: …", the
  names / MONEY line, what the target keeps, a line per 1× source, "This
  can't be undone…"; "Cancel" / "Merge"), then `merge_pantry_items` with every
  row as STORED, the lists read again, the SHOP list judged again for the
  target; editor and picker close; toast `Merged {n} items into "{target}" ·
  {stock} {unit}` without a button. Refused: the database's message; "already
  merged": nothing extra; offline: refused before writing.
- **K112** A group target: all its variants (finished 1× too) start in
  "Chosen", ticked and locked, "(variant)"; above the list `All {n} variants
  of "{group}" are always merged together.`; afterwards a normal item.
- **K113** Unsaved changes in "Edit item" / "Edit group": the merge button and
  every Separate are disabled with "Save changes first."; nothing is saved or
  thrown away.
- **K114** "Separate" (aria "Separate {name} into its own item") next to every
  saved other name; a merged name has only "Separate".
- **K115** The separate question (title, the text with or without origin, the
  required field "Stock that goes with it ({parent unit})" starting empty, the
  hints, the two errors, the SHOP line at 0 only when the real rule lists it,
  "This can't be undone — to put it back, merge it again."; "Cancel" /
  "Separate"), then `separate_item_name`, the lists read again, the SHOP list
  judged for both items, the editor closes; toast `"{name}" is its own item
  again · {stock} {unit}` / `"{name}" is now its own item · {stock} {unit}`.
- **K116** Deleting an item that holds merged names first asks `Delete
  "{item}"?` with `It holds the names of {n} merged items ({first}, {second}
  +{rest}). Once deleted, they can't be separated again.`; "Cancel" /
  "Delete"; "Delete" is today's delete with its toast and Undo.
- **K117 + K118** Restore guard ("Restore backup", JSON): the current items
  (with names) are read first; a backup item merged away since is skipped and
  its history goes to the item holding its name; that item is restored except
  its stock, names, unit and group (and, in another unit, every field counted
  in it); `names` is never written. One more line in the question and in the
  result (texts in "Stage 4 as built").
- **K119** (08/11) "Import CSV / Excel" gets the same guard as "Restore
  backup": the current items (with names) are read before anything is
  written. A row whose id is a merged id (a `from_item_id` in any item's
  names) is skipped; so is a row that would make a new item (no id, or an id
  of no item now) whose name (exactKey) is a merged name (one with an
  `origin`) of an item now. A row of a target (an item holding merged names)
  is imported except `current_stock`, `names`, `is_group`, `group_id`,
  `unit`, the K124 and the K125 fields, which stay as they are now. Question
  line (m > 0): `{m} of these items were merged into another item since this
  file was made — they are skipped.` (m = 1: `1 of these items was merged
  into another item since this file was made — it is skipped.`). Result:
  today's text, then ` {m} skipped: merged into another item.` (m > 0), then
  ` {k} items kept their merged names and stock: {names}.` (k = 1: ` 1 item
  kept its merged names and stock: {name}.`). Without either: today's text.
- **K120** (08/11) Restore and import: a row keeps its `group_id` only when
  that group is a group afterwards: an item that is a group now and isn't
  skipped, or a group row of the same file that is neither skipped nor a
  target. Otherwise (the group is a normal item now, a target, gone or
  skipped) the row comes back with no group, as a normal item.
- **K121** (08/11) "When it was merged it brought {x}" stays computed from
  the origin (as built).
- **K122** (08/11) A merge 032 would refuse is refused before the question,
  with 032's own text, nothing sent (as built).
- **K123** (08/11) "Merged 1 item into …", the disabled "Merge 0 items…" and
  the two empty-list texts stay as built. K116 with one name: `It holds the
  name of 1 merged item ({name}). Once deleted, it can't be separated
  again.` (several names unchanged, "they").
- **K124** (08/11) K118 stays: when the file's unit differs from the
  target's unit now, unit, stock, minimum, pack size and price stay as now;
  name, category, notes, store and payer come from the file. The same for
  the CSV / Excel import.
- **K125** (08/11) Restore and import: a target also keeps its current
  `expiry_date` and `batch_lot` (they describe the current stock, which is
  kept). Example: backup 1 Nov, T 1 pcs, expiry 20/11/2026; on 10 Nov A and B
  merged into T → 6 pcs, expiry 01/03/2027; restore on 15 Nov → T stays 6 pcs
  with 01/03/2027. Items that are no target come back fully, stock and expiry
  together, as before.
- **K126** (08/11) "Import CSV / Excel" and "Restore backup": a row that
  overwrites an item that exists now (same id) and whose name in the file
  equals (exactKey) the own name or any other name of another item that
  exists now keeps that item's current name; every other field of the row by
  the existing rules (K118, K124, K125 unchanged). A file name that is the
  item's own name now or one of its own other names: imported as today. Also
  for a target row (K118). Result, after the existing lines, only when
  j > 0: ` 1 item kept its current name: the name in the file belongs to
  another item.` / ` {j} items kept their current name: the names in the
  file belong to other items.` Example: file 1 Nov, X "TEST Corn Bites"; 3
  Nov X renamed "TEST Lime Soda"; 5 Nov another "TEST Corn Bites" merged
  into T; import on 15 Nov → X stays "TEST Lime Soda", its note from the
  file. Not covered on purpose: a row whose id is no item now, two rows of
  the same file with the same name.
- **K127** (08/11) The question title counts every row of the file; the
  second paragraph explains the skipped ones (as built).
- **K128** (08/11) The JSON restore (and the CSV / Excel import, if it ever
  writes it): a target also keeps its current `last_purchased_at`, like
  K125. Example: T last bought 12/11 now, the backup says 28/10 → stays
  12/11. Normal items are restored fully as before.
- **K129** (08/11) A CSV with a group writes the group total into the
  group's own stock (as built). Not fixed: the only group is merged into a
  normal item after the stage-4 test, and stage 5 removes groups.
- **K130** (09/11, keep as built) An item deleted and made again with the
  same name: a restore can give two items with that name; the household
  fixes it by merging.
- **K131** (09/11, keep as built) Two rows of one file with the same name are
  both written.
- **K132** (09/11, keep as built) Names in a file are compared with the names
  of NOW.
- **K133** (09/11) Restore backup / Import CSV are not tested on the iPhone
  with real data; covered by automated tests (unit, render, PGlite with the
  real 032 functions).
- **K134** (09/11) Database columns stay: `pantry_items.is_group`,
  `pantry_items.group_id`, the constraints `pantry_items_group_shape` and
  `pantry_items_one_time_not_group` and the index stay (no SQL), so a device
  still on the old app version doesn't break and old backups still restore.
  `is_group` and `group_id` stay in `ITEM_FIELDS` for old backups; the
  restore / import logic of K117–K129 is not changed. No new path in the app
  ever writes `is_group = true` or a non-null `group_id`.
- **K135** (09/11, option A) "Not urgent" is removed completely: the reason
  `'not-urgent'`, its sky style, the "Not urgent" label in Shop → List and
  Shop → Shop, and the rule that sinks such cards to the bottom (priority
  sort, budget plan). Every other colour stays exactly as it was (red Out of
  Stock, yellow Low Stock, purple expired, blue New Item, the category colour
  of a card added by hand, the order of every other card). Every item is
  judged only on its own stock and minimum.
- **K136** (09/11) "It arrived!" (not linked to HOME) offers exactly "Add to
  an existing item" (its "Which item?" also finds other names), "Create a new
  item", "Don't add to HOME". "Add to a variant of an item group" and every
  variant text, select and toast are gone; the K12 "Add it to …" on what used
  to be a variant opens "Add to an existing item" with that item chosen. The
  linked dialog has no variant select, no new variant and no `… to a new
  variant of "{group}"` toast; `useOrders` has no `newVariant` and no group
  branches. Everything else of 9J/9H/9M/K90/K95 is unchanged.
- **K137** (09/11) The order's name is NOT remembered when "Add to an existing
  item" is chosen (no tick box; report J.8's proposal is not built). A name
  is added by hand in "Edit item" → "Other names" → "+ Add a name".
- **K138** (09/11) A group made by an OLDER app version (a device not reloaded
  yet): its row is a normal item tile (its own stored stock, no total) with
  the grey note `Item group from an older app version — merge its variants
  into it: Edit item → Merge other items into this one…` under the name
  (after "also: …"); it never goes on the SHOP list and is never Low or Out.
  Its variants are normal items (own stock, own minimum, own SHOP entry).
  "Edit item" of the group row has "Merge other items into this one…" with
  the K112 rule (all variants chosen and locked); the 1× toggle stays hidden.
  Edge cases (a)–(d) built the safe way (see "Stage 5 as built", Kata ragu).
- **K139** (09/11, keep as built) A group row from an older app version with 0 variants keeps the note that mentions variants.
- **K140** (keep as built) A SHOP card linked to an old group row is locked in "Confirm purchase" with the K138 text.
- **K141** (keep as built) Deleting an old group row that still has variants is refused with the K138 text.
- **K142** (keep as built) Old group rows are left out of every picker; the same name can then become two items (fixed by a merge).
- **K143** (keep as built) Variants of an old group get no names features until the group is merged.
- **K144** (keep as built) The old group row's tile: no status badge, green, "min …"; its minimum field stays in "Edit item".
- **K145** (keep as built) The CSV/Excel "names" column and the "It arrived!" toast with the other name ("(Corn Snack)") are not built; they are under "Later".

iPhone test of stage 4 done 08/11/2026: all OK.

Real data merged 08/11/2026: Chips & Snacks 11 pcs (10 names), Meat Snacks 0 pcs (2 names).

- **Stock format** `separate_item_name`: the new stock carries no long decimal:
  `trim_scale(round(v_moved / v_factor, 3))`, and the history rows use that
  value. 3 ÷ 3 stores exactly 1; 2 ÷ 3 stores 0.667.

Every other report rule for names, Confirm and Reopen stands unless the above
changes it.

**The stages.**

1. This one: `supabase/032_item_names.sql`, `lib/itemNames.js`,
   `useItemNamesReady`, tests. No screen.
2. Names read everywhere, "Other names" in "Edit item", the tile line, K58,
   History title and subtitle.
3. Name lines in Confirm purchase and MONEY.
4. Merge and separate actions, restore guard (K64), then the household merges
   on the phone with TEST items first.
5. Remove the variant mechanics and finish "It arrived!" without variants.

**Data (032).** `pantry_items.names jsonb not null default '[]'`, check
`pantry_items_names_array` (it is an array). Element: `name, packaging_unit,
quantity_per_pack, price, price_qty, price_unit, from_item_id, origin,
added_at, added_by_trip, pack_by_trip`; `origin` is the full source row,
stored by a merge, null for any other name. `shopping_trip_items.merged_from`
and `orders.merged_from`: uuid, nullable, no foreign key (the old item is
gone). In SQL a name is compared with `lower(btrim(…))`; the app first checks
with `exactKey` (also accents and plurals), report C.

**`confirm_shopping_trip`** (from 030). New, optional, on a line: `name,
quantity, unit, price, price_qty, price_unit` (a SHOP line: that line only);
`add_name`; `name_pack: { packaging_unit, quantity_per_pack }`. Old SHOP
payloads send none of the six; MONEY lines always send them, so "a name line"
means a SHOP line with `name`. Only such a line may repeat a
`grocery_item_id`: a repeat without `name` is refused as in 030. Expired stock
is thrown away on an item's first line only, in every payload (K71).

**`reopen_shopping_trip`** (from 031). A line with `merged_from`: stock only
(`− stock_added × factor + stock_discarded × factor`, as an existing item),
its own history rows, expense and entry; never `pantry_before`, never a
delete. An item with a name with `from_item_id` is "from elsewhere" (K26). A
deleted entry comes back once (`on conflict (id) do nothing`), linked to the
line's item of now when the snapshot had a link or the line was moved, never
to one that is gone. K61, and a pack size with `pack_by_trip` = this purchase
goes back to empty (an edit by hand clears `pack_by_trip`, so it stays).

**`save_item_names(payload)`** → `pantry_items`. `{ item_id, add: [{ name,
packaging_unit, quantity_per_pack, price, price_qty, price_unit }], remove:
[name], edit: [the same, only the fields sent change], was: { names } }`.
Changed meanwhile: `"{item}" changed meanwhile (on the other phone?) — open it
again. Nothing was changed.` K59 applies; the app can't write `origin` or
`from_item_id`; a name with `origin` can't be removed (K74). Sent again
when already as asked: nothing is written.

**`merge_pantry_items(payload)`** → jsonb. `{ into_id, from_ids: [], was: {
id: { current_stock, unit, updated_at } } }`, one transaction, report H.4 with
K44–K46, K49 and K70. Each source: its own name with `origin` and `from_item_id`,
then the names it had (a plain name the target has is skipped; a name with an
`origin` is never dropped). History, lines, orders move; `merged_from =
coalesce(merged_from, source)`, so a chain B → A → T keeps B. Automatic "to
buy" entries go; those in a cart, ordered online, typed by hand or bought move
with their own name. "merged" history row only when the moved stock is above
0. Earliest non-empty expiry, a source's date only with stock above 0 (K72),
the target's own date only with stock above 0 or when no source brings any
(K81); latest `last_purchased_at`. `is_group` ends false (K70). A source's pack size
counts in its own unit, so on the name it is × the factor, or empty when there
is no conversion (a source at 0 in another unit). A price without a unit gets
the source's unit. Sent twice: `{ already_merged: true }`, nothing written.
Expenses, order groups, `category_memory`: not touched.

**`separate_item_name(payload)`** → jsonb (the counts). `{ item_id, name,
stock_moved, was: { current_stock, unit, updated_at } }`, one transaction.
Refused, nothing written: changed meanwhile; not a name of the item; its own
name; `stock_moved` below 0, above the stock or missing; another HOME item has
that name. With `origin`: the row comes back with the SAME id and all its
fields, `group_id` null, `is_group` false, `names` empty. A category,
sub-category or store deleted since the merge can't come back: the parent's
category, no sub, no store. Without `origin`: a new id; category, sub-category
and unit of the parent; minimum 0; the name's price and pack size; the parent's
expiry only when `stock_moved` is above 0 (K77). Stock: in the old unit when the
conversion is known (the same unit, kg/gr, L/ml, the name's pack size, the
parent's usual pack: K75), rounded to 3 decimals with no trailing zeros, else
in the parent's unit, so no stock is lost. Moved:
purchase lines with `merged_from` = its id (`merged_from` empty again); the
parent's lines with that name and `merged_from` empty or = the parent
(`merged_from` = the parent, so a later merge and separation find them again);
history rows with that name except "merged"; orders with `merged_from` = its id
or that name; entries of the parent with that name. "separated" history row on
both items when `stock_moved` is above 0. Expenses are never touched.

**Before 032** (the code is deployed first). `useItemNamesReady` reads
`select('names').limit(1)`: an answer → true; 42703 / PGRST204 naming `names`
→ false; anything else or offline → null, read again when the connection comes
back; once true, known for the app start. Rows read with all columns that carry
`names` also say true. Stage 1 shows nothing either way. From stage 2 on: while
not true no names UI, one line per SHOP entry (today's payload), groups exactly
as today; a save that would need 032 while it is null reads first, and without
an answer saves nothing, with the 9K messages. 030 refuses a multi-line payload
whole (proven in the report), so never half data.

**After 032.** 032 adds the column and replaces the functions in one
transaction, so "the column is there" means "the functions are there". An
older app on another device: its Confirm sends no new keys and gets exactly
030's result; its MONEY row with a known name goes to that item, no second
item; it never writes `names` (`pickFields`).

Every changed line of `confirm_shopping_trip` (032 compared with 030 lines
69–328: 9 lines changed, the rest added; the test "032" checks the same with
its own line diff):

| Where (line in 030) | Change | Old payload |
|---|---|---|
| declare, after 103 | + comment, `v_own`, `v_snapshot`, `v_name_line`, `v_repeat`, `v_entries`, `v_done`, `v_log_name`, `v_add_name`, `v_key`, `v_other`, `v_pack` | — |
| before 125 | + comment, `v_name_line := not v_money and v_item ? 'name'`, `v_repeat := v_name_line and v_entries ? (…)` | Both false. |
| 130, 135 | `if g.completed` / `if found` + `and not v_repeat` | The same checks. |
| after 159 | + comment, `v_own := g.name`, `v_snapshot`, a name line's own fields on `g`, `v_add_name` | `g` unchanged, `v_snapshot` = `to_jsonb(g)`. |
| after 191 | + comment, a repeat takes the item its first line found | Skipped. |
| 198 | the name match also reads `names`, an own name first; matches on `v_own` | The same row while no item has names. |
| after 211 | + comment, `v_log_name` | `pi.name`. |
| 225 | `and not pi.id = any(v_done)` (K71) | The same on an item's first line; a later line of that item throws nothing away: the one exception to 030. |
| 248 | `pi.name` → `v_log_name` | The same value. |
| after 259 | + `v_log_name := …` | `trim(g.name)`. |
| 262, 275 | `trim(g.name)` → `trim(v_own)` / `v_log_name` (K50: the item is the entry's, the row the line's) | The same value. |
| after 278 | + comment, `add_name` (K59), `name_pack` (K60), `v_done := v_done || v_pantry` | Skipped; `v_done` is read on line 225. |
| 305 | `to_jsonb(g)` → `v_snapshot` | The same value. |
| 312, after 319 | `if not v_money` + `and not v_repeat`; + comment; `v_entries := …` | The same. |

Every changed line of `reopen_shopping_trip` (032 compared with 031 lines
73–223: 2 lines changed, the rest added):

| Where (line in 031) | Change | A line without `merged_from`, no names |
|---|---|---|
| after 145 | + comment, `or exists (… n->>'from_item_id' is not null)` in `v_elsewhere` | False. |
| 147 | + `if ti.merged_from is not null then` … stock only; the 031 `if` becomes `elsif` | The 031 branches. |
| after 207 | + comment, the snapshot takes the line's item of now (when the snapshot had a link, or the line was moved, and that item exists) | The same value, or the 031 null below. |
| 211 | + comment, `… on conflict (id) do nothing` | The same insert. |
| after 219 | + comment, K61 and `pack_by_trip`: one `update` of items with an element of this purchase | No row. |

Everything else of both functions is the 030 / 031 text line for line.

**Known limit (K79).** Two name lines of one purchase, the first separated later:
Reopen takes the first as stock only and puts the parent back from the second
line's `pantry_before`, which already holds the first line's payer (tested).
The price is the same case only when the first line sent one.

**Files.** New: `supabase/032_item_names.sql`, `src/lib/itemNames.js` (+
test), `src/hooks/useItemNamesReady.js`, `src/hooks/itemNamesReady.test.jsx`.
Changed: `supabase/migrations.test.js` (block "032"; the 9J guard allows 032,
which never touches `arrive_order`), this plan.

**Tests: 2102 → 2186 (115 → 117 files), then 2198 after the follow-up of 06/11
(K70–K77), then 2204 after the second follow-up (K81).**
`supabase/migrations.test.js` block "032" (76, PGlite): the file; both line diffs; stops at 030 ("Run
031_reopen_created_items.sql first."); run twice, every check ok, nothing else
changed; anon and a stranger refused; old SHOP and MONEY payloads = 030 / 031
row by row, Reopen too; €1.39 + €0.99 + €1.49 = €3.87, stock 1 → 4; K50; coupon
−€0.58 = 0.20 + 0.12 + 0.26 and −€0.39 = 0.14 + 0.10 + 0.15; Shared €3.00 =
1.02 + 0.65 + 1.33 and €2.58 = 0.87 + 0.55 + 1.16; 24 + 4 = 28 pcs and 10 + 12
= 22 pcs; 500 gr + 1 kg into kg, ml into L at another store; MONEY names; K59;
J.10; every Reopen case; merge: both proven bugs, K42 (10 variants, 11 pcs),
group, variants, K44, K49, K62, K63, chain, orders of every status, every kind
of entry, sent twice, changed meanwhile, K59; separate: with and without origin,
K44, stock 0, refusals, purchases and arrivals before and after the merge, a
Reopen and "Back on the way" of each, separate → merge → separate, expenses
unchanged; `save_item_names`; K70 (refused with a variant left out, or only
normal items; all variants; a group with none); K71 (+3 and +1 = 4 pcs against
030's 1, kg at another store, MONEY, a line after the line that made the item);
K72; K75 (1 pack = 3 pcs, 2 bags = 10 pcs, the order); the stock format; K77;
K81 (the five rows, each in its own unit; after a conversion; several sources
in any order; a group as target; the two Kata ragu cases below).
`lib/itemNames.test.js` (19), `hooks/itemNamesReady.test.jsx` (7).

**SQL 032 run on Supabase 06/11/2026: all 9 checks ok.**

**Kata ragu (06/11).** (Answered 06/11: 1 → K70, 2 → K71, 3 → K72, 4 → K73,
5 → K74, 6 → K75, 7 → K76, 8 → K77, 9 → K78.)

**Kata ragu (06/11 follow-up).** (Answered 06/11: 1 → K80, 2 → K81, 3 → K82.)

**Kata ragu (06/11 second follow-up).** (Answered 06/11: 1 → K83, 2 → K84.)

### Stage 2 as built (06/11; code and tests only, no SQL)

Names are read everywhere and can be edited in HOME. No new column, no new
browser storage, no new offline queue. `names` is still not in `ITEM_FIELDS`
and is written only through `save_item_names`
(`hooks/itemNameActions.js`). `GroupTile`, `GroupShopCard`, `syncGroup`,
`useShopTidy`, `lib/groups.js`, `lib/groupShop.js` and the variant selects are
not touched. An item with no names renders exactly as before.

**Ready or not.** `PantryPage` reads `useItemNamesReady(items)` and passes
`namesReady` to `ItemTile`, `ItemEditor` and `HistoryView`; each defaults to
false, so nothing new shows. The pure readers work from `item.names`, which
doesn't exist before 032. K58 asks first (`checkItemNames`) and sends nothing
without a yes. The pantry store reads every column (`columns = '*'`, realtime
rows not cut), so `names` arrives through the existing cache and realtime.

**Reading names (3A).** All through `lib/itemNames.js`:

- `similarItems.matchHomeItems`: each item by its own name, then the best of
  its other names (`via`, only when strictly better). An own name goes before
  another item's other name, then a normal item before a group. → `{ exact,
  exactVia, similar: [{ item, kind, via }], more }`. Exact: no question.
  Similar: "Use Chips & Snacks (Corn Snack) · 11 pcs at home". The same in
  "Go to …" and "Add it to …". Durables are still never searched. It only
  reads the phone's copy, so offline is the same as online.
- `moneyPurchase.homeItemFor` and `purchase.pantryItemFor`: own name first,
  then `itemForName`; `pantryItemFor` never a group, as before.
- `AddItemForm`: an exact other name links the item and the entry keeps the
  name typed. The toast names what was added ("Added “corn snack” · in HOME:
  11 pcs"). The item's price is filled in only for its own name.
  `useGroceryList.pantryByName` and `useCategorySuggestions` also hold other
  names, after every own name, so the unit, the category and an unlinked card
  of that name find the item.
- `nameSuggestions`: after the items, before the SHOP cards, each other name
  as "Corn Snack · Chips & Snacks" with the name's own price; tapped, the name
  fills in and Save links the item.
- `lastPrice`: the order of report F. 1 purchase line, 2 order, 3 the name's
  stored price (`source: 'name'`, time `added_at`, a missing unit = the item's),
  4 the item, only when the name IS the item's name; the most recent found wins.
  `!is_group` stays until stage 5 (groups are not touched here). **Which forms
  use `lastPriceFor`:** "+ Add to SHOP list" and the MONEY row (`useLastPrice`).
  The order form does NOT: it starts from `prefill` / the order itself, so it is
  unchanged.
- `pantryFilters.searchRank`: other names count like the other fields (rank
  3). The list of finished 1× items searches them too.
- `GroceryPage.variantNamesOf`: also the item's other names, so SHOP search
  finds the entry with the existing "In it: Svelto".
- `ArrivedDialog`: "Which item?" also finds other names. No other change there
  except K58 below.
- Pack size under another name (added to keep K60, not asked in the prompt):
  `packItemFor` starts the field with the name's own size for that unit, else
  the item's; a first-time size is never saved on the item from such a line.
  Saving it on the name comes with stage 3 (`name_pack`).
- A rename carries over to open SHOP entries as before, except entries under
  another name of the item: they keep their name. Without names the query is
  the old one.

**HOME tile (K57).** `ItemTile` only: under the name one grey line, the first
two names, "…" and "+N" when there are more: "also: Corn Snack, Nuvole di
drago… +8". `line-clamp-2`, `break-words`, the "+N" on its own so it is never
cut. No line without names.

**"Edit item" → "Other names"** (`inventory/OtherNamesFields.jsx`). Before
Notes. Only editing a normal item: never "Add an item", a group, a variant
(also not after choosing a group in the form) or a durable. Each name as text,
"Purchase unit", "{stock unit} per {unit}" (empty = no pack size) and × (aria
"Remove {name}"); no × when `origin` is not empty (K74). "+ Add a name" adds a
field "e.g. Corn Snack". "Save changes" sends `{ item_id, add, remove, edit,
was: { names } }` first, then the other fields, so a refusal leaves everything
as it was (shown as it is; the editor stays open). After a later failure, Save
again changes nothing in the names. No change to the names: not called.

**K59.** A new name equal to another item's name or other name, to a name
already on the list, or to the item's own name stops at Save, under that name:
`"{name}" is already a name of "{item}" in HOME.` Renaming an item, or adding
one, to another item's other name stops with the same note and "Go to {item}"
(the exact-name way of 9G; "Add it to …" from "It arrived!"). A similar word is
allowed.

**K58 + K85: every place with the buttons.**

| Place | Button | The word is saved | "Create new" with a changed name |
|---|---|---|---|
| SHOP "+ Add to SHOP list" (List and Shop mode) | "Use …" | after the card is saved, also "Add anyway"; not after "OK" / "Go to card" (nothing was saved) | not built: the HOME item is made later, at Confirm (Kata ragu 1) |
| MONEY "Add expense" row | "Use …" | after the purchase is saved, while the row still is that item | built: the item is made by that purchase, found by name after a reload |
| "It arrived!" → "Create a new item" | "Add it to …" | after the arrival is saved, while it goes to that item | built: the item is made with the arrival |
| HOME "Add an item" | "Go to …": nothing is used, so no word | never | built: the item is made there |

"Use …" with a `via`: the card or row takes that other name. Never when the
word already is a name of that item, never for a group, a variant or a durable
(Kata ragu 2), never when another item has it. The first word typed counts: a
second "Create new" keeps it; a name changed back to it saves nothing. Failed
save: `"{word}" was not saved as another name of "{item}".` with Retry; a Retry
reads the list again, so `was` is fresh. Undo reads the list of now too.

**History (report J.2).** With `namesReady`: title = the item's name now, from
`item_id`; under it, when different (capitals ignored), "Corn Snack · Bought ·
4 Nov 2026, 10:30" (the date format stays). "Item" filter: one option per
`item_id`; rows of deleted items by stored name, "{name} (deleted item)"; K29
unchanged. Reasons "Merged" and "Separated"; in the filter only with
`namesReady`. Before that the view is exactly the old one.

**Delete + Undo (3G).** Nothing to change: `deleteItem` keeps the whole row it
deleted and `upsert`s it, so `names` comes back, a merged name with its
`origin`. Tested in memory and on the real SQL (PGlite).

**Files.** New: `hooks/itemNameActions.js`,
`components/inventory/OtherNamesFields.jsx`, tests `lib/itemNamesRead.test.js`,
`hooks/itemNameActions.test.js`, `hooks/itemNamesPantry.test.jsx`,
`components/itemNames.render.test.jsx`,
`components/itemNamesArrived.render.test.jsx`,
`pages/itemNamesPages.render.test.jsx`. Changed: `lib/itemNames.js`,
`similarItems.js`, `moneyPurchase.js`, `purchase.js`, `nameSuggestions.js`,
`lastPrice.js`, `pantryFilters.js`, `grocerySearch.js` (comment),
`hooks/usePantryItems.js`, `useGroceryList.js`, `useCategorySuggestions.js`,
`pages/PantryPage.jsx`, `GroceryPage.jsx`, `inventory/ItemEditor.jsx`,
`ItemTile.jsx`, `HistoryView.jsx`, `grocery/AddItemForm.jsx`,
`NameSuggestions.jsx`, `expenses/PurchaseForm.jsx`, `ArrivedDialog.jsx`,
`ui/SimilarItemsPrompt.jsx`.

**Tests: 2204 → 2319 (117 → 123 files).** Existing tests changed:
`similarItems.render.test.jsx` (`getSnapshot` on the fake stores, needed by K58;
"Go to …" now also says the word typed); `hooks/arrivalDb.fixture.js` (`upsert`
takes one row too, as `deleteItem` really sends it). Added to
`supabase/migrations.test.js`: K85, a pack size emptied, delete + Undo.

**Kata ragu (06/11 stage 2, tanya Zidane).** (Answered 07/11: 1 → K87, 2 →
K88, 3 → K89, 4 → K90, 5 → K91.)

iPhone test of stage 2 done 07/11/2026: all OK.

1. "Create new" in SHOP. Typed "Pumpkin" → "Create new" → changed to "Frozen
   Pumpkin Cubes" → "Save". There is only a SHOP card; the HOME item is made at
   Confirm, and nothing can carry "Pumpkin" until then without a new column.
   Not built. Options: (a) leave it; (b) a column on `grocery_items`; (c) after
   Confirm, ask. Suggestion: (a).
2. K58 for a group or a variant. Typed "Patatine" → "Use Chips & Snacks" (a
   group). The card is added as today; no name is saved, because a group or
   variant shows no "Other names", so the word could not be seen or removed.
   Options: (a) leave it until the merge; (b) save it anyway. Suggestion: (a).
3. "Use …" and then "OK". Typed "Pumpkin" → "Use Fresh Pumpkin" → "Already on
   your SHOP list" → "OK" (or "Go to card"). Nothing was saved, so the word is
   not saved either, and the question comes back next time. Options: (a) leave
   it; (b) save the word there too. Suggestion: (a).
4. First-time pack at Arrived. An order "Felix" linked to Cat
   Wet Food, Arrived "1 pack" = 4: `LinkedArrivedDialog` still saves that size
   on the item, not the name (K60 covers purchases). The brief says no other
   change to Arrived. Options: (a) fix in stage 5 with the Arrived work; (b)
   stop saving it now. Suggestion: (a).
5. Renaming to the item's own other name. "Chips & Snacks" renamed "Corn
   Snack", which is already its other name: allowed; the element stays, hidden
   (`otherNames` leaves out the own name), and shows again after a rename back.
   Renaming "A" to "B" and adding "A" in one Save: refused as it is ("already the
   name of this item"), because the names go first; two Saves work. Options: (a)
   leave both; (b) rename first when the old name is added. Suggestion: (a).

### Stage 3 as built (07/11; code and tests only, no SQL)

Name lines in SHOP "Confirm purchase" and MONEY "Add expense", the SHOP card
title, and a first pack size saved on a name at a linked arrival. No SQL, no
new column, no change to any 032 function: the payloads are exactly the ones
block "032" proves. No new browser storage, no new offline queue. Group code
(`GroupShopCard`, `syncGroup`, `useShopTidy`, `lib/groups.js`,
`lib/groupShop.js`, the variant selects) is not touched.

**Ready or not.** `GroceryPage` and `ExpensesPage` read
`useItemNamesReady(…) === true` and pass `namesReady` to `ConfirmPurchase`,
`GroceryItemTile`, `ShoppingMode` and `PurchaseForm` (each defaults to
false). While it isn't true nothing new shows and every payload is today's
(one line per card): `purchaseLine` gets no `typedName`, so it has no
`naming` and sends no name key. A card of one line under its own word sends
exactly today's line also after 032 (tested equal).

**Confirm purchase** (`grocery/ConfirmPurchase.jsx`, `grocery/NameLines.jsx`,
`lib/purchase.js`, `lib/itemNames.js`).

- Which cards (K93): `purchaseLine(…).takesNames` — a normal HOME item or a
  new one; never a group, a variant, a durable / "expense only" line, an
  order on the way or a card left for another trip.
- Card title (K53): `cardTitle(entry, item)` — the HOME item's name, the
  card's own name under it in small grey text when it differs (exactKey).
- Line 1 = the card: field **"Name"** (aria "Name of {card}"), starting with
  the card's own name (K50); emptied, it counts as the card's name (no
  refusal). Its quantity, unit, total, discount and payer are the card's, and
  its edits are saved on the card as today (`editPatch`). Its name is sent on
  the line only (032: the card keeps its own name; Reopen brings the card back
  with it).
- Lines 2…N (`laterNameLine`, K51, K52): **"+ Add another name"** under the
  card's last line adds one at quantity 1, in the card's unit of now, with no
  name; it changes no other line and lives only on this screen. Each has
  "Name" + × (aria "Remove line {n} of {card}"), quantity, unit, € total,
  "−% / −€" (J.5), and its 9H field when the unit needs one (K60). No payer
  pill (K92): sent with line 1's payer at Confirm.
- Price (K55, report F): `useLastPrice(name)` of each line 2…N, per its
  quantity (2 for €1.98 → €0.99 for 1; a new quantity follows), until the
  total or the unit is typed by hand; a brand-new name stays empty. Line 1 keeps the
  card's price.
- Chips (K56, `nameChips`): the item's own name and other names, last bought
  first (`useLastBoughtNames` → the item's purchase lines, newest first; read
  only for an item with other names), then in list order. A name already on
  another line of the card is **left out**. A new item: its card name only.
- What a name means (`lineNaming`, K59, K94): own name / one of its names →
  plain line (the stored spelling is sent); a new word → `add_name` and "New
  name of {item} — it will be remembered."; a word of ANOTHER item → `"{name}"
  is already a name of "{item}" in HOME.` and the line is not ready; an empty
  line 2…N → "Type the name of this line." and not ready. Not ready locks
  "Confirm purchase · €…" (bottom: "Answer the question above to confirm.").
  A new name that looks durable (9F keywords, `durableLookalike` with the
  HOME categories) shows the HOME editor's text, not blocking
  (`durable.durableLookalikeText`, shared with `ItemEditor`).
- Pack (K60, `namedPack`): under another name or a new one the field starts
  with the name's size for that unit, else the item's; a first-time size is
  the name's (`onName`, sent as `name_pack`) only while the name has none and
  only when it differs from the item's usual size (Kata ragu 3). Under the
  item's own name: the 9H item rule (`firstTimePatch`, never for `onName`).
- A new HOME item (J.1, D10): "Count it at home in" only on line 1; lines
  2…N count in the unit chosen there (`laterLineHome`), their own required
  9H field starting empty, first time → `name_pack`. 10 + 12 = 22 pcs.
- Expired stock once per item (K71, K80, `expiryOncePerItem`): the question
  and `discard_expired` / `expiry_date` only on the item's first line in the
  purchase (also across two cards of one item).
- Several lines: "= {n} {stock unit} added to the stock" under the card
  (`cardStock`; hidden while a line can't tell its stock — the K9 / pack locks
  stay).
- Payload (`confirmationPayload` → `nameKeys`): every line of a card with 2+
  lines, and a line 1 whose name was changed, sends `name, quantity, unit,
  price, price_qty, price_unit`; plus `add_name: true` for a new name and
  `name_pack` for a first size on a name; lines 2…N repeat the card's
  `grocery_item_id`. Coupon spread over all lines (`purchasePricing`), Shared
  parts per line in the 9K box (J.9: "What each one paid of the N Shared
  items (€…)." counts lines).
- K96: bottom "{n} item(s) · {date}" and the toast "Purchase confirmed · {n}
  items · €…" count lines; "{n} item(s) stay in the cart" counts cards.

**MONEY "Add expense"** (`expenses/PurchaseForm.jsx`, `lib/moneyPurchase.js`,
K54). A row with "Add to HOME" on, not locked, whose name is no HOME item
(`rowLine` `canAttach`): link **"It's another name of…"** → a search
("Search your items…", group aria "Which HOME item?") over normal items only
(`canHaveNames`: no group, variant or durable), up to 6 buttons "{name}
({stock} {unit})", then "{n} more — type more of the name"; × "Close the
search". Picked: the row keeps its name, takes the item's category and unit
(unless changed by hand), the note reads `Adds to "{item}" in HOME (+{qty}
{unit}) — new name, it will be remembered.`, and **"Not this item"** undoes
the choice (typing the name again does too). Saved: `pantry_item_id` +
`add_name` (+ `name_pack` for a first size). Undo / Reopen removes the name
(K61). The "Use …" / K85 path is unchanged.

**Linked arrival (K90 + K95)** (`expenses/LinkedArrivedDialog.jsx`,
`inventory/RestockForm.jsx` `boughtAs`, `hooks/useOrders.js`,
`hooks/itemNameActions.setNamePack`). An order whose `item_name` is another
name (exactKey) of its linked item: the pack field starts with that name's
size; a first-time size is the name's. After `arrive_order`: the order gets
`pack_size` and `arrival_pack_before = { packaging_unit, quantity_per_pack,
name, saved }` (what the name had), then `save_item_names` `edit` with a
fresh `was`, only while the name still has no size (else
`arrival_pack_before` is emptied). Undo on the toast and "Back on the way":
the name gets back what it had, only while it still has exactly `saved`.
Texts unchanged. Unlinked "It arrived!" still never saves a usual size.

**Reopen / Undo (K96).** `askUndoPurchase(trip, { count, cards })`:
"Reopen this purchase?" says "The {cards} item(s) (€…) go(es) back to the
cart, …" (`trips.cardCount`: one per card, a deleted card by its copy; from
Receipts and from Money's purchase row); "Undo this purchase?" keeps
counting lines. `reopenNotes`: a created item that stays adds up all its
lines ("this purchase's 5 pcs were taken out"); a line with `merged_from`
never counts as having created the item.

**How a name line shows elsewhere.** Money → the opened purchase row: one
row per line with its own name and amount (as built in round 4). Shop →
"Receipts": one line per name with its price. Home → "History": title = the
item of now, the line's name under it (stage 2).

**Files.** New: `components/grocery/NameLines.jsx`,
`hooks/useLastBoughtNames.js`, tests `lib/nameLines.test.js`,
`components/nameLines.render.test.jsx`, `hooks/nameArrival.test.js`,
`hooks/nameLinesToasts.test.js`. Changed: `lib/purchase.js`,
`lib/itemNames.js`, `lib/moneyPurchase.js`, `lib/packSize.js`
(`firstTimePatch` skips `onName`), `lib/lastPrice.js`
(`fetchItemLineNames`), `lib/reopenUnits.js`, `lib/trips.js`,
`lib/durable.js`, `hooks/usePurchase.js`, `hooks/useOrders.js`,
`hooks/itemNameActions.js`, `grocery/ConfirmPurchase.jsx`,
`GroceryItemTile.jsx`, `ShoppingMode.jsx`, `ReceiptsView.jsx`,
`expenses/PurchaseForm.jsx`, `LinkedArrivedDialog.jsx`,
`inventory/RestockForm.jsx`, `ItemEditor.jsx`, `pages/GroceryPage.jsx`,
`ExpensesPage.jsx`.

**Tests: 2319 → 2387 (123 → 127 files).** `lib/nameLines.test.js` (28:
every naming kind, €3.87, K92, coupon 0.14 + 0.10 + 0.15 → €3.48, Shared
0.72 + 0.51 + 0.77 / 0.67 + 0.48 + 0.72, K51, K94, one-line payload equal
before and after 032, K93, K60 pcs item "1 pack" typed 4 → name_pack, the
item's own name → item rule, J.1 22 pcs, K71, K53, K56, notes per item, K54);
`components/nameLines.render.test.jsx` (18: K53 header, three lines →
"3 items", "= 3 pcs added to the stock", the price filled per quantity, ×,
K94 and the empty name lock Confirm, the durable warning, K71 with two lines
and two cards, the Shared box with name lines, J.1, K93, before 032, 36-px
targets and wrapping, the K53 tile in List, Shop mode and its cart, MONEY
link + search + note + "Not this item" + save with add_name, the Arrived
field under a name); `hooks/nameArrival.test.js` (8: K90 saved on the name,
a name with a size, the other phone first, no usual size on the item; K95
Undo, "Back on the way", changed by hand kept twice); `hooks/nameLinesToasts
.test.js` (5: "Purchase confirmed · 3 items · €3.87", "Purchase saved · 1
item · €4.50", the Reopen question for 1 and 2 cards, "Undo this purchase?"
3 items); `supabase/migrations.test.js` block "032" → "stage 3: the app's own
payloads" (9, PGlite: €3.87 stock 1 → 4, three expenses, the card bought
once, Reopen → 1 and back once, the new name gone; coupon; Shared; K94 never
sent and refused when forced; name_pack +4 and Reopen; J.1 22 pcs; K71;
MONEY K54 + Reopen; the K90/K95 writes). Existing tests changed:
`lib/itemNamesRead.test.js` (the stage-2 "never saved on the item from
another name" now also expects `name_pack`, K60), `hooks/reopenNotes.test.js`
("The 1 item … goes back", K96), `hooks/arrivalDb.fixture.js` (+
`save_item_names` as 032 writes a name's pack).

**Kata ragu (07/11 stage 3, tanya Zidane).** Built the safe way until
answered.

(Answered 07/11: 1 → K97, 2 → K98, 3 → K99, 4 → K100, 5 → K101, 6 → K102.)

1. Line 1's name is not saved on the SHOP card (it is sent on the line;
   K52 saves only quantity, unit, price, payer). Card "Chips & Snacks", line 1
   changed to "Corn Snack", Confirm → expense "Corn Snack"; Reopen → the card
   is back as "Chips & Snacks". Options: (a) as built; (b) also rename the
   card. Suggestion: (a).
2. Line 1 keeps the card's price when its name is changed (K55 fills lines
   2…N only). Card €1.20, chip "Nuvole di drago" tapped on line 1 → stays
   €1.20 (last Nuvole price €0.99 not filled). Options: (a) as built; (b) fill
   it (it then becomes the card's price). Suggestion: (a).
3. A name without a size, bought in the item's usual unit at the item's
   usual size, saves nothing on the name. Cat Wet Food box 48, "Gourmet 1
   box" kept at 48 → Gourmet stays without a size; typed 40 → Gourmet box 40.
   Options: (a) as built; (b) save 48 on the name too. Suggestion: (a).
4. Lines 2…N of a NEW item start with an empty "pcs per pack", also when
   line 1 said 10. Options: (a) as built (report J.1: "required; with 12");
   (b) start with line 1's 10. Suggestion: (a).
5. A line name equal to ANOTHER card of the same cart that will make a new
   item is not checked (K94 checks HOME only). Cart: new card "Patatine
   Paprika" + card "Chips & Snacks" line 2 "Patatine Paprika": Chips first →
   the name is added and the new card's stock also goes to Chips & Snacks;
   the new card first → 032 refuses the whole purchase ("… is already a name
   of … in HOME — check the line and save again."), nothing saved. Options:
   (a) as built; (b) refuse under the line with a new text; (c) take the card
   out of the cart. Suggestion: (b).
6. A card under a word that is no name of its item (an old card linked
   to an item renamed since) sends that word without add_name. Card "Snack
   mix" linked to Chips & Snacks, 2 lines → expense "Snack mix", not
   remembered. Options: (a) as built; (b) add it as a new name. Suggestion: (a).

### Stage 3 follow-up as built (07/11; K98 and K101, code and tests only, no SQL)

No SQL, no new column, no change to any 032 function, no new browser storage,
no new offline queue. K97, K99, K100 and K102 stay as built.

**K98** (`grocery/ConfirmPurchase.jsx` `FirstLinePrice`, `lib/purchase.js`
`namePriceTotal`). Only on a card with name lines (`namesReady`). Line 1's
name ≠ the card's name (exactKey; emptied counts as the card's) and it is the
item's own name, one of its names or a new name: `useLastPrice(name)` (report
F) → `namePriceTotal(last, quantity, unit)` = `lineTotal` with that price,
converting only the same unit, kg/gr and L/ml (no pack sizes). A total → the
screen's edit `{ total }`, exactly as if it had been typed (the field
"Total for {card}", visible only as "€" and "0.00"); it follows a later
quantity or unit of line 1 while filled in. No price or no conversion → the
total stays as it is. Back on the card's name, or the item's own name with no
price: the opening price (the card's own price fields as the screen opened;
when the card still has them the edit is simply dropped, else that price for
the quantity and unit of now). Typing in "Total for {card}" ends it for that
card on this screen (`typedPrice`). Quantity and unit are never changed. What
is saved: the same `patches` (`editPatch`) and the same line as a typed
price; lines 2…N untouched.

**K101** (`lib/purchase.js` `newNameOnce`, `lib/itemNames.js`
`NAME_TWICE_TEXT`). Run on the trip's lines after `expiryOncePerItem`
(`tripLinesOf`, also at Confirm). Only lines of kind `new` (they would send
`add_name`): (1) its name equals (exactKey) a card of this trip with `isNew`
other than its own card; (2) a line of another card added that name earlier
in screen order (cards with name lines are never in a group card, so screen
order = cart order). The line gets `naming.problem` = `"{name}" is also another
line of this purchase — use it only once.` ({name} as typed, trimmed), no "New
name of …" note, and `ready: false`; it shows under that line's "Name" field
(line 1: "Name of {card}"; line n: "Name of line {n} of {card}"), the card
gets the amber border, and the bottom says "Answer the question above to
confirm." with "Confirm purchase · €…" disabled. A card left out of the trip
("Not in this trip — stays in the cart") does not count. K94 is checked first
and stays as it is.

**Proven with the real 032 (PGlite), before this fix:**

- Case (1), the named card first: saved; the name went on the item and the
  new card's stock went to that item too, no new item (Chips Box F1 2 → 5 pcs).
- Case (1), the new card first: 032 refused the whole purchase (`"Paprika F2"
  is already a name of "Paprika F2" in HOME — check the line and save again.`),
  nothing saved.
- Case (2): 032 refused the whole purchase (`"lime f3" is already a name of
  "Chips Box F3" in HOME — check the line and save again.`), nothing saved.
- The same new name twice in ONE card (not K101, unchanged): saved; the name is
  added once (by that purchase), 2 + 1 + 1 + 1 = 5 pcs, three expenses (€1.20,
  €0.90, €0.80), three history rows each with its line's spelling; Reopen → 2
  pcs and the name gone.

After the fix such a line is never ready, so Confirm never sends it; renamed,
the same purchase saves both items (Paprika F1 made with 1 pcs, the item 2 → 4).

**Files.** Changed: `lib/purchase.js`, `lib/itemNames.js`,
`grocery/ConfirmPurchase.jsx`; tests `components/nameLines.render.test.jsx`,
`lib/nameLines.test.js`, `supabase/migrations.test.js`; this plan.

**Tests: 2387 → 2407 (127 files, unchanged).** `nameLines.render.test.jsx`
(+13: K98 €1.20 → €1.49 and the same patch and line as typed €1.49; 2 pcs
€2.40 → €2.98, 3 pcs → €4.47; typed €1.10 stays; back to the card's name
(chip, emptied) and the item's own name without a price → €1.35, with a price
→ €2.10; no price → unchanged, also after a fill; €5.40 per pack → unchanged;
500 gr, €8.00 per kg → €4.00, total €5.20; lines 2…N 1.49 + 1.35 + 0.80 =
€3.64. K101 (1) on line 2 and line 1, either order, × and renaming free it,
"Not in this trip" frees it; (2) the later card either order; different
names; the same name twice in one card sent with add_name twice; K94 stays);
`nameLines.test.js` (+3: `namePriceTotal`, `newNameOnce` both cases);
`migrations.test.js` block "032" → "stage 3" → "follow-up K101" (+4, PGlite:
the four results above, and the renamed purchase).

**Kata ragu (07/11 stage 3 follow-up, tanya Zidane).** Built the safe way
until answered.

1. When a filled price reaches the card. A price typed in "Total for {card}"
   is written to the SHOP card when the field is left; a filled one only at
   Confirm (or when the quantity or unit field of line 1 is left, as for any
   edit). "Back" without confirming: the card keeps €1.20. Options: (a) as
   built; (b) write it to the card at once. Suggestion: (a).
2. After Confirm the card carries the name's price, so Reopen brings back
   "Chips & Snacks" (K97) at €1.49 (Nuvole's), exactly like a typed €1.49
   today. Options: (a) as built (the same as typed); (b) never save line 1's
   price on the card when its name was changed. Suggestion: (a).
3. No conversion through a pack size. Nuvole di drago last "€5.40 per 1 pack"
   (6 pcs in a pack on the name), line 1 in pcs → €1.20 stays. Options: (a) as
   built (the same unit, kg/gr, L/ml only); (b) also through the name's pack
   size (€0.90 per pcs). Suggestion: (a).
4. A filled price follows line 1's quantity (2 pcs €2.98 → 3 pcs €4.47), as
   lines 2…N do; the decision did not say. Options: (a) as built; (b) keep the
   total of the moment of filling. Suggestion: (a).

(Answered 08/11: 1 → K103, 2 → K104, 3 → K105, 4 → K106.)

iPhone test of stage 3 done 08/11/2026: all OK.

### Stage 4 as built (08/11; code and tests only, no SQL)

The merge and separate actions, the delete question, the restore guard and
K107. No SQL, no new column, no change to any 032 function: the payloads are
exactly what `merge_pantry_items` and `separate_item_name` take, proven with
the real 032 in PGlite. No new browser storage, no new offline queue. `names`
is still out of `ITEM_FIELDS`. Group code (`GroupTile`, `GroupShopCard`,
`syncGroup`, `useShopTidy`, `lib/groups.js`, `lib/groupShop.js`, the variant
selects) is not touched.

**Pure rules** (`lib/itemNames.js`). `mergeRow` / `mergeRows` (K109, K110:
`stockFactor`, the same rule as 032: the same unit, kg/gr, L/ml, the target's
usual pack), `mergeQuestion`, `mergePayload` (`was` = `current_stock`, `unit`,
`updated_at` of each STORED row), `mergedToast`, `separateQuestion`,
`separatePayload`, `separatedToast`, `mergedNamesDeleteText`, `canMergeInto`.
`separationCheck` now follows K75 fully (the name's pack size, then the
parent's usual pack) and rounds to 3 decimals like 032.

**Actions** (`hooks/itemNameActions.js` `mergeItems`, `separateName`). Offline:
`"You're offline — this needs a connection."` before anything is asked. Every
row is read from the pantry store as stored (a group row with its own 0, never
the `withGroupTotals` total). Before the question `mergeCheck` (the same
refusals and texts as 032) — a merge 032 would refuse is never asked, the text
is shown as an error toast. After "Merge" / "Separate": the 032 function; a
refusal (P0001) is the database's message as the error toast and the lists are
read again; then pantry and SHOP entries are read again, and orders, history
and purchase lines when those lists are open; `syncShoppingForItem` for the
target (merge) or both items (separate); the toast (15 s, no button).
"already merged": the lists are read again, nothing is said.

**Screens.** `inventory/ItemEditor.jsx`: "Merge other items into this one…"
after "Other names" (in "Edit group" in the same place, before Notes); K113 by
comparing the form and the name list with what they were when the editor
opened. `inventory/MergePicker.jsx`: the picker (portal, z-50, above the
editor; the question z-60 above it). `inventory/OtherNamesFields.jsx`:
"Separate" per saved name. `pages/PantryPage.jsx`: the actions; the editor
closes when one is done. `ui/Feedback.jsx` + `lib/feedback.js`: a question's
`message` may be several paragraphs, a number field may have `check(text,
number)`, a field's `help` may follow the values, and a `note` closes the
question (all optional; every other question unchanged).

**K116** in `usePantryItems.deleteItem` (every delete: the tile, a group tile,
"Finished one-time items"): only an item with a name with `origin` or
`from_item_id` asks; "Delete" runs today's delete with its toast and Undo.
Deleting asked no question before, so this is the only one.

**K117 + K118** (`lib/inventoryBackup.js` `readCurrentItems`, `restorePlan`,
`skippedQuestionLine`, `restoredText`; `inventory/DataView.jsx`). The items of
now are read before the question (offline or a failed read: nothing is
written). Question line (m > 0): `{m} of these items were merged into another
item since this backup — they are skipped, and their history goes to that
item.` (m = 1: `1 of these items was merged into another item since this
backup — it is skipped, and its history goes to that item.`). Result:
`Restored {n} items. {m} skipped: merged into another item.` (n = restored;
without skips today's `Restored {n} items.`), then `{k} items kept their
merged names and stock: {names}.` (k = 1: `1 item kept its merged names and
stock: {name}.`). In another unit also `min_stock`, `packaging_unit`,
`quantity_per_pack`, `price`, `price_qty`, `price_unit` stay as now.

**K107** (`lib/packSize.js` `purchasedQuantityLabel`): Money's rule moved
there; `expenses/ExpenseGroup.jsx` and `grocery/ReceiptsView.jsx` both use it.

**Verified.** Reopen / Undo after a merge: `reopenNotes` treats a line with
`merged_from` as stock only (an old purchase of B that created B, reopened on
T: 6 → 3 pcs, no "stays in HOME" note; PGlite and unit). History after a real
merge and separation: "TEST T" with "Corn Snack · Merged ·…" and "Corn Snack ·
Separated ·…" under it; the separated item's own "Separated" row.

**A separated item at 0** goes on the SHOP list when `restockReason` says so:
a new item (minimum 0, not 1×) always ("Out of Stock" on its card); an item
back from its origin unless it was 1×.

**Files.** New: `components/inventory/MergePicker.jsx`, tests
`lib/mergeSeparate.test.js`, `hooks/mergeSeparate.test.js`,
`components/mergeSeparate.render.test.jsx`,
`components/receiptsQuantity.render.test.jsx`,
`components/restoreGuard.render.test.jsx`. Changed: `lib/itemNames.js`,
`lib/inventoryBackup.js`, `lib/packSize.js`, `lib/feedback.js`,
`hooks/itemNameActions.js`, `hooks/usePantryItems.js`,
`components/ui/Feedback.jsx`, `inventory/ItemEditor.jsx`,
`inventory/OtherNamesFields.jsx`, `inventory/DataView.jsx`,
`expenses/ExpenseGroup.jsx`, `grocery/ReceiptsView.jsx`,
`pages/PantryPage.jsx`; tests `hooks/arrivalDb.fixture.js` (a test may add a
function; a refusal keeps its code), `hooks/itemNamesPantry.test.jsx` (the
delete of an item with a merged name answers K116 first),
`supabase/migrations.test.js`; this plan.

**Tests: 2407 → 2459 (127 → 132 files).** `lib/mergeSeparate.test.js` (16),
`hooks/mergeSeparate.test.js` (14), `components/mergeSeparate.render.test.jsx`
(10), `components/receiptsQuantity.render.test.jsx` (2),
`components/restoreGuard.render.test.jsx` (2), `supabase/migrations.test.js`
block "032" → "stage 4" (8, PGlite, the app's own payloads: tests 1 + 10, 2
(the total 3 refused, the stored 0 merged), 3 + 4, 5, 7, 8, 9, 12).

**Kata ragu (08/11 stage 4, tanya Zidane).** Built the safe way until
answered.

1. CSV / Excel import can bring back a merged item and overwrite a target's
   stock. A CSV exported before the merge (with its `id` column) imported
   after it: A and B come back as items with their old stock (counted twice)
   and T's stock is set back to 1 pcs; names stay, `is_group` isn't in the
   file. Not built. Options: (a) leave it; (b) the same guard as the restore;
   (c) refuse rows with an id of a merged item. Suggestion: (b).
2. A restored backup row that was a variant of the group that is now a
   normal item (taken out of the group after the backup, before the merge)
   gets its `group_id` back and becomes a variant of a normal item. Not
   built. Options: (a) leave it; (b) restore it with no group when its group
   is no group any more. Suggestion: (b).
3. "When it was merged it brought {x}" is worked out from the name's origin
   (its stock then × the parent's conversion now), not from the "merged"
   history row. They differ only when the parent's unit or usual pack changed
   since the merge (then it says it in the old unit). Options: (a) as built;
   (b) read the "merged" row. Suggestion: (a).
4. A merge 032 would refuse (stock that can't be converted, a name of a third
   item) is refused before the question with the same text, nothing sent.
   Options: (a) as built; (b) ask and let the database refuse. Suggestion: (a).
5. Texts the prompt didn't give: "Merged 1 item into …" (singular), "Merge 0
   items…" (disabled), the picker's empty list "No other items in this
   category — search to find more." / `Nothing else matches "{text}".`, and
   K116 with one name keeps "they" ("Once deleted, they can't be separated
   again."). Options: (a) as built; (b) other words. Suggestion: (a), or
   "it" for one name.
6. K118 in another unit. Backup: T counted in pack, minimum 1 pack, €5.00 per
   pack; now 8 pcs, minimum 4 pcs, €1.20 per pcs. Restored: unit pcs, stock 8,
   minimum 4, pack size and price as now; name, category, notes, store, payer,
   expiry from the backup. Options: (a) as built; (b) skip the whole row.
   Suggestion: (a).

(Answered 08/11: 1 → K119, 2 → K120, 3 → K121, 4 → K122, 5 → K123, 6 → K124.)

### Stage 4 follow-up as built (08/11; K119, K120, K123, K125, code and tests only, no SQL)

The import guard, the group of a restored row, a target's expiry and batch,
and one text. No SQL, no new column, no new browser storage, no new offline
queue; `names` is still out of `ITEM_FIELDS` and is never written by a
restore or an import. Group code is not touched.

**One rule for both** (`lib/inventoryBackup.js` `guardRows`, used by
`restorePlan` and the new `importPlan`). Skipped: a row whose id is a
`from_item_id` of a name now; for the import also a row that would make a new
item (no id, or an id of no item now) whose exactKey is a merged name with an
`origin` ("test corn bite" against "TEST Corn Bites"). A plain other name
(no origin) or the row of an item now is never skipped by name. A target's
row keeps `current_stock`, `unit`, `expiry_date`, `batch_lot` (K125) and, in
another unit, `min_stock`, `packaging_unit`, `quantity_per_pack`, `price`,
`price_qty`, `price_unit` (K124). The restore still writes `is_group` false
and `group_id` null for a target (as built). An imported row only has the
file's columns and only those are replaced: the import adds no column (one
upsert writes the same columns for every row; a column missing from one row
would be written as null), so a target's group, names and `price_qty` /
`price_unit` stay as they are.

**K120.** The groups afterwards: every item that is a group now plus every
group row of the file, minus the skipped and the targets. A row whose
`group_id` is not one of them comes back with `group_id` null (this also
means a row never points to an item that doesn't exist). The CSV / Excel file
has no `group_id` or `is_group` column, so an import never changes a group:
an item now keeps its group, a new item has none.

**The import** (`inventory/DataView.jsx` `handleCsv`). Unchanged until the
rows are read (an unreadable file, no rows, only durables: as before). Then
the items of now are read (offline or a failed read: the error toast,
nothing written), the question `Import {n} items?` (n = every row of the
file, after the durables, as today) with today's text (and today's durable
note) and, when m > 0, the line `{m} of these items were merged into another
item since this file was made — they are skipped.` / `1 of these items was
merged into another item since this file was made — it is skipped.`;
"Cancel" / "Import". After "Import" only the rows of the plan are written
(`importItems`, as before). The result under the two cards:
`Imported {n} item(s).{durable note}` with n = the rows written, then
` {m} skipped: merged into another item.` (m > 0), then ` {k} items kept
their merged names and stock: {names}.` / ` 1 item kept its merged names and
stock: {name}.` (k > 0). Without skips and kept items exactly today's text.
Example: `Imported 1 item. 2 skipped: merged into another item. 1 item kept
its merged names and stock: TEST Nacho Tray.`

**K123** (`lib/itemNames.js` `mergedNamesDeleteText`): one name → `It holds
the name of 1 merged item (Corn Snack). Once deleted, it can't be separated
again.`; two or more unchanged.

**Files.** New: tests `lib/importGuard.test.js`. Changed:
`lib/inventoryBackup.js`, `lib/itemNames.js`, `inventory/DataView.jsx`;
tests `lib/mergeSeparate.test.js`, `hooks/mergeSeparate.test.js` (K116 with
one name), `components/restoreGuard.render.test.jsx`,
`supabase/migrations.test.js`; this plan.

**Tests: 2459 → 2473 (132 → 133 files).** `lib/importGuard.test.js` (9: tests
1, 2, 3 (JSON and CSV), 4 (and a group gone and not in the file), 5, 6, the
texts without merges); `components/restoreGuard.render.test.jsx` (+3: test 1
on the screen, Cancel, a file without merges as before);
`supabase/migrations.test.js` block "032" → "stage 4" (+2, PGlite, written in
one upsert as `importItems` sends it: K120 + K125 after real merges and a
deleted group, and test 1 from a real CSV).

**Kata ragu (08/11 stage 4 follow-up, tanya Zidane).** Built the safe way
until answered.

1. The name rule only for a row that makes a new item. A CSV row with the id
   of an item now ("TEST Lime Soda" now, "TEST Corn Bites" in the file
   because it was renamed after the export) whose file name is a merged name
   of T is imported: the item is renamed to "TEST Corn Bites", and that name
   is then on two items. Options: (a) as built; (b) skip the row; (c) import
   it but keep its current name. Suggestion: (c).
2. The question counts every row, the result only the rows written: 3 rows,
   2 skipped → `Import 3 items?` … `Imported 1 item. 2 skipped: …` (as
   "Restore backup" does). Options: (a) as built; (b) `Import 1 item?`.
   Suggestion: (a).
3. `last_purchased_at` of a target. The restore brings back the backup's date
   (T last bought 12/11 after the merge, the backup of 1/11 says 28/10 →
   28/10). The CSV import never writes it (its column is exported but not
   read). Not changed (K125 says no other field). Options: (a) leave it;
   (b) a target keeps it too. Suggestion: (b).
4. A group in a CSV. The export writes a group's total (what HOME shows: 1 +
   1 + 1 = 3) as its `current_stock`; importing that file writes 3 on the
   group's own stock (stored 0), so HOME then shows 6. Not changed (as before
   this round). Options: (a) leave it, stage 5 removes groups; (b) the import
   never writes a group's stock. Suggestion: (a).

(Answered 08/11: 1 → K126, 2 → K127, 3 → K128, 4 → K129.)

### Stage 4 second follow-up as built (08/11; K126, K128, code and tests only, no SQL)

A name in the file that belongs to another item, and a target's last bought
date. No SQL, no new column, no new browser storage, no new offline queue;
`names` is still out of `ITEM_FIELDS` and is never written by a restore or an
import. Group code is not touched. K127 and K129: nothing changed.

**K126** (`lib/inventoryBackup.js` `guardRows`, so the restore and the import
alike). For every row that is not skipped and whose id is an item now: when
the file name is not a name of that item (`hasName`: its own name or one of
its other names, exactKey) and is a name of any other item now
(`nameTakenBy`, own or other name, with or without origin, groups too), the
row is written with the item's current name. The rest of the row follows the
existing rules, a target's row too (K118, K124, K125). `restorePlan` and
`importPlan` return `keptName` (the items now that kept their name);
`restoredText` and `importedText` add the line after the existing ones.
Compared with the items as they are now, not as the file would leave them.
The questions are unchanged.

**K128.** `last_purchased_at` joins `STOCK_FIELDS` (the fields a target
keeps). The CSV / Excel import never reads that column, so it never writes it
(a field the row doesn't carry is not added); the restore keeps the target's
date (null stays null).

**The texts, in full** (`inventory/DataView.jsx`, unchanged; the result shows
under the two cards):

- Import question: title `Import {n} item(s)?` (n = every row of the file
  after the durables), text `Rows with an existing id overwrite that item;
  the others are added as new items.` + ` {d} durable row(s) skipped (durable
  items don't go into HOME stock).` (d > 0), then its own paragraph
  `{m} of these items were merged into another item since this file was made
  — they are skipped.` / `1 of these items was merged … — it is skipped.`
  (m > 0); "Cancel" / "Import".
- Import result: `Imported {n} item(s).` + the durable note (d > 0) +
  ` {m} skipped: merged into another item.` (m > 0) + ` {k} items kept their
  merged names and stock: {names}.` / ` 1 item kept its merged names and
  stock: {name}.` (k > 0) + the K126 line (j > 0).
- Restore question: title `Restore {n} items?` (every item of the backup),
  text `From the backup of {date}. Items in the backup overwrite current ones
  with the same id; other items are kept.`, then (m > 0) `{m} of these items
  were merged into another item since this backup — they are skipped, and
  their history goes to that item.` / the m = 1 text; "Cancel" / "Restore".
- Restore result: `Restored {n} items.` (n = items written; with skips
  `Restored {n} items. {m} skipped: merged into another item.`) + the k
  line + the K126 line.

**Files.** New: tests `lib/importNames.test.js`. Changed:
`lib/inventoryBackup.js`; tests `components/restoreGuard.render.test.jsx`,
`supabase/migrations.test.js`; this plan.

**Tests: 2473 → 2487 (133 → 134 files).** `lib/importNames.test.js` (10:
tests 1, 2, 3, 4, 5, a row of no item now untouched, 6 (JSON and CSV), 7
(JSON, and the CSV never writes the date)); `components/restoreGuard.render.test.jsx`
(+2: test 1 on the screen, tests 2 + 7 on the screen);
`supabase/migrations.test.js` block "032" → "stage 4" (+2, PGlite, after a
real merge, written as `importItems` sends it: K126 + K128 restore, K126 CSV).

**Kata ragu (08/11 stage 4 second follow-up, tanya Zidane).** Built the safe
way until answered. (Answered 09/11: 1 → K130, 2 → K131, 3 → K132.)

1. A row whose id is no item now, whose name is another item's name now. A
   backup of 1 Nov holds D "TEST Plum"; D deleted on 4 Nov; on 6 Nov a new
   "TEST Plum" made. Restore → D comes back as "TEST Plum": two items of that
   name. Not built (K126 says so). Options: (a) leave it, merge them by hand;
   (b) skip the row; (c) bring it back but say so in the result. Suggestion:
   (a), it needs a delete and a new item of the same name first.
2. Two rows of the same file with the same name (X and Y both "TEST Mango")
   both written. Not built. Options: (a) leave it; (b) keep the second one's
   current name. Suggestion: (a).
3. Names the same file also changes. The file has Z "TEST Peach" and X "TEST
   Mango"; now Z is "TEST Mango", X "TEST Kiwi". After the import Z would no
   longer be "TEST Mango", but X still keeps "TEST Kiwi" (compared with the
   names now). Options: (a) as built; (b) compare with the names the import
   leaves. Suggestion: (a), simpler, and nothing is ever on two items.

### Stage 5 as built (09/11; code and tests only, no SQL)

The item-group and variant mechanics are gone from the app. No SQL, no new
column, no change to any 032 function, no new browser storage, no new
offline queue. The database keeps `is_group`, `group_id`, their constraints
and index (K134); `ITEM_FIELDS` keeps both for old backups; `lib/inventoryBackup.js`
and `inventory/DataView.jsx` (K117–K129) are not touched. Nothing in the app
writes `is_group = true` or a `group_id` any more. Every item is judged on its
own stock and minimum (K135).

**Removed, per screen.**

- Home → Items: "Add group", the notice "Item groups need a one-time update
  of the database", the `topLevel` filter (variants show as their own tiles),
  `GroupTile` + `VariantRow` ("{n} variants", "Total: …", "Variants" /
  "Hide", "Add a variant", "Edit variant", "Take out of the group (becomes a
  normal item again)" and its toast), `restockGroup`, `takeOut`, the group
  branch of "Add to grocery list" and its two toasts, the "in {group}" line on
  a tile. "Add item" is the only add button.
- "Edit item": the titles "Add a group" / "Edit group" / "Add a variant to
  {group}", "Create group", "Group (optional)" with its hint, `changeGroup` +
  `Move into "{group}"?` + "Convert and move", the unit lock and its two notes,
  the variant hint about the group's minimum. "Usually bought at" now shows for
  every item (variants too).
- "Add bought stock" (`RestockForm`): "Which variant", "New variant…", "Name /
  brand of the new variant".
- "Finished one-time items": "in {group}".
- Shop → List / Shop: `GroupShopCard`, `ShopGroupCard`, `shopUnits`,
  `rowOrder`, `unitItem`, "Add another variant" (`addVariant`,
  `addableVariants`), "You choose the variant when confirming", `useShopTidy`,
  `syncGroup`, `planGroupEntries`, `groupsToTidy`, `variantPurchase`,
  `groupOf`, the "(group)" aria labels, "Not urgent" (K135). One card per SHOP
  entry, exactly as normal items were; `spareEntryIds` moved into
  `lib/inventory.js` (its only user).
- Confirm purchase: the group box, "Which variant of "{group}" gets this
  stock?", "Choose a variant…", "New variant…", `variantIds`,
  `usePurchase.makeVariants` / `removeEmptyVariants`. Name lines (stage 3)
  unchanged.
- Money → "Add expense": the variant select, "This group has no variants yet
  …", `Choose which variant of "{group}" gets the stock.`, `"{group}" is a
  group — choose the variant that gets the stock.`, the group fallback in
  `homeItemFor`, `withGroupTotals`.
- "It arrived!" and the linked dialog: K136.
- Logic: `lib/groupShop.js` deleted; `lib/groups.js` keeps only `isGroup`,
  `variantsOf` and the three K138 texts (`withGroupTotals`, `checkMoveIntoGroup`,
  `newVariantFields`, `listedOutVariants`, `variantOrder`, `firstOutVariant`,
  `groupsReady` deleted). `lib/inventory.js`: `shopReason` deleted (the list
  uses `restockReason`), no group branch in `restockReason` / `displayReason`
  / `syncShoppingForItem`. `useNewItemIds`: the group part.
  `useGroceryList`: `groupOf`, the variant reason rule, `useShopTidy`.
  `grocerySearch`: `variantHint` → `namesHint` ("In it: …" from other names),
  `matchingVariants` → `matchingNames`. `pantryFilters`: `groupName` in
  `searchRank`, `matchesExpiryDeep`. `similarItems`: no group-before/after
  ordering. `purchase` / `moneyPurchase` / `packSize`: no variant line.

**Kept, and why.** `merge_pantry_items` / `separate_item_name` /
`save_item_names` calls and all of stages 2–4; the K112 / K70 group target in
the merge (`mergeRows`, `groupMergeNote`, `MergePicker` locked variants, the
`mergeCheck` texts, which are 032's own): they are the K138 way to turn an
old group row into a normal item. Order groups of 9I. `canHaveNames` /
`cardTitle` / the K93 rule still leave out a group row and a variant of one
(Kata ragu 5).

**K138 fallback (a group row made by an older app version).**

- Tile (`ItemTile`): its own stored stock, the grey note under the name (after
  "also: …"), no Low / Out badge, never red or yellow (purple when expired),
  and none of −, +, "+1 {pack}", "Add bought stock", "Discard", "Add to grocery
  list"; "Edit" and "Delete" stay. `increment_stock` does not refuse a group
  row, so nothing on the tile may change its stock.
- "Edit item": no 1×, no "Current stock", no expiry, no batch (so Save never
  sends stock to it); no minimum hint; "Merge other items into this one…" as
  K112. Delete refused while it has variants (`groupDeleteText`).
- Never on the SHOP list: `restockReason` null; `syncShoppingForItem` deletes
  its automatic entries still "to buy" (as `planGroupEntries` did), keeps those
  in a cart, on the way or typed by hand. Not counted in the Low / Out tiles
  or "need buying".
- Its variants: normal items (own minimum; at 0 their own entry "Out of
  Stock"); "Which item?" in "It arrived!" offers them.
- Kept out of every picker that gives stock or a SHOP entry (K138 d):
  `matchHomeItems` (SHOP "Use …", MONEY's question, "It arrived!" "Add it to
  …", HOME "Go to …"), `homeItemFor` (MONEY: its name makes a new normal item,
  as 022 does in SHOP), `pantryItemFor` / `pantryByName` (already), "It's
  another name of…", "Which item?", the "+ Add to SHOP list" name
  suggestions, `linkedItemOf` (an order linked to it opens "It arrived!";
  `arrive_order` refuses a group row anyway).
- A SHOP card linked to it by id (K138 b): **032 does not refuse it** — proved
  in PGlite, a hand-sent line puts the stock on the group row (0 → 2). So the
  app never sends it: the line has `oldGroup`, shows `"{group}" is an item
  group from an older app version and can't get stock — merge its variants
  into it first (Home → Edit item → Merge other items into this one…), or take
  this card out of the cart.`, no `restocks "…"`, and "Confirm purchase · €…"
  stays locked.

**Files.** Deleted: `lib/groupShop.js`, `lib/groupShop.test.js`,
`lib/groups.test.js`, `hooks/useShopTidy.js`, `inventory/GroupTile.jsx`,
`grocery/GroupShopCard.jsx`. New: `lib/noItemGroups.test.js`. Changed:
`lib/groups.js`, `inventory.js`, `inventoryStyles.js`, `grocery.js`,
`grocerySearch.js`, `pantryFilters.js`, `similarItems.js`, `nameSuggestions.js`,
`purchase.js`, `moneyPurchase.js`, `itemNames.js` (comments), `oneTime.js`,
`newItems.js` (comments); `hooks/usePantryItems.js`, `useGroceryList.js`,
`useGroceryItems.js`, `useNewItemIds.js`, `usePurchase.js`, `useOrders.js`,
`orderActions.js`, `itemNameActions.js` (comments); `pages/PantryPage.jsx`,
`GroceryPage.jsx`; `inventory/ItemEditor.jsx`, `ItemTile.jsx`,
`RestockForm.jsx`, `FinishedItems.jsx`; `grocery/ConfirmPurchase.jsx`,
`ShoppingMode.jsx`, `AddItemForm.jsx`, `GroceryItemTile.jsx`,
`EntryControls.jsx`, `OrderOnlineDialog.jsx`; `expenses/ArrivedDialog.jsx`,
`LinkedArrivedDialog.jsx`, `PurchaseForm.jsx`, `OrderCard.jsx`, `OrderForm.jsx`
(comments); `ui/Feedback.jsx` (comment); tests (below); this plan.

**Tests: 2487 → 2477 (134 → 133 files).** Deleted with their code:
`lib/groups.test.js` (30), `lib/groupShop.test.js` (14; its `spareEntryIds`
case moved to `lib/shopSync.test.js`). New: `lib/noItemGroups.test.js` (35:
every removed text, reason and module is nowhere in the app's code).
Rewritten: `lib/shopSync.test.js` (K138: the group row never listed, a variant
at 0 Out and at 5 not, a variant on its own minimum, old group-level entries,
duplicates of one item), `lib/oneTime.test.js` (K135: minimum 1 at 2 / 1 / 0
for three items, minimum 3 at 3, no 'not-urgent' anywhere, the priority order
with out / low / expired / hand-added / stocked cards; K138 rules and the
locked Confirm line), `lib/moneyPurchase.test.js`, `lib/similarItems.test.js`,
`lib/packSize.test.js`, `lib/itemNamesRead.test.js`, `lib/newItemUnit.test.js`,
`lib/newItems.test.js`, `hooks/arrivalUndo.test.js`,
`hooks/oneTimeActions.test.jsx`, `hooks/orderPackSave.test.js`,
`components/oneTime.render.test.jsx` (K138 tile, note after "also:", "Edit
item" of a group row and of a variant, variant card "Out of Stock", locked
Confirm, Shop mode tiles), `components/inventory/inventory.render.test.jsx`,
`components/arrivedUndo.render.test.jsx` (K136 three choices, "Corn Bites TEST"
→ "Snack Box TEST" by another name with Undo, K137 names unchanged, the real
data shape with 10 names), `components/expenses/purchaseForm.render.test.jsx`
(no variant select, the real data shape), `components/mergeSeparate.render.test.jsx`
(K138: "Edit item" of a group row at 0 / minimum 4 with variants at 0 and 5 →
both ticked and locked, merged 5 pcs), `components/nameLines.render.test.jsx`
(the real data shape in Confirm and on the SHOP list), `components/itemNames.render.test.jsx`,
`components/newItemUnit.render.test.jsx`, `components/discountPreview.test.jsx`,
`components/similarItems.render.test.jsx`, `pages/shopAdd.render.test.jsx`,
`components/durableLock.render.test.jsx`, `pages/itemNamesPages.render.test.jsx`;
`supabase/migrations.test.js`: the round-4 MONEY case (a group row's name makes
a normal item, the group row and its variants untouched) and block "032" →
"stage 5" (+3, PGlite: K138 b proof, a variant bought with the app's payload,
the real data shape bought under an other name and a new name, Reopen).
Blocks 018, 022, 023…032 otherwise unchanged.

**Report rows "replace" not built (not decided).** A CSV / Excel column
"names" (report J.13) and the arrival toast "(Corn Snack)" (report J.8): see
Kata ragu 7.

**Kata ragu (09/11 stage 5, tanya Zidane).** Built the safe way until
answered.

1. K138 (a) A group row with 0 variants. An older phone makes "Pasta TEST" with
   "Add group" and adds nothing: the tile still says "merge its variants into
   it". Merge works with any items (none locked); Delete works (no variants).
   Options: (a) as built; (b) another text for 0 variants, e.g. "Item group
   from an older app version — merge items into it or delete it." Suggestion:
   (a), it is rare and both ways work.
2. K138 (b) A SHOP card linked to a group row (from the older version). 032
   puts the stock on the group row (proved), so the line is locked with the
   text above; the card can be taken out of the cart (or "Not in this trip").
   Its automatic "to buy" entries are deleted by the next judging; in the cart,
   on the way or typed by hand they stay. "Order online" of such a card says
   "For "{group}" in HOME … "Arrived" adds the stock", but Arrived then asks
   "It arrived!". Options: (a) as built; (b) let Confirm pick another item for
   the stock; (c) send it as "expense only". Suggestion: (a).
3. K138 (c) Deleting a group row that still has variants is refused with
   `"{group}" still has variants — merge them into it first (Edit item → Merge
   other items into this one…), then delete it if you want.` Options: (a) as
   built; (b) allow the delete: the database sets the variants' `group_id` to
   null (on delete set null) and they simply stay as items. Suggestion: (a)
   (nothing is lost either way; (a) keeps the K138 merge as the one way).
4. K138 (d) Pickers: a group row is left out of every place listed above. One
   consequence: HOME "Add item" with exactly a group row's name gets no "Go to
   …" question, and MONEY / SHOP with that name make a normal item, so two
   rows can share the name (fixed by the merge). Options: (a) as built; (b)
   keep "Go to …" for HOME only. Suggestion: (a).
5. Variants of a group row are normal for stock, minimum and the SHOP list,
   but still get no "Other names", no name lines at Confirm, no "It's another
   name of…", no K58 word and no merge button (032 refuses a variant as
   target). Example: "Lays TEST" (variant) → "Edit item" without "Other
   names". Options: (a) as built until the group is merged; (b) names for
   variants too. Suggestion: (a).
6. The group row's tile shows no status badge and stays green, still shows
   "min 4 pcs", is counted in "Total items" but not in Low / Out; "Edit item"
   still shows its minimum field (no hint). Options: (a) as built; (b) also
   hide the minimum. Suggestion: (a).
7. Report "replace" rows not built: the CSV / Excel "names" column (J.13) and
   the arrival toast with the other name ("Added 1 pcs to "Chips & Snacks"
   (Corn Snack)", J.8). Today: the CSV has no names column (the JSON backup
   has them); the toast says `Added 1 pcs to "Snack Box TEST"`. Options: (a)
   leave; (b) build in a later round. Suggestion: (a) for now.

(Answered 09/11: 1 → K139, 2 → K140, 3 → K141, 4 → K142, 5 → K143, 6 → K144, 7 → K145.)

iPhone test of stage 5 done 09/11/2026: all OK.

**Notes for later stages.**

- **Stage 3:** built (above).
- **Stage 4:** built (above): the stored `was`, a group target with every
  variant locked, Reopen / Undo stock only for `merged_from`, the restore
  guard, the delete question. Follow-up built (above): the same guard for the CSV /
  Excel import, K120, K125, K123. Second follow-up built (above): K126, K128. Next: the household merges on the phone, TEST
  items first. The name lines of Confirm never show for a group or a variant
  (K93): once stage 5 removes groups, the merged item is a normal item and
  gets them by itself.
- **Stage 5:** built (above). The old note "`LinkedArrivedDialog` with a
  group still has no name pack" is no longer relevant: there are no groups in
  the app, and an order linked to a group row from an older app version opens
  "It arrived!" instead of the linked dialog (K138).

### 9O. MONEY display round (decided 10–11/11)

Analysis: `tmp-export/money-display-readonly-report.md` (09/11, read only,
A–I; Kata ragu M1–M26). The household's decisions below win where they
differ from the report. **No SQL in any prompt of this round** (K163): no
file in `supabase/` changes; no new browser storage (the keys
`money.incomePerson`, `money.expensePerson` and the Trend bars/line choice
keep working as before), no new offline queue.

**Decisions.**

- **K146** Bar texts: "Totals per category (N)", "Expenses (N)", "Income (N)".
  - N for "Totals per category" = main categories with spending in the period for the "Paid by" pill.
  - N for "Expenses" = expenses in the period for the "Paid by" pill (the same rows the € chip next to "Expenses" adds up).
  - N for "Income" = income entries in the period for the "Received by" pill.
  - With a chart filter on: "Expenses (n of N)" / "Income (n of N)" (n = what the list shows).
  - The € total is shown only on the "Totals per category" bar (right side, as the card shows it today).
  - Empty period: "(0)"; the bar can still be tapped and opens to today's empty text (like "History (0)" in Orders).
- **K147** A chart tap (pie slice, legend entry, TREND bar, store row) while the list bar of that section is closed: the filter is applied AND the bar opens by itself. No scrolling.
- **K148** The filter chips, "Clear filters" and "{n} · €{x}" sit directly under the charts of their section, always visible (never inside a bar). "Clear filters" never closes a bar.
- **K149** "Select" opens "Expenses (N)" by itself. While selecting, the charts and the filter chips are hidden as today; the "Select expenses" card and the tick list are shown inside the open "Expenses (N)" bar, in place of "Sort by" and the list. "Totals per category (N)" stays where it is, open or closed as it was. Leaving Select: keep today's behaviour exactly (today leaving Select clears the sort, the chart filters and the By category/By store toggle).
- **K150** After "Add expense" saves, every bar stays as it was (a closed bar stays closed); the existing toast is enough.
- **K151** An opened bar stays open while the period, the period pill or a person pill changes, until the user leaves Money. Every time the Money page mounts (menu, reload, app update, back from Plan/Shop/Home), all bars start closed. Page state only (useState), no browser storage. A period or pill change must not remount the bars.
- **K152** Order of the Money page, top to bottom:
  1. period pills + "‹ … ›" bar + top card (unchanged)
  2. Income: title "Income", € chip, "Add income", "Received by" pills (K174), today's notices, the Add income card when open, the charts "By category" + "Trend", the filter chips row (K148), then the closed bar "Income (N)" holding "Sort by" + the income list.
  3. Orders: exactly as today ("History (N)" stays closed, "Where do I record a purchase?" stays closed).
  4. Expenses: title "Expenses", € chip, "Select", "Add expense", "Paid by" pills, "Set the store of several expenses…", the Add expense form when open, the charts ("By category" / "By store" + "Trend") FIRST, the filter chips row (K148), then the closed bar "Totals per category (N)" (inside: today's Totals card content), then the closed bar "Expenses (N)" (inside: "Sort by" + the expenses list, unchanged).

  The € chips next to the titles "Income" and "Expenses" stay ALWAYS visible and keep following their pills exactly as today. Real October 2026 data: Expenses chip Everyone €2575.40, Irene €952.15, Akbar €1623.25, Shared €268.58; Income chip Everyone €4920.17, Irene €2858.51, Akbar €2061.66.
- **K153 + K162** Weeks of a month = calendar rows Monday–Sunday, cut to the month. The Month pill's TREND has one bar per row, labelled "Week 1", "Week 2", …; every day of the month is in exactly one bar. This fixes the defect where the last days of some months were in no bar (Nov 2026: 30/11; Feb 2026: 23–28/02; Mar 2026: 30–31/03; Aug 2026: 31/08). Filter chip of a week bar: "Week {n} · {first}–{last} {Mon}", or "Week {n} · {day} {Mon}" for a one-day week (e.g. "Week 1 · 1 Nov", "Week 2 · 2–8 Nov", "Week 6 · 30 Nov"). Tapping a week bar filters exactly those days. Verified examples:
  - Oct 2026 (1 Oct = Thursday): 1–4, 5–11, 12–18, 19–25, 26–31 → 5 bars
  - Nov 2026 (1 Nov = Sunday): 1, 2–8, 9–15, 16–22, 23–29, 30 → 6 bars
  - Feb 2026 (1 Feb = Sunday): 1, 2–8, 9–15, 16–22, 23–28 → 5 bars
  - Mar 2026 (1 Mar = Sunday): 1, 2–8, 9–15, 16–22, 23–29, 30–31 → 6 bars
  - Aug 2026 (1 Aug = Saturday): 1–2, 3–9, 10–16, 17–23, 24–30, 31 → 6 bars
  - Feb 2027 (1 Feb = Monday): 1–7, 8–14, 15–21, 22–28 → 4 bars

  The Week pill (7 day bars), 3 Months, 6 Months and Year (month bars) don't change. The existing "Sort by" options ("By category", "By week", "Category & week", "✕ Clear sort") are NOT changed in this prompt (prompt 2 replaces them). Check every other user of the month buckets.
- **K154** Period filter: period chips OR dates (choosing one clears the other).
- **K155** Dates: "From" + "To"; an empty "To" = one day.
- **K156** List filters work only inside the period on screen; a date outside it → a short message. (Period chips: see K175.)
- **K157** (Version 1) Inside the open list bar: two buttons "Sort by category ▾" and "Sort by period ▾", then the list. "Sort by category": chips of the main categories with spending in the period, several at once. "Sort by period": the period chips (K175) or "From"/"To". AND between the two buttons, OR inside one. The list arrangement is automatic: nothing chosen → the plain list as today; only categories → one card per category with its subtotal; only period chips → one card per chosen chip period; only dates → the plain list; categories + period → one card per category. A total "{n} · €{x}". "Category & week", "By category", "By week" and "✕ Clear sort" are removed. Example (made-up October data): Week 1 + Week 2 AND Going out + Cigarettes & Vape → 5 expenses, €86.60; Going out €74.90, Cigarettes & Vape €11.70.
- **K157a** Several period chips at once show the expenses of all chosen periods (Week 1 only: 2 · €31.70; Week 2 only: 3 · €54.90; both: 5 · €86.60, with the two categories of K157's example).
- **K157b** A chart tap turns on the same chip (pie or legend → category chip; TREND bar → period chip).
- **K157c** A closed button shows how many are chosen: "Sort by category · 2".
- **K157d** The store filter (from "By store") stays a chip under the charts, not a third button.
- **K158** Income gets the same two buttons (no store filter).
- **K159** The pills stay "Week", "Month", "3 Months", "6 Months", "Year".
- **K160a** 3 Months / 6 Months: tapping the period text opens an inline row with "Month", "Year", "Ending in" / "Starting in" (default "Ending in") and "Show"; quick buttons "Q1"–"Q4" (3 Months) and "H1", "H2" (6 Months), always inside one calendar year. Opening the pill shows the span ending in the current month. Examples on 11/11/2026: 3 Months → Sep–Nov 2026; September 2026 + Ending in → Jul–Sep 2026; September 2026 + Starting in → Sep–Nov 2026; December 2025 + Starting in → Dec 2025 – Feb 2026; Q3 2026 → Jul–Sep 2026; 6 Months → Jun–Nov 2026; H2 2026 → Jul–Dec 2026.
- **K160b** "‹ ›" only on Week and Month; removed on 3 Months, 6 Months and Year.
- **K160c** Year pill: a "Year" select with the calendar years that have data (now 2026), plus span buttons "Last 12 months", "3 years", "5 years", "10 years", "All", each shown only when its result differs from every other choice (Nov 2026: 2026 only; Jan 2027: 2026, 2027, All; Nov 2027: + Last 12 months; Nov 2029: + 3 years). K160c-1: "Last 12 months" = the 12 whole months ending in the current month (Dec 2025 – Nov 2026). K160c-2: spans longer than 12 months → one TREND bar per year.
- **K160d** Months after the current month can't be picked. A running period (the current month, Q4 2026, H2 2026, Year 2026) is allowed and shows data up to today. TREND draws no bar for months after the current month. "Starting in" the current month is not offered for 3 / 6 Months.
- **K161** Tapping the period text opens the inline pickers (no popup) with "Show", and a small "This month" button to go back to the current period.
- **K163** Four build prompts, each followed by an iPhone test: (1) closed bars + order + Month TREND weeks + K174 + plan; (2) the two "Sort by" buttons (K154–K158, K175), Expenses and Income; (3) periods (K159–K161, K160a–d, K173); (4) leftover (K164–K172). No SQL in any of them.
- **K164** (B) The leftover is computed and only shown, never saved (no SQL). It is always right after late edits and the same on every device.
- **K165** (B) Carried on: the leftover = the household's money at the end of the previous month, counting every month since the first month with data (October 2026). Example: Oct leftover €500, salaries on 5 Nov €1500 + €1400, €1000 left on 30 Nov → "Leftover from November 2026 · +€1000.00" in December.
- **K166** (C) No leftover line when the leftover is ≤ 0 (the month's own minus still shows in "This month").
- **K167** (A) Top card: the line "Leftover from October 2026 · +€2344.77" (real October 2026) above the tiles; INCOME = only the income of the period; EXPENSES unchanged; BALANCE = leftover + income − expenses (the money really there); under BALANCE a grey "This month +€…" (the period's own result). Example November (made-up income €2900.00, expenses €2400.00): BALANCE +€2844.77, "This month +€500.00". The app doesn't track which money is spent first: leftover and income are one sum, and every expense reduces it.
- **K168** (B) Both pills "Everyone": the household line + a grey breakdown per person, e.g. "Irene +€1906.36 · Akbar +€438.41" (real October; labels from PAID_BY_OPTIONS). Both pills on the same person: that person's leftover. Any other combination (different persons, or a Shared pill): no line. K168a: in the grey breakdown each person's amount is shown as it is, minus included; the main line follows K166.
- **K169** (B) The leftover also shows in 3 Months, 6 Months, Year and the spans: the money at the end of the month before the span, always with its amount ("Leftover from October 2026 · +€2344.77"); BALANCE includes it; a grey "This range +€…" under it. Week: no leftover. A span starting in or before the first month with data: no leftover. Never add the leftover of each month inside a range (that counts the same money again).
- **K170** (A) No leftover line in the first month with data (October 2026).
- **K171** (A) Text "Leftover from {Month YYYY}".
- **K172** (C) The leftover is never in any chart (each chart equals its own tile). A thin bar in the top card: "Available €{leftover + income} · spent {p}%" (example: €5244.77, 46%).
- **K173** (A) TREND follows the period on top: Week → days, Month → weeks (K153), 3 Months / 6 Months / Year / Last 12 months → months, longer → years.
- **K174** Income "Received by" pills: the "Shared" pill is shown only when the period on screen (before the pill filter) has at least one income entry with received_by = 'shared'. If the "Shared" pill is selected (or remembered on the phone) and it is not shown, the pill becomes "Everyone" (the same way a tap on "Everyone" works, so the remembered value follows). The "Add income" form keeps "Shared" in "Received by". The Expenses / Orders "Paid by" pills don't change.
- **K175** (A) The "Sort by period" chips are always the TREND bars of the period: Week → days, Month → weeks, 3/6 Months and Year → months, longer spans → years; plus "From"/"To" (this extends K156).
- **K176** Later (not scheduled, after the AI round): a Telegram bot. Messages and receipt photos in English, Indonesian or Italian, with past dates understood ("yesterday"), go to a Supabase Edge Function, which calls the Claude API and records expenses and income in the same tables as the app. Only the household's two Telegram accounts. A confirmation or an Undo before or after saving. Rough cost estimate of 11/11/2026: about $2–6 a month. Also listed in the "Later (not scheduled)" list of 9K.
- **K177** (A) A chart tap that turns a filter off while the list bar is closed leaves the bar closed.
- **K178** (B) While selecting, closing "Expenses (N)" ends Select like the X ("Stop selecting").
- **K179** (B) The two K145 items are added to the "Later (not scheduled)" list.
- **K180** (A) "Totals per category (N)" counts the "Uncategorized" row.

### Prompt 1 as built (11/11; code and tests only, no SQL)

Built: K146–K153, K162, K174 (and the plan). No file in `supabase/`
changed; no new browser storage, no new offline queue. Orders, the top
card, the K4 note, colours, toasts and forms are unchanged.

**Files.** New: `components/ui/ClosedBar.jsx` (the bar: full-width button,
`aria-expanded`, icon + label on the left, an optional value on the right,
a chevron that turns, `min-h-10` = 40 px; exactly the classes of the old
"History (N)" button), `hooks/useMoneyExplorer.js` (the one filter state of
a section: chart filters, sort, buckets, pie, stores, what the list shows,
`count` "(6)" / "(3 of 6)", `clearFilters`, `reset`),
`lib/expensePeriods.test.js`, `components/moneyBars.render.test.jsx`.
Changed: `components/expenses/MoneyExplorer.jsx` (now `ExplorerCharts` =
the charts + the chips row, and `ExplorerList` = "Sort by" + the list; both
read the same `explorer`), `IncomeSection.jsx` (charts, chips, the bar
"Income (N)"; `personOptions` for K174), `pages/ExpensesPage.jsx` (the
order of K152, the two bars, Select, K174), `CategoryTotals.jsx` (only the
rows: its title and € total are on the bar; a `region` named "Totals per
category"), `OrdersSection.jsx` ("History (N)" through `ClosedBar`, same
markup), `PersonSelector.jsx` (optional `options`),
`lib/expensePeriods.js` (`monthWeeks`; the Month buckets come from it),
`lib/moneyList.js` (`formatMonthWeek`; `bucketChipLabel(period, bucket)`),
`components/sharedParts.render.test.jsx` (opens the bars).

**The bars and where they are** (icons from lucide-react, already in the
project):

| Bar | Icon | Right side | Inside when open | Empty |
|---|---|---|---|---|
| Money → section Income → under the charts and the chips row: "Income (N)" / "Income (n of N)" | `Wallet` | — | "Sort by" + the income list | "Income (0)" → "No income entries match this filter." |
| Money → section Orders → under the orders on the way: "History (N)" | `History` | — | as before | as before |
| Money → section Expenses → under the charts and the chips row: "Totals per category (N)" | `PieChart` | the € total of the pill, e.g. "€135.50" | today's rows (dot, name, €, share, bar) | "Totals per category (0)" → "No expenses in this period." |
| Money → section Expenses → under "Totals per category (N)": "Expenses (N)" / "Expenses (n of N)" | `Receipt` | — | "Sort by" + the list; while selecting, the "Select expenses" card + the tick list | "Expenses (0)" → "No expenses match this filter." |

N of "Totals per category" is the number of rows of the card (an
"Uncategorized" row counts as one). The bars are page state
(`useState(false)`): "Income (N)" in `IncomeSection`, the other two in
`ExpensesPage`, all closed at every mount and kept through a new period,
pill or saved expense. A chart tap that turns a filter **on** (legend /
slice, TREND bar, store row) opens its section's list bar; a tap that lets
a filter go opens nothing. "Select" calls `reset()` (no sort, no chart
filter) and opens "Expenses (N)"; "Stop selecting" calls `reset()` again;
the charts are not mounted while selecting, so "By category / By store"
starts again at "By category" — exactly as before.

**Month weeks.** `monthWeeks(year, month)` gives the calendar rows cut to
the month: `{ key: the Monday of the row, label: "Week n", first, last }`.
The key stays the row's Monday, so `bucketKeyForDate` and
`applyChartFilters` are unchanged (the list only holds the month's days).
Other users of the month buckets: only `useMoneyExplorer` (TREND and its
filter) and the chip text. "By week" / "Category & week" in "Sort by" keep
their full Monday–Sunday labels ("26 Oct – 1 Nov 2026"; prompt 2 replaces
them).

**K174.** `ExpensesPage` passes the "Received by" options without
"Shared" when the period (before the pill) has no Shared income; while the
income is still loading, a chosen "Shared" stays on offer. When it goes
while chosen, the page calls the pill's own setter with "Everyone" (which
saves `money.incomePerson` = all, as a tap does).

**Tests: 2477 → 2504 (133 → 135 files).** `lib/expensePeriods.test.js`
(10: the six months of K153, every day Jan 2025 – Dec 2027 in exactly one
Month bar, the Month keys, the other pills unchanged, the chip texts).
`components/moneyBars.render.test.jsx` (17: the October list of the
prompt — Everyone "Expenses (6)", "Totals per category (3)" €135.50; a
chart tap opens "Expenses (3 of 6)", "3 · €74.90", Totals and top card
€135.50; the store row; the four pills (€59.90 "Expenses (2 of 4)" €33.70,
€75.60, Shared €80.30 "Totals per category (2)"); an empty month; K4 note
and top card ignore filters; TREND October €80.60 / €54.90 / 0 / 0 / 0 and
"Week 2 · 5–11 Oct"; November six weeks, "Week 1 · 1 Nov", "Week 6 · 30
Nov"; Income (2) €2000.00 without "Shared", (3) €2050.00 with it; Shared →
a month without → "Everyone" remembered; remembered Shared; bars kept
through ‹ › / pills; closed after unmount; Select; Add expense).
`components/sharedParts.render.test.jsx`: the same checks, with the step
that opens the bars (and "before 029" now opens the list too, so its "no
Housing & Utilities" check still means something). Orders tests unchanged.

**Kata ragu (11/11 prompt 1, tanya Zidane).** Built the safe way until
answered.

1. A chart tap that **removes** a filter while the bar is closed (e.g.
   "Going out" tapped → bar opens; the bar closed by hand; "Going out"
   tapped again → filter off). Built: the bar stays closed (only a tap that
   applies a filter opens it). Options: (a) as built; (b) every chart tap
   opens it. Suggestion: (a).
2. Closing "Expenses (N)" while selecting. Built: the bar closes like any
   other; Select stays on (charts still hidden, "Select" still not shown),
   the ticks are lost, reopening the bar shows the tick list again.
   Options: (a) as built; (b) closing the bar also leaves Select; (c) the
   bar can't be closed while selecting. Suggestion: (b).
3. K145 says the CSV/Excel "names" column and the toast "(Corn Snack)" "are
   under Later", but no "Later" list holds them yet; not added (rule: change
   nothing else in the plan). Options: (a) leave; (b) add them to the 9K
   "Later (not scheduled)" list. Suggestion: (b).

(Answered 11/11: 1 → K177, 2 → K178, 3 → K179.)

iPhone test of MONEY display prompt 1 done 11/11/2026: all OK.

### Prompt 2 as built (11/11; code and tests only, no SQL)

Built: K154–K158, K157a–d, K175, K177 (kept), K178, K180 (kept), and the
plan (K177–K180, the two K145 items in the 9K "Later (not scheduled)"
list). No file in `supabase/` changed; no new browser storage, no new
offline queue. The top card, the K4 note, Orders, colours, the bars of
prompt 1 (texts, order, open/close rules), the TREND weeks and the Income
"Shared" pill (K174) are unchanged.

**Files.** Changed: `hooks/useMoneyExplorer.js` (the one filter state:
`categories` and `buckets` as lists, `from` / `to`, `store`; a chart tap
toggles one entry without clearing the others; a period chip clears the
dates and a typed date clears the chips; the chips of both panels; the
list layout; the counts of the two buttons; `reset` = clear every filter),
`components/expenses/MoneyExplorer.jsx` (`ExplorerCharts`: the chips row
with every filter; `ExplorerList`: the two buttons, their panels and the
cards), `components/expenses/MoneyCharts.jsx` (several categories / TREND
bars highlighted at once), `lib/moneyList.js` (new `applyFilters`,
`listArrangement`, `checkDates`, `formatDatesChip`, `categoryChipOrder`,
`groupByCategory`, `groupByBucket`; removed `applyChartFilters`,
`groupEntries`, `formatWeekRange` and the "By week" / "Category & week"
grouping), `pages/ExpensesPage.jsx` (K178), `IncomeSection.jsx` (comment
only), `lib/moneyList.test.js`, `components/moneyBars.render.test.jsx`.
New: `components/moneySortBy.render.test.jsx`.

**Removed.** The "Sort by" row with "By category", "By week", "Category &
week" (title "Tap again for the plain list") and "✕ Clear sort", in
Money → Income → "Income (N)" and Money → Expenses → "Expenses (N)".

**Texts and where they are** (Income: the same, without the store):

| Text | Where |
|---|---|
| "Sort by category" + an arrow icon (▾, turns while open); "Sort by category · 2" while 2 are on | Money → section Expenses → bar "Expenses (N)" open → first button (Income: bar "Income (N)") |
| "Sort by period" + the arrow; "Sort by period · 1" (the dates count as 1, only while applied) | next to it (they wrap at 375 px; 40 px high) |
| The category chips, each with its colour dot, A–Z, "Other" next to last, "Uncategorized" last (only with such rows); several on | → "Sort by category ▾" → its panel, under the buttons |
| The period chips = the TREND bars: Month "Week 1 · 1–4 Oct" … "Week 5 · 26–31 Oct"; Week "Mon 19 Oct" … "Sun 25 Oct"; 3 Months "Sep 2026", "Oct 2026", "Nov 2026"; 6 Months / Year: the months; also the bars at €0.00 | → "Sort by period ▾" → its panel, first row |
| "From", "To" (labels over the app's date fields, DD/MM/YYYY) | → "Sort by period ▾" → under the chips |
| `Choose a date in October 2026.` / `"From" is after "To".` (small, red) | → "Sort by period ▾" → under "From" / "To" |
| "No expenses in this period." / "No income entries in this period." | → "Sort by category ▾" in a period with nothing |
| Card titles: the category (dot + name) or the period chip text ("Week 2 · 5–11 Oct"), with the subtotal "€54.90" on the right | → the list, under the buttons |
| Filter chips: each period chip, the dates "03/10 – 06/10" / "03/10", each category, the store; each with "×" (aria "Remove filter …"); "Clear filters"; "{n} · €{x}" | Money → Expenses (or Income) → directly under the charts (unchanged place) |

**The list.** Nothing chosen → the plain list as before; only categories →
one card per category (ordered as the old "By category"); only period chips
→ one card per chosen chip that has rows, the newest period first; only
dates (or only the store) → the plain list; categories + a period → one
card per category. Inside a card the newest first; a purchase / order
group is one closed line with "of total €…" (as before).

**Dates.** Nothing applies without a "From"; an empty "To" = that one day;
a date outside the period (start included, end not) → the line `Choose a
date in {period text}.` (the text of the "‹ … ›" bar, e.g. "October 2026",
"Sep – Nov 2026"); a "From" after the "To" → `"From" is after "To".` (the
outside check comes first). A date that is not applied is kept in the
field but is no filter, no chip and no "· 1".

**Kept.** A new period ("‹" / "›"), period pill or person pill clears every
filter (also half-typed dates). "Select" and leaving it clear every filter
(K149). "Clear filters" clears all and leaves the bar as it is. A chart tap
that turns a filter on opens the bar (K147); one that turns it off doesn't
(K177).

**K178.** `ExpensesPage.toggleExpenses`: closing "Expenses (N)" while
selecting calls `stopSelecting` (the same as "Stop selecting") and closes
the bar; the charts come back, "Select" is shown again.

**Tests: 2504 → 2531 (135 → 136 files).** `lib/moneyList.test.js` (12 old
filter / grouping tests → 17: several categories and chips, AND / OR, dates,
the store, `checkDates` with both lines, the dates chip, the five layouts,
cards by category and by period, the chip order). New
`components/moneySortBy.render.test.jsx` (22: every example of the prompt:
2 · €31.70, 3 · €54.90, 5 · €86.60 "Expenses (5 of 6)" with the cards
€74.90 (#6 #4 #1) / €11.70 (#5 #3), Week 1 + Week 2 → 6 · €135.50 with the
week cards, the dates (2 · €24.20, 3 · €73.10, 1 · €48.90), chips OR
dates, both lines, pie / legend / TREND taps, "· 1" / "· 2", the chips row
and "Clear filters", K177, period / pill changes, 3 Months, Week, the three
pills 39.90 / 46.70 / 31.40, Income 2 · €2000.00 "Income (2 of 3)",
1 · €30.00, 0 "Income (0 of 3)", K178). Three prompt-1 tests in
`moneyBars.render.test.jsx` changed only where the old "Sort by" row was
used: the open bar now shows the two buttons; November taps Week 6 again to
let it go before Week 1 (a tap no longer replaces, K157b); the Select test
sets a filter with "Sort by period" instead of "By week".

**Kata ragu (11/11 prompt 2, tanya Zidane).** Built the safe way until
answered.

1. "To" typed with "From" empty (e.g. To 06/10). Built: nothing applied,
   no line. Options: (a) as built; (b) "To" alone = that one day; (c) a
   line "Type a "From" date.". Suggestion: (a).
2. A chosen period chip with nothing in it (e.g. Week 1 + Week 3 in
   October; Week 3 €0.00). Built: no card for Week 3, only "Week 1 · 1–4
   Oct". Options: (a) as built; (b) an empty card "Week 3 · 12–18 Oct
   €0.00". Suggestion: (a).
3. The count on an open button. Built: "Sort by category · 2" also while
   its panel is open. Options: (a) as built; (b) only while closed.
   Suggestion: (a).
4. A date that is not applied (outside the period, or "From" after "To")
   stays in the field, with the line, but is not counted ("Sort by period"
   without "· 1") and has no chip. Options: (a) as built; (b) count it.
   Suggestion: (a).

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
