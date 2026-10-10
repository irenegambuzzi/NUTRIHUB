import { Card } from '../ui/Card'
import { cn } from '../../lib/cn'

const money = (n) => `${n < 0 ? '−' : ''}€${Math.abs(n).toFixed(2)}`

// Income, expenses and what's left (or overspent) in the period.
export function MoneySummary({ income, expenses }) {
  const difference = income - expenses
  const tiles = [
    { label: 'Income', value: money(income), tone: 'text-[#7FDB92]' },
    { label: 'Expenses', value: money(expenses), tone: 'text-[var(--color-accent)]' },
    { label: 'Difference', value: `${difference > 0 ? '+' : ''}${money(difference)}`, tone: difference < 0 ? 'text-rose-300' : 'text-[var(--color-text)]' },
  ]
  return (
    <Card className="grid grid-cols-3 gap-2 text-center p-3">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{t.label}</p>
          <p className={cn('text-sm font-mono font-bold truncate', t.tone)}>{t.value}</p>
        </div>
      ))}
    </Card>
  )
}
