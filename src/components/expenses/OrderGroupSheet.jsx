import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Layers, LogOut, Ungroup, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Label, Select } from '../ui/Field'
import { DiscountField } from '../ui/DiscountField'
import { ShopPicker } from './ShopPicker'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { confirmDialog } from '../../lib/feedback'
import { couponText, discountProblem, parseDiscount } from '../../lib/discounts'
import { ORDER_STATUS } from '../../lib/orders'
import { groupDiscount, groupLabel, groupMembers, groupPreview } from '../../lib/orderGroups'
import { money } from '../../lib/pricing'
import { orderGroupStore, orderStore } from '../../lib/stores'
import { saveGroupDetails, takeOutOfGroup, ungroupOrders } from '../../hooks/useOrderGroups'

// "Order group" (plan 9I): the orders that were one order at the store,
// opened from an order card's tag in Orders or from the group's row in
// Expenses. Every order of the group (cancelled and returned ones too) with
// its price before the order discount, its share and what it pays; the
// "Order discount" (−% / −€) with a live line per item; the group's store,
// order date and payer (for all its orders and their expenses); per order
// "Take out of the group", and "Ungroup". Nothing is saved until "Save"
// (or one of those two, which have Undo).
export function OrderGroupSheet({ groupId, shopById, onClose }) {
  const { rows: groups, loaded } = orderGroupStore.useRows()
  const { rows: orders } = orderStore.useRows()
  const group = groups.find((g) => g.id === groupId) ?? null
  const members = useMemo(() => groupMembers(groupId, orders), [groupId, orders])
  const shopName = (id) => shopById.get(id)?.name ?? null

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Order group"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-center gap-2">
          <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2 min-w-0">
            <Layers size={16} className="shrink-0" /> <span className="truncate">Order group</span>
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>
        {group && members.length > 0 ? (
          <GroupForm key={group.id} group={group} members={members} label={groupLabel(members, shopName)} onClose={onClose} />
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            {loaded ? 'This order group no longer exists (ungrouped, maybe on the other phone).' : 'The order group is still loading — it needs a connection.'}
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}

const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label ?? value

function GroupForm({ group, members, label, onClose }) {
  const start = groupDiscount(group)
  const [discount, setDiscount] = useState({ kind: start?.kind ?? 'amount', text: start ? String(start.value) : '' })
  const [shopId, setShopId] = useState(group.shop_id ?? '')
  const [orderDate, setOrderDate] = useState(group.order_date)
  const [dateValid, setDateValid] = useState(true)
  const [paidBy, setPaidBy] = useState(group.paid_by)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const typedProblem = discountProblem(Infinity, discount)
  const parsed = typedProblem ? null : parseDiscount(discount)
  const preview = groupPreview(members, parsed)
  const paidTotal = Math.round(preview.rows.reduce((s, r) => s + r.paid, 0) * 100) / 100
  const placeChanged = shopId !== (group.shop_id ?? '') || orderDate !== group.order_date || paidBy !== group.paid_by

  const save = async () => {
    if (busy) return
    const problem = typedProblem || (!shopId ? 'Choose the store of the order.' : !orderDate || !dateValid ? 'Fix the order date first (DD/MM/YYYY).' : '')
    setError(problem)
    if (problem) return
    setBusy(true)
    const { error: failed } = await saveGroupDetails(group, members, { discount: parsed, place: { shop_id: shopId, order_date: orderDate, paid_by: paidBy } })
    setBusy(false)
    if (failed) return setError(failed.message)
    onClose()
  }

  const takeOut = async (order) => {
    const share = Number(order.group_share) || 0
    const ok = await confirmDialog({
      title: `Take "${order.item_name}" out of the group?`,
      message: `${share > 0 ? `Its part of the order discount (${money(share)}) goes back to 0, and the discount is spread again over the other orders. ` : ''}It stays an order on its own. You can Undo afterwards.`,
      confirmLabel: 'Take out',
    })
    if (!ok) return
    const { error: failed } = await takeOutOfGroup(group, members, order)
    if (!failed && members.length === 1) onClose()
  }

  const ungroup = async () => {
    const total = members.reduce((s, o) => s + (Number(o.group_share) || 0), 0)
    const ok = await confirmDialog({
      title: 'Ungroup this order?',
      message: `Every order is on its own again${total > 0 ? `: the order discount (−${money(total)}) is removed and each price and expense goes back to before it` : ''}. You can Undo afterwards.`,
      confirmLabel: 'Ungroup',
    })
    if (!ok) return
    const { error: failed } = await ungroupOrders(group, members)
    if (!failed) onClose()
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-text-soft)]">{label}</p>

      <ul aria-label="Orders of the group" className="space-y-2">
        {preview.rows.map(({ order, base, share, paid, note }) => (
          <li key={order.id} className="rounded-2xl border border-[var(--color-border)] p-2.5 text-xs space-y-1">
            <div className="flex justify-between gap-2">
              <span className="min-w-0">
                <span className="font-bold text-[var(--color-text)] block break-words">{order.item_name}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {ORDER_STATUS[order.status] ?? order.status}
                  {order.expense_id ? '' : ' · no expense'}
                </span>
              </span>
              <span className="font-mono text-right shrink-0">
                <span className="text-[10px] text-[var(--color-text-muted)] block">
                  {money(base)}
                  {share > 0 ? ` −${money(share)}` : ''}
                </span>
                <span className="font-bold text-[var(--color-accent)] block">{money(paid)}</span>
              </span>
            </div>
            {note && <p className="text-[11px] font-bold text-emerald-300 break-words">{note}</p>}
            <button type="button" onClick={() => takeOut(order)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-muted)]">
              <LogOut size={12} /> Take out of the group
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-1.5">
        <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Order discount</p>
        <DiscountField kind={discount.kind} text={discount.text} onChange={(d) => { setDiscount(d); setError('') }} label="Order discount" placeholder="Discount" problem={typedProblem} />
        {preview.total > 0 && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {couponText(parsed)} = {money(preview.total)} off, spread over the {members.length} items by what each costs after its own discount.
          </p>
        )}
        <p className="text-[11px] text-[var(--color-text-soft)]">
          Paid <span className="font-mono font-bold">{money(paidTotal)}</span>
          {preview.total > 0 ? ` (order discount −${money(preview.total)})` : ''}
        </p>
      </div>

      <div className="space-y-3">
        <ShopPicker value={shopId} onChange={(v) => { setShopId(v); setError('') }} defaultOnline label="Store" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Order date</Label>
            <DateField label="Order date" required value={orderDate} onChange={setOrderDate} onValidity={setDateValid} />
          </div>
          <div>
            <Label>Paid by</Label>
            <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} aria-label="Paid by">
              {PAID_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {placeChanged && (
          <p className="text-[11px] text-amber-300">
            Saving changes the store, order date and payer of all {members.length} orders and of their expenses
            {paidBy !== group.paid_by ? ` (paid by ${payerLabel(paidBy)})` : ''}.
          </p>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={ungroup} className="flex-1">
          <Ungroup size={16} /> Ungroup
        </Button>
        <Button type="button" onClick={save} disabled={busy} className="flex-1">
          <Check size={16} /> {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
