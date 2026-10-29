import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronDown, History, Layers, Plus, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { OrderForm } from './OrderForm'
import { OrderCard } from './OrderCard'
import { ArrivedDialog } from './ArrivedDialog'
import { PersonSelector } from './PersonSelector'
import { LinkedArrivedDialog } from './LinkedArrivedDialog'
import { OrderGroupSheet } from './OrderGroupSheet'
import { WhereToRecord } from '../ui/WhereToRecord'
import { useOrders, createOrder, editOrder, linkedItemOf, markArrived, markDurableArrived } from '../../hooks/useOrders'
import { askBackOnTheWay, askCancelOrder, askRemoveOrder } from '../../hooks/orderActions'
import { groupOrders, useOrderGroups } from '../../hooks/useOrderGroups'
import { useFlow } from '../../hooks/useFlow'
import { groceryStore, pantryStore } from '../../lib/stores'
import { orderLock } from '../../lib/durable'
import { localDateString } from '../../lib/expensePeriods'
import { linkedOrderUnits, splitOrders } from '../../lib/orders'
import { groupLabel, groupMembers, groupingPlan, respreadNote } from '../../lib/orderGroups'
import { personLabel } from '../../lib/personFilter'
import { cn } from '../../lib/cn'

export const ORDERS_NOTICE = 'Orders need a one-time database update (supabase/019_stores_and_orders.sql). Until then everything else works as before.'

// Online purchases waiting to arrive: a header with how many are on the
// way, "+ Add order" (the form opens on demand), the orders on the way by
// expected date, and a "History (N)" list of the arrived, cancelled
// and returned ones. A new order makes its expense at once; Arrived never makes one.
// `person` filters by who paid. Before supabase/019 it says so instead.
// With supabase/028 (plan 9I) orders that were one order at the store can
// be an order group: "Group orders" ticks them, each card of a group has a
// tag that opens the "Order group" sheet (its discount, store, date, payer).
export function OrdersSection({ person, onPerson, shopById, categories, mainCategories, subsOf, namesOf, addCategory, renameCategory, moveCategory, deleteCategory, styleFor }) {
  const { orders, ready, missing } = useOrders()
  const location = useLocation()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [arrived, setArrived] = useState(null)
  const [arrivedLinked, setArrivedLinked] = useState(null) // { order, item }
  const flow = useFlow()
  const { rows: pantryRows } = pantryStore.useRows()
  const { rows: groceryItems } = groceryStore.useRows()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [highlight, setHighlight] = useState(null)
  const today = localDateString()
  const groups = useOrderGroups()
  const groupsOn = ready && groups.ready
  const [grouping, setGrouping] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [sheet, setSheet] = useState(null) // an order group's id
  const shopName = (id) => shopById.get(id)?.name ?? null

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

  // An order linked to a HOME item asks how much arrived and adds it in
  // one step; any other order is marked arrived, then HOME is offered. A
  // durable order (its budget category, or the SHOP entry it came from)
  // or a service one is only marked arrived: nothing goes into HOME,
  // nothing is asked.
  const arrive = async (order) => {
    const lock = orderLock(order, { expenseCategories: categories, groceryItems })
    if (lock) return markDurableArrived(order, localDateString(), lock)
    const item = flow.ready ? linkedItemOf(order, pantryRows) : null
    if (item) return setArrivedLinked({ order, item })
    const { error } = await markArrived(order, localDateString())
    if (!error) setArrived(order)
  }

  const cancel = async (order) => {
    const result = await askCancelOrder(order, { orders, today })
    if (result && !result.error) {
      setHistoryOpen(true)
      setHighlight(order.id)
    }
  }

  const backOnTheWay = (order) => askBackOnTheWay(order, { unit: linkedItemOf(order, pantryRows)?.unit })

  const pick = (order) =>
    setPicked((ids) => {
      const next = new Set(ids)
      if (!next.delete(order.id)) next.add(order.id)
      return next
    })
  const startGrouping = () => {
    setGrouping(true)
    setPicked(new Set())
    setHistoryOpen(true)
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
      onDelete={askRemoveOrder}
      linkedItem={linkedItemOf(order, pantryRows)}
      groupTag={order.group_id ? { label: groupLabel(groupMembers(order.group_id, orders), shopName), onOpen: () => setSheet(order.group_id) } : null}
      selectable={grouping}
      selected={picked.has(order.id)}
      onSelect={pick}
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
          {!adding && !grouping && groupsOn && (
            <Button variant="ghost" onClick={startGrouping} className="px-3 py-1.5 text-xs whitespace-nowrap">
              <Layers size={14} /> Group orders
            </Button>
          )}
          {!adding && ready && (
            <Button variant="ghost" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs whitespace-nowrap">
              <Plus size={14} /> Add order
            </Button>
          )}
        </div>
      </div>

      {missing && <Card className="text-xs text-yellow-300">{ORDERS_NOTICE}</Card>}
      <WhereToRecord here="orders" />

      {ready && (
        <>
          <PersonSelector value={person} onChange={onPerson} label="Paid by" />

          {grouping && groupsOn && (
            <GroupOrdersBar
              selected={orders.filter((o) => picked.has(o.id))}
              orders={orders}
              person={person}
              shopName={shopName}
              onDone={() => setGrouping(false)}
              onGrouped={(groupId) => {
                setGrouping(false)
                setPicked(new Set())
                if (groupId) setSheet(groupId)
              }}
            />
          )}

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
            {editing.expense_id && <p className="text-[11px] text-[var(--color-text-muted)]">Changing the total price, date, category, who paid or the store also updates its expense.</p>}
            <OrderForm
              {...formProps}
              initial={editing}
              group={
                editing.group_id
                  ? { count: groupMembers(editing.group_id, orders).length, discounted: groupMembers(editing.group_id, orders).some((o) => Number(o.group_share) > 0) }
                  : null
              }
              units={editing.pantry_item_id && linkedItemOf(editing, pantryRows) ? linkedOrderUnits(editing, linkedItemOf(editing, pantryRows)) : null}
              packItem={orderLock(editing, { expenseCategories: categories, groceryItems }) ? null : linkedItemOf(editing, pantryRows)}
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

      {sheet && <OrderGroupSheet groupId={sheet} shopById={shopById} onClose={() => setSheet(null)} />}
      {arrived && <ArrivedDialog order={arrived} onClose={() => setArrived(null)} />}
      {arrivedLinked && <LinkedArrivedDialog order={arrivedLinked.order} item={arrivedLinked.item} onClose={() => setArrivedLinked(null)} />}
    </section>
  )
}

// "Group orders": how many orders are ticked and what can be done with
// them — "Group as one order" (a new group; then its sheet opens, to type
// the order discount), and beside it one "Add to {group}" for each existing
// group of the same store, date and payer — or why not. Each button does
// only what it says. Every status can be grouped. When "Paid by" isn't on
// Everyone, it says that some orders may be hidden.
function GroupOrdersBar({ selected, orders, person, shopName, onDone, onGrouped }) {
  const [id, setId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const plan = groupingPlan(selected, orders, shopName)
  const run = async (target) => {
    if (busy) return
    setBusy(true)
    const { error } = await groupOrders({ id, singles: plan.singles, target, shopName })
    setBusy(false)
    if (error) return
    setId(crypto.randomUUID())
    onGrouped(target ? null : id)
  }
  return (
    <Card className="space-y-2" data-unsaved={selected.length ? '' : undefined}>
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Group orders</p>
        <button type="button" onClick={onDone} aria-label="Stop grouping" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
          <X size={16} />
        </button>
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Tick orders of the same store, order date and payer that were one order at the store (on the way or in History). They stay separate orders; the order can then have one discount for all of them.
      </p>
      {person !== 'all' && (
        <p className="text-[11px] text-amber-300">"Paid by" shows only {personLabel(person)}: some orders may be hidden. Choose Everyone to see them all.</p>
      )}
      <p className="text-xs text-[var(--color-text-soft)]">{selected.length} ticked</p>
      {plan.problem ? (
        selected.length > 0 && (
          <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {plan.problem}
          </p>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {plan.newGroup && (
            <Button type="button" onClick={() => run(null)} disabled={busy} className="px-3 py-1.5 text-xs">
              <Layers size={14} /> Group as one order
            </Button>
          )}
          {plan.targets.map((target) => (
            <div key={target.groupId} className="space-y-1">
              <Button type="button" onClick={() => run(target)} disabled={busy} className="px-3 py-1.5 text-xs">
                <Plus size={14} /> Add to {groupLabel(target.members, shopName)}
              </Button>
              {target.members.some((o) => Number(o.group_share) > 0) && <p className="text-[11px] text-[var(--color-text-muted)]">{respreadNote(target.members.length + plan.singles.length)}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
