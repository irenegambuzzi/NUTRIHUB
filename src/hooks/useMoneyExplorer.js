import { useMemo, useState } from 'react'
import { categoryTotals } from '../lib/moneySummary'
import { onlineSplit, shopKeyFor, shopTotals } from '../lib/shops'
import { applyFilters, bucketChipLabel, categoryChipOrder, checkDates, groupByBucket, groupByCategory, listArrangement } from '../lib/moneyList'
import { bucketKeyForDate, formatPeriodRange, getPeriodBuckets, getPeriodRange, localDateString } from '../lib/expensePeriods'

const toggled = (list, key) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

// The one filter state of a money section (income or expenses) for the
// period on screen (plan 9O K157b), shared by its charts and their chips
// (above the bars) and the two buttons "Sort by category" / "Sort by
// period" with the list (inside its closed bar):
//   categories – main category keys, several (a pie slice / legend entry
//                toggles one)
//   buckets    – the period chips = the TREND bars, several (a TREND bar
//                toggles one); chips OR dates (K154)
//   from, to   – "From" / "To" (YYYY-MM-DD or ''), applied only when
//                `checkDates` allows them (K155, K156)
//   store      – expenses only, from the "By store" chart (K157d)
// Arguments:
//   entries     – everything in the period (already filtered by person)
//   scope       – the person selection; changing it clears every filter
//   dateOf      – an entry's date
//   categoryOf  – (categoryId) => its main category ({ id, name }) or null
//   shopById    – expenses only: the stores by id (adds "By store" and its
//                 filter); null for income
// The filters only narrow the list: the top card, the K4 note and
// "Totals per category" never follow them.
export function useMoneyExplorer({ entries, dateOf, categoryOf, period, offset, scope, styleFor, shopById = null }) {
  const [categories, setCategories] = useState([])
  const [buckets, setBuckets] = useState([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [store, setStore] = useState(null)
  // Bumped whenever the filters are cleared, so the date fields start empty
  // again even while they hold half a date.
  const [cleared, setCleared] = useState(0)

  const clearFilters = () => {
    setCategories([])
    setBuckets([])
    setFrom('')
    setTo('')
    setStore(null)
    setCleared((n) => n + 1)
  }

  // A new period (or person) starts with no filter at all.
  const periodKey = `${period}|${offset}|${scope ?? ''}`
  const [seenPeriod, setSeenPeriod] = useState(periodKey)
  if (seenPeriod !== periodKey) {
    setSeenPeriod(periodKey)
    clearFilters()
  }

  const trendBuckets = useMemo(() => getPeriodBuckets(period, new Date(), offset), [period, offset])
  const range = useMemo(() => {
    const { start, end } = getPeriodRange(period, new Date(), offset)
    return { start: localDateString(start), end: localDateString(end), periodText: formatPeriodRange(period, new Date(), offset) }
  }, [period, offset])

  const barData = useMemo(() => {
    const sums = new Map(trendBuckets.map((b) => [b.key, 0]))
    for (const e of entries) {
      const key = bucketKeyForDate(dateOf(e), period)
      if (sums.has(key)) sums.set(key, sums.get(key) + Number(e.amount || 0))
    }
    return trendBuckets.map((b) => ({ ...b, amount: Math.round((sums.get(b.key) || 0) * 100) / 100 }))
  }, [entries, trendBuckets, period, dateOf])

  const totals = useMemo(() => categoryTotals(entries, categoryOf), [entries, categoryOf])
  const pieData = useMemo(() => totals.map((c) => ({ key: c.key, name: c.name, value: c.total, hex: styleFor(c.id).hex })), [totals, styleFor])
  // The chips of "Sort by category": the categories of the pie, A–Z.
  const categoryChips = useMemo(() => categoryChipOrder(pieData), [pieData])
  // The chips of "Sort by period": every TREND bar of the period (K175).
  const periodChips = useMemo(() => barData.map((b) => ({ key: b.key, label: bucketChipLabel(period, b) })), [barData, period])

  const shopKeyOf = useMemo(() => (shopById ? shopKeyFor(shopById) : null), [shopById])
  const storeTotals = useMemo(() => (shopById ? shopTotals(entries, shopById) : []), [entries, shopById])
  const storeSplit = useMemo(() => (shopById ? onlineSplit(entries, shopById) : null), [entries, shopById])

  const { dates, problem: datesProblem } = useMemo(() => checkDates({ from, to }, range), [from, to, range])
  const accessors = useMemo(() => ({ dateOf, mainOf: (e) => categoryOf(e.category_id), period, shopKeyOf }), [dateOf, categoryOf, period, shopKeyOf])
  const visible = useMemo(() => applyFilters(entries, { categories, buckets, dates, store }, accessors), [entries, categories, buckets, dates, store, accessors])

  const arrangement = listArrangement({ categories, buckets })
  const groups = useMemo(() => {
    if (arrangement === 'category') return groupByCategory(visible, accessors)
    if (arrangement === 'period') {
      const chosen = trendBuckets.filter((b) => buckets.includes(b.key))
      return groupByBucket(visible, chosen, { dateOf, period, labelOf: (b) => bucketChipLabel(period, b) })
    }
    return []
  }, [arrangement, visible, accessors, trendBuckets, buckets, dateOf, period])

  // Tapping what is on lets it go; anything else turns it on. Each returns
  // whether the tap turned a filter on (K147: then the list's bar opens).
  const toggleCategory = (key) => {
    setCategories((list) => toggled(list, key))
    return !categories.includes(key)
  }
  // A period chip clears the dates (K154).
  const toggleBucket = (key) => {
    setBuckets((list) => toggled(list, key))
    setFrom('')
    setTo('')
    return !buckets.includes(key)
  }
  const toggleStore = (key) => {
    const next = store === key ? null : key
    setStore(next)
    return Boolean(next)
  }
  // A typed (or picked) date clears the period chips (K154).
  const typeDate = (which) => (iso) => {
    ;(which === 'from' ? setFrom : setTo)(iso)
    if (iso) setBuckets([])
  }

  const filtered = categories.length > 0 || buckets.length > 0 || Boolean(dates) || Boolean(store)
  return {
    entries,
    period,
    shopById,
    barData,
    pieData,
    storeTotals,
    storeSplit,
    categoryChips,
    periodChips,
    categories,
    buckets,
    from,
    to,
    dates,
    datesProblem,
    store,
    toggleCategory,
    toggleBucket,
    toggleStore,
    setFrom: typeDate('from'),
    setTo: typeDate('to'),
    clearDates: () => {
      setFrom('')
      setTo('')
      setCleared((n) => n + 1)
    },
    // How many are on, for the closed buttons (K157c; the dates count as 1).
    categoryCount: categories.length,
    periodCount: buckets.length + (dates ? 1 : 0),
    fieldsKey: `${seenPeriod}|${cleared}`,
    visible,
    arrangement,
    groups,
    filtered,
    // The number on the list's closed bar (plan 9O K146): "(6)", or
    // "(3 of 6)" while a filter is on.
    count: filtered ? `(${visible.length} of ${entries.length})` : `(${entries.length})`,
    clearFilters,
    // Starting or leaving "Select" (K149): no filter, as when the list was
    // built again from scratch.
    reset: clearFilters,
  }
}
