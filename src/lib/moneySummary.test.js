import { describe, expect, it } from 'vitest'
import { categoryTotals, formatShare, sumAmounts } from './moneySummary'
import { formatPeriodRange, getPeriodBuckets, getPeriodRange, isInPeriod } from './expensePeriods'
import { localDateString } from './week'

const food = { id: 'food', name: 'Groceries' }
const fun = { id: 'fun', name: 'Going out' }
const mainOf = (id) => ({ food, 'food-sub': food, fun })[id] ?? null

describe('category totals', () => {
  const expenses = [
    { category_id: 'food', amount: '40.50' },
    { category_id: 'food-sub', amount: 9.5 },
    { category_id: 'fun', amount: 25 },
    { category_id: null, amount: 25 },
  ]

  it('adds sub-categories to their main, sorts high to low and gives each share', () => {
    const totals = categoryTotals(expenses, mainOf)
    expect(totals.map((c) => [c.name, c.total])).toEqual([['Groceries', 50], ['Going out', 25], ['Uncategorized', 25]])
    expect(totals.map((c) => c.share)).toEqual([50, 25, 25])
    expect(sumAmounts(expenses)).toBe(100)
  })

  it('totals match the plain sum, and categories without spending are hidden', () => {
    const totals = categoryTotals([...expenses, { category_id: 'fun', amount: 0 }], mainOf)
    expect(totals.reduce((s, c) => s + c.total, 0)).toBe(sumAmounts(expenses))
    expect(categoryTotals([], mainOf)).toEqual([])
  })

  it('formats shares', () => {
    expect(formatShare(49.6)).toBe('50%')
    expect(formatShare(0.2)).toBe('<1%')
  })
})

describe('periods', () => {
  const now = new Date(2026, 9, 10) // Saturday 10 Oct 2026
  const range = (p, o = 0) => {
    const { start, end } = getPeriodRange(p, now, o)
    return [localDateString(start), localDateString(end)]
  }

  it('current periods are what they were before (week from Monday, month, year)', () => {
    expect(range('week')).toEqual(['2026-10-05', '2026-10-12'])
    expect(range('month')).toEqual(['2026-10-01', '2026-11-01'])
    expect(range('year')).toEqual(['2026-01-01', '2027-01-01'])
  })

  it('3 and 6 months are the last calendar months including the current one', () => {
    expect(range('3months')).toEqual(['2026-08-01', '2026-11-01'])
    expect(range('6months')).toEqual(['2026-05-01', '2026-11-01'])
  })

  it('arrows move back a whole period, across year ends', () => {
    expect(range('week', -1)).toEqual(['2026-09-28', '2026-10-05'])
    expect(range('month', -1)).toEqual(['2026-09-01', '2026-10-01'])
    expect(range('3months', -1)).toEqual(['2026-05-01', '2026-08-01'])
    expect(range('6months', -2)).toEqual(['2025-05-01', '2025-11-01'])
    expect(range('year', -1)).toEqual(['2025-01-01', '2026-01-01'])
    expect(range('month', -10)).toEqual(['2025-12-01', '2026-01-01'])
  })

  it('isInPeriod agrees with the range', () => {
    expect(isInPeriod('2026-08-01', '3months', now)).toBe(true)
    expect(isInPeriod('2026-07-31', '3months', now)).toBe(false)
    expect(isInPeriod('2026-07-31', '3months', now, -1)).toBe(true)
  })

  it('shows the dates on screen', () => {
    expect(formatPeriodRange('week', now)).toBe('5 Oct – 11 Oct 2026')
    expect(formatPeriodRange('week', now, -2)).toBe('21 Sep – 27 Sep 2026')
    expect(formatPeriodRange('month', now, -1)).toBe('September 2026')
    expect(formatPeriodRange('3months', now)).toBe('Aug – Oct 2026')
    expect(formatPeriodRange('6months', now, -1)).toBe('Nov 2025 – Apr 2026')
    expect(formatPeriodRange('year', now)).toBe('2026')
  })

  it('chart buckets cover each period', () => {
    expect(getPeriodBuckets('3months', now).map((b) => b.key)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(getPeriodBuckets('6months', now, -1).map((b) => b.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'])
    expect(getPeriodBuckets('year', now)).toHaveLength(12)
    expect(getPeriodBuckets('week', now, -1)[0].key).toBe('2026-09-28')
  })
})
