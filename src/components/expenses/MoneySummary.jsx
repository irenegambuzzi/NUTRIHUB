import { Card } from '../ui/Card'
import { cn } from '../../lib/cn'
import { personLabel } from '../../lib/personFilter'

const money = (n) => `${n < 0 ? '−' : ''}€${Math.abs(n).toFixed(2)}`
// In cents, so an amount that shows as €0.00 is exactly 0 (no sign, no colour).
const toCents = (n) => Math.round((Number(n) || 0) * 100) / 100
const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`
// Money colours (plan 9O K181): in / plus green, minus red, €0.00
// neutral; EXPENSES stays orange. The same for the leftover numbers.
const toneOf = (n) => (n > 0 ? 'text-[var(--color-money-in)]' : n < 0 ? 'text-[var(--color-money-out)]' : 'text-[var(--color-text)]')

// Income, expenses and what's left (or overspent) in the period.
// A figure that follows a person selection says whose it is.
// `expensesNote`: a small line under "Expenses · {label}" (plan 9K: the
// Shared expenses without parts that a person's total leaves out), or '';
// across the whole card, as a tile is too narrow for it on a phone.
// `leftover` (plan 9O K164–K172, from lib/leftover `leftoverCard`): null,
// or the line "Leftover from {Month YYYY} · +€{x}" above the tiles (with
// the grey breakdown per person for the household); BALANCE then includes
// it and "This month" / "This range" under it gives the period's own
// result. `available`: null, or the thin bar under the tiles "Available
// €{a} · spent {p}%".
export function MoneySummary({ income, expenses, incomePerson = 'all', expensesPerson = 'all', expensesNote = '', leftover = null, available = null }) {
  const result = toCents(income - expenses)
  const balance = leftover ? toCents(leftover.amount + income - expenses) : result
  const tiles = [
    { label: 'Income', who: incomePerson, value: money(income), tone: 'text-[var(--color-money-in)]' },
    { label: 'Expenses', who: expensesPerson, value: money(expenses), tone: 'text-[var(--color-accent)]' },
    { label: 'Balance', value: signed(balance), tone: toneOf(balance) },
  ]
  return (
    <Card className="grid grid-cols-3 gap-2 text-center p-3">
      {leftover && (
        <div className="col-span-3 space-y-0.5">
          <p className="text-xs font-bold text-[var(--color-text)]">
            Leftover from {leftover.month} · <span className="font-mono text-[var(--color-money-in)]">{signed(toCents(leftover.amount))}</span>
          </p>
          {leftover.breakdown && (
            <p className="text-[10px] text-[var(--color-text-muted)] break-words">
              {leftover.breakdown.map((p, i) => (
                <span key={p.code}>
                  {i > 0 && ' · '}
                  {p.label} <span className={cn('font-mono', toneOf(toCents(p.amount)))}>{signed(toCents(p.amount))}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{t.label}
            {t.who && t.who !== 'all' && <span className="ml-1 normal-case tracking-normal text-[var(--color-primary)]">· {personLabel(t.who)}</span>}
          </p>
          <p className={cn('text-sm font-mono font-bold truncate', t.tone)}>{t.value}</p>
          {t.label === 'Balance' && leftover && (
            <p className="text-[10px] text-[var(--color-text-muted)] truncate">
              {leftover.word} <span className={cn('font-mono', toneOf(result))}>{signed(result)}</span>
            </p>
          )}
        </div>
      ))}
      {available && (
        <div className="col-span-3 space-y-1">
          <div
            role="progressbar"
            aria-label="Spent of available"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(available.percent, 100)}
            className="h-1.5 rounded-full bg-[var(--color-surface-soft)] overflow-hidden"
          >
            <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.min(Math.max(available.percent, 0), 100)}%` }} />
          </div>
          <p className={cn('text-[10px] font-mono', available.over ? 'text-[var(--color-money-out)]' : 'text-[var(--color-text-muted)]')}>
            Available {money(available.amount)} · spent {available.percent}%
          </p>
        </div>
      )}
      {expensesNote && <p className="col-span-3 text-[10px] leading-snug text-[var(--color-text-muted)] break-words">{expensesNote}</p>}
    </Card>
  )
}
