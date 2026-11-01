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
  const balance = income - expenses
  const tiles = [
    { label: 'Income', who: incomePerson, value: money(income), tone: 'text-[#7FDB92]' },
    { label: 'Expenses', who: expensesPerson, value: money(expenses), tone: 'text-[var(--color-accent)]' },
    { label: 'Balance', value: `${balance > 0 ? '+' : ''}${money(balance)}`, tone: balance < 0 ? 'text-rose-300' : 'text-[var(--color-text)]' },
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
