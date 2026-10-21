import { DEFAULT_UNIT } from '../data/constants'
import { decimalProblem, parseDecimal } from './decimal'
import { normName } from './grocery'
import { firstOutVariant, variantOrder } from './groups'
import { expiryState, isDurable } from './inventory'
import { isFinished } from './oneTime'
import { budgetCategoryFor } from './budgetMap'
import { packSizePatch, purchasedQuantity } from './purchase'
import { couponFields, lineDiscountFields, priceLines, round2 as roundCents } from './discounts'

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
//   priceEdited / autoFilled   the price, quantity and unit were typed by hand
//               / filled in from the last purchase of that name
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
    addToHome: null,
    oneTime: false,
    minText: '0',
    variantId: undefined,
    packSizeText: '',
    discountKind: 'percent',
    discountText: '',
  }
}

// The HOME item a typed name stands for: a normal item with that name (a
// finished 1× item too: buying it again brings it back), else a group with
// that name (its stock then goes to one of its variants, never the group).
export function homeItemFor(name, pantryItems) {
  const key = normName(name)
  if (!key) return null
  return pantryItems.find((p) => !p.is_group && normName(p.name) === key) ?? pantryItems.find((p) => p.is_group && normName(p.name) === key) ?? null
}

// Home & Appliances never goes into HOME (no stock): its rows are always
// an expense only.
export const homeLocked = (row) => isDurable({ category_id: row.categoryId })

// "Add to HOME": on by default when the row has a HOME item category that
// isn't Home & Appliances, off otherwise; the user can switch it.
export const addsToHome = (row) => !homeLocked(row) && (row.addToHome ?? Boolean(row.categoryId))

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

// The budget category shown for a row: the one picked by hand, else the
// mapped one.
export const budgetOf = (row, ctx) => (row.budgetTouched ? row.budgetId : defaultBudget(row, ctx))

// What a row does, worked out from what was typed:
//   total       the price as on the receipt, BEFORE any discount (the normal
//               price: it becomes the HOME item's last price); what is paid
//               comes from pricedLines()
//   home        it goes into HOME ("Add to HOME" on)
//   known       the HOME item with that name (also with Add to HOME off,
//               to say what happens to its SHOP entry)
//   group       that item is a group: `variants` to pick from, `target`
//               the chosen one (the first at 0 until the user picks)
//   target      the HOME item whose stock goes up (null = a new item)
//   add         how much stock, in the target's unit (null = the units
//               don't convert and the pack size is still missing)
//   isNew       a new HOME item is made (with 1× and Min)
//   revives     a finished 1× item comes back
export function rowLine(row, pantryItems) {
  const quantity = parseDecimal(row.quantityText)
  const total = parseDecimal(row.priceText)
  const home = addsToHome(row)
  const known = homeItemFor(row.name, pantryItems)
  const match = home ? known : null
  const group = match?.is_group ? match : null
  const variants = group ? variantOrder(group.variants ?? pantryItems.filter((p) => p.group_id === group.id)) : []
  const variantId = group ? (row.variantId === undefined ? (firstOutVariant(variants) ?? variants[0])?.id ?? null : row.variantId) : null
  const target = group ? variants.find((v) => v.id === variantId) ?? null : match
  const packSize = parseDecimal(row.packSizeText)
  const add = !home ? 0 : target ? purchasedQuantity(target, { quantity: quantity > 0 ? quantity : 1, unit: row.unit }, packSize) : quantity > 0 ? quantity : 1
  const minStock = parseDecimal(row.minText)
  return {
    row,
    quantity: quantity > 0 ? round2(quantity) : 1,
    total: Number.isFinite(total) ? round2(total) : NaN,
    discount: { kind: row.discountKind, text: row.discountText },
    home,
    known,
    group,
    variants,
    target,
    add,
    packSize,
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
// typed with the same name and no HOME item. null = not on the list.
export function listEntryFor(name, target, groceryItems, orderedIds = new Set()) {
  const key = normName(name)
  if (!key && !target) return null
  const open = groceryItems.filter((g) => !g.completed && ((target && g.pantry_item_id === target.id) || (!g.pantry_item_id && key && normName(g.name) === key)))
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
  if (decimalProblem(row.priceText) || decimalProblem(row.quantityText) || decimalProblem(row.minText) || decimalProblem(row.packSizeText)) return 'Fix the numbers in red.'
  if (!row.priceText.trim()) return line.home ? 'Enter the price (0 if it was free).' : 'Enter the price.'
  if (!(line.total > 0) && !(line.home && line.total === 0)) return 'Enter a price above 0.'
  if (line.priced?.problem) return line.priced.problem
  const paid = line.paid ?? line.total
  if (!(paid > 0) && !(line.home && paid === 0)) return 'Nothing is paid after the discounts — lower the discount, or turn Add to HOME on.'
  if (!(parseDecimal(row.quantityText) > 0)) return 'Enter a quantity above 0.'
  if (line.needsVariant) return `Choose which variant of "${line.group.name}" gets the stock.`
  if (line.needsPackSize) return `Say how many ${line.target.unit} are in 1 ${row.unit}.`
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
      if (line.target) Object.assign(item, packSizePatch(line.target, row.unit, line.packSize))
      const listEntry = entryOf(line)
      if (closesEntry(line, listEntry)) item.list_entry_id = listEntry.entry.id
      return item
    }),
  }
}

// What the row says it will do in HOME.
export function homeNote(line) {
  if (!line.home) return homeLocked(line.row) ? 'Home & Appliances never go into HOME — expense only.' : 'Expense only — nothing changes in HOME.'
  if (line.group && !line.target) return `"${line.group.name}" is a group — choose the variant that gets the stock.`
  if (line.target) {
    const amount = line.add === null ? '' : ` (+${line.add} ${line.target.unit})`
    const note = line.revives ? `"${line.target.name}" comes back from Finished one-time items${amount}.` : `Adds to "${line.target.name}" in HOME${amount}.`
    return line.expired ? `${note} Its stock in HOME has expired — check it there after saving.` : note
  }
  return 'New in HOME (shown as New Item).'
}
