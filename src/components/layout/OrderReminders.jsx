import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Truck, X } from 'lucide-react'
import { useOrders } from '../../hooks/useOrders'
import { useShops } from '../../hooks/useShops'
import { dismissForToday, dismissedToday } from '../../lib/orderBanner'
import { reminders } from '../../lib/orders'
import { localDateString } from '../../lib/week'
import { cn } from '../../lib/cn'

const MAX_SHOWN = 3

// At the top of the screen when the app opens: orders that are overdue,
// expected today or within 2 days, and orders with no expected date that
// were placed 14 days ago or more. Tapping one opens that order in Money;
// "Dismiss" hides the banner for the rest of the day.
export function OrderReminders() {
  const { orders, ready } = useOrders()
  const { byId } = useShops()
  const navigate = useNavigate()
  const today = localDateString()
  const [dismissed, setDismissed] = useState(() => dismissedToday(today))
  const found = useMemo(() => reminders(orders, today, (id) => byId.get(id)?.name ?? null), [orders, today, byId])

  if (!ready || dismissed || found.length === 0) return null

  const open = (id) => navigate('/expenses', { state: { openOrder: id } })
  const urgent = found.some((r) => r.state === 'overdue')
  const shown = found.slice(0, MAX_SHOWN)

  return (
    <div
      role="status"
      aria-label="Order reminders"
      className={cn('mb-4 rounded-3xl border p-3 space-y-1', urgent ? 'border-red-400/60 bg-red-500/10' : 'border-amber-400/50 bg-amber-500/10')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-xs font-extrabold flex items-center gap-1.5', urgent ? 'text-red-300' : 'text-amber-200')}>
          <Truck size={14} /> {found.length === 1 ? 'An order needs a look' : `${found.length} orders need a look`}
        </p>
        <button
          type="button"
          onClick={() => {
            dismissForToday(today)
            setDismissed(true)
          }}
          className="min-h-9 px-2 -mr-1 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-text-muted)]"
          aria-label="Dismiss the order reminders for today"
        >
          <X size={13} /> Dismiss for today
        </button>
      </div>
      {shown.map((r) => (
        <button
          key={r.order.id}
          type="button"
          onClick={() => open(r.order.id)}
          className="w-full min-h-10 flex items-center gap-2 text-left text-xs text-[var(--color-text)]"
        >
          <span className={cn('flex-1 min-w-0', r.state === 'overdue' && 'font-bold')}>{r.message}</span>
          <ChevronRight size={14} className="shrink-0 text-[var(--color-icon-muted)]" />
        </button>
      ))}
      {found.length > MAX_SHOWN && (
        <button type="button" onClick={() => open(found[MAX_SHOWN].order.id)} className="min-h-9 text-[11px] font-bold text-[var(--color-accent)]">
          +{found.length - MAX_SHOWN} more
        </button>
      )}
    </div>
  )
}
