import { Check, Truck, X } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { ShopTag } from '../ui/ShopIcon'
import { expectedLabel, orderDiscount } from '../../lib/orders'
import { formatPurchaseQuantity } from '../../lib/inventory'
import { money } from '../../lib/pricing'
import { cn } from '../../lib/cn'
import { parseLocalDate } from '../../lib/week'

const day = (date) => parseLocalDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// SHOP list entries ordered online and not arrived yet: not "to buy", not
// in the budget, and not added again by low stock. Each shows when it was
// ordered and is expected, with Arrived (adds the stock) and Cancel /
// Return (the entry goes back to "to buy" if still needed).
// `entries`: [{ entry, order, pantry }].
export function OnTheWay({ entries, shopById, today, onArrived, onCancel }) {
  if (entries.length === 0) return null
  return (
    <section className="space-y-2 pt-2" aria-label="On the way">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-border)] pt-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase flex items-center gap-1.5">
          <Truck size={13} /> On the way ({entries.length})
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)]">Ordered online · already in MONEY · not to buy again</p>
      </div>
      {entries.map(({ entry, order, pantry }) => {
        const shop = order.shop_id ? shopById.get(order.shop_id) : null
        const overdue = expectedLabel(order, today).startsWith('overdue')
        const discount = orderDiscount(order)
        return (
          <div key={entry.id} className={cn('rounded-2xl border p-3 text-xs space-y-2', overdue ? 'border-red-400/60 bg-red-500/10' : 'border-[var(--color-border)] bg-[var(--color-surface)]')}>
            <div className="flex items-start gap-2.5">
              <CategoryIcon category={entry.category_id} size={16} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[var(--color-text)] break-words">{entry.name}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {Number(order.quantity) > 0 ? `${formatPurchaseQuantity(Number(order.quantity), order.unit, pantry)} · ` : ''}
                  ordered {day(order.order_date)}
                  {shop && (
                    <>
                      {' · '}
                      <ShopTag shop={shop} />
                    </>
                  )}
                </p>
                <p className={cn('text-[11px] font-bold', overdue ? 'text-red-400' : 'text-amber-300')}>{expectedLabel(order, today)}</p>
                {discount && <p className="text-[11px] font-bold text-emerald-300 break-words">{discount.label}</p>}
              </div>
              <span className="text-right shrink-0">
                <span className="font-mono font-bold text-[var(--color-accent)] block">{money(Number(order.price))}</span>
                {discount && <span className="font-mono text-[10px] text-[var(--color-text-muted)] line-through block">{money(discount.list)}</span>}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onArrived(order, pantry)}
                className="flex-1 min-h-9 px-3 rounded-xl bg-[var(--color-primary)] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
              >
                <Check size={14} /> Arrived
              </button>
              <button
                type="button"
                onClick={() => onCancel(order)}
                className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text-muted)] inline-flex items-center justify-center gap-1.5"
              >
                <X size={13} /> Cancel / Return
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
