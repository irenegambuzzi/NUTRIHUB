import { expiryState, stockFill, stockStatus } from './inventory'

// Sorting, searching and filtering the pantry list.

const STATUS_ORDER = { out: 0, low: 1, ok: 2 }

const byName = (a, b) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' })

// Sorting works the same for one category or for "All" (every item
// together, regardless of category).
export const SORTS = {
  az: { label: 'A–Z', fn: byName },
  za: { label: 'Z–A', fn: (a, b) => byName(b, a) },
  stockDesc: { label: 'Stock: highest first', fn: (a, b) => Number(b.current_stock) - Number(a.current_stock) || byName(a, b) },
  stockAsc: { label: 'Stock: lowest first', fn: (a, b) => Number(a.current_stock) - Number(b.current_stock) || byName(a, b) },
  restock: {
    label: 'Needs restock first',
    fn: (a, b) => STATUS_ORDER[stockStatus(a)] - STATUS_ORDER[stockStatus(b)] || stockFill(a) - stockFill(b),
  },
  expiry: { label: 'Expiry date', fn: (a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') },
  recent: { label: 'Newest', fn: (a, b) => b.created_at.localeCompare(a.created_at) },
}

// 0 = exact name, 1 = name starts with, 2 = name contains, 3 = other
// fields contain, -1 = no match.
export function searchRank(item, q, categoryName) {
  const name = item.name.trim().toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  const other = [item.notes, item.batch_lot, categoryName(item.category_id), item.subcategory_id && categoryName(item.subcategory_id)]
  return other.some((s) => s && s.toLowerCase().includes(q)) ? 3 : -1
}

export function matchesExpiry(item, filter) {
  const state = expiryState(item)
  if (filter === 'all') return true
  if (filter === 'month') return state === 'week' || state === 'month'
  return state === filter
}

export function matchesStatus(item, filter) {
  const status = stockStatus(item)
  if (filter === 'all') return true
  if (filter === 'attention') return status !== 'ok'
  return status === filter
}
