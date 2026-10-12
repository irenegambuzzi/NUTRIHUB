import { Pencil, Trash2 } from 'lucide-react'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { ShopTag } from '../ui/ShopIcon'
import { parseLocalDate } from '../../lib/week'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const dateLabel = (date) => parseLocalDate(date).toLocaleDateString('en-GB')

const iconButton = 'text-[var(--color-icon-muted)] transition w-9 h-9 flex items-center justify-center'

// One expense or income entry inside a sorted group: what it is, when,
// who, and the amount.
function Row({ title, detail, amount, tone, before, actions }) {
  return (
    <div className="flex justify-between items-center gap-2 py-1.5 border-t first:border-t-0 border-[var(--color-border)]">
      <div className="min-w-0">
        <p className="text-[var(--color-text)] truncate">{title}</p>
        <span className="text-[10px] text-[var(--color-text-muted)] block truncate">{detail}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {before}
        <span className={`font-mono ${tone}`}>{amount}</span>
        {actions}
      </div>
    </div>
  )
}

// `names(categoryId)` → { main, sub } category names; `shopOf(shopId)` →
// the store (shown next to the category), or nothing.
// The edit button sits before the amount and the delete button after it,
// so a tap meant for one doesn't land on the other.
export function ExpenseRow({ expense, names, shopOf, onEdit, onDelete }) {
  const { main, sub } = names(expense.category_id)
  const shop = shopOf?.(expense.shop_id)
  const parts = [dateLabel(expense.expense_date), sub && main ? `${main} › ${sub}` : null, shop ? <ShopTag key="shop" shop={shop} /> : null, paidByLabel(expense.paid_by)].filter(Boolean)
  return (
    <Row
      title={expense.description || sub || main || 'Expense'}
      detail={parts.flatMap((part, i) => (i ? [' · ', part] : [part]))}
      amount={`€${Number(expense.amount).toFixed(2)}`}
      tone="text-[var(--color-text-soft)]"
      before={
        <button onClick={() => onEdit(expense)} className={`${iconButton} mr-1 hover:text-[var(--color-primary)]`} title="Edit expense" aria-label="Edit expense">
          <Pencil size={13} />
        </button>
      }
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
