import { Card } from '../ui/Card'
import { cn } from '../../lib/cn'
import { personLabel } from '../../lib/personFilter'

const money = (n) => `${n < 0 ? '−' : ''}€${Math.abs(n).toFixed(2)}`

// Income, expenses and what's left (or overspent) in the period.
// A figure that follows a person selection says whose it is.
// `expensesNote`: a small line under "Expenses · {label}" (plan 9K: the
// Shared expenses without parts that a person's total leaves out), or '';
// across the whole card, as a tile is too narrow for it on a phone.
export function MoneySummary({ income, expenses, incomePerson = 'all', expensesPerson = 'all', expensesNote = '' }) {
  // In cents, so a balance that shows as €0.00 is exactly 0 (no sign, no colour).
  const balance = Math.round((income - expenses) * 100) / 100
  // Money colours (plan 9O K181): in / plus green, minus red, €0.00
  // neutral; EXPENSES stays orange.
  const balanceTone = balance > 0 ? 'text-[var(--color-money-in)]' : balance < 0 ? 'text-[var(--color-money-out)]' : 'text-[var(--color-text)]'
  const tiles = [
    { label: 'Income', who: incomePerson, value: money(income), tone: 'text-[var(--color-money-in)]' },
    { label: 'Expenses', who: expensesPerson, value: money(expenses), tone: 'text-[var(--color-accent)]' },
    { label: 'Balance', value: `${balance > 0 ? '+' : ''}${money(balance)}`, tone: balanceTone },
  ]
  return (
    <Card className="grid grid-cols-3 gap-2 text-center p-3">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{t.label}
            {t.who && t.who !== 'all' && <span className="ml-1 normal-case tracking-normal text-[var(--color-primary)]">· {personLabel(t.who)}</span>}
          </p>
          <p className={cn('text-sm font-mono font-bold truncate', t.tone)}>{t.value}</p>
        </div>
      ))}
      {expensesNote && <p className="col-span-3 text-[10px] leading-snug text-[var(--color-text-muted)] break-words">{expensesNote}</p>}
    </Card>
  )
}
