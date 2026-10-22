import { describe, expect, it } from 'vitest'
import { applyChartFilters, categoryTree, formatWeekRange, groupEntries, groupPurchases, purchasePart, purchaseSections, splitCategory } from './moneyList'

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
  it('by category: subtotals, the category with the newest entry first, newest entries first inside', () => {
    const g = groupEntries(entries, 'category', acc)
    expect(g.map((x) => [x.name, x.total])).toEqual([['Uncategorized', 7], ['Going out', 5], ['Groceries', 33]])
    expect(g[2].items.map((e) => e.id)).toEqual(['e', 'b', 'a'])
  })
  it('by category: on the same day, the category entered last comes first', () => {
    const sameDay = [
      { id: 'x', date: '2026-10-12', category_id: 'food', amount: 50, created_at: '2026-10-12T09:00:00+00:00' },
      { id: 'y', date: '2026-10-12', category_id: 'fun', amount: 5, created_at: '2026-10-12T20:00:00+00:00' },
      { id: 'z', date: '2026-10-12', category_id: 'food', amount: 1, created_at: '2026-10-12T21:00:00+00:00' },
      { id: 'w', date: '2026-10-12', category_id: 'food', amount: 1, created_at: null },
    ]
    const g = groupEntries(sameDay, 'category', acc)
    expect(g.map((x) => x.name)).toEqual(['Groceries', 'Going out'])
    expect(g[0].items.map((e) => e.id)).toEqual(['z', 'x', 'w'])
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
    const groceries = g.find((c) => c.name === 'Groceries')
    expect(groceries.total).toBe(33)
    expect(groceries.weeks.map((w) => [w.key, w.total])).toEqual([['2026-10-05', 23], ['2026-09-28', 10]])
    expect(groceries.weeks[0].items.map((e) => e.id)).toEqual(['e', 'b'])
    expect(g.flatMap((c) => c.weeks).reduce((s, w) => s + w.total, 0)).toBe(45)
  })
  it('formats a week range across a year end', () => {
    expect(formatWeekRange('2026-12-28')).toBe('28 Dec – 3 Jan 2027')
  })
})

describe('shopping trips in the expense list', () => {
  const list = [
    { id: 'a', trip_id: 't1', amount: 2 },
    { id: 'b', trip_id: null, amount: 5 },
    { id: 'c', trip_id: 't1', amount: 3.3 },
    { id: 'd', trip_id: 't2', amount: 1 },
  ]
  it('puts the expenses of one trip together, where its first one was', async () => {
    const { bundleTrips } = await import('./moneyList')
    const parts = bundleTrips(list)
    expect(parts.map((p) => p.key)).toEqual(['trip:t1', 'b', 'd'])
    expect(parts[0]).toMatchObject({ tripId: 't1', total: 5.3 })
    expect(parts[0].items.map((e) => e.id)).toEqual(['a', 'c'])
    // Every expense is still there exactly once, so totals add up the same.
    expect(parts.flatMap((p) => p.items ?? [p.entry]).map((e) => e.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('says the store the trip expenses share, else the trip own store', async () => {
    const { tripShopId } = await import('./moneyList')
    expect(tripShopId([{ shop_id: 's1' }, { shop_id: 's1' }], { shop_id: null })).toBe('s1')
    expect(tripShopId([{ shop_id: 's1' }, { shop_id: null }], { shop_id: 's2' })).toBe('s2')
    expect(tripShopId([{ shop_id: null }], null)).toBeNull()
  })
})

describe('one row per purchase', () => {
  const groceries = { id: 'g', name: 'Groceries' }
  const pets = { id: 'p', name: 'Pets' }
  const mainOfId = (id) => ({ g: groceries, 'g:bread': groceries, p: pets })[id] ?? null
  const x = (id, patch) => ({ id, expense_date: '2026-10-14', amount: 1, category_id: 'g', created_at: '2026-10-14T10:00:00Z', ...patch })
  const list = [
    x('bread', { trip_id: 't1', category_id: 'g:bread', amount: 2.5 }),
    x('cat', { trip_id: 't1', category_id: 'p', amount: 20 }),
    x('milk', { amount: 1.2, created_at: '2026-10-14T09:00:00Z' }),
    x('beer', { expense_date: '2026-10-13', amount: 4 }),
  ]

  it('a purchase is one group, whatever its categories; other expenses by day and main category', () => {
    const groups = groupPurchases(list, { mainOf: mainOfId })
    expect(groups.map((g) => [g.key, g.total, g.items.map((i) => i.id)])).toEqual([
      ['trip|t1', 22.5, ['bread', 'cat']],
      ['2026-10-14|g', 1.2, ['milk']],
      ['2026-10-13|g', 4, ['beer']],
    ])
  })

  it('before supabase/021 a purchase is split per category as plain expenses', () => {
    expect(groupPurchases(list, { mainOf: mainOfId, tripsOn: false }).map((g) => g.key)).toEqual(['2026-10-14|g', '2026-10-14|p', '2026-10-13|g'])
  })

  it('opened: by main category, A–Z, with a subtotal each (Uncategorized last)', () => {
    const sections = purchaseSections([...list.slice(0, 2), x('x', { category_id: null, amount: 3 })], mainOfId)
    expect(sections.map((s) => [s.name, s.total, s.items.map((i) => i.id)])).toEqual([
      ['Groceries', 2.5, ['bread']],
      ['Pets', 20, ['cat']],
      ['Uncategorized', 3, ['x']],
    ])
  })

  it('opened: "Other" comes after the other categories, before Uncategorized', () => {
    const other = { id: 'o', name: 'Other' }
    const bank = { id: 'b', name: 'Bank & Fee' }
    const mainOf = (id) => ({ g: groceries, o: other, b: bank })[id] ?? null
    const sections = purchaseSections([x('1', { category_id: 'o' }), x('2', { category_id: null }), x('3', { category_id: 'g' }), x('4', { category_id: 'b' })], mainOf)
    expect(sections.map((s) => s.name)).toEqual(['Bank & Fee', 'Groceries', 'Other', 'Uncategorized'])
  })

  it('with a category filter on, only that part, "of total" the whole purchase', () => {
    expect(purchasePart([list[1]], list.slice(0, 2))).toEqual({ total: 20, fullTotal: 22.5, partial: true })
    expect(purchasePart(list.slice(0, 2), list.slice(0, 2))).toEqual({ total: 22.5, fullTotal: 22.5, partial: false })
  })
})

describe('categoryTree (every MONEY and Income picker)', () => {
  it('gives mains A–Z with "Other" last, and subs A–Z with "Others" last', () => {
    const tree = categoryTree([
      { id: 'o', name: 'Other', parent_id: null },
      { id: 't', name: 'Trips & Holidays', parent_id: null },
      { id: 'g', name: 'Groceries', parent_id: null },
      { id: 's', name: 'Shopping', parent_id: null },
      { id: 's3', name: 'Others', parent_id: 's' },
      { id: 's1', name: 'Gifts', parent_id: 's' },
      { id: 's2', name: 'Clothing', parent_id: 's' },
    ])
    expect(tree.mainCategories.map((c) => c.name)).toEqual(['Groceries', 'Shopping', 'Trips & Holidays', 'Other'])
    expect(tree.subsOf('s').map((c) => c.name)).toEqual(['Clothing', 'Gifts', 'Others'])
    expect(tree.namesOf('s1')).toEqual({ main: 'Shopping', sub: 'Gifts' })
  })
})

describe('splitCategory (the two MONEY category selects)', () => {
  const { mainCategories, subsOf } = categoryTree([
    { id: 'trips', name: 'Trips & Holidays', parent_id: null },
    { id: 'flights', name: 'Flights', parent_id: 'trips' },
    { id: 'family', name: 'Family Support', parent_id: null },
    { id: 'orphan', name: 'Orphan', parent_id: 'gone' },
  ])

  it('a sub gives its main and itself; a main gives itself and no sub', () => {
    expect(splitCategory('flights', mainCategories, subsOf)).toEqual({ mainId: 'trips', subId: 'flights' })
    expect(splitCategory('family', mainCategories, subsOf)).toEqual({ mainId: 'family', subId: '' })
  })

  it('none, or an id no longer on offer, gives nothing', () => {
    for (const id of [null, '', 'deleted', 'orphan']) expect(splitCategory(id, mainCategories, subsOf)).toEqual({ mainId: '', subId: '' })
  })
})
