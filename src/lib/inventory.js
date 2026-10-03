import { supabase } from './supabaseClient'
import { followUp, must } from './db'
import { DURABLE_CATEGORY_IDS, DURABLE_EXPENSE_CATEGORY } from '../data/constants'
import { priceFields } from './pricing'
import { normalizeUnit, unitFactor } from './units'
import { parseLocalDate } from './week'

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
  const n = Number(value)
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

// Why an item needs buying: 'out' | 'expired' | 'low' | null.
export function restockReason(item) {
  const status = stockStatus(item)
  if (status === 'out') return 'out'
  if (expiryState(item) === 'expired') return 'expired'
  if (status === 'low') return 'low'
  return null
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

// The Groceries expense category's id, or null if it's missing (the
// expense is then saved without a category).
export async function getGroceriesCategoryId() {
  return must(await supabase.from('expense_categories').select('id').eq('name', 'Groceries').maybeSingle())?.id ?? null
}

// Expense category for a durable purchase: the "Home & Appliances"
// sub-category named like the item's sub-category if there is one, else
// "Home & Appliances" itself. The app never creates it (two phones
// checking off at once could race); supabase/008_durable_category.sql does.
export async function getDurableExpenseCategoryId(subcategoryId) {
  const subName = subcategoryId
    ? must(await supabase.from('inventory_categories').select('name').eq('id', subcategoryId).maybeSingle())?.name
    : null
  const names = [DURABLE_EXPENSE_CATEGORY, subName].filter(Boolean)
  const rows = must(await supabase.from('expense_categories').select('id, name, parent_id').in('name', names))
  return pickDurableCategory(rows, subName)
}

export function pickDurableCategory(rows, subName) {
  const parent = rows.find((c) => c.name === DURABLE_EXPENSE_CATEGORY && !c.parent_id)
  if (!parent) {
    throw new Error(`The "${DURABLE_EXPENSE_CATEGORY}" expense category is missing — run supabase/008_durable_category.sql in Supabase.`)
  }
  return rows.find((c) => c.parent_id === parent.id && c.name === subName)?.id ?? parent.id
}

export const isDurable = (row) => DURABLE_CATEGORY_IDS.includes(row?.category_id)

export async function logStockChange(item, change, newStock, reason) {
  if (!change) return
  must(
    await supabase.from('stock_logs').insert([{ item_id: item.id, item_name: item.name, change, new_stock: newStock, unit: item.unit, reason }])
  )
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
  const delta = round(parts.reduce((sum, p) => sum + p.change, 0))
  const data = must(await supabase.rpc('increment_stock', { item_id: item.id, delta }))
  if (!data?.id) throw new Error(`"${item.name}" is no longer in the pantry.`)
  const updated = normalizeItem(data)
  for (const entry of stockLogEntries(Number(item.current_stock) || 0, Number(updated.current_stock), parts)) {
    await followUp('the stock history', () => logStockChange(updated, entry.change, entry.newStock, entry.reason))
  }
  await followUp('the shopping list', () => syncShoppingForItem(updated))
  return updated
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

// Columns added by supabase/006_backfill_inventory_data.sql and
// 007_schema_sync.sql. Until those migrations have run, writes retry
// without them instead of failing.
const OPTIONAL_COLUMNS = {
  grocery_items: ['payer', 'subcategory_id', 'price_qty', 'price_unit'],
  pantry_items: ['price', 'price_qty', 'price_unit', 'payer', 'last_purchased_at'],
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
// is fine again. Manually added entries are never touched.
// Throws if the list couldn't be read or changed.
export async function syncShoppingForItem(item) {
  const open = must(
    await supabase.from('grocery_items').select('id, auto_generated').eq('pantry_item_id', item.id).eq('completed', false)
  )

  if (!restockReason(item)) {
    const autoIds = open.filter((g) => g.auto_generated).map((g) => g.id)
    if (autoIds.length) must(await supabase.from('grocery_items').delete().in('id', autoIds))
    return
  }

  if (open.length) return
  const { quantity, unit } = suggestedPurchase(item)
  const result = await insertRows('grocery_items', [
    {
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
    },
  ])
  must(result)
}
