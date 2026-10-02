import { supabase } from './supabaseClient'
import { DURABLE_CATEGORY_IDS, DURABLE_EXPENSE_CATEGORY } from '../data/constants'
import { priceFields } from './pricing'
import { normalizeUnit, unitFactor } from './units'

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
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(y, m - 1, d)
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
  return `Exp. ${new Date(item.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function round(n) {
  return Math.round(n * 100) / 100
}

// Stock and minimum stock are kept in steps of 0.5 (0.3 → 0.5, 0.2 → 0).
export function roundHalf(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 2) / 2
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
  return { quantity: Math.max(1, Math.ceil(need * 2) / 2), unit: item.unit }
}

// Converts a purchased quantity into the pantry item's base unit
// (e.g. 2 case → 24 btl, 1 kg → 1000 gr).
export function toBaseQuantity(item, quantity, rawUnit) {
  const qty = Number(quantity) || 0
  const unit = normalizeUnit(rawUnit)
  if (!unit || unit === item.unit) return qty
  const perPack = Number(item.quantity_per_pack)
  if (unit === item.packaging_unit && perPack > 0) return qty * perPack
  const factor = unitFactor(unit, item.unit)
  return factor === null ? qty : qty * factor
}

export async function getGroceriesCategoryId() {
  const { data } = await supabase.from('expense_categories').select('id').eq('name', 'Groceries').maybeSingle()
  return data?.id ?? null
}

// Expense category for a durable purchase: the "Home & Appliances"
// sub-category named like the item's sub-category if there is one, else
// "Home & Appliances" itself (created if the migration hasn't run yet).
export async function getDurableExpenseCategoryId(subcategoryId) {
  const { data: rows } = await supabase.from('expense_categories').select('id, name, parent_id')
  const parent = rows?.find((c) => c.name === DURABLE_EXPENSE_CATEGORY && !c.parent_id)
  if (subcategoryId && parent) {
    const { data: sub } = await supabase.from('inventory_categories').select('name').eq('id', subcategoryId).maybeSingle()
    const match = rows.find((c) => c.parent_id === parent.id && c.name === sub?.name)
    if (match) return match.id
  }
  if (parent) return parent.id
  const { data: created } = await supabase.from('expense_categories').insert([{ name: DURABLE_EXPENSE_CATEGORY }]).select().single()
  return created?.id ?? null
}

export const isDurable = (row) => DURABLE_CATEGORY_IDS.includes(row?.category_id)

export async function logStockChange(item, change, newStock, reason) {
  if (!change) return
  await supabase.from('stock_logs').insert([
    { item_id: item.id, item_name: item.name, change, new_stock: newStock, unit: item.unit, reason },
  ])
}

// Columns added by supabase/006_backfill_inventory_data.sql. Until that
// migration has run, writes retry without them instead of failing.
const OPTIONAL_COLUMNS = {
  grocery_items: ['payer', 'subcategory_id', 'price_qty', 'price_unit'],
  pantry_items: ['price_qty', 'price_unit'],
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
export async function syncShoppingForItem(item) {
  const { data: open } = await supabase
    .from('grocery_items')
    .select('id, auto_generated')
    .eq('pantry_item_id', item.id)
    .eq('completed', false)

  if (!restockReason(item)) {
    const autoIds = (open || []).filter((g) => g.auto_generated).map((g) => g.id)
    if (autoIds.length) await supabase.from('grocery_items').delete().in('id', autoIds)
    return
  }

  if (open && open.length) return
  const { quantity, unit } = suggestedPurchase(item)
  await insertRows('grocery_items', [
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
}
