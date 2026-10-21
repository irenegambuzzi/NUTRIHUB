import { useState } from 'react'
import { ChevronDown, Pencil, ShoppingCart, Store, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { ShopTag } from '../ui/ShopIcon'
import { parseLocalDate } from '../../lib/week'
import { purchaseCouponNote } from '../../lib/discounts'

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

// The expenses of one purchase (SHOP, MONEY or merged) inside a sorted
// group: one line ("Conad · 16/10 · 3 items"), opened to see and edit each
// expense, with the store changeable for the whole purchase. `fullTotal`:
// the whole purchase, when the group shows only a part of it.
export function TripRow({ part, trip, shop, renderEntry, onChangeTripStore, fullTotal = null }) {
  const [open, setOpen] = useState(false)
  const date = trip?.trip_date ?? part.items[0].expense_date
  const payers = [...new Set(part.items.map((e) => paidByLabel(e.paid_by)))]
  return (
    <div className="border-t first:border-t-0 border-[var(--color-border)]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex justify-between items-center gap-2 py-1.5 text-left">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[var(--color-text)] min-w-0">
            <ShoppingCart size={11} className="shrink-0 text-[var(--color-primary)]" />
            <span className="truncate">
              {shop?.name ?? 'Purchase'} · {dateLabel(date).slice(0, 5)} · {part.items.length} items
            </span>
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
            {dateLabel(date)} · {payers.join(', ')}
            {purchaseCouponNote(trip) && ` · ${purchaseCouponNote(trip)}`}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-right">
            <span className="font-mono text-[var(--color-text-soft)] block">€{part.total.toFixed(2)}</span>
            {fullTotal != null && Math.abs(fullTotal - part.total) > 0.004 && <span className="text-[10px] text-[var(--color-text-muted)] block">of total €{fullTotal.toFixed(2)}</span>}
          </span>
          <ChevronDown size={13} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div className="pl-2 mb-1.5 border-l-2 border-[var(--color-border)]">
          {part.items.map(renderEntry)}
          {trip && onChangeTripStore && (
            <button type="button" onClick={() => onChangeTripStore(trip)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
              <Store size={12} /> Change the store of the whole purchase
            </button>
          )}
        </div>
      )}
    </div>
  )
}
