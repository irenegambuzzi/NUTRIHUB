import { DEFAULT_UNIT } from '../data/constants'
import { decimalProblem, parseDecimal } from './decimal'
import { normName } from './grocery'
import { firstOutVariant, variantOrder } from './groups'
import { expiryState, isDurable } from './inventory'
import { isFinished } from './oneTime'
import { budgetCategoryFor } from './budgetMap'
import { durableLock, isPurposeBudget, lockNote } from './durable'
import { purchasedQuantity } from './purchase'
import { firstTimePatch, packField, packMissingText, packStartText, packTextFor } from './packSize'
import { couponFields, lineDiscountFields, priceLines, round2 as roundCents } from './discounts'
import { exactKey, matchHomeItems, sameItemName, shopEntryFor } from './similarItems'

// A purchase typed in MONEY ("Add expense"): the store, date and payer once
// for the whole receipt, then one row per item. Every row becomes one
// normal expense; several rows are one purchase, saved by
// confirm_shopping_trip with source 'money' (supabase/023), exactly like a
// SHOP purchase: one expense per line, stock per line, one Undo for all.
// Pure, so every rule can be tested.

const round2 = (n) => Math.round(n * 100) / 100

// A new, empty item row. `key` only tells rows apart on screen.
//   addToHome   null = follow the default (see addsToHome), else the choice
//   variantId   undefined = not chosen yet (the first variant at 0 is taken)
//   similarAnswer  the name (its exactKey) "Create new" was pressed for in
//               the similar-name question (plan 9G); another name asks again
//   priceEdited / autoFilled   the price, quantity and unit were typed by hand
//               / filled in from the last purchase of that name
//   packSizeText / packUnit   the pack field as typed, and the unit it was
//               typed for (another unit starts the field again, plan 9H)
export function emptyRow(key) {
  return {
    key,
    name: '',
    priceText: '',
    quantityText: '1',
    unit: DEFAULT_UNIT,
    unitTouched: false,
    priceEdited: false,
    autoFilled: false,
    categoryId: '',
    subcategoryId: '',
    categoryTouched: false,
    suggested: false,
    budgetId: '',
    budgetTouched: false,
    autoBudgetId: '',
    addToHome: null,
    oneTime: false,
    minText: '0',
    variantId: undefined,
    packSizeText: '',
    packUnit: null,
    discountKind: 'percent',
    discountText: '',
    similarAnswer: '',
  }
}

// The HOME item a typed name stands for: a normal item with that name (a
// finished 1× item too: buying it again brings it back), else a group with
// that name (its stock then goes to one of its variants, never the group).
// The same name ignoring capitals and spaces first, then apart from
// accents, punctuation and a plural too ("cucumbers" is "Cucumber", plan 9G).
export function homeItemFor(name, pantryItems) {
  const key = normName(name)
  if (!key) return null
  const by = (same) => pantryItems.find((p) => !p.is_group && same(p.name)) ?? pantryItems.find((p) => p.is_group && same(p.name))
  return by((n) => normName(n) === key) ?? by((n) => sameItemName(n, name)) ?? null
}

// The similar-name question of a row (plan 9G): { similar, more } — the
// HOME items like its name ({ item, kind }, up to 3) and how many more
// matched — or null when there is nothing to ask: the row isn't added to
// HOME (off or locked), its name is a HOME item, or "Create new" was
// pressed for this very name.
export function similarAsk(line, pantryItems) {
  const { row } = line
  if (!line.home || line.known || !row.name.trim() || row.similarAnswer === exactKey(row.name)) return null
  const { exact, similar, more } = matchHomeItems(row.name, pantryItems)
  return exact || !similar.length ? null : { similar, more }
}

// An open SHOP card (to buy, in the cart or ordered online) WITHOUT a HOME
// item whose name is only similar to the row's ("Pumpkin" for "Pumkin"),
// for a row added to HOME and not locked: the row says so, and the card is
// never closed or changed from here (only an exact name can close one, see
// listEntryFor). null when there is none.
export function similarListEntry(line, groceryItems, orderedIds = new Set()) {
  if (!line.home || !line.row.name.trim()) return null
  const unlinked = groceryItems.filter((g) => !g.pantry_item_id)
  return shopEntryFor({ name: line.row.name }, unlinked, { orderedIds, kinds: ['typo', 'words'] })?.entry ?? null
}

export const SIMILAR_PROBLEM = 'Choose “Use …” or “Create new” for this item.'

// "Add to HOME" as chosen: on by default when the row has a HOME item
// category, off otherwise; the user can switch it (unless it is locked).
const wantsHome = (row) => row.addToHome ?? Boolean(row.categoryId)

// Why a row can't go into HOME (lib/durable.js), or null: its HOME
// category is a durable one, or its budget category is a durable or a
// service one. Changing either to a consumable one releases it. `ctx`: { expenseCategories,
// inventoryCategories, mapRows }; without it only the HOME category counts.
export const lockOf = (row, ctx) => durableLock({ categoryId: row.categoryId, subcategoryId: row.subcategoryId, budgetId: budgetOf(row, ctx) }, ctx)

// A locked row is always an expense only: "Add to HOME" off and disabled.
export const homeLocked = (row, ctx) => Boolean(lockOf(row, ctx))

export const addsToHome = (row, ctx) => !homeLocked(row, ctx) && wantsHome(row)

// The budget category a row starts with: the one its HOME category is
// mapped to (lib/budgetMap.js), or none without a HOME category (the user
// picks one). `ctx`: { expenseCategories, inventoryCategories, mapRows }.
export function defaultBudget(row, ctx) {
  if (!row.categoryId) return ''
  try {
    return budgetCategoryFor({ category_id: row.categoryId, subcategory_id: row.subcategoryId || null }, ctx) ?? ''
  } catch {
    return ''
  }
}

// The budget category shown for a row: the one picked by hand; else the
// one its name filled in (the first budget chip, `autoBudgetId`) when
// there is no HOME mapping to follow (no HOME category, decision 14a:
// "Marlboro" stays Cigarettes & Vape with Add to HOME on), when the row
// isn't added to HOME (its HOME category is durable, or Add to HOME is
// off) or when that is a purpose category (family, work, a gift: "Work
// Printer Ink" is Work even with Add to HOME on); else the mapped one.
// The lock is worked out from the result (lockOf), never the other way
// round.
export const usesAutoBudget = (row, ctx) =>
  Boolean(row.autoBudgetId) && (isPurposeBudget(row.autoBudgetId, ctx?.expenseCategories) || !row.categoryId || isDurable({ category_id: row.categoryId }) || !wantsHome(row))

export const budgetOf = (row, ctx) => {
  if (row.budgetTouched) return row.budgetId
  if (usesAutoBudget(row, ctx)) return row.autoBudgetId
  return defaultBudget(row, ctx)
}

// What a row does, worked out from what was typed:
//   total       the price as on the receipt, BEFORE any discount (the normal
//               price: it becomes the HOME item's last price); what is paid
//               comes from pricedLines()
//   home        it goes into HOME ("Add to HOME" on)
//   lock        why it can't (lockOf), or null
//   known       the HOME item with that name (also with Add to HOME off,
//               to say what happens to its SHOP entry)
//   group       that item is a group: `variants` to pick from, `target`
//               the chosen one (the first at 0 until the user picks)
//   target      the HOME item whose stock goes up (null = a new item)
//   pack        the pack field (lib/packSize.js), or null: how many of the
//               target's stock units are in 1 package for this purchase
//   add         how much stock, in the target's unit (null = the pack
//               size is still missing)
//   isNew       a new HOME item is made (with 1× and Min)
//   revives     a finished 1× item comes back
export function rowLine(row, pantryItems, ctx) {
  const quantity = parseDecimal(row.quantityText)
  const total = parseDecimal(row.priceText)
  const lock = lockOf(row, ctx)
  const home = !lock && wantsHome(row)
  const known = homeItemFor(row.name, pantryItems)
  const match = home ? known : null
  const group = match?.is_group ? match : null
  const variants = group ? variantOrder(group.variants ?? pantryItems.filter((p) => p.group_id === group.id)) : []
  const variantId = group ? (row.variantId === undefined ? (firstOutVariant(variants) ?? variants[0])?.id ?? null : row.variantId) : null
  const target = group ? variants.find((v) => v.id === variantId) ?? null : match
  const count = quantity > 0 ? quantity : 1
  const pack = home && target ? packField({ item: target, unit: row.unit, quantity: count, text: packTextFor({ text: row.packSizeText, unit: row.packUnit }, row.unit, packStartText(target, row.unit)) }) : null
  const add = !home ? 0 : target ? purchasedQuantity(target, { quantity: count, unit: row.unit }, pack?.value) : count
  const minStock = parseDecimal(row.minText)
  return {
    row,
    quantity: quantity > 0 ? round2(quantity) : 1,
    total: Number.isFinite(total) ? round2(total) : NaN,
    discount: { kind: row.discountKind, text: row.discountText },
    home,
    lock,
    known,
    group,
    variants,
    target,
    add,
    pack,
    isNew: home && !match,
    revives: Boolean(target) && isFinished(target),
    // MONEY doesn't ask what to do with expired stock (SHOP's Confirm
    // does): the stock is added and the row says to check it in HOME.
    expired: Boolean(target) && expiryState(target) === 'expired',
    minStock: row.oneTime ? 0 : Number.isFinite(minStock) && minStock > 0 ? minStock : 0,
    needsVariant: Boolean(group) && !target,
    needsPackSize: Boolean(target) && add === null,
  }
}

// The lines with what is really paid. Each line's own discount comes
// first; the purchase discount (`coupon`, { kind, text } or null) is then
// spread over the lines by what they cost after those (lib/discounts.js).
// → { lines, priced }: every line gets `priced` (its list price, discount,
// coupon share and paid amount) and `paid`; `priced` as a whole has the
// totals and the first problem. The coupon only exists for two lines or
// more — for one line it would be the same as the line's own discount.
export function pricedLines(lines, coupon = null) {
  const priced = priceLines(
    lines.map((l) => ({ list: l.total, discount: l.discount })),
    lines.length > 1 ? coupon : null
  )
  return { lines: lines.map((line, i) => ({ ...line, priced: priced.lines[i], paid: priced.lines[i].paid })), priced }
}

// The SHOP list entry for what a row buys, and where it is:
//   'to-buy'   still to buy: it leaves the list when the stock really goes
//              into HOME (the database checks it again)
//   'in-cart'  in a cart in SHOP: never closed from here
//   'ordered'  ordered online and on the way: never closed from here
// The entries of the HOME item (`target`), or for a new item the open ones
// typed with the same name and no HOME item (capitals, accents and a plural
// ignored; never only a similar name: this entry may be closed). null = not
// on the list.
export function listEntryFor(name, target, groceryItems, orderedIds = new Set()) {
  const key = normName(name)
  if (!key && !target) return null
  const open = groceryItems.filter((g) => !g.completed && ((target && g.pantry_item_id === target.id) || (!g.pantry_item_id && key && sameItemName(g.name, name))))
  const linked = (g) => (g.pantry_item_id ? 0 : 1)
  open.sort((a, b) => linked(a) - linked(b))
  const toBuy = open.find((g) => !g.in_cart && !orderedIds.has(g.id))
  if (toBuy) return { entry: toBuy, state: 'to-buy' }
  const ordered = open.find((g) => orderedIds.has(g.id))
  if (ordered) return { entry: ordered, state: 'ordered' }
  const inCart = open.find((g) => g.in_cart)
  return inCart ? { entry: inCart, state: 'in-cart' } : null
}

// The entry a row's line sends as `list_entry_id`: only one still "to buy",
// and only when the line really adds stock.
export const closesEntry = (line, listEntry) => Boolean(line.home && line.add > 0 && listEntry?.state === 'to-buy')

// What the row says about its SHOP entry ('' when nothing to say).
export function listEntryNote(line, listEntry) {
  if (!listEntry) return ''
  if (listEntry.state === 'in-cart') return "It's in the cart in SHOP — it stays there."
  if (listEntry.state === 'ordered') return "It's ordered online (on the way) — it stays on the SHOP list."
  if (closesEntry(line, listEntry)) return 'On your SHOP list — it will leave the list.'
  return line.home ? '' : 'On your SHOP list — it stays there (Add to HOME is off).'
}

// Why a row can't be saved yet ('' when it can). `plain`: the form is a
// single expense only (no name needed, as in the old Add expense).
export function rowProblem(line, { plain = false } = {}) {
  const { row } = line
  if (!plain && !row.name.trim()) return 'Type what you bought.'
  if (decimalProblem(row.priceText) || decimalProblem(row.quantityText) || decimalProblem(row.minText) || decimalProblem(line.pack?.text)) return 'Fix the numbers in red.'
  if (!row.priceText.trim()) return line.home ? 'Enter the price (0 if it was free).' : 'Enter the price.'
  if (!(line.total > 0) && !(line.home && line.total === 0)) return 'Enter a price above 0.'
  if (line.priced?.problem) return line.priced.problem
  const paid = line.paid ?? line.total
  if (!(paid > 0) && !(line.home && paid === 0)) return 'Nothing is paid after the discounts — lower the discount, or turn Add to HOME on.'
  if (!(parseDecimal(row.quantityText) > 0)) return 'Enter a quantity above 0.'
  if (line.needsVariant) return `Choose which variant of "${line.group.name}" gets the stock.`
  if (line.needsPackSize) return packMissingText(line.pack)
  if (line.isNew && !row.categoryId) return 'Pick a HOME item category, or turn Add to HOME off.'
  return ''
}

// A form with one row that is only an expense is saved as one plain
// expense, exactly like the old "Add expense" (it can be edited with the
// old form and merged later). Everything else is a purchase. The exception
// is a single expense WITH a discount: a plain expense has nowhere to keep
// "€80 → €56 (−30%)", so it is saved as a one-line purchase (expense only,
// nothing goes to HOME) whose line keeps the history.
export const savesAsPlainExpense = (lines) => lines.length === 1 && !lines[0].home && !lines[0].priced?.discount

// What the whole receipt came to: what was really paid.
export const purchaseTotal = (lines) => roundCents(lines.reduce((sum, l) => sum + paidOf(l), 0))

const paidOf = (line) => {
  const paid = line.paid ?? line.total
  return Number.isFinite(paid) ? paid : 0
}

// The payload for confirm_shopping_trip (source 'money'). `budgetFor(line)`
// → the expense category id; `entryOf(line)` → its listEntryFor result.
// Add to HOME off → `durable: true` (an expense only, like an appliance in
// SHOP). On → the HOME item (or chosen variant) and the stock in its own
// unit; a new item gets its category, 1× and minimum. The typed price is
// the normal price for the quantity bought (the HOME item's last price,
// `list_total` of the line); `line_total` is what was paid (the expense):
// the price less the line's own discount and its part of the coupon.
// `priced`: the result of pricedLines() — the purchase's coupon.
export function moneyPurchasePayload({ id, date, at, shopId = null, paidBy, lines, budgetFor, entryOf = () => null, priced = null }) {
  return {
    ...(priced ? couponFields(priced) : {}),
    id,
    trip_date: date,
    at,
    source: 'money',
    shop_id: shopId || null,
    paid_by: paidBy,
    photo_ids: [],
    items: lines.map((line) => {
      const { row } = line
      const total = Number.isFinite(line.total) ? line.total : 0
      const item = {
        ...(line.priced ? lineDiscountFields(line.priced) : {}),
        name: row.name.trim(),
        category_id: row.categoryId || null,
        subcategory_id: row.subcategoryId || null,
        quantity: line.quantity,
        unit: row.unit,
        price: total,
        price_qty: line.quantity,
        price_unit: row.unit,
        line_total: paidOf(line),
        payer: paidBy,
        expense_category_id: budgetFor(line) || null,
        durable: !line.home,
      }
      if (!line.home) return item
      item.pantry_item_id = line.target?.id ?? null
      item.add = line.add ?? 0
      if (line.isNew) {
        item.one_time = Boolean(row.oneTime)
        item.min_stock = line.minStock
      }
      // The item's usual size only the first time (it has none yet).
      if (line.target) Object.assign(item, firstTimePatch(line.pack))
      const listEntry = entryOf(line)
      if (closesEntry(line, listEntry)) item.list_entry_id = listEntry.entry.id
      return item
    }),
  }
}

// What the row says it will do in HOME.
export function homeNote(line) {
  if (!line.home) return line.lock ? lockNote(line.lock) : 'Expense only — nothing changes in HOME.'
  if (line.group && !line.target) return `"${line.group.name}" is a group — choose the variant that gets the stock.`
  if (line.target) {
    const amount = line.add === null ? '' : ` (+${line.add} ${line.target.unit})`
    const note = line.revives ? `"${line.target.name}" comes back from Finished one-time items${amount}.` : `Adds to "${line.target.name}" in HOME${amount}.`
    return line.expired ? `${note} Its stock in HOME has expired — check it there after saving.` : note
  }
  return 'New in HOME (shown as New Item).'
}
