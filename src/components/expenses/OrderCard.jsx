import { Check, ChevronDown, ExternalLink, Link2, Pencil, Trash2, Undo2, X } from 'lucide-react'
import { ShopTag } from '../ui/ShopIcon'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { ORDER_STATUS, agoLabel, orderAmountLabel, expectedLabel, expenseOutcomeLabel, normalizeUrl, orderDiscount, orderState } from '../../lib/orders'
import { orderPackLabel } from '../../lib/packSize'
import { parseLocalDate } from '../../lib/week'
import { cn } from '../../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const dateLabel = (date) => parseLocalDate(date).toLocaleDateString('en-GB')
const iconButton = 'text-[var(--color-icon-muted)] transition w-9 h-9 flex items-center justify-center rounded-xl border border-[var(--color-border)]'

const TONE = {
  overdue: 'text-red-400',
  today: 'text-amber-300',
  soon: 'text-amber-300',
  later: 'text-[var(--color-text-soft)]',
  nodate: 'text-[var(--color-text-muted)]',
}

// One order. On the way it shows how long ago it was ordered and when it
// is expected (overdue ones are red), with the Arrived and Cancelled /
// Returned buttons. Tapping the top opens its details. In the history
// (arrived, cancelled or returned) it shows the status, the day of it and,
// for cancelled and returned ones, whether the expense was kept or deleted,
// and it can go back on the way.
// `linkedItem`: the HOME item (or group) it was ordered for from the SHOP
// list, shown as a tag; Arrived then adds its stock.
export function OrderCard({ order, shop, names, today, open, highlighted, onToggle, onArrived, onCancelled, onBackOnTheWay, onEdit, onDelete, linkedItem = null }) {
  const onTheWay = order.status === 'on_the_way'
  const state = onTheWay ? orderState(order, today) : null
  const overdue = state === 'overdue'
  const { main, sub } = names(order.category_id)
  const link = normalizeUrl(order.order_url)
  const discount = orderDiscount(order)

  return (
    <div
      id={`order-${order.id}`}
      className={cn(
        'rounded-2xl border shadow-sm text-xs overflow-hidden transition-shadow',
        overdue ? 'border-red-400/60 bg-red-500/10' : 'border-[var(--color-border)] bg-[var(--color-surface)]',
        highlighted && 'ring-2 ring-[var(--color-primary)]',
        !onTheWay && 'opacity-90'
      )}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full p-3 flex justify-between items-start gap-3 text-left">
        <div className="min-w-0">
          <p className="font-bold text-[var(--color-text)] break-words">{order.item_name}</p>
          <span className="text-[10px] text-[var(--color-text-muted)] block">
            {shop && (
              <>
                <ShopTag shop={shop} />
                {' · '}
              </>
            )}
            ordered {agoLabel(order.order_date, today)}
          </span>
          {linkedItem && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-[var(--color-accent)]">
              <Link2 size={10} /> HOME: {linkedItem.name}
              {orderPackLabel(order, linkedItem.unit) ? ` · ${orderPackLabel(order, linkedItem.unit)}` : Number(order.quantity) > 0 ? ` · ${Number(order.quantity)} ${order.unit ?? ''}` : ''}
            </span>
          )}
          {onTheWay ? (
            <span className={cn('text-[11px] font-bold block mt-0.5', TONE[state])}>
              {overdue && <span className="mr-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] uppercase">Overdue</span>}
              {expectedLabel(order, today)}
            </span>
          ) : (
            <span className="text-[11px] font-bold block mt-0.5 text-[var(--color-text-soft)]">
              {ORDER_STATUS[order.status]}
              {order.arrived_date ? ` · ${dateLabel(order.arrived_date)}` : ''}
              {expenseOutcomeLabel(order) && <span className="font-normal text-[var(--color-text-muted)]"> · {expenseOutcomeLabel(order)}</span>}
            </span>
          )}
          {discount && <span className="text-[11px] font-bold block mt-0.5 text-emerald-300 break-words">{discount.label}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-right">
            <span className="font-mono font-bold text-[var(--color-accent)] block">{orderAmountLabel(order)}</span>
            {discount && <span className="font-mono text-[10px] text-[var(--color-text-muted)] line-through block">€{discount.list.toFixed(2)}</span>}
          </span>
          <ChevronDown size={14} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <dl className="px-3 pb-2 space-y-1 text-[11px] border-t border-[var(--color-border)] pt-2">
          {order.details && <p className="text-[var(--color-text)] whitespace-pre-wrap break-words">{order.details}</p>}
          <p className="text-[var(--color-text-muted)]">
            Ordered {dateLabel(order.order_date)} · paid by {paidByLabel(order.paid_by)}
            {main ? ` · ${sub ? `${main} › ${sub}` : main}` : ''}
          </p>
          {order.expected_date && (
            <p className="text-[var(--color-text-muted)]">
              Expected {dateLabel(order.expected_date)}
              {order.expected_until ? ` – ${dateLabel(order.expected_until)}` : ''}
            </p>
          )}
          {!order.expense_id && <p className="text-[var(--color-text-muted)]">No expense is linked to this order.</p>}
          {linkedItem && (
            <p className="text-[var(--color-text-muted)]">
              Ordered from the SHOP list for "{linkedItem.name}" in HOME: Arrived adds it to the stock.
              {order.status === 'arrived' && Number(order.stock_added) > 0 ? ` Added ${Number(order.stock_added)} ${linkedItem.unit} when it arrived.` : ''}
            </p>
          )}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-[var(--color-accent)] break-all">
              <ExternalLink size={11} /> Open the order page
            </a>
          )}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
        {onTheWay ? (
          <>
            <button
              type="button"
              onClick={() => onArrived(order)}
              className="flex-1 min-w-[6.5rem] min-h-9 px-3 rounded-xl bg-[var(--color-primary)] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Check size={14} /> Arrived
            </button>
            <button
              type="button"
              onClick={() => onCancelled(order)}
              title="Mark as cancelled or returned"
              className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text-muted)] inline-flex items-center justify-center gap-1.5"
            >
              <X size={13} /> Cancel / Return
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onBackOnTheWay(order)}
            className="flex-1 min-w-[6.5rem] min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text-muted)] inline-flex items-center justify-center gap-1.5"
          >
            <Undo2 size={13} /> Back on the way
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => onEdit(order)} className={`${iconButton} hover:text-[var(--color-primary)]`} title="Edit order" aria-label={`Edit ${order.item_name}`}>
            <Pencil size={13} />
          </button>
          <button type="button" onClick={() => onDelete(order)} className={`${iconButton} hover:text-red-400`} title="Delete order" aria-label={`Delete ${order.item_name}`}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>
    </div>
  )
}
