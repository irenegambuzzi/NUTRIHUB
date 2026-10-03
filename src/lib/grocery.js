import { PACKAGING_UNITS, PAID_BY_OPTIONS, UNIT_VALUES } from '../data/constants'

// Helpers for the grocery list.

// Packaging units that aren't also regular units (offered separately).
export const EXTRA_PACKAGING_UNITS = PACKAGING_UNITS.filter((u) => !UNIT_VALUES.includes(u))

export const normName = (s) => (s || '').trim().toLowerCase()
export const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || 'Shared'

// Newest day first, with each day's total.
export function groupByDate(expenses) {
  const map = new Map()
  for (const e of expenses) {
    const list = map.get(e.expense_date) || []
    list.push(e)
    map.set(e.expense_date, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, list, total: list.reduce((sum, e) => sum + Number(e.amount || 0), 0) }))
}
