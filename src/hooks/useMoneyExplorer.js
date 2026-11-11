import { useMemo, useState } from 'react'
import { categoryTotals } from '../lib/moneySummary'
import { onlineSplit, shopKeyFor, shopTotals } from '../lib/shops'
import { applyChartFilters, groupEntries } from '../lib/moneyList'
import { bucketKeyForDate, getPeriodBuckets } from '../lib/expensePeriods'

// The one filter state of a money section (income or expenses) for the
// period on screen, shared by its charts (above the bars) and its list
// (inside its closed bar, plan 9O K148): the chart filters (a time bucket,
// a category, a store), "Sort by", and what they give.
//   entries     – everything in the period (already filtered by person)
//   scope       – the person selection; changing it clears the chart filters
//   dateOf      – an entry's date
//   categoryOf  – (categoryId) => its main category ({ id, name }) or null
//   shopById    – expenses only: the stores by id (adds "By store" and its
//                 filter); null for income
// The filters only narrow the list: the top card, the K4 note and
// "Totals per category" never follow them.
export function useMoneyExplorer({ entries, dateOf, categoryOf, period, offset, scope, styleFor, shopById = null }) {
  const [bucket, setBucket] = useState(null)
  const [category, setCategory] = useState(null)
  const [store, setStore] = useState(null)
  const [sort, setSort] = useState(null)

  // A new period (or person) starts with no chart filter (the sort stays).
  const periodKey = `${period}|${offset}|${scope ?? ''}`
  const [seenPeriod, setSeenPeriod] = useState(periodKey)
  if (seenPeriod !== periodKey) {
    setSeenPeriod(periodKey)
    setBucket(null)
    setCategory(null)
    setStore(null)
  }

  const buckets = useMemo(() => getPeriodBuckets(period, new Date(), offset), [period, offset])

  const barData = useMemo(() => {
    const sums = new Map(buckets.map((b) => [b.key, 0]))
    for (const e of entries) {
      const key = bucketKeyForDate(dateOf(e), period)
      if (sums.has(key)) sums.set(key, sums.get(key) + Number(e.amount || 0))
    }
    return buckets.map((b) => ({ ...b, amount: Math.round((sums.get(b.key) || 0) * 100) / 100 }))
  }, [entries, buckets, period, dateOf])

  const totals = useMemo(() => categoryTotals(entries, categoryOf), [entries, categoryOf])
  const pieData = useMemo(() => totals.map((c) => ({ key: c.key, name: c.name, value: c.total, hex: styleFor(c.id).hex })), [totals, styleFor])

  const shopKeyOf = useMemo(() => (shopById ? shopKeyFor(shopById) : null), [shopById])
  const storeTotals = useMemo(() => (shopById ? shopTotals(entries, shopById) : []), [entries, shopById])
  const storeSplit = useMemo(() => (shopById ? onlineSplit(entries, shopById) : null), [entries, shopById])

  const accessors = useMemo(() => ({ dateOf, mainOf: (e) => categoryOf(e.category_id), period, shopKeyOf }), [dateOf, categoryOf, period, shopKeyOf])
  const visible = useMemo(() => applyChartFilters(entries, { bucket, category, store }, accessors), [entries, bucket, category, store, accessors])
  const groups = useMemo(() => (sort ? groupEntries(visible, sort, accessors) : []), [visible, sort, accessors])

  const clearFilters = () => {
    setBucket(null)
    setCategory(null)
    setStore(null)
  }

  const filtered = !!(bucket || category || store)
  return {
    entries,
    period,
    shopById,
    barData,
    pieData,
    storeTotals,
    storeSplit,
    bucket,
    category,
    store,
    setBucket,
    setCategory,
    setStore,
    sort,
    setSort,
    visible,
    groups,
    filtered,
    // The number on the list's closed bar (plan 9O K146): "(6)", or
    // "(3 of 6)" while a chart filter leaves fewer.
    count: filtered ? `(${visible.length} of ${entries.length})` : `(${entries.length})`,
    clearFilters,
    // Leaving "Select" (or starting it): no sort and no chart filter, as
    // when the list was built again from scratch.
    reset: () => {
      clearFilters()
      setSort(null)
    },
  }
}
