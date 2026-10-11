// Filtering and grouping the money lists (income and expenses alike).
// Pure, so they can be tested. Every function takes accessors:
//   dateOf(entry)   → 'YYYY-MM-DD'
//   mainOf(entry)   → the entry's main category ({ id, name }) or null

import { getWeekStart, parseLocalDate } from './week'
import { bucketKeyForDate } from './expensePeriods'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const NO_CATEGORY = 'none'
export const categoryKeyOf = (main) => main?.id ?? NO_CATEGORY

const amountOf = (entry) => Number(entry.amount || 0)
const sum = (entries) => entries.reduce((total, e) => total + amountOf(e), 0)

// Only what the chart clicks picked: a time bucket and/or a category.
export function applyChartFilters(entries, { bucket, category }, { dateOf, mainOf, period }) {
  return entries.filter((e) => {
    if (bucket && bucketKeyForDate(dateOf(e), period) !== bucket) return false
    if (category && categoryKeyOf(mainOf(e)) !== category) return false
    return true
  })
}

// Newest day first; the same day newest added first.
function newestFirst(dateOf) {
  return (a, b) => dateOf(b).localeCompare(dateOf(a)) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
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
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
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
// categories ({ id, name, parent_id }).
export function categoryTree(categories) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const mainOf = (categoryId) => {
    const c = byId.get(categoryId)
    return c?.parent_id ? byId.get(c.parent_id) || c : c || null
  }
  return {
    mainCategories: categories.filter((c) => !c.parent_id),
    subsOf: (id) => categories.filter((c) => c.parent_id === id),
    mainOf,
    // { main, sub } names for an entry's category.
    namesOf: (categoryId) => {
      const c = byId.get(categoryId)
      const main = mainOf(categoryId)
      return { main: main?.name ?? null, sub: c?.parent_id ? c.name : null }
    },
  }
}
