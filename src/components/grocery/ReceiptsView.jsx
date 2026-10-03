import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { deleteExpenses, useCategoryExpenses, useExpenseCategories } from '../../hooks/useExpenses'
import { groupByDate } from '../../lib/grocery'
import { parseLocalDate } from '../../lib/week'

// Every checked-off grocery item logs a "Groceries" expense; a receipt
// is one day's worth. Loaded only when this view is open.
export function ReceiptsView() {
  const { categories } = useExpenseCategories()
  const groceriesId = categories.find((c) => c.name === 'Groceries' && !c.parent_id)?.id
  const { expenses, loaded } = useCategoryExpenses(groceriesId)
  const receipts = useMemo(() => groupByDate(expenses), [expenses])

  if (!loaded) {
    return <p className="text-xs text-[var(--color-text-muted)] text-center py-6">Loading receipts…</p>
  }

  if (receipts.length === 0) {
    return (
      <Card className="text-center rounded-3xl">
        <p className="text-xs text-[var(--color-text-muted)]">No receipts yet — they appear here as you check off priced items.</p>
      </Card>
    )
  }

  const handleDelete = (date, list) =>
    deleteExpenses(
      list.map((e) => e.id),
      `Receipt from ${parseLocalDate(date).toLocaleDateString('en-GB')} deleted`
    )

  return (
    <div className="space-y-3">
      {receipts.map(({ date, list, total }) => (
        <Card key={date} className="rounded-3xl">
          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 mb-2">
            <span className="text-xs font-bold text-[var(--color-text)]">
              {parseLocalDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
              <button onClick={() => handleDelete(date, list)} className="text-[var(--color-icon-muted)] hover:text-red-400 transition">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {list.map((e) => (
              <div key={e.id} className="flex justify-between text-xs text-[var(--color-text-soft)]">
                <span>{e.description || 'Item'}</span>
                <span className="font-mono">€{Number(e.amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
