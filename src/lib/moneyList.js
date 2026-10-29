// Filtering and grouping the money lists (income and expenses alike).
// Pure, so they can be tested. Every function takes accessors:
//   dateOf(entry)   → 'YYYY-MM-DD'
//   mainOf(entry)   → the entry's main category ({ id, name }) or null

import { getWeekStart, parseLocalDate } from './week'
import { bucketKeyForDate } from './expensePeriods'
import { newestFirst, newestGroupFirst } from './recency'
import { compareCategories, sortCategories } from './categoryOrder'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const NO_CATEGORY = 'none'
export const categoryKeyOf = (main) => main?.id ?? NO_CATEGORY

const amountOf = (entry) => Number(entry.amount || 0)
const sum = (entries) => entries.reduce((total, e) => total + amountOf(e), 0)

// Only what the chart clicks picked: a time bucket, a category and/or a
// store (`shopKeyOf(entry)` gives the key a store is filed under).
export function applyChartFilters(entries, { bucket, category, store }, { dateOf, mainOf, period, shopKeyOf }) {
  return entries.filter((e) => {
    if (bucket && bucketKeyForDate(dateOf(e), period) !== bucket) return false
    if (category && categoryKeyOf(mainOf(e)) !== category) return false
    if (store && shopKeyOf?.(e) !== store) return false
    return true
  })
}

// "5 Oct – 11 Oct 2026" for the week starting `weekStart`.
export function formatWeekRange(weekStart) {
  const start = parseLocalDate(weekStart)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return `${day(start)} – ${day(end)} ${end.getFullYear()}`
}

function byWeek(entries, dateOf) {
  const map = new Map()
  for (const e of [...entries].sort(newestFirst(dateOf))) {
    const key = getWeekStart(parseLocalDate(dateOf(e)))
    if (!map.has(key)) map.set(key, { key, label: formatWeekRange(key), items: [], total: 0 })
    const g = map.get(key)
    g.items.push(e)
    g.total += amountOf(e)
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
}

function byCategory(entries, { dateOf, mainOf }) {
  const map = new Map()
  for (const e of [...entries].sort(newestFirst(dateOf))) {
    const main = mainOf(e)
    const key = categoryKeyOf(main)
    if (!map.has(key)) map.set(key, { key, main, name: main?.name || 'Uncategorized', items: [], total: 0 })
    const g = map.get(key)
    g.items.push(e)
    g.total += amountOf(e)
  }
  // The category with the most recent entry first.
  const newest = newestGroupFirst(dateOf, (g) => g.items)
  return [...map.values()].sort((a, b) => newest(a, b) || b.total - a.total || a.name.localeCompare(b.name))
}

// The three ways of sorting the list shown:
//   'category'      → [{ key, main, name, total, items }]
//   'week'          → [{ key, label, total, items }]
//   'categoryWeek'  → [{ key, main, name, total, weeks: [{ key, label, total, items }] }]
// Inside every group the newest entries come first.
export function groupEntries(entries, mode, accessors) {
  if (mode === 'week') return byWeek(entries, accessors.dateOf)
  if (mode === 'category') return byCategory(entries, accessors)
  if (mode === 'categoryWeek') return byCategory(entries, accessors).map((g) => ({ ...g, weeks: byWeek(g.items, accessors.dateOf), items: undefined }))
  return []
}

export const entriesTotal = sum

// What the chip for a clicked time bucket says. `key` is the bucket key
// (a day, a Monday, or YYYY-MM), `label` the chart's own label.
export function bucketChipLabel(period, key, label) {
  if (period === 'week') return parseLocalDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  if (period === 'month') return `${label} · ${formatWeekRange(key)}`
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

// Main categories, sub-categories and lookups for a flat list of
// categories ({ id, name, parent_id }). Mains and subs come out A–Z with
// "Other" / "Others" last (lib/categoryOrder.js), for every picker.
export function categoryTree(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const mainOf = (categoryId) => {
    const c = byId.get(categoryId)
    return c?.parent_id ? byId.get(c.parent_id) || c : c || null
  }
  return {
    mainCategories: sortCategories(categories.filter((c) => !c.parent_id)),
    subsOf: (id) => sortCategories(categories.filter((c) => c.parent_id === id)),
    mainOf,
    // { main, sub } names for an entry's category.
    namesOf: (categoryId) => {
      const c = byId.get(categoryId)
      const main = mainOf(categoryId)
      return { main: main?.name ?? null, sub: c?.parent_id ? c.name : null }
    },
  }
}

// Which main and sub-category a MONEY category id stands for, among
// `mainCategories` and `subsOf` (as categoryTree gives them): { mainId,
// subId } ('' for none). An id that is no longer on offer gives nothing.
export function splitCategory(id, mainCategories, subsOf) {
  if (!id) return { mainId: '', subId: '' }
  if (mainCategories.some((m) => m.id === id)) return { mainId: id, subId: '' }
  const main = mainCategories.find((m) => subsOf(m.id).some((s) => s.id === id))
  return main ? { mainId: main.id, subId: id } : { mainId: '', subId: '' }
}

// A list of expenses with the ones from the same shopping trip together:
// [{ key, entry }] for an expense on its own, [{ key, tripId, items,
// total }] for two or more expenses of one trip, placed where the trip's
// first expense was (so a newest-first list stays newest first). The
// expenses of one order group (plan 9I; `orderGroupOf(expense)` → its
// group id, or null) are put together the same way: [{ key, orderGroupId,
// items, total }].
export function bundleTrips(entries, orderGroupOf = () => null) {
  const parts = []
  const byTrip = new Map()
  for (const e of entries) {
    const orderGroupId = e.trip_id ? null : orderGroupOf(e)
    if (!e.trip_id && !orderGroupId) {
      parts.push({ key: e.id, entry: e })
      continue
    }
    const key = e.trip_id ? `trip:${e.trip_id}` : `order:${orderGroupId}`
    let part = byTrip.get(key)
    if (!part) {
      part = e.trip_id ? { key, tripId: e.trip_id, items: [], total: 0 } : { key, orderGroupId, items: [], total: 0 }
      byTrip.set(key, part)
      parts.push(part)
    }
    part.items.push(e)
    part.total = Math.round((part.total + amountOf(e)) * 100) / 100
  }
  return parts.map((p) => (p.items?.length === 1 ? { key: p.items[0].id, entry: p.items[0] } : p))
}

// The store of a trip as its expenses show it: the one they all share, or
// the trip's own (supabase/021) when they differ or have none.
export function tripShopId(items, trip) {
  const ids = new Set(items.map((e) => e.shop_id ?? null))
  if (ids.size === 1 && [...ids][0]) return [...ids][0]
  return trip?.shop_id ?? null
}

const round2 = (n) => Math.round(n * 100) / 100

// The plain expense list: one group per purchase (SHOP trip, MONEY
// purchase or merged expenses alike, when `tripsOn`), one per order group
// (plan 9I: the expenses of its orders; `orderGroupOf(expense)` → its
// group id, or null), and the other expenses one group per day and main
// category. The group with the most recent expense comes first; inside a
// group the newest first.
//   → [{ key, date, main, items, total, tripId, orderGroupId }]  (main: null for a purchase or an order group)
export function groupPurchases(entries, { mainOf, tripsOn = true, orderGroupOf = () => null }) {
  const dateOf = (e) => e.expense_date
  const map = new Map()
  for (const e of [...entries].sort(newestFirst(dateOf))) {
    const tripId = tripsOn && e.trip_id ? e.trip_id : null
    const orderGroupId = tripId || e.trip_id ? null : orderGroupOf(e)
    const main = tripId || orderGroupId ? null : mainOf(e.category_id)
    const key = tripId ? `trip|${tripId}` : orderGroupId ? `order|${orderGroupId}` : `${e.expense_date}|${main?.id ?? 'none'}`
    if (!map.has(key)) map.set(key, { key, date: e.expense_date, main, items: [], total: 0, tripId, orderGroupId })
    const g = map.get(key)
    g.items.push(e)
    g.total = round2(g.total + amountOf(e))
  }
  return [...map.values()].sort(newestGroupFirst(dateOf, (g) => g.items))
}

// An opened purchase: its expenses by main category, each with a subtotal,
// A–Z with "Other" next to last and "Uncategorized" last. `mainOf(categoryId)` → { id, name } | null.
export function purchaseSections(items, mainOf) {
  const map = new Map()
  for (const e of items) {
    const main = mainOf(e.category_id)
    const key = categoryKeyOf(main)
    if (!map.has(key)) map.set(key, { key, main, name: main?.name || 'Uncategorized', items: [], total: 0 })
    const s = map.get(key)
    s.items.push(e)
    s.total = round2(s.total + amountOf(e))
  }
  return [...map.values()].sort((a, b) => (a.main ? 0 : 1) - (b.main ? 0 : 1) || (a.main ? compareCategories(a.main, b.main) : 0))
}

// With a category filter on, a purchase row shows only that category's
// part: `items` are the expenses shown, `all` every loaded expense of the
// purchase. { total: the part, fullTotal, partial }.
export function purchasePart(items, all) {
  const total = round2(sum(items))
  const fullTotal = round2(sum(all.length ? all : items))
  return { total, fullTotal, partial: fullTotal !== total }
}
