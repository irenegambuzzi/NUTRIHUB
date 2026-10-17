import { decimalProblem, moneyText, parseDecimal } from './decimal'
import { lineTotal, unitPriceFromTotal } from './pricing'

// The price of an order, typed as a unit price, a total price, or both,
// like on the SHOP list: typing one works out the other from the quantity.
// The total is what the order costs: it is the amount of its expense.
//
// state: { unit, total, unitSrc, totalSrc } — the texts as typed, and where
// each came from: 'typed' (by hand), 'auto' (worked out from the other),
// 'saved' (the total of an existing order), '' (empty).
//   - Typing one price works out the other, unless that other was typed
//     too: then the two must agree (see priceMismatch).
//   - A new quantity works out the total from the unit price. A total that
//     was typed, or saved with an existing order, is the amount paid: it
//     stays, and the unit price follows.

export const emptyPrice = { unit: '', total: '', unitSrc: '', totalSrc: '' }

// An existing order: its price is the total.
export const savedPrice = (total, quantity, unit) => withUnitFromTotal({ ...emptyPrice, total: moneyText(total), totalSrc: 'saved' }, quantity, unit)

// A new order started from the SHOP list: its total, the unit price worked
// out, both still free to change with the quantity.
export const prefilledPrice = (total, quantity, unit) => withUnitFromTotal({ ...emptyPrice, total: moneyText(total), totalSrc: 'auto' }, quantity, unit)

const quantityOf = (text) => {
  const n = parseDecimal(text)
  return n > 0 ? n : null
}
// One order unit is the price's basis, so no conversion is needed.
const row = (price, quantity, unit) => ({ price, price_qty: 1, price_unit: unit, quantity, unit })
const totalFromUnit = (unitText, quantity, unit) => {
  const price = parseDecimal(unitText)
  const qty = quantityOf(quantity)
  return price >= 0 && qty ? lineTotal(row(price, qty, unit), null) : null
}
const unitFromTotal = (totalText, quantity, unit) => {
  const total = parseDecimal(totalText)
  const qty = quantityOf(quantity)
  return total >= 0 && qty ? unitPriceFromTotal(total, row(0, qty, unit), null) : null
}

const withTotalFromUnit = (s, quantity, unit) => {
  if (!s.unit.trim()) return { ...s, total: '', totalSrc: '' }
  const total = totalFromUnit(s.unit, quantity, unit)
  return total === null ? s : { ...s, total: moneyText(total), totalSrc: 'auto' }
}
const withUnitFromTotal = (s, quantity, unit) => {
  if (!s.total.trim()) return { ...s, unit: '', unitSrc: '' }
  const price = unitFromTotal(s.total, quantity, unit)
  return price === null ? s : { ...s, unit: moneyText(price), unitSrc: 'auto' }
}

export function typeUnitPrice(s, text, quantity, unit) {
  const next = { ...s, unit: text, unitSrc: text.trim() ? 'typed' : '' }
  if (decimalProblem(text) || s.totalSrc === 'typed') return next
  return withTotalFromUnit(next, quantity, unit)
}

export function typeTotalPrice(s, text, quantity, unit) {
  const next = { ...s, total: text, totalSrc: text.trim() ? 'typed' : '' }
  if (decimalProblem(text) || s.unitSrc === 'typed') return next
  return withUnitFromTotal(next, quantity, unit)
}

// The quantity (or its unit) changed.
export function changeQuantity(s, quantity, unit) {
  if (!quantityOf(quantity) || decimalProblem(s.unit) || decimalProblem(s.total)) return s
  if (s.totalSrc === 'typed' || s.totalSrc === 'saved') return s.unitSrc === 'typed' ? s : withUnitFromTotal(s, quantity, unit)
  return s.unit.trim() ? withTotalFromUnit(s, quantity, unit) : s
}

// Both prices typed, and not quantity × unit price: { unit, total, expected },
// else null. Saving waits until one of them is chosen (see chooseUnitPrice,
// chooseTotalPrice).
export function priceMismatch(s, quantity, unit) {
  if (s.unitSrc !== 'typed' || s.totalSrc !== 'typed') return null
  const expected = totalFromUnit(s.unit, quantity, unit)
  const total = parseDecimal(s.total)
  if (expected === null || !(total >= 0) || Math.round(total * 100) === Math.round(expected * 100)) return null
  return { unit: parseDecimal(s.unit), total, expected }
}

// The unit price is right: the total follows.
export const chooseUnitPrice = (s, quantity, unit) => withTotalFromUnit({ ...s, totalSrc: '' }, quantity, unit)
// The total is right: the unit price follows.
export const chooseTotalPrice = (s, quantity, unit) => withUnitFromTotal({ ...s, unitSrc: '' }, quantity, unit)

// The total of the order (the expense's amount), or NaN when there is none.
export const orderTotal = (s) => {
  const total = parseDecimal(s.total)
  return total > 0 ? Math.round(total * 100) / 100 : NaN
}
