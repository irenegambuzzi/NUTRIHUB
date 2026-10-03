import { expiryState, isDurable, toBaseQuantity } from './inventory'
import { normName } from './grocery'

// Confirming a purchase: for each item in the cart, the pantry item it
// restocks, how much stock that adds, and the questions still open (pack
// size, expired stock); then the payload for confirm_shopping_trip
// (supabase/014), which does everything at once.

const MEASURE_UNITS = ['gr', 'kg', 'ml', 'L']

// The pantry item a grocery entry restocks: its linked item, else the one
// with the same name.
export function pantryItemFor(item, pantryItems) {
  return pantryItems.find((p) => p.id === item.pantry_item_id) ?? pantryItems.find((p) => normName(p.name) === normName(item.name)) ?? null
}

// The entry's quantity in the pantry item's base unit, or null when the
// units can't be converted and no pack size was given (e.g. 2 pack of an
// item counted in gr).
export function purchasedQuantity(pantry, item, packSize) {
  const quantity = Number(item.quantity) || 1
  const base = toBaseQuantity(pantry, quantity, item.unit) ?? (packSize > 0 ? quantity * packSize : null)
  return base === null ? null : Math.round(base * 100) / 100
}

// A pack size given now is kept on the pantry item, unless the item
// already has a different multipack or the unit is a measure (kg…).
export function packSizePatch(pantry, unit, packSize) {
  if (!(packSize > 0) || MEASURE_UNITS.includes(unit)) return {}
  if (pantry.packaging_unit && pantry.packaging_unit !== unit) return {}
  return { packaging_unit: unit, quantity_per_pack: packSize }
}

// One cart item, as the confirm screen shows it. answer: { packSize,
// discard (true = throw the expired stock away, false = keep it),
// expiryDate } from the user.
//   needsPackSize   – the list unit can't be converted to the pantry's
//   expired         – the pantry item has expired (with stock: must choose
//                     to throw it away or keep it; the new date is optional)
//   ready           – every question that must be answered is
export function purchaseLine(item, pantryItems, answer = {}) {
  const durable = isDurable(item)
  const pantry = durable ? null : pantryItemFor(item, pantryItems)
  const add = pantry ? purchasedQuantity(pantry, item, answer.packSize) : durable ? 0 : Number(item.quantity) || 1
  const needsPackSize = Boolean(pantry) && add === null
  const expired = Boolean(pantry) && expiryState(pantry) === 'expired'
  const expiredStock = expired ? Number(pantry.current_stock) || 0 : 0
  const needsExpiryChoice = expiredStock > 0 && typeof answer.discard !== 'boolean'
  return { item, pantry, durable, add, needsPackSize, expired, expiredStock, needsExpiryChoice, ready: !needsPackSize && !needsExpiryChoice }
}

// The payload for confirm_shopping_trip. totalOf(item) is the line total
// (null when it can't be worked out: no expense then); expenseCategoryFor
// (item) the expense category id.
export function confirmationPayload({ id, date, at, lines, answers, totalOf, expenseCategoryFor, photoIds = [] }) {
  return {
    id,
    trip_date: date,
    at,
    photo_ids: photoIds,
    items: lines.map(({ item, pantry, durable, add, expired }) => {
      const answer = answers[item.id] ?? {}
      const row = {
        grocery_item_id: item.id,
        line_total: totalOf(item) ?? 0,
        payer: item.payer || 'shared',
        expense_category_id: expenseCategoryFor(item),
        durable,
        pantry_item_id: pantry?.id ?? null,
        add: add ?? 0,
      }
      if (expired) {
        row.discard_expired = answer.discard === true
        // A fresh purchase replaces the expired date (or clears it).
        row.expiry_date = answer.expiryDate || null
      }
      if (pantry) Object.assign(row, packSizePatch(pantry, item.unit, answer.packSize))
      return row
    }),
  }
}
