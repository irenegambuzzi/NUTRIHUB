import { normalizeUnit, unitFactor } from './units'
import { parseDecimal } from './decimal'

// Pack size per purchase (plan 9H). Something bought in a package (box,
// pack, conf…) holds a number of the item's stock units that can differ
// from one purchase to the next: an emergency store, an offer, another
// brand. The "pack field" says it for THIS purchase only: "pcs per box".
// The item's usual size (`packaging_unit` + `quantity_per_pack`, set in
// the HOME editor) only starts the field, and a purchase saves into it
// only the first time — while the item has no usual size yet.
// One set of rules for Confirm purchase, MONEY "Add expense", Order
// online and Arrived.

const MEASURE_UNITS = ['gr', 'kg', 'ml', 'L']

const round2 = (n) => Math.round(n * 100) / 100

// Whether a line bought in `unit` for `item` gets the pack field: a unit
// that isn't the item's stock unit and can't be turned into it by measure
// (kg → gr, L → ml). Same-unit and measure lines never get it; nor a line
// without a HOME item (a new item takes the line's unit as its stock unit).
export function hasPackField(item, unit) {
  const u = normalizeUnit(unit)
  if (!item?.unit || !u || u === item.unit) return false
  return unitFactor(u, item.unit) === null
}

// The item's usual size for this unit (a number), or null when its usual
// size is for another unit or not set.
export function usualPackSize(item, unit) {
  const per = Number(item?.quantity_per_pack)
  return item?.packaging_unit && item.packaging_unit === normalizeUnit(unit) && per > 0 ? per : null
}

// The first-time rule: a purchase may save its pack size as the item's
// usual size only while the item has none — no packaging unit and no
// size, or this very packaging unit without a size. An existing usual size
// is never overwritten, an item whose packaging unit is another unit never
// gets anything saved, and a measure unit (kg…) is never a package.
export function savesUsualSize(item, unit) {
  const u = normalizeUnit(unit)
  if (!item || !u || MEASURE_UNITS.includes(u)) return false
  if (Number(item.quantity_per_pack) > 0) return false
  return !item.packaging_unit || item.packaging_unit === u
}

// What the field starts with for this unit: the usual size when there is
// one, else empty.
export const packStartText = (item, unit) => {
  const usual = usualPackSize(item, unit)
  return usual ? String(usual) : ''
}

// The text in the field: what was typed, while it was typed for this very
// unit (`typed`: { text, unit }); else `start` — so changing the unit
// starts the field again for the new one.
export const packTextFor = (typed, unit, start) => (typed && typed.unit != null && typed.unit === normalizeUnit(unit) && typed.text != null ? typed.text : start)

// The pack field of one line, or null when the line has none.
//   item       the HOME item whose stock unit and usual size count
//   unit       the line's unit; quantity: how many of it
//   text       what the field holds now (packTextFor)
//   required   saving is blocked while it is empty (not at Order online)
//   canSave    this place may save a first-time usual size (Confirm, MONEY,
//              Arrived when the order can remember it; never Order online)
// → { stockUnit, unit, text, value, usual, total, differs, firstTime,
//     empty, blocking }
export function packField({ item, unit, quantity = 1, text = '', required = true, canSave = true }) {
  if (!hasPackField(item, unit)) return null
  const u = normalizeUnit(unit)
  const parsed = parseDecimal(text)
  const value = parsed > 0 ? parsed : null
  const usual = usualPackSize(item, u)
  const count = Number(quantity) > 0 ? Number(quantity) : 1
  return {
    stockUnit: item.unit,
    unit: u,
    text: text ?? '',
    value,
    usual,
    total: value === null ? null : round2(count * value),
    differs: value !== null && usual !== null && value !== usual,
    firstTime: canSave && value !== null && savesUsualSize(item, u),
    empty: value === null,
    blocking: required && value === null,
  }
}

// The usual size a first-time save writes on the item ({} for none). Sent
// with a purchase line as its packaging_unit / quantity_per_pack.
export const firstTimePatch = (pack) => (pack?.firstTime ? { packaging_unit: pack.unit, quantity_per_pack: pack.value } : {})

// The texts, exactly as the screens show them.
export const packLabel = (pack) => `${pack.stockUnit} per ${pack.unit}`
export const packTotalText = (pack) => `= ${pack.total} ${pack.stockUnit}`
export const packUsualText = (pack) => `This purchase only — usual: ${pack.usual} ${pack.stockUnit} per ${pack.unit}.`
export const packMissingText = (pack) => `Type how many ${pack.stockUnit} are in 1 ${pack.unit}.`
export const PACK_LATER_TEXT = 'You can fill this in when it arrives.'
export const PACK_FIRST_TIME_TEXT = 'It will be saved as the usual size for next time.'

// What was bought, in packages: "1 box · 30 pcs", or with more than one
// "2 box · 30 pcs each · 60 pcs".
export function packAmountLabel(quantity, unit, perPack, stockUnit) {
  const q = round2(Number(quantity))
  const per = round2(Number(perPack))
  if (q === 1) return `1 ${unit} · ${per} ${stockUnit}`
  return `${q} ${unit} · ${per} ${stockUnit} each · ${round2(q * per)} ${stockUnit}`
}

// A purchase line (shopping_trip_items: quantity, unit, stock_added) bought
// in packages of `item` (its HOME item, for the stock unit), as above; the
// size per package is what really went into HOME (stock_added ÷ quantity),
// whatever was typed then. null when the line wasn't bought in packages or
// doesn't say enough (an old line, a deleted item): it shows as before.
export function purchasedPackLabel(line, item) {
  const quantity = Number(line?.quantity)
  const added = Number(line?.stock_added)
  if (!(quantity > 0) || !(added > 0) || !hasPackField(item, line.unit)) return null
  return packAmountLabel(quantity, normalizeUnit(line.unit), added / quantity, item.unit)
}

// An order with a pack size (orders.pack_size) and its HOME item's stock
// unit, as above; null without one.
export function orderPackLabel(order, stockUnit) {
  const quantity = Number(order?.quantity) > 0 ? Number(order.quantity) : 1
  const per = Number(order?.pack_size)
  if (!(per > 0) || !order.unit || !stockUnit || order.unit === stockUnit) return null
  return packAmountLabel(quantity, order.unit, per, stockUnit)
}
