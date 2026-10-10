import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EXPENSE_PERIODS, EXPENSE_PERIOD_LABELS } from '../../data/constants'
import { formatPeriodRange } from '../../lib/expensePeriods'
import { cn } from '../../lib/cn'

// Week / Month / 3 Months / 6 Months / Year, and arrows to the periods
// before (the one after the current can't have anything yet).
export function PeriodPicker({ period, offset, onPeriod, onOffset }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 overflow-x-auto">
        {EXPENSE_PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriod(p)}
            aria-pressed={period === p}
            className={cn(
              'flex-1 whitespace-nowrap px-2.5 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
              period === p ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
            )}
          >
            {EXPENSE_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1">
        <button
          onClick={() => onOffset(offset - 1)}
          aria-label="Previous period"
          className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => onOffset(0)}
          disabled={offset === 0}
          title={offset === 0 ? undefined : 'Back to the current period'}
          className="text-xs font-bold text-[var(--color-text)] px-2 disabled:cursor-default"
        >
          {formatPeriodRange(period, new Date(), offset)}
        </button>
        <button
          onClick={() => onOffset(offset + 1)}
          disabled={offset >= 0}
          aria-label="Next period"
          className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
