import { PACKAGING_UNITS, UNIT_VALUES } from '../data/constants'
import { normalizeUnit } from './units'
import { packField, packMissingText } from './packSize'
import { moneyText } from './decimal'

// Units for a NEW HOME item made by a purchase (plan 9L). Bought as "1
// pack" of soft drinks, the item may be counted at home in pcs, with 4 pcs
// in 1 pack as its usual size. Asked only where a purchase creates the item
// (SHOP "Confirm purchase", MONEY "+ Add expense" with Add to HOME on), only
// when the purchase unit is a package, and only once supabase/030 has run
// (the database then makes the item in the chosen unit). Pure, so every
// rule can be tested.

// A package: what a purchase comes in, never a count of its own
// (PACKAGING_UNITS: pack, box, case, carton, crate, bag).
export const isPackageUnit = (unit) => PACKAGING_UNITS.includes(normalizeUnit(unit))

// The count units a package can be counted in at home, in this order:
// pcs first, then the others the app's unit list has. Never a measure
// (gr, kg, ml, L), never another package.
export const COUNT_STOCK_UNITS = ['pcs', 'btl', 'can', 'roll', 'jar', 'tube', 'sachet', 'tablet', 'capsule'].filter((u) => UNIT_VALUES.includes(u))

// What "Count it at home in" offers for a purchase unit: the unit itself
// (today's result: counted in packs), then the count units.
export const stockUnitChoices = (unit) => [normalizeUnit(unit), ...COUNT_STOCK_UNITS]

// The column of supabase/030 that tells the app it has run
// (shopping_trip_items.stock_unit), and a read or write that failed
// because it isn't there (PostgREST PGRST204 / Postgres 42703 naming it).
export const STOCK_UNIT_COLUMN = 'stock_unit'
export const missingStockUnitColumn = (error) => ['PGRST204', '42703'].includes(error?.code) && String(error?.message ?? '').includes(STOCK_UNIT_COLUMN)

export const STOCK_UNIT_LABEL = 'Count it at home in'
export const STOCK_UNIT_MISSING = 'Choose how to count it at home.'

// The question of one line, or null when the line has none.
//   unit       the purchase unit of the line; quantity: how many of it
//   answer     what was chosen: { unit (the purchase unit it was chosen
//              for), stockUnit, text (the pack field as typed) } — another
//              purchase unit starts the question again
//   ready      supabase/030 is known to have run (true); false or null hide it
// → { unit, choices, stockUnit (null = not chosen yet), pack (the pack
//     field "pcs per pack" when another unit is chosen, lib/packSize.js),
//     problem ('' when the line can be saved), blocking }
// There is no default: saving waits until a unit is chosen (and, for
// another unit than the purchase unit, its pack size typed).
export function stockUnitQuestion({ unit, quantity = 1, answer = null, ready }) {
  if (ready !== true || !isPackageUnit(unit)) return null
  const u = normalizeUnit(unit)
  const choices = stockUnitChoices(u)
  const picked = answer && answer.unit === u ? answer.stockUnit : null
  const stockUnit = choices.includes(picked) ? picked : null
  const pack = stockUnit && stockUnit !== u ? packField({ item: { unit: stockUnit }, unit: u, quantity, text: answer.text ?? '' }) : null
  const problem = !stockUnit ? STOCK_UNIT_MISSING : pack?.blocking ? packMissingText(pack) : ''
  return { unit: u, choices, stockUnit, pack, problem, blocking: Boolean(problem) }
}

// Whether a line making a new item in this unit gets the question once 030
// is known: used to check first when that isn't known yet.
export const asksStockUnit = (unit) => isPackageUnit(unit)

// What a line sends to confirm_shopping_trip for its new item ({} for
// none): only another unit than the purchase unit, with its pack size. The
// stock (`add`) stays in the purchase unit, so a database without 030
// (which ignores these keys) makes exactly today's item, never a wrong
// stock.
export function newItemKeys(question) {
  if (!question || question.blocking || !question.pack?.value) return {}
  return { new_stock_unit: question.stockUnit, new_pack_size: question.pack.value }
}

// The stock unit the new item will have: the chosen one, else the line's.
export const newStockUnit = (question, unit) => question?.stockUnit ?? unit

// The same new name twice in one purchase: the first line makes the item,
// the next ones add to it (confirm_shopping_trip finds it by name). A later
// line adds the right stock only when the item is counted in its own unit,
// or in the unit it chose with its pack size; otherwise the database
// refuses the purchase. So, as soon as one of those lines has the question,
// the later ones must match the first: their problem says so ('' when
// fine). `lines`: [{ name, unit, question }] of the NEW lines, in the order
// they are saved.
export function sameNameProblems(lines) {
  const first = new Map()
  return lines.map(({ name, unit, question }) => {
    const key = normalizeName(name)
    if (!key) return ''
    const earlier = first.get(key)
    if (!earlier) {
      first.set(key, { stockUnit: newStockUnit(question, unit), asked: Boolean(question) })
      return ''
    }
    if (!earlier.asked && !question) return ''
    const counted = earlier.stockUnit
    if (!counted || counted === normalizeUnit(unit) || question?.stockUnit === counted) return ''
    return `"${name.trim()}" is in this purchase twice — count it in ${counted} at home here too.`
  })
}
const normalizeName = (name) => (name || '').trim().toLowerCase()

// What the HOME editor starts with when "It arrived!" → "Create a new item"
// makes an item from an order (K5): the stock unit is the order's unit, and
// "Current stock" its quantity; an order in a package (e.g. "1 pack")
// starts with "Bought in a different unit" on, the order's unit as the
// purchase unit, the pack size empty (it must be typed) and the stock
// counted in packs. The price is the order's normal price for what was
// ordered. `units`: the stock units the HOME editor offers.
export function arrivalPrefill(order, units = UNIT_VALUES) {
  const unit = normalizeUnit(order.unit || 'pcs')
  const quantity = Number(order.quantity) > 0 ? Number(order.quantity) : 1
  const normal = Number(order.list_price ?? order.price)
  const price = normal > 0 ? { price: moneyText(normal), price_qty: String(quantity), price_unit: unit } : {}
  if (isPackageUnit(unit)) {
    return { name: order.item_name, unit: 'pcs', multipack: true, packaging_unit: unit, quantity_per_pack: '', current_stock: String(quantity), stockInPacks: true, ...price }
  }
  const known = units.includes(unit)
  return { name: order.item_name, unit: known ? unit : 'pcs', current_stock: String(quantity), ...(known ? price : {}) }
}
