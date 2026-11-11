// Filtering and grouping the money lists (income and expenses alike).
// Pure, so they can be tested. Every function takes accessors:
//   dateOf(entry)   → 'YYYY-MM-DD'
//   mainOf(entry)   → the entry's main category ({ id, name }) or null

import { parseLocalDate } from './week'
import { bucketKeyForDate } from './expensePeriods'
import { newestFirst, newestGroupFirst } from './recency'
import { compareCategories, sortCategories } from './categoryOrder'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const NO_CATEGORY = 'none'
export const categoryKeyOf = (main) => main?.id ?? NO_CATEGORY

const amountOf = (entry) => Number(entry.amount || 0)
const sum = (entries) => entries.reduce((total, e) => total + amountOf(e), 0)

// The list filters of a section (plan 9O K157): AND between kinds, OR
// inside one kind.
//   categories – main category keys (`categoryKeyOf`); any of them
//   buckets    – TREND bucket keys (the "Sort by period" chips); any of them
//   dates      – { from, to } (YYYY-MM-DD, both included) already checked
//                by `checkDates`, or null
//   store      – expenses only: one store key (`shopKeyOf(entry)`)
// Chips and dates never come together (K154); if they did, both would apply.
export function applyFilters(entries, { categories = [], buckets = [], dates = null, store = null }, { dateOf, mainOf, period, shopKeyOf }) {
  return entries.filter((e) => {
    if (buckets.length && !buckets.includes(bucketKeyForDate(dateOf(e), period))) return false
    if (dates && (dateOf(e) < dates.from || dateOf(e) > dates.to)) return false
    if (categories.length && !categories.includes(categoryKeyOf(mainOf(e)))) return false
    if (store && shopKeyOf?.(e) !== store) return false
    return true
  })
}

// How the list is laid out for the filters on (K157):
//   'plain'    – nothing chosen, only dates, or only the store: as today
//   'category' – any category (with or without a period): a card each
//   'period'   – only period chips: a card per chosen chip
export function listArrangement({ categories = [], buckets = [] }) {
  if (categories.length) return 'category'
  if (buckets.length) return 'period'
  return 'plain'
}

// "03/10" for 2026-10-03.
const dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

// The chip of a "From" / "To" filter: "03/10 – 06/10", or "03/10" for one day.
export function formatDatesChip({ from, to }) {
  return from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`
}

// Whether "From" / "To" can be applied in the period on screen (K155, K156):
//   from, to    – YYYY-MM-DD or '' ("To" empty = that one day)
//   start, end  – the period: start included, end not (YYYY-MM-DD)
//   periodText  – the period as the bar says it ("October 2026")
// → { dates: { from, to } | null, problem: '' | the short line to show }.
// Nothing is applied without a "From", with a date outside the period, or
// with "From" after "To".
export function checkDates({ from, to }, { start, end, periodText }) {
  if (!from) return { dates: null, problem: '' }
  const last = to || from
  const outside = (d) => d < start || d >= end
  if (outside(from) || (to && outside(to))) return { dates: null, problem: `Choose a date in ${periodText}.` }
  if (from > last) return { dates: null, problem: '"From" is after "To".' }
  return { dates: { from, to: last }, problem: '' }
}

// The chips of "Sort by category" (K157): the categories ({ key, name, … };
// key = the main's id, or NO_CATEGORY) A–Z, "Other" next to last and
// "Uncategorized" last.
export function categoryChipOrder(list) {
  const asCategory = (c) => ({ id: c.key, name: c.name })
  return [...list].sort((a, b) => (a.key === NO_CATEGORY) - (b.key === NO_CATEGORY) || compareCategories(asCategory(a), asCategory(b)))
}

// One card per main category ("Uncategorized" for none) with its total;
// the category whose newest entry is most recent first, then the bigger
// total, then A–Z; inside, newest first.
//   → [{ key, main, name, total, items }]
export function groupByCategory(entries, { dateOf, mainOf }) {
  const map = new Map()
  for (const e of [...entries].sort(newestFirst(dateOf))) {
    const main = mainOf(e)
    const key = categoryKeyOf(main)
    if (!map.has(key)) map.set(key, { key, main, name: main?.name || 'Uncategorized', items: [], total: 0 })
    const g = map.get(key)
    g.items.push(e)
    g.total += amountOf(e)
  }
  const newest = newestGroupFirst(dateOf, (g) => g.items)
  return [...map.values()].sort((a, b) => newest(a, b) || b.total - a.total || a.name.localeCompare(b.name))
}

// One card per chosen period chip that has entries, the newest period
// first; inside, newest first. `chosen` are the TREND buckets of the chips
// on ({ key, … }, in TREND order); `labelOf(bucket)` gives the card title.
//   → [{ key, label, total, items }]
export function groupByBucket(entries, chosen, { dateOf, period, labelOf }) {
  const sorted = [...entries].sort(newestFirst(dateOf))
  return [...chosen]
    .reverse()
    .map((b) => {
      const items = sorted.filter((e) => bucketKeyForDate(dateOf(e), period) === b.key)
      return { key: b.key, label: labelOf(b), items, total: sum(items) }
    })
    .filter((g) => g.items.length)
}

export const entriesTotal = sum

// The days of a week of a month (plan 9O, K153): "2–8 Nov", or "30 Nov"
// for a week of one day. `first` and `last` (YYYY-MM-DD) are in one month.
export function formatMonthWeek(first, last) {
  const a = parseLocalDate(first)
  const b = parseLocalDate(last)
  const month = MONTHS[b.getMonth()]
  return first === last ? `${b.getDate()} ${month}` : `${a.getDate()}–${b.getDate()} ${month}`
}

// What the chip for a clicked time bucket says. `bucket` is the chart's
// bucket ({ key, label }, and for a Month its `first` and `last` day):
// a day ("Mon 5 Oct"), a week of the month ("Week 2 · 2–8 Nov",
// "Week 6 · 30 Nov") or a month ("Oct 2026").
export function bucketChipLabel(period, bucket) {
  const { key, label } = bucket
  if (period === 'week') return parseLocalDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  if (period === 'month') return `${label} · ${formatMonthWeek(bucket.first, bucket.last)}`
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
