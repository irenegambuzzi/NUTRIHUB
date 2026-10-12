import { describe, expect, it } from 'vitest'
import { applyChartFilters, formatWeekRange, groupEntries } from './moneyList'

const food = { id: 'food', name: 'Groceries' }
const fun = { id: 'fun', name: 'Going out' }
const mainOf = (e) => ({ food, 'food-sub': food, fun })[e.category_id] ?? null
const dateOf = (e) => e.date
const acc = { dateOf, mainOf }

// 2026-10-05 is a Monday.
const entries = [
  { id: 'a', date: '2026-10-01', category_id: 'food', amount: 10 }, // week of 09-28
  { id: 'b', date: '2026-10-05', category_id: 'food-sub', amount: 20 }, // week of 10-05
  { id: 'c', date: '2026-10-11', category_id: 'fun', amount: 5 }, // Sunday: still the week of 10-05
  { id: 'd', date: '2026-10-12', category_id: null, amount: 7 }, // week of 10-12
  { id: 'e', date: '2026-10-06', category_id: 'food', amount: 3 },
]

describe('chart filters', () => {
  it('keeps only the time bucket clicked', () => {
    const got = applyChartFilters(entries, { bucket: '2026-10-05' }, { ...acc, period: 'month' })
    expect(got.map((e) => e.id)).toEqual(['b', 'c', 'e'])
  })
  it('keeps only the category clicked, sub-categories included', () => {
    expect(applyChartFilters(entries, { category: 'food' }, { ...acc, period: 'month' }).map((e) => e.id)).toEqual(['a', 'b', 'e'])
    expect(applyChartFilters(entries, { category: 'none' }, { ...acc, period: 'month' }).map((e) => e.id)).toEqual(['d'])
  })
  it('combines both, and does nothing without any', () => {
    expect(applyChartFilters(entries, { bucket: '2026-10-05', category: 'food' }, { ...acc, period: 'month' }).map((e) => e.id)).toEqual(['b', 'e'])
    expect(applyChartFilters(entries, {}, { ...acc, period: 'month' })).toHaveLength(5)
  })
  it('works with day buckets (week view) and month buckets', () => {
    expect(applyChartFilters(entries, { bucket: '2026-10-05' }, { ...acc, period: 'week' }).map((e) => e.id)).toEqual(['b'])
    expect(applyChartFilters(entries, { bucket: '2026-10' }, { ...acc, period: 'year' })).toHaveLength(5)
  })
})

describe('store filter', () => {
  const stored = [
    { ...entries[0], shop_id: 'lidl' },
    { ...entries[1], shop_id: 'zalando' },
    { ...entries[2], shop_id: 'lidl' },
    { ...entries[3], shop_id: null },
    { ...entries[4], shop_id: 'lidl' },
  ]
  const shopKeyOf = (e) => e.shop_id ?? 'none'
  const withShops = { ...acc, shopKeyOf, period: 'month' }

  it('keeps only the store clicked, or the expenses with no store', () => {
    expect(applyChartFilters(stored, { store: 'lidl' }, withShops).map((e) => e.id)).toEqual(['a', 'c', 'e'])
    expect(applyChartFilters(stored, { store: 'none' }, withShops).map((e) => e.id)).toEqual(['d'])
  })
  it('combines with the category and the time bucket, exactly like they combine with each other', () => {
    expect(applyChartFilters(stored, { store: 'lidl', category: 'food' }, withShops).map((e) => e.id)).toEqual(['a', 'e'])
    expect(applyChartFilters(stored, { store: 'lidl', category: 'food', bucket: '2026-10-05' }, withShops).map((e) => e.id)).toEqual(['e'])
    expect(applyChartFilters(stored, { store: 'zalando', category: 'fun' }, withShops)).toEqual([])
  })
  it('changes nothing when no store is picked, or the screen has no stores (income)', () => {
    expect(applyChartFilters(stored, { store: null }, withShops)).toHaveLength(5)
    expect(applyChartFilters(entries, { bucket: '2026-10-05', category: 'food' }, { ...acc, period: 'month' }).map((e) => e.id)).toEqual(['b', 'e'])
  })
})

describe('grouping', () => {
  it('by category: subtotals, biggest first, newest entries first inside', () => {
    const g = groupEntries(entries, 'category', acc)
    expect(g.map((x) => [x.name, x.total])).toEqual([['Groceries', 33], ['Uncategorized', 7], ['Going out', 5]])
    expect(g[0].items.map((e) => e.id)).toEqual(['e', 'b', 'a'])
  })
  it('by week (Monday start): date range, subtotal, newest week first', () => {
    const g = groupEntries(entries, 'week', acc)
    expect(g.map((x) => [x.key, x.label, x.total])).toEqual([
      ['2026-10-12', '12 Oct – 18 Oct 2026', 7],
      ['2026-10-05', '5 Oct – 11 Oct 2026', 28],
      ['2026-09-28', '28 Sep – 4 Oct 2026', 10],
    ])
    expect(g[1].items.map((e) => e.id)).toEqual(['c', 'e', 'b'])
  })
  it('category & week: subtotals at both levels, adding up', () => {
    const g = groupEntries(entries, 'categoryWeek', acc)
    const groceries = g[0]
    expect(groceries.total).toBe(33)
    expect(groceries.weeks.map((w) => [w.key, w.total])).toEqual([['2026-10-05', 23], ['2026-09-28', 10]])
    expect(groceries.weeks[0].items.map((e) => e.id)).toEqual(['e', 'b'])
    expect(g.flatMap((c) => c.weeks).reduce((s, w) => s + w.total, 0)).toBe(45)
  })
  it('formats a week range across a year end', () => {
    expect(formatWeekRange('2026-12-28')).toBe('28 Dec – 3 Jan 2027')
  })
})
