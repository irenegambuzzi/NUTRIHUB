import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

// A full-width bar that opens and closes what is under it, like "History
// (N)" in Orders: an icon and a label on the left, an optional value on
// the right (e.g. the € total of "Totals per category"), and an arrow that
// turns while it is open. The parent keeps `open` and shows what the bar
// holds right after it.
export function ClosedBar({ icon: Icon, label, value = null, open, onToggle }) {
  const chevron = <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full min-h-10 px-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex justify-between items-center text-xs font-bold text-[var(--color-text-soft)]"
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon size={14} /> {label}
      </span>
      {value === null ? (
        chevron
      ) : (
        <span className="inline-flex items-center gap-2 shrink-0">
          <span className="font-mono text-[var(--color-accent)]">{value}</span>
          {chevron}
        </span>
      )}
    </button>
  )
}
