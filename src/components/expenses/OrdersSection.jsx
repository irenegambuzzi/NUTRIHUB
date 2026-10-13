import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, History, Plus, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { OrderForm } from './OrderForm'
import { OrderCard } from './OrderCard'
import { ArrivedDialog } from './ArrivedDialog'
import { PersonSelector } from './PersonSelector'
import { useOrders, createOrder, editOrder, markArrived, markCancelled, putBackOnTheWay, removeOrder } from '../../hooks/useOrders'
import { askDialog } from '../../lib/feedback'
import { localDateString } from '../../lib/expensePeriods'
import { outcomeSupported, splitOrders } from '../../lib/orders'
import { cn } from '../../lib/cn'

export const ORDERS_NOTICE = 'Orders need a one-time database update (supabase/019_stores_and_orders.sql). Until then everything else works as before.'

const money = (value) => `€${Number(value).toFixed(2)}`

// Online purchases waiting to arrive: a header with how many are on the
// way, "+ Add order" (the form opens on demand), the orders on the way by
// expected date, and a "History (N)" list of the arrived, cancelled
// and returned ones. A new order makes its expense at once; Arrived never makes one.
// `person` filters by who paid. Before supabase/019 it says so instead.
export function OrdersSection({ person, onPerson, shopById, categories, mainCategories, subsOf, namesOf, addCategory, renameCategory, moveCategory, deleteCategory, styleFor }) {
  const { orders, ready, missing } = useOrders()
  const location = useLocation()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [arrived, setArrived] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [highlight, setHighlight] = useState(null)
  const today = localDateString()

  const shown = useMemo(() => orders.filter((o) => person === 'all' || o.paid_by === person), [orders, person])
  const { onTheWay, history } = useMemo(() => splitOrders(shown), [shown])
  const waiting = orders.filter((o) => o.status === 'on_the_way')

  // A reminder was tapped: show that order, opened and in view. (The
  // order list may still be loading, so this waits for it.)
  const wanted = location.state?.openOrder
  const [seenWanted, setSeenWanted] = useState(null)
  const wantedOrder = wanted && ready ? orders.find((o) => o.id === wanted) : null
  if (wanted && ready && wanted !== seenWanted) {
    setSeenWanted(wanted)
    if (wantedOrder) {
      if (wantedOrder.status !== 'on_the_way') setHistoryOpen(true)
      setOpenIds((ids) => new Set(ids).add(wantedOrder.id))
      setHighlight(wantedOrder.id)
    }
  }
  const hiddenByPerson = Boolean(wantedOrder) && person !== 'all' && wantedOrder.paid_by !== person
  useEffect(() => {
    if (!wanted || !ready) return
    if (hiddenByPerson) onPerson('all')
    navigate(location.pathname, { replace: true, state: null })
  }, [wanted, ready, hiddenByPerson, onPerson, navigate, location.pathname])

  useEffect(() => {
    if (!highlight) return
    document.getElementById(`order-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlight(null), 3500)
    return () => clearTimeout(timer)
  }, [highlight, shown])

  const toggle = (id) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const arrive = async (order) => {
    const { error } = await markArrived(order, localDateString())
    if (!error) setArrived(order)
  }

  // Cancel / Return: nothing happens until the question is answered. It
  // says where the order goes, what becomes of its expense, and offers
  // Undo afterwards. "Returned" is only offered once the database knows it.
  const cancel = async (order) => {
    const returnedKnown = outcomeSupported(orders)
    const fields = []
    if (returnedKnown) {
      fields.push({
        name: 'kind',
        type: 'choice',
        label: 'Mark it as',
        value: 'cancelled',
        options: [
          { value: 'cancelled', label: 'Cancelled', hint: 'It never arrived, or the order was called off.' },
          { value: 'returned', label: 'Returned', hint: 'It arrived and was sent back.' },
        ],
      })
    }
    if (order.expense_id) {
      fields.push({
        name: 'how',
        type: 'choice',
        label: `What about the expense? (${money(order.price)}, ${new Date(`${order.order_date}T00:00:00`).toLocaleDateString('en-GB')})`,
        value: 'keep',
        options: [
          { value: 'delete', label: 'Delete the expense (I got my money back / was never charged)', hint: 'It is taken out of your expenses.' },
          { value: 'keep', label: 'Keep the expense', hint: 'The money stays in your expenses, e.g. a refund has not arrived yet.' },
        ],
      })
    }
    const answer = await askDialog({
      title: `Cancel or return "${order.item_name}"?`,
      message: `${order.expense_id ? '' : 'It has no expense linked, so no money changes. '}It moves to History under the orders on the way, and no longer shows in the reminders. Nothing changes until you confirm, and you can Undo afterwards.${returnedKnown ? '' : ' (Returned needs a one-time database update, supabase/020_order_returned.sql; until then it is saved as Cancelled.)'}`,
      fields,
      confirmLabel: 'Move to History',
    })
    if (!answer) return
    const result = await markCancelled(order, { kind: answer.kind ?? 'cancelled', deleteExpense: answer.how === 'delete', today, outcomeKnown: returnedKnown })
    if (!result?.error) {
      setHistoryOpen(true)
      setHighlight(order.id)
    }
  }

  const backOnTheWay = async (order) => {
    if (order.expense_id) return putBackOnTheWay(order, { createExpense: false })
    const answer = await askDialog({
      title: `Put "${order.item_name}" back on the way?`,
      message: 'Its expense was deleted. Add the expense again (one, for the order date and price)?',
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: 'add',
          options: [
            { value: 'add', label: 'Add the expense again', hint: `${money(order.price)} on ${new Date(`${order.order_date}T00:00:00`).toLocaleDateString('en-GB')}.` },
            { value: 'none', label: 'Without an expense' },
          ],
        },
      ],
      confirmLabel: 'Put back on the way',
    })
    if (answer) await putBackOnTheWay(order, { createExpense: answer.how === 'add' })
  }

  const remove = async (order) => {
    if (!order.expense_id) return removeOrder(order, { alsoExpense: false })
    const answer = await askDialog({
      title: `Delete "${order.item_name}"?`,
      message: 'This order has an expense. Delete that too?',
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: 'order',
          options: [
            { value: 'order', label: 'Delete the order only', hint: 'The expense stays in your expenses.' },
            { value: 'both', label: 'Delete the order and its expense', hint: `The ${money(order.price)} is taken out of your expenses.` },
          ],
        },
      ],
      confirmLabel: 'Delete',
    })
    if (answer) await removeOrder(order, { alsoExpense: answer.how === 'both' })
  }

  const card = (order) => (
    <OrderCard
      key={order.id}
      order={order}
      shop={order.shop_id ? shopById.get(order.shop_id) : null}
      names={namesOf}
      today={today}
      open={openIds.has(order.id)}
      highlighted={highlight === order.id}
      onToggle={() => toggle(order.id)}
      onArrived={arrive}
      onCancelled={cancel}
      onBackOnTheWay={backOnTheWay}
      onEdit={setEditing}
      onDelete={remove}
    />
  )

  const formProps = { categories, mainCategories, subsOf, addCategory, renameCategory, moveCategory, deleteCategory, styleFor }

  return (
    <section id="orders" className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Orders</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm whitespace-nowrap">
            {ready ? `${waiting.length} on the way` : '—'}
          </span>
          {!adding && ready && (
            <Button variant="ghost" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs whitespace-nowrap">
              <Plus size={14} /> Add order
            </Button>
          )}
        </div>
      </div>

      {missing && <Card className="text-xs text-yellow-300">{ORDERS_NOTICE}</Card>}

      {ready && (
        <>
          <PersonSelector value={person} onChange={onPerson} label="Paid by" />

          {adding && (
            <Card className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add an order</p>
                <button type="button" onClick={() => setAdding(false)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                  <X size={16} />
                </button>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">Saving adds the expense too (the money is spent when you order).</p>
              <OrderForm
                {...formProps}
                onSubmit={async (values, ids) => {
                  const result = await createOrder(values, ids)
                  if (!result.error) setAdding(false)
                  return result
                }}
              />
            </Card>
          )}

          <div className="space-y-2">
            {onTheWay.length === 0 ? (
              <Card className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{orders.some((o) => o.status === 'on_the_way') ? 'No orders on the way for this person.' : 'No orders on the way.'}</p>
              </Card>
            ) : (
              onTheWay.map(card)
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              className="w-full min-h-10 px-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex justify-between items-center text-xs font-bold text-[var(--color-text-soft)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <History size={14} /> History ({history.length})
              </span>
              <ChevronDown size={14} className={cn('transition-transform', historyOpen && 'rotate-180')} />
            </button>
            {historyOpen &&
              (history.length > 0 ? (
                history.map(card)
              ) : (
                <Card className="text-center">
                  <p className="text-xs text-[var(--color-text-muted)]">Arrived, cancelled and returned orders will be listed here.</p>
                </Card>
              ))}
          </div>
        </>
      )}

      {editing && (
        <div data-unsaved className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
          >
            <div className="flex justify-between items-center">
              <p className="text-sm font-extrabold text-[var(--color-primary)]">Edit order</p>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                <X size={18} />
              </button>
            </div>
            {editing.expense_id && <p className="text-[11px] text-[var(--color-text-muted)]">Changing the price, date, category, who paid or the store also updates its expense.</p>}
            <OrderForm
              {...formProps}
              initial={editing}
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={async (values) => {
                const result = await editOrder(editing, values)
                if (!result.error) setEditing(null)
                return result
              }}
            />
          </div>
        </div>
      )}

      {arrived && <ArrivedDialog order={arrived} onClose={() => setArrived(null)} />}
    </section>
  )
}
