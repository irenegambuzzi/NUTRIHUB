import { PieChart } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatShare } from '../../lib/moneySummary'

// What was spent in each category over the period on screen: biggest
// first, with its share of the total. Categories with nothing spent are
// left out.
export function CategoryTotals({ totals, total, styleFor }) {
  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
          <PieChart size={14} /> Totals per category
        </p>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
      </div>
      {totals.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No expenses in this period.</p>
      ) : (
        <ul className="space-y-3">
          {totals.map((c) => {
            const style = styleFor(c.id)
            return (
              <li key={c.key} className="text-xs">
                <div className="flex justify-between items-baseline gap-3 mb-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: style.hex }} />
                    <span className="font-bold truncate" style={{ color: style.text }}>
                      {c.name}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <span className="font-mono font-bold text-[var(--color-text)]">€{c.total.toFixed(2)}</span>
                    <span className="font-mono text-[var(--color-text-muted)] inline-block w-12 text-right">{formatShare(c.share)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--color-surface-soft)] overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(c.share, 1)}%`, background: style.hex }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
