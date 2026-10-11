import { Pencil, Trash2 } from 'lucide-react'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { parseLocalDate } from '../../lib/week'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const dateLabel = (date) => parseLocalDate(date).toLocaleDateString('en-GB')

const iconButton = 'text-[var(--color-icon-muted)] transition w-9 h-9 flex items-center justify-center'

// One expense or income entry inside a sorted group: what it is, when,
// who, and the amount.
function Row({ title, detail, amount, tone, actions }) {
  return (
    <div className="flex justify-between items-center gap-2 py-1.5 border-t first:border-t-0 border-[var(--color-border)]">
      <div className="min-w-0">
        <p className="text-[var(--color-text)] truncate">{title}</p>
        <span className="text-[10px] text-[var(--color-text-muted)] block truncate">{detail}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`font-mono ${tone}`}>{amount}</span>
        {actions}
      </div>
    </div>
  )
}

// `names(categoryId)` → { main, sub } category names.
export function ExpenseRow({ expense, names, onDelete }) {
  const { main, sub } = names(expense.category_id)
  return (
    <Row
      title={expense.description || sub || main || 'Expense'}
      detail={[dateLabel(expense.expense_date), sub && main ? `${main} › ${sub}` : null, paidByLabel(expense.paid_by)].filter(Boolean).join(' · ')}
      amount={`€${Number(expense.amount).toFixed(2)}`}
      tone="text-[var(--color-text-soft)]"
      actions={
        <button onClick={() => onDelete(expense)} className={`${iconButton} hover:text-red-400`} title="Delete expense" aria-label="Delete expense">
          <Trash2 size={13} />
        </button>
      }
    />
  )
}

export function IncomeRow({ entry, names, onEdit, onDelete }) {
  const { main, sub } = names(entry.category_id)
  return (
    <Row
      title={entry.source || sub || main || 'Income'}
      detail={[dateLabel(entry.income_date), sub && main ? `${main} › ${sub}` : main, paidByLabel(entry.received_by)].filter(Boolean).join(' · ')}
      amount={`+€${Number(entry.amount).toFixed(2)}`}
      tone="font-bold text-[#7FDB92]"
      actions={
        <>
          <button onClick={() => onEdit(entry)} className={`${iconButton} hover:text-[var(--color-primary)]`} title="Edit income" aria-label="Edit income">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(entry.id)} className={`${iconButton} hover:text-red-400`} title="Delete income" aria-label="Delete income">
            <Trash2 size={13} />
          </button>
        </>
      }
    />
  )
}
