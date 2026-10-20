import { supabase } from './supabaseClient'
import { followUp, must } from './db'
import { DURABLE_CATEGORY_IDS, DURABLE_EXPENSE_CATEGORY } from '../data/constants'
import { priceFields } from './pricing'
import { normalizeUnit, unitFactor } from './units'
import { parseLocalDate } from './week'
import { parseDecimal } from './decimal'
import { isOneTime } from './oneTime'
import { listedOutVariants } from './groups'
import { planGroupEntries, spareEntryIds, variantPurchase } from './groupShop'

export { normalizeUnit, unitFactor }

export const STOCK_STATUS_LABELS = { ok: 'OK', low: 'Low', out: 'Out' }

// Status is derived, never stored: Out at zero, Low at or below the
// minimum, OK above it.
export function stockStatus(item) {
  const current = Number(item.current_stock) || 0
  const min = Number(item.min_stock) || 0
  if (current <= 0) return 'out'
  if (current <= min) return 'low'
  return 'ok'
}

export function daysUntil(date) {
  if (!date) return null
  const target = parseLocalDate(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

// 'expired' | 'week' (≤7 days) | 'month' (≤30 days) | 'ok' | 'none'
export function expiryState(item) {
  const days = daysUntil(item.expiry_date)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= 7) return 'week'
  if (days <= 30) return 'month'
  return 'ok'
}

export function expiryLabel(item) {
  const days = daysUntil(item.expiry_date)
  if (days === null) return null
  if (days < 0) return `Expired ${-days}d ago`
  if (days === 0) return 'Expires today'
  if (days <= 30) return `Expires in ${days}d`
  return `Exp. ${parseLocalDate(item.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function round(n) {
  return Math.round(n * 100) / 100
}

// The step quantities are kept in, by unit: whole gr/ml, 0.05 kg/L
// (50 gr/ml) and half pieces, packs, bottles and other counts.
export function quantityStep(unit) {
  const u = normalizeUnit(unit)
  if (u === 'gr' || u === 'ml') return 1
  if (u === 'kg' || u === 'L') return 0.05
  return 0.5
}

// How much one tap of − / + changes a quantity: 100 gr/ml, 0.5 kg/L,
// 1 of anything counted.
export function tapStep(unit) {
  const u = normalizeUnit(unit)
  if (u === 'gr' || u === 'ml') return 100
  if (u === 'kg' || u === 'L') return 0.5
  return 1
}

// One tap of − (direction -1) or + (1) from `quantity`, never below one
// step's worth of the unit's rounding; null when − can't go lower.
export function stepQuantity(quantity, unit, direction) {
  const current = Number(quantity) || 0
  const next = roundQuantity(current + direction * tapStep(unit), unit)
  return next > 0 ? next : null
}

// Rounds a quantity to its unit's step (0.3 kg stays 0.3, 0.3 pcs → 0.5).
// Negative or invalid values are 0.
export function roundQuantity(value, unit) {
  const n = parseDecimal(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  const step = quantityStep(unit)
  return round(Math.round(n / step) * step)
}

// Old unit spellings (pc, g, l) in stock or price units → current ones.
export function normalizeItem(item) {
  const unit = normalizeUnit(item.unit)
  const priceUnit = item.price_unit ? normalizeUnit(item.price_unit) : item.price_unit
  return unit === item.unit && priceUnit === item.price_unit ? item : { ...item, unit, price_unit: priceUnit }
}

// Why an item needs buying: 'out' | 'expired' | 'low' | null. An item in
// a group never needs buying on its own — the group, with its total and
// its threshold, does. A one-time item (1×) never needs buying by itself.
export function restockReason(item) {
  if (item.group_id || isOneTime(item)) return null
  const status = stockStatus(item)
  if (status === 'out') return 'out'
  if (expiryState(item) === 'expired') return 'expired'
  if (status === 'low') return 'low'
  return null
}

// Why an entry is on the SHOP list: restockReason, or 'not-urgent' for a
// group whose total is fine but with a variant at 0 (`item.variants`, see
// listedOutVariants).
export function shopReason(item) {
  const reason = restockReason(item)
  if (reason) return reason
  return item.is_group && listedOutVariants(item.variants).length > 0 ? 'not-urgent' : null
}

// The status HOME shows: a one-time item is never Low or Out (it is
// finished at 0, see oneTime.js).
export const shownStatus = (item) => (isOneTime(item) ? 'ok' : stockStatus(item))

// The colour state of an item card: why it needs buying, or — for a
// variant, which has no threshold of its own — out or expired. A one-time
// item never turns yellow or red (only purple when expired).
export function displayReason(item) {
  if (isOneTime(item)) return expiryState(item) === 'expired' ? 'expired' : null
  if (!item.group_id) return restockReason(item)
  if (stockStatus(item) === 'out') return 'out'
  return expiryState(item) === 'expired' ? 'expired' : null
}

export function formatStock(item) {
  const current = round(Number(item.current_stock) || 0)
  const base = `${current} ${item.unit}`
  const perPack = Number(item.quantity_per_pack)
  if (item.packaging_unit && perPack > 0) {
    return `${base} · ${round(current / perPack)} ${item.packaging_unit}`
  }
  return base
}

// Fill level for the progress bar: full at twice the minimum.
export function stockFill(item) {
  const current = Number(item.current_stock) || 0
  const min = Number(item.min_stock) || 0
  const target = Math.max(min * 2, 1)
  return Math.max(0, Math.min(current / target, 1))
}

// How much to buy to get back above the minimum (up to twice the
// minimum), in whole packs when the item comes in a multipack.
export function suggestedPurchase(item) {
  const current = Number(item.current_stock) || 0
  const min = Number(item.min_stock) || 0
  // An expired item needs replacing even if there's plenty of it.
  const need = expiryState(item) === 'expired' ? Math.max(current, min, 1) : Math.max(min * 2, min + 1, 1) - current
  const perPack = Number(item.quantity_per_pack)
  if (item.packaging_unit && perPack > 0) {
    return { quantity: Math.max(1, Math.ceil(need / perPack)), unit: item.packaging_unit }
  }
  const step = quantityStep(item.unit)
  return { quantity: Math.max(1, round(Math.ceil(round(need / step)) * step)), unit: item.unit }
}

// A quantity in the item's purchase unit with its stock-unit equivalent,
// "2 pack (24 pcs)"; just "2 pack" when there is no conversion to show
// (no purchase unit, or the quantity is in another unit).
export function formatPurchaseQuantity(quantity, unit, pantry) {
  const base = `${quantity} ${unit}`
  const perPack = Number(pantry?.quantity_per_pack)
  if (!pantry?.packaging_unit || unit !== pantry.packaging_unit || !(perPack > 0) || pantry.unit === unit) return base
  return `${base} (${round(Number(quantity) * perPack)} ${pantry.unit})`
}

// Converts a purchased quantity into the pantry item's base unit
// (e.g. 2 case → 24 btl, 1 kg → 1000 gr). Returns null when it can't be
// converted, e.g. a pack of an item counted in gr with no pack size.
export function toBaseQuantity(item, quantity, rawUnit) {
  const qty = Number(quantity) || 0
  const unit = normalizeUnit(rawUnit)
  if (!unit || unit === item.unit) return qty
  const perPack = Number(item.quantity_per_pack)
  if (unit === item.packaging_unit && perPack > 0) return qty * perPack
  const factor = unitFactor(unit, item.unit)
  return factor === null ? null : qty * factor
}

// Expense category for a durable purchase, from the expense categories
// named "Home & Appliances" and like the item's sub-category: that
// sub-category of Home & Appliances if there is one, else Home &
// Appliances itself. The app never creates it (two phones checking off at
// once could race); supabase/008_durable_category.sql does. (Used by the
// default budget mapping, lib/budgetMap.js.)
export function pickDurableCategory(rows, subName) {
  const parent = rows.find((c) => c.name === DURABLE_EXPENSE_CATEGORY && !c.parent_id)
  if (!parent) {
    throw new Error(`The "${DURABLE_EXPENSE_CATEGORY}" expense category is missing — run supabase/008_durable_category.sql in Supabase.`)
  }
  return rows.find((c) => c.parent_id === parent.id && c.name === subName)?.id ?? parent.id
}

export const isDurable = (row) => DURABLE_CATEGORY_IDS.includes(row?.category_id)

// Writes one history row; returns its id (in a list, empty when nothing
// changed).
export async function logStockChange(item, change, newStock, reason) {
  if (!change) return []
  const rows = must(
    await supabase.from('stock_logs').insert([{ item_id: item.id, item_name: item.name, change, new_stock: newStock, unit: item.unit, reason }]).select('id')
  )
  return (rows ?? []).map((r) => r.id)
}

// The stock history entry and shopping list update after a stock change.
// They don't undo the change if they fail; the toast offers Retry.
export async function afterStockChange(item, change, newStock, reason) {
  await followUp('the stock history', () => logStockChange(item, change, newStock, reason))
  await followUp('the shopping list', () => syncShoppingForItem(item))
}

// Adds `delta` to an item's stock in one database statement (never below
// 0), so two people changing it at once can't overwrite each other.
// Throws if the stock wasn't changed; then logs the change and re-syncs
// the shopping list. Returns the updated row.
export function changeStock(item, delta, reason) {
  return changeStockParts(item, [{ change: delta, reason }])
}

// Several changes saved as one stock update, each with its own history
// entry — e.g. throw away 2 expired and add 4 bought: one +2 update,
// logged as -2 discarded and +4 purchased.
export async function changeStockParts(item, parts) {
  return (await stockChangeWithLog(item, parts)).item
}

// As changeStockParts, also giving the ids of the history rows it wrote
// ({ item, logIds }), so an Undo can take them away again. A history row
// saved later by Retry is added to the same list.
export async function stockChangeWithLog(item, parts) {
  const delta = round(parts.reduce((sum, p) => sum + p.change, 0))
  const data = must(await supabase.rpc('increment_stock', { item_id: item.id, delta }))
  if (!data?.id) throw new Error(`"${item.name}" is no longer in the pantry.`)
  const updated = normalizeItem(data)
  const logIds = []
  for (const entry of stockLogEntries(Number(item.current_stock) || 0, Number(updated.current_stock), parts)) {
    await followUp('the stock history', async () => logIds.push(...(await logStockChange(updated, entry.change, entry.newStock, entry.reason))))
  }
  await followUp('the shopping list', () => syncShoppingForItem(updated))
  return { item: updated, logIds }
}

// Undo of a stock change: the stock goes back (`delta` added in one
// database statement, never below 0) and the history rows the change wrote
// (`logIds`) are deleted — no "Adjusted" row, so the change leaves no
// trace. A row already gone (deleted on the other phone) is simply not
// there. Returns the updated row.
export async function undoStockChange(item, delta, logIds = []) {
  const data = must(await supabase.rpc('increment_stock', { item_id: item.id, delta: round(delta) }))
  if (!data?.id) throw new Error(`"${item.name}" is no longer in the pantry.`)
  const updated = normalizeItem(data)
  if (logIds.length) await followUp('the stock history', async () => must(await supabase.from('stock_logs').delete().in('id', logIds)))
  await followUp('the shopping list', () => syncShoppingForItem(updated))
  return updated
}

// The history row of a stock change made offline and sent meanwhile (its
// id isn't known on the phone): the newest one of that item with that
// change and reason, or null.
export async function latestLogId(itemId, change, reason) {
  const rows = must(
    await supabase.from('stock_logs').select('id').eq('item_id', itemId).eq('change', change).eq('reason', reason).order('created_at', { ascending: false }).limit(1)
  )
  return rows?.[0]?.id ?? null
}

// History entries for `parts` applied in order to `before`, as far as
// stock can't go below 0 (a "use 3" from 1 logs -1). The stock after
// each entry is shifted so the last one matches `after`, the saved
// value, which may include someone else's change made at the same time.
export function stockLogEntries(before, after, parts) {
  let stock = before
  const entries = []
  for (const { change, reason } of parts) {
    const next = round(Math.max(0, stock + change))
    if (next !== stock) entries.push({ change: round(next - stock), stock: next, reason })
    stock = next
  }
  const offset = round(after - stock)
  return entries.map(({ change, stock: s, reason }) => ({ change, newStock: round(Math.max(0, s + offset)), reason }))
}

// Columns added by supabase/006_backfill_inventory_data.sql,
// 007_schema_sync.sql and (usual_shop_id) 021_connected_flow.sql. Until
// those migrations have run, writes retry without them instead of failing.
const OPTIONAL_COLUMNS = {
  grocery_items: ['payer', 'subcategory_id', 'price_qty', 'price_unit'],
  pantry_items: ['price', 'price_qty', 'price_unit', 'payer', 'last_purchased_at', 'usual_shop_id'],
}

const missingOptional = (table, error) => Boolean(error) && OPTIONAL_COLUMNS[table].some((c) => error.message?.includes(c))
const stripOptional = (table, row) => Object.fromEntries(Object.entries(row).filter(([k]) => !OPTIONAL_COLUMNS[table].includes(k)))

export async function insertRows(table, rows) {
  const first = await supabase.from(table).insert(rows).select()
  if (!missingOptional(table, first.error)) return first
  return supabase.from(table).insert(rows.map((r) => stripOptional(table, r))).select()
}

export async function upsertRows(table, rows) {
  const first = await supabase.from(table).upsert(rows)
  if (!missingOptional(table, first.error)) return first
  return supabase.from(table).upsert(rows.map((r) => stripOptional(table, r)))
}

// Updates rows matching `ids` (one id or a list) and returns them.
export async function updateRows(table, ids, patch) {
  const run = (p) => {
    const q = supabase.from(table).update(p)
    return (Array.isArray(ids) ? q.in('id', ids) : q.eq('id', ids)).select()
  }
  const first = await run(patch)
  if (!missingOptional(table, first.error)) return first
  const stripped = stripOptional(table, patch)
  return Object.keys(stripped).length ? run(stripped) : { data: [], error: null }
}

// Keeps the grocery list in step with stock: a Low, Out or Expired item
// gets one auto-generated entry, and that entry disappears once the item
// is fine again. Manually added entries are never touched. A one-time item
// never gets one, and its entry in the cart stays there. A group and its
// variants are judged together (syncGroup): each variant at 0 gets its own
// entry, the group none. Throws if the list couldn't be read or changed.
export async function syncShoppingForItem(item) {
  if (item.group_id) return syncGroup(item.group_id)
  if (item.is_group) return syncGroup(item.id, item)
  const open = must(
    await supabase.from('grocery_items').select('id, auto_generated, in_cart, created_at').eq('pantry_item_id', item.id).eq('completed', false)
  )

  if (!restockReason(item)) {
    // An entry ordered online and on the way stays: it leaves the list
    // when the order arrives (or goes back to "to buy" if cancelled). So
    // does a one-time item's entry already in the cart.
    const ordered = await orderedEntryIds(open.map((g) => g.id))
    const keepInCart = isOneTime(item)
    const autoIds = open.filter((g) => g.auto_generated && !ordered.has(g.id) && !(keepInCart && g.in_cart)).map((g) => g.id)
    if (autoIds.length) must(await supabase.from('grocery_items').delete().in('id', autoIds))
    return
  }

  if (open.length > 1) await removeSpareEntries(item.id, open)
  if (open.length) return
  const { quantity, unit } = suggestedPurchase(item)
  must(await insertRows('grocery_items', [autoEntry(item, quantity, unit)]))
  // The other phone may have added one at the same moment: one stays.
  await removeSpareEntries(item.id)
}

// An automatic SHOP entry for a HOME item: its name, category, last price
// and payer.
function autoEntry(item, quantity, unit) {
  return {
    name: item.name,
    category_id: item.category_id,
    subcategory_id: item.subcategory_id ?? null,
    quantity,
    unit,
    ...priceFields(item),
    payer: item.payer || 'shared',
    completed: false,
    pantry_item_id: item.id,
    auto_generated: true,
  }
}

// Removes the automatic entries "to buy" that are one too many for an item
// (see spareEntryIds), from `open` or as read now.
async function removeSpareEntries(itemId, open = null) {
  const rows = open ?? must(await supabase.from('grocery_items').select('id, auto_generated, in_cart, created_at').eq('pantry_item_id', itemId).eq('completed', false))
  if (rows.length < 2) return
  const spare = spareEntryIds(rows, await orderedEntryIds(rows.map((g) => g.id)))
  if (spare.length) must(await supabase.from('grocery_items').delete().in('id', spare))
}

// A group and its variants on the SHOP list, judged together (see
// planGroupEntries in groupShop.js): every variant at 0 (not one-time) has
// its own entry, the group none; a group at or below its minimum with no
// variant at 0 lists the variant with the least. `known`: the group row,
// when the caller has it.
async function syncGroup(groupId, known = null) {
  const group = known ?? must(await supabase.from('pantry_items').select('*').eq('id', groupId).maybeSingle())
  if (!group) return
  const variants = must(await supabase.from('pantry_items').select('*').eq('group_id', groupId)).map(normalizeItem)
  const ids = [groupId, ...variants.map((v) => v.id)]
  const readOpen = async () => must(await supabase.from('grocery_items').select('id, pantry_item_id, auto_generated, in_cart, created_at').in('pantry_item_id', ids).eq('completed', false))
  const total = round(variants.reduce((sum, v) => sum + (Number(v.current_stock) || 0), 0))
  const groupNeeds = variants.length > 0 && Boolean(restockReason({ ...group, current_stock: total }))
  const plan = async (open) => planGroupEntries({ group, variants, open, ordered: await orderedEntryIds(open.map((g) => g.id)), groupNeeds })

  const { remove, add } = await plan(await readOpen())
  if (remove.length) must(await supabase.from('grocery_items').delete().in('id', remove))
  if (!add.length) return
  must(
    await insertRows(
      'grocery_items',
      add.map((v) => {
        const { quantity, unit } = variantPurchase(v)
        return autoEntry(v, quantity, unit)
      })
    )
  )
  // The other phone may have added the same entries at the same moment:
  // judged again, one of each stays (the oldest).
  const again = await plan(await readOpen())
  if (again.remove.length) must(await supabase.from('grocery_items').delete().in('id', again.remove))
}

// The SHOP list entries among `ids` that have an order on the way
// (supabase/021); none before that update.
export async function orderedEntryIds(ids) {
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('orders').select('grocery_item_id').in('grocery_item_id', ids).eq('status', 'on_the_way')
  if (error) return new Set()
  return new Set(data.map((o) => o.grocery_item_id))
}

// The open SHOP entries of a pantry item that are still "to buy": not in a
// cart and not ordered online. Entries without a link count when they
// have the item's name (typed by hand). Whole rows, so they can be put
// back exactly.
export async function toBuyEntriesOf(item) {
  const linked = must(await supabase.from('grocery_items').select('*').eq('pantry_item_id', item.id).eq('completed', false))
  const unlinked = must(await supabase.from('grocery_items').select('*').is('pantry_item_id', null).eq('completed', false))
  const key = (item.name || '').trim().toLowerCase()
  const rows = [...linked, ...unlinked.filter((g) => (g.name || '').trim().toLowerCase() === key)].filter((g) => !g.in_cart)
  const ordered = await orderedEntryIds(rows.map((g) => g.id))
  return rows.filter((g) => !ordered.has(g.id))
}
