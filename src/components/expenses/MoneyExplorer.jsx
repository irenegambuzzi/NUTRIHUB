import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Card } from '../ui/Card'
import { ShopIcon } from '../ui/ShopIcon'
import { MoneyCharts } from './MoneyCharts'
import { categoryTotals } from '../../lib/moneySummary'
import { NO_STORE, onlineSplit, shopKeyFor, shopTotals } from '../../lib/shops'
import { applyChartFilters, bucketChipLabel, entriesTotal, groupEntries } from '../../lib/moneyList'
import { getPeriodBuckets, bucketKeyForDate } from '../../lib/expensePeriods'
import { cn } from '../../lib/cn'

const SORTS = [
  { value: 'category', label: 'By category' },
  { value: 'week', label: 'By week' },
  { value: 'categoryWeek', label: 'Category & week' },
]

const chipClasses = 'min-h-10 pl-3 pr-2 rounded-full inline-flex items-center gap-1.5 text-xs font-bold border'

// Charts, chart filters, "Sort by" and the list for one kind of money
// (income or expenses), for the period on screen.
//   entries        – everything in the period (already filtered by person)
//   scope          – the person selection; changing it clears the chart filters
//   dateOf         – an entry's date
//   categoryOf     – (categoryId) => its main category ({ id, name }) or null
//   renderDefault  – (entries) => the list as it was before sorting
//   renderEntry    – (entry) => one row, for the sorted lists
//   renderEntries  – (entries) => the rows of a sorted group (optional; e.g.
//                    a shopping trip's expenses as one row)
//   shopById       – expenses only: the stores by id, which adds the
//                    "By store" view and its filter (null = no stores
//                    here, as for income)
//   shopsMissing   – stores aren't in the database yet (supabase/019)
export function MoneyExplorer({ entries, dateOf, categoryOf, period, offset, scope, styleFor, plural, renderDefault, renderEntry, renderEntries = null, shopById = null, shopsMissing = false }) {
  const rowsOf = (items) => (renderEntries ? renderEntries(items) : items.map(renderEntry))
  const [bucket, setBucket] = useState(null)
  const [category, setCategory] = useState(null)
  const [store, setStore] = useState(null)
  const [sort, setSort] = useState(null)

  // A new period (or person) starts with no chart filter.
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
    return buckets.map((b) => ({ key: b.key, label: b.label, amount: Math.round((sums.get(b.key) || 0) * 100) / 100 }))
  }, [entries, buckets, period, dateOf])

  const totals = useMemo(() => categoryTotals(entries, categoryOf), [entries, categoryOf])
  const pieData = useMemo(() => totals.map((c) => ({ key: c.key, name: c.name, value: c.total, hex: styleFor(c.id).hex })), [totals, styleFor])

  const shopKeyOf = useMemo(() => (shopById ? shopKeyFor(shopById) : null), [shopById])
  const storeTotals = useMemo(() => (shopById ? shopTotals(entries, shopById) : []), [entries, shopById])
  const storeSplit = useMemo(() => (shopById ? onlineSplit(entries, shopById) : null), [entries, shopById])

  const accessors = useMemo(() => ({ dateOf, mainOf: (e) => categoryOf(e.category_id), period, shopKeyOf }), [dateOf, categoryOf, period, shopKeyOf])
  const visible = useMemo(() => applyChartFilters(entries, { bucket, category, store }, accessors), [entries, bucket, category, store, accessors])
  const groups = useMemo(() => (sort ? groupEntries(visible, sort, accessors) : []), [visible, sort, accessors])

  const toggle = (current, set) => (key) => set(current === key ? null : key)
  const bucketLabel = barData.find((b) => b.key === bucket)?.label
  const categoryName = pieData.find((c) => c.key === category)?.name
  const categoryHex = pieData.find((c) => c.key === category)?.hex
  const storeShop = store && store !== NO_STORE ? shopById?.get(store) : null
  const storeName = store === NO_STORE ? 'No store' : storeShop?.name ?? 'Store'
  const filtered = !!(bucket || category || store)

  return (
    <div className="space-y-4">
      <MoneyCharts
        pieData={pieData}
        barData={barData}
        emptyText={`No ${plural} in this period.`}
        selectedCategory={category}
        selectedBucket={bucket}
        onCategory={toggle(category, setCategory)}
        onBucket={toggle(bucket, setBucket)}
        stores={
          shopById ? { missing: shopsMissing, totals: storeTotals, split: storeSplit, selected: store, onSelect: toggle(store, setStore) } : null
        }
      />

      <div className="space-y-2">
        {filtered && (
          <div className="flex flex-wrap items-center gap-2">
            {bucket && (
              <button onClick={() => setBucket(null)} aria-label={`Remove filter ${bucketChipLabel(period, bucket, bucketLabel)}`} className={cn(chipClasses, 'bg-[var(--color-primary)]/15 text-[var(--color-text)] border-[var(--color-primary)]/40')}>
                {bucketChipLabel(period, bucket, bucketLabel)}
                <X size={14} />
              </button>
            )}
            {category && (
              <button
                onClick={() => setCategory(null)}
                aria-label={`Remove filter ${categoryName ?? 'category'}`}
                className={cn(chipClasses, 'text-[var(--color-text)]')}
                style={{ background: `${categoryHex}26`, borderColor: `${categoryHex}66` }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: categoryHex }} />
                {categoryName ?? 'Category'}
                <X size={14} />
              </button>
            )}
            {store && (
              <button
                onClick={() => setStore(null)}
                aria-label={`Remove filter ${storeName}`}
                className={cn(chipClasses, 'bg-[var(--color-surface-soft)] text-[var(--color-text)] border-[var(--color-border)]')}
              >
                {storeShop && <ShopIcon online={storeShop.is_online} size={12} />}
                {storeName}
                <X size={14} />
              </button>
            )}
            <button
              onClick={() => {
                setBucket(null)
                setCategory(null)
                setStore(null)
              }}
              className="min-h-10 px-3 rounded-full text-xs font-bold text-[var(--color-text-muted)] underline underline-offset-2"
            >
              Clear filters
            </button>
            <span className="text-[11px] text-[var(--color-text-muted)] ml-auto font-mono">
              {visible.length} · €{entriesTotal(visible).toFixed(2)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider shrink-0">Sort by</span>
          <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 flex-1 min-w-0">
            {SORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSort(sort === s.value ? null : s.value)}
                aria-pressed={sort === s.value}
                title={sort === s.value ? 'Tap again for the plain list' : undefined}
                className={cn(
                  'flex-1 min-h-9 px-1.5 rounded-full text-[11px] font-bold leading-tight transition-all duration-200',
                  sort === s.value ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {sort && (
          <button onClick={() => setSort(null)} className="min-h-10 px-3 rounded-full text-xs font-bold text-[var(--color-text-muted)] underline underline-offset-2">
            ✕ Clear sort
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <Card className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">No {plural} match {filtered ? 'these filters' : 'this filter'}.</p>
          </Card>
        ) : !sort ? (
          renderDefault(visible)
        ) : (
          groups.map((g) => (
            <div key={g.key} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden">
              <div className="p-3 flex justify-between items-center gap-3 bg-[var(--color-surface-soft)]">
                <span className="flex items-center gap-2 min-w-0">
                  {sort !== 'week' && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleFor(g.main?.id).hex }} />}
                  <span className="font-extrabold text-[var(--color-text)] truncate">{sort === 'week' ? g.label : g.name}</span>
                </span>
                <span className="font-mono font-bold text-[var(--color-accent)] shrink-0">€{g.total.toFixed(2)}</span>
              </div>
              {sort === 'categoryWeek' ? (
                g.weeks.map((w) => (
                  <div key={w.key} className="border-t border-[var(--color-border)]">
                    <p className="flex justify-between gap-3 px-3 pt-2 text-[10px] font-bold uppercase text-[var(--color-text-muted)]">
                      <span>{w.label}</span>
                      <span className="font-mono">€{w.total.toFixed(2)}</span>
                    </p>
                    <div className="px-3 pb-1">{rowsOf(w.items)}</div>
                  </div>
                ))
              ) : (
                <div className="px-3 pb-1 border-t border-[var(--color-border)]">{rowsOf(g.items)}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
