import { METRIC_PARTNER, convertQuantity } from './units'

// A price is stored as an amount per a basis quantity, e.g. €2.50 per
// 500 gr, €1 per can, €6 per pack: price + price_qty + price_unit. Rows
// without a basis mean "per 1 <row's unit>".
export function priceBasis(row) {
  const qty = Number(row.price_qty)
  return { qty: qty > 0 ? qty : 1, unit: row.price_unit || row.unit }
}

export function priceFields(row) {
  return { price: Number(row.price) || 0, price_qty: row.price_qty ?? null, price_unit: row.price_unit ?? null }
}

const round2 = (n) => Math.round(n * 100) / 100

export const money = (n) => `€${(Number(n) || 0).toFixed(2)}`

// "€2.50 / 500 gr", "€1.00 / can"
export function formatUnitPrice(row) {
  if (!(Number(row.price) > 0)) return null
  const { qty, unit } = priceBasis(row)
  return `${money(row.price)} / ${qty === 1 ? '' : `${qty} `}${unit}`
}

// What a grocery line costs: quantity converted into the price basis,
// e.g. 10 can × €1/can = €10, or 1 kg at €2.50/500 gr = €5. `pack` is
// the linked pantry item, for multipack conversions (pack ↔ btl).
// null when the quantity can't be converted into the price basis (e.g.
// 2 pack at €/gr with no pack size): the total is unknown, not a guess.
export function lineTotal(row, pack) {
  const price = Number(row.price) || 0
  if (!price) return 0
  const { qty, unit } = priceBasis(row)
  const amount = convertQuantity(row.quantity ?? 1, row.unit, unit, pack)
  return amount === null ? null : round2((price * amount) / qty)
}

// Inverse of lineTotal: the per-basis price that makes the line cost
// `total`, or null when the units can't be converted.
export function unitPriceFromTotal(total, row, pack) {
  const { qty, unit } = priceBasis(row)
  const amount = convertQuantity(row.quantity ?? 1, row.unit, unit, pack)
  if (amount === null) return null
  return amount > 0 ? round2((Number(total) * qty) / amount) : 0
}

// Units a price can be quoted in for an item: its own unit, the metric
// partner (gr ↔ kg, ml ↔ L) and its multipack, if any.
export function priceUnitOptions(row, pack) {
  const units = [row.unit, METRIC_PARTNER[row.unit], pack?.unit, pack?.packaging_unit, row.price_unit]
  return [...new Set(units.filter(Boolean))]
}
