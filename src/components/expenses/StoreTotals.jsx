import { CircleSlash } from 'lucide-react'
import { ShopIcon } from '../ui/ShopIcon'
import { formatShare } from '../../lib/moneySummary'
import { NO_STORE, SHOPS_NOTICE } from '../../lib/shops'
import { cn } from '../../lib/cn'

const money = (value) => `€${Number(value).toFixed(2)}`

// What was spent in each store over the period on screen: biggest first,
// with its share of the total, and how much of it was online, in a
// physical store, or has no store. Tapping a store picks it as a filter
// for the list; tapping it again lets go.
//   totals – shopTotals(...)   split – onlineSplit(...)
export function StoreTotals({ totals, split, missing, selected, onSelect, emptyText }) {
  if (missing) return <p className="text-xs text-yellow-300 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-2.5">{SHOPS_NOTICE}</p>
  if (totals.length === 0) return <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">{emptyText}</p>
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {totals.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onSelect(s.key)}
              aria-pressed={selected === s.key}
              className={cn(
                'w-full min-h-11 px-2 py-1.5 rounded-xl border text-left text-xs transition-all duration-200',
                selected === s.key ? 'border-[var(--color-text-soft)] bg-[var(--color-surface-soft)]' : 'border-transparent',
                selected && selected !== s.key && 'opacity-60'
              )}
            >
              <span className="flex justify-between items-baseline gap-3 mb-1">
                <span className="flex items-center gap-2 min-w-0">
                  {s.key === NO_STORE ? (
                    <CircleSlash size={12} className="shrink-0 text-[var(--color-icon-muted)]" aria-hidden="true" />
                  ) : (
                    <ShopIcon online={s.online} size={12} className="shrink-0 text-[var(--color-text-soft)]" />
                  )}
                  <span className={cn('font-bold truncate', s.key === NO_STORE ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]')}>{s.name}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                    {s.count} {s.count === 1 ? 'expense' : 'expenses'}
                  </span>
                </span>
                <span className="shrink-0">
                  <span className="font-mono font-bold text-[var(--color-text)]">{money(s.total)}</span>
                  <span className="font-mono text-[var(--color-text-muted)] inline-block w-12 text-right">{formatShare(s.share)}</span>
                </span>
              </span>
              <span className="block h-1.5 rounded-full bg-[var(--color-surface-soft)] overflow-hidden" aria-hidden="true">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(s.share, 1)}%`, background: s.key === NO_STORE ? 'var(--color-icon-muted)' : 'var(--color-primary)' }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-text-muted)]" aria-label="Online or in store">
        <span className="inline-flex items-center gap-1.5">
          <ShopIcon online size={12} /> Online <b className="font-mono text-[var(--color-text)]">{money(split.online.total)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShopIcon online={false} size={12} /> In store <b className="font-mono text-[var(--color-text)]">{money(split.inStore.total)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CircleSlash size={12} aria-hidden="true" /> No store <b className="font-mono text-[var(--color-text)]">{money(split.none.total)}</b>
        </span>
      </p>
    </div>
  )
}
