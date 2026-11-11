import { useId, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Label } from '../ui/Field'
import { DateField } from '../ui/DateField'
import { ShopIcon } from '../ui/ShopIcon'
import { MoneyCharts } from './MoneyCharts'
import { NO_STORE } from '../../lib/shops'
import { entriesTotal, formatDatesChip } from '../../lib/moneyList'
import { cn } from '../../lib/cn'

const chipClasses = 'min-h-10 pl-3 pr-2 rounded-full inline-flex items-center gap-1.5 text-xs font-bold border'
const periodChipColors = 'bg-[var(--color-primary)]/15 text-[var(--color-text)] border-[var(--color-primary)]/40'

// The two halves of one kind of money (income or expenses) for the period
// on screen, sharing one filter state (`explorer`, from
// hooks/useMoneyExplorer): the charts with the filter chips right under
// them (always visible, plan 9O K148), and the two buttons "Sort by
// category" / "Sort by period" with the list (inside the section's closed
// bar, K157).

// The charts, then — only while a filter is on — a chip for each (the
// period chips, the dates, the categories, the store), "Clear filters" and
// "{n} · €{x}" of what the list shows.
//   onPick – called when a chart tap turns a filter on (K147: it opens the
//            list's bar); a tap that lets a filter go calls nothing (K177)
//   shopsMissing – stores aren't in the database yet (supabase/019)
export function ExplorerCharts({ explorer, plural, shopsMissing = false, onPick = () => {} }) {
  const { barData, pieData, storeTotals, storeSplit, shopById, categoryChips, periodChips, categories, buckets, dates, store, toggleCategory, toggleBucket, toggleStore, clearDates, visible, filtered, clearFilters } = explorer
  const tap = (toggle) => (key) => {
    if (toggle(key)) onPick()
  }
  const storeShop = store && store !== NO_STORE ? shopById?.get(store) : null
  const storeName = store === NO_STORE ? 'No store' : storeShop?.name ?? 'Store'

  return (
    <div className="space-y-4">
      <MoneyCharts
        pieData={pieData}
        barData={barData}
        emptyText={`No ${plural} in this period.`}
        selectedCategories={categories}
        selectedBuckets={buckets}
        onCategory={tap(toggleCategory)}
        onBucket={tap(toggleBucket)}
        stores={shopById ? { missing: shopsMissing, totals: storeTotals, split: storeSplit, selected: store, onSelect: tap(toggleStore) } : null}
      />

      {filtered && (
        <div className="flex flex-wrap items-center gap-2">
          {periodChips
            .filter((c) => buckets.includes(c.key))
            .map((c) => (
              <button key={c.key} onClick={() => toggleBucket(c.key)} aria-label={`Remove filter ${c.label}`} className={cn(chipClasses, periodChipColors)}>
                {c.label}
                <X size={14} />
              </button>
            ))}
          {dates && (
            <button onClick={clearDates} aria-label={`Remove filter ${formatDatesChip(dates)}`} className={cn(chipClasses, periodChipColors)}>
              {formatDatesChip(dates)}
              <X size={14} />
            </button>
          )}
          {categoryChips
            .filter((c) => categories.includes(c.key))
            .map((c) => (
              <button
                key={c.key}
                onClick={() => toggleCategory(c.key)}
                aria-label={`Remove filter ${c.name}`}
                className={cn(chipClasses, 'text-[var(--color-text)]')}
                style={{ background: `${c.hex}26`, borderColor: `${c.hex}66` }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.hex }} />
                {c.name}
                <X size={14} />
              </button>
            ))}
          {store && (
            <button
              onClick={() => toggleStore(store)}
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

// A closed button over its panel: "Sort by category ▾", with " · 2" while
// some of its filters are on (K157c).
function PanelButton({ label, count, open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'min-h-10 px-3 rounded-full border inline-flex items-center gap-1.5 text-xs font-bold transition-all duration-200',
        count ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/40 text-[var(--color-text)]' : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-soft)]'
      )}
    >
      {count ? `${label} · ${count}` : label}
      <ChevronDown size={14} aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}

// A chip in a panel: on / off, several at once.
function PanelChip({ on, onClick, hex = null, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'min-h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold border transition-all duration-200',
        on ? 'text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
        on && !hex && periodChipColors
      )}
      style={on && hex ? { background: `${hex}26`, borderColor: `${hex}66` } : undefined}
    >
      {hex && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hex }} />}
      {children}
    </button>
  )
}

// The two buttons "Sort by category ▾" / "Sort by period ▾" (K157, K158),
// each opening its own panel inline under them (one at a time), then the
// list of what the filters leave, laid out by itself:
//   nothing chosen, only dates (or only the store) → the plain list
//   categories (with or without a period) → one card per category
//   only period chips → one card per chosen chip, the newest first
// Inside a card the newest first; a purchase / order group is one closed
// line (`renderEntries`).
//   renderDefault  – (entries) => the plain list
//   renderEntry    – (entry) => one row, for the cards
//   renderEntries  – (entries) => the rows of a card (optional; e.g. a
//                    shopping trip's expenses as one row)
export function ExplorerList({ explorer, plural, styleFor, renderDefault, renderEntry, renderEntries = null }) {
  const { categoryChips, periodChips, categories, buckets, from, to, datesProblem, toggleCategory, toggleBucket, setFrom, setTo, categoryCount, periodCount, fieldsKey, visible, arrangement, groups, filtered } = explorer
  const [panel, setPanel] = useState(null)
  const fromId = useId()
  const toId = useId()
  const rowsOf = (items) => (renderEntries ? renderEntries(items) : items.map(renderEntry))
  const flip = (name) => () => setPanel((open) => (open === name ? null : name))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <PanelButton label="Sort by category" count={categoryCount} open={panel === 'category'} onToggle={flip('category')} />
          <PanelButton label="Sort by period" count={periodCount} open={panel === 'period'} onToggle={flip('period')} />
        </div>

        {panel === 'category' && (
          <div role="region" aria-label="Sort by category" className="p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {categoryChips.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">No {plural} in this period.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categoryChips.map((c) => (
                  <PanelChip key={c.key} on={categories.includes(c.key)} onClick={() => toggleCategory(c.key)} hex={c.hex}>
                    {c.name}
                  </PanelChip>
                ))}
              </div>
            )}
          </div>
        )}

        {panel === 'period' && (
          <div role="region" aria-label="Sort by period" className="p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3">
            <div className="flex flex-wrap gap-2">
              {periodChips.map((c) => (
                <PanelChip key={c.key} on={buckets.includes(c.key)} onClick={() => toggleBucket(c.key)}>
                  {c.label}
                </PanelChip>
              ))}
            </div>
            <div key={fieldsKey} className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <Label htmlFor={fromId}>From</Label>
                <DateField id={fromId} label="From" value={from} onChange={setFrom} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={toId}>To</Label>
                <DateField id={toId} label="To" value={to} onChange={setTo} />
              </div>
            </div>
            {datesProblem && <p className="text-[11px] text-red-400">{datesProblem}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <Card className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">No {plural} match {filtered ? 'these filters' : 'this filter'}.</p>
          </Card>
        ) : arrangement === 'plain' ? (
          renderDefault(visible)
        ) : (
          groups.map((g) => (
            <div
              key={g.key}
              role="group"
              aria-label={arrangement === 'category' ? g.name : g.label}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden"
            >
              <div className="p-3 flex justify-between items-center gap-3 bg-[var(--color-surface-soft)]">
                <span className="flex items-center gap-2 min-w-0">
                  {arrangement === 'category' && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleFor(g.main?.id).hex }} />}
                  <span className="font-extrabold text-[var(--color-text)] truncate">{arrangement === 'category' ? g.name : g.label}</span>
                </span>
                <span className="font-mono font-bold text-[var(--color-accent)] shrink-0">€{g.total.toFixed(2)}</span>
              </div>
              <div className="px-3 pb-1 border-t border-[var(--color-border)]">{rowsOf(g.items)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
