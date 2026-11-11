import { X } from 'lucide-react'
import { Card } from '../ui/Card'
import { ShopIcon } from '../ui/ShopIcon'
import { MoneyCharts } from './MoneyCharts'
import { NO_STORE } from '../../lib/shops'
import { bucketChipLabel, entriesTotal } from '../../lib/moneyList'
import { cn } from '../../lib/cn'

const SORTS = [
  { value: 'category', label: 'By category' },
  { value: 'week', label: 'By week' },
  { value: 'categoryWeek', label: 'Category & week' },
]

const chipClasses = 'min-h-10 pl-3 pr-2 rounded-full inline-flex items-center gap-1.5 text-xs font-bold border'

// The two halves of one kind of money (income or expenses) for the period
// on screen, sharing one filter state (`explorer`, from
// hooks/useMoneyExplorer): the charts with the filter chips right under
// them (always visible, plan 9O K148), and "Sort by" with the list (inside
// the section's closed bar).

// The charts, then — only while a chart filter is on — its chips,
// "Clear filters" and "{n} · €{x}" of what the list shows.
//   onPick – called when a chart tap turns a filter on (K147: it opens the
//            list's bar); a tap that lets a filter go calls nothing
//   shopsMissing – stores aren't in the database yet (supabase/019)
export function ExplorerCharts({ explorer, plural, shopsMissing = false, onPick = () => {} }) {
  const { period, barData, pieData, storeTotals, storeSplit, shopById, bucket, category, store, setBucket, setCategory, setStore, visible, filtered, clearFilters } = explorer
  // Tapping what is picked lets it go; anything else picks it.
  const toggle = (current, set) => (key) => {
    const next = current === key ? null : key
    set(next)
    if (next) onPick()
  }
  const bucketOn = barData.find((b) => b.key === bucket)
  const categoryName = pieData.find((c) => c.key === category)?.name
  const categoryHex = pieData.find((c) => c.key === category)?.hex
  const storeShop = store && store !== NO_STORE ? shopById?.get(store) : null
  const storeName = store === NO_STORE ? 'No store' : storeShop?.name ?? 'Store'

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

      {filtered && (
        <div className="flex flex-wrap items-center gap-2">
          {bucket && bucketOn && (
            <button onClick={() => setBucket(null)} aria-label={`Remove filter ${bucketChipLabel(period, bucketOn)}`} className={cn(chipClasses, 'bg-[var(--color-primary)]/15 text-[var(--color-text)] border-[var(--color-primary)]/40')}>
              {bucketChipLabel(period, bucketOn)}
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
          <button onClick={clearFilters} className="min-h-10 px-3 rounded-full text-xs font-bold text-[var(--color-text-muted)] underline underline-offset-2">
            Clear filters
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)] ml-auto font-mono">
            {visible.length} · €{entriesTotal(visible).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

// "Sort by" and the list of what the chart filters leave.
//   renderDefault  – (entries) => the list as it was before sorting
//   renderEntry    – (entry) => one row, for the sorted lists
//   renderEntries  – (entries) => the rows of a sorted group (optional; e.g.
//                    a shopping trip's expenses as one row)
export function ExplorerList({ explorer, plural, styleFor, renderDefault, renderEntry, renderEntries = null }) {
  const { sort, setSort, visible, groups, filtered } = explorer
  const rowsOf = (items) => (renderEntries ? renderEntries(items) : items.map(renderEntry))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
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

