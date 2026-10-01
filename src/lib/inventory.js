import { supabase } from './supabaseClient'

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
  const need = Math.max(min * 2, min + 1, 1) - current
  const perPack = Number(item.quantity_per_pack)
  if (item.packaging_unit && perPack > 0) {
    return { quantity: Math.max(1, Math.ceil(need / perPack)), unit: item.packaging_unit }
  }
  return { quantity: Math.max(1, round(need)), unit: item.unit }
}

const METRIC_FACTORS = { g: ['kg', 1000], ml: ['L', 1000], cm: ['m', 100] }

// Converts a purchased quantity into the pantry item's base unit
// (e.g. 2 case → 24 btl, 1 kg → 1000 g).
export function toBaseQuantity(item, quantity, unit) {
  const qty = Number(quantity) || 0
  if (!unit || unit === item.unit) return qty
  const perPack = Number(item.quantity_per_pack)
  if (unit === item.packaging_unit && perPack > 0) return qty * perPack
  for (const [small, [big, factor]] of Object.entries(METRIC_FACTORS)) {
    if (item.unit === small && unit === big) return qty * factor
    if (item.unit === big && unit === small) return qty / factor
  }
  return qty
}

export async function logStockChange(item, change, newStock, reason) {
  if (!change) return
  await supabase.from('stock_logs').insert([
    { item_id: item.id, item_name: item.name, change, new_stock: newStock, unit: item.unit, reason },
  ])
}

// Keeps the grocery list in step with stock: a Low/Out item gets one
// auto-generated entry, and that entry disappears once stock is back
// above the minimum. Manually added entries are never touched.
export async function syncShoppingForItem(item) {
  const { data: open } = await supabase
    .from('grocery_items')
    .select('id, auto_generated')
    .eq('pantry_item_id', item.id)
    .eq('completed', false)

  if (stockStatus(item) === 'ok') {
    const autoIds = (open || []).filter((g) => g.auto_generated).map((g) => g.id)
    if (autoIds.length) await supabase.from('grocery_items').delete().in('id', autoIds)
    return
  }

  if (open && open.length) return
  const { quantity, unit } = suggestedPurchase(item)
  await supabase.from('grocery_items').insert([
    {
      name: item.name,
      category_id: item.category_id,
      quantity,
      unit,
      price: 0,
      completed: false,
      pantry_item_id: item.id,
      auto_generated: true,
    },
  ])
}
