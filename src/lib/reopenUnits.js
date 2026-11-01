import { unitFactor } from './units'

// Reopen / Undo purchase and "Back on the way" after a unit change (plan
// 9M). From supabase/031 the database converts the stock a purchase line
// or an arrival added from the unit it was counted in to the item's unit
// now, keeps an item the purchase created when it also got stock or an
// order from elsewhere, and takes nothing out when the stock can't be
// converted. The functions return what they always did, so the app reads
// the lines and items before the call and the items after it, and these
// pure rules (the same as 031's) say what to tell the user. Before 031 the
// database deletes every created item and always takes the stock out as
// it was counted, so nothing here ever says anything then.

// How many of the item's unit now are in 1 of `from` (K27): the same unit
// → 1; kg ↔ gr, L ↔ ml → the factor; the item's usual pack
// (packaging_unit = `from`) → its size. Anything else: null.
export function stockFactor(from, item) {
  if ((from ?? null) === (item?.unit ?? null)) return 1
  const metric = from && item?.unit ? unitFactor(from, item.unit) : null
  if (metric != null) return metric
  const per = Number(item?.quantity_per_pack)
  return item?.packaging_unit && item.packaging_unit === from && per > 0 ? per : null
}

// The factor for one purchase line (031): the unit it counted its stock
// in is its stock_unit (030), else the unit of its own "Bought" history
// row (`boughtUnit`); without either, its own unit, and then only when
// that is the item's unit.
export function lineFactor(line, item, boughtUnit = null) {
  const from = line.stock_unit ?? boughtUnit ?? null
  if (from == null) return (line.unit ?? null) === (item?.unit ?? null) ? 1 : null
  return stockFactor(from, item)
}

// The unit of each line's own "Bought" row, from the history rows of the
// purchase (`logs`: { id, unit, reason }).
export function boughtUnits(lines, logs) {
  const byId = new Map(logs.map((l) => [l.id, l]))
  return new Map(lines.map((line) => [line.id, (line.log_ids ?? []).map((id) => byId.get(id)).find((l) => l?.reason === 'purchased')?.unit ?? null]))
}

const amount = (n) => Math.round(n * 1000) / 1000
const near = (a, b) => Math.abs(a - b) < 1e-6
const quantity = (n, unit) => `${amount(n)}${unit ? ` ${unit}` : ''}`

export const keptText = (name, taken) =>
  taken ? `"${name}" stays in HOME — it also got stock or an order from elsewhere; this purchase's ${taken} were taken out.` : `"${name}" stays in HOME — it also got stock or an order from elsewhere.`
export const notTakenOutText = (name) => `"${name}": this purchase's stock couldn't be taken out (its unit changed) — check it in HOME.`
export const keptNotTakenOutText = (name) => `"${name}" stays in HOME — it also got stock or an order from elsewhere; this purchase's stock couldn't be taken out (its unit changed) — check it in HOME.`
export const arrivalNotTakenOutText = (name) => `"${name}": this arrival's stock couldn't be taken out (its unit changed) — check it in HOME.`

// What to tell after Reopen / Undo purchase / the Undo toast, one text per
// item. `lines`: the purchase's lines read before the call; `before` /
// `after`: their HOME items before and after it; `logs`: the purchase's
// own history rows (read before). A created item still there afterwards
// was kept (031). An item whose stock couldn't be converted is named only
// when its stock is what 031 leaves and not what the database before 031
// would have made of it.
export function reopenNotes({ lines, before, after, logs = [] }) {
  const units = boughtUnits(lines, logs)
  const notes = []
  for (const item of before) {
    const own = lines.filter((l) => l.pantry_item_id === item.id).sort((a, b) => Number(b.position) - Number(a.position))
    if (!own.length) continue
    const now = after.find((i) => i.id === item.id)
    if (!now) continue
    const factors = own.map((l) => lineFactor(l, item, units.get(l.id)))
    const created = own.findIndex((l) => l.pantry_created)
    if (created >= 0) {
      const line = own[created]
      const f = factors[created]
      const added = Number(line.stock_added) || 0
      notes.push(f == null ? (added > 0 ? keptNotTakenOutText(item.name) : keptText(item.name, '')) : keptText(item.name, added > 0 ? quantity(added * f, item.unit) : ''))
      continue
    }
    const stuck = own.some((l, k) => factors[k] == null && (Number(l.stock_added) > 0 || Number(l.stock_discarded) > 0))
    if (!stuck) continue
    let old = Number(item.current_stock) || 0
    let next = old
    own.forEach((l, k) => {
      const added = Number(l.stock_added) || 0
      const discarded = Number(l.stock_discarded) || 0
      old = Math.max(0, old - added) + discarded
      if (factors[k] != null) next = Math.max(0, next - added * factors[k]) + discarded * factors[k]
    })
    const seen = Number(now.current_stock) || 0
    if (near(seen, next) && !near(seen, old)) notes.push(notTakenOutText(item.name))
  }
  return notes
}

// The factor for an arrival (031): from the unit of its own history row
// (`log`), or the item's unit when that row is gone.
export const arrivalFactor = (log, item) => stockFactor(log?.unit ?? item?.unit ?? null, item)

// The question before "Back on the way" (K37), what it says about the
// stock an arrival added to an item it didn't create. `unit`: the item's
// unit as the phone shows it; `seen` ({ item, log }, read just before):
// when the arrival's own history row was counted in another unit than the
// item's now, it says what the arrival really added and what 031 takes
// out. The app can't tell before the call whether 031 has run, so it also
// says what the database before 031 takes out (the arrival's number in the
// item's unit now). Otherwise (same unit, that row gone, nothing read) the
// text as before: both take out the same.
export function backOnTheWayStockText(order, unit, seen) {
  const added = Number(order.stock_added)
  const item = seen?.item
  const from = seen?.log?.unit ?? null
  if (!item || from == null || from === (item.unit ?? null)) return `Its arrival added ${added}${unit ? ` ${unit}` : ''} to HOME. That stock is taken out again, so it isn't counted twice when it really arrives.`
  const factor = stockFactor(from, item)
  const before031 = `Until the database update supabase/031_reopen_created_items.sql has run, ${quantity(added, item.unit)} is taken out instead`
  return factor == null
    ? `Its arrival added ${quantity(added, from)} to HOME. That stock won't be taken out (its unit changed) — check "${item.name}" in HOME. ${before031}.`
    : `Its arrival added ${quantity(added, from)} (${quantity(added * factor, item.unit)}) to HOME. That stock is taken out again, so it isn't counted twice when it really arrives. ${before031} — check "${item.name}" in HOME afterwards.`
}

// What "Back on the way" / the Arrived Undo took out of `before` (the item
// before the call; `after`: the same item after it), or null when it can't
// be told; and the text when nothing could be taken out (031) — only when
// the stock is what 031 leaves and not what 021 would have made of it.
export function unarriveNote({ order, before, after, log }) {
  const added = Number(order?.stock_added) || 0
  if (!before || !after || !(added > 0)) return null
  const old = Number(before.current_stock) || 0
  const seen = Number(after.current_stock) || 0
  if (arrivalFactor(log, before) != null) return null
  return near(seen, old) && !near(Math.max(0, old - added), old) ? arrivalNotTakenOutText(before.name) : null
}

// "4 pcs": what an arrival's undo really took out of the item (the stock
// before and after it, in the item's unit), or '' when nothing.
export function takenOutQuantity(before, after) {
  if (!before || !after) return ''
  const taken = (Number(before.current_stock) || 0) - (Number(after.current_stock) || 0)
  return taken > 1e-9 ? quantity(taken, before.unit) : ''
}
