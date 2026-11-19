import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Label } from '../ui/Field'
import { ShopPicker } from './ShopPicker'
import { PayerSelect } from './PayerSelect'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { ACCOUNT_OPTIONS, PAYER_MISSING, payerOptionsFor, startingPayer } from '../../lib/payers'
import { OFFLINE_MESSAGE } from '../../lib/db'
import { isOffline } from '../../lib/connection'
import { showToast, toastSaveError } from '../../lib/feedback'
import { localDateString } from '../../lib/week'
import { cn } from '../../lib/cn'
import {
  CHANGED_MEANWHILE,
  changePayload,
  dateLine,
  dateProblem,
  dateToast,
  hasDate,
  hasPayer,
  ORDER_GROUP_GONE,
  payerLine,
  payerNowLine,
  payerToast,
  purchaseState,
  startPayer,
  storeLine,
  withDate,
  withPayer,
} from '../../lib/changePurchase'
import { changePurchase, readPurchase } from '../../hooks/useChangePurchase'
import { setTripShop } from '../../hooks/usePurchase'
import { groupDiscount, groupMembers } from '../../lib/orderGroups'
import { orderGroupStore, orderStore } from '../../lib/stores'
import { saveGroupDetails } from '../../hooks/useOrderGroups'

// "Change purchase ▾" (plan 9P K204, K207, K236, K237): one button on an
// opened purchase row in Money (and on a purchase / order-group line of the
// "Sort by" views) in place of the old "Change the store of the whole
// purchase". It opens an inline panel (no popup) under the row's buttons,
// with three choices — Store · Date · Paid by — none chosen at first, one
// open at a time. Tapping ▾ again, Cancel or a save closes it.

const CHOICES = [
  { value: 'store', label: 'Store' },
  { value: 'date', label: 'Date' },
  { value: 'payer', label: 'Paid by' },
]

const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label ?? value

export function ChangePurchaseButton({ open, onToggle }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
      <Pencil size={12} /> Change purchase
      <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}

// The card (the look of the "Sort by" panels) with the three choices.
function Panel({ choice, onChoice, children }) {
  return (
    <div role="region" aria-label="Change purchase" className="mt-1 mb-2 p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3 text-xs">
      <div role="group" aria-label="What to change" className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={choice === c.value}
            onClick={() => onChoice(choice === c.value ? null : c.value)}
            className={cn(
              'min-h-9 px-3 rounded-full inline-flex items-center text-xs font-bold border transition-all duration-200',
              choice === c.value ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/40 text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

function Grey({ children }) {
  return <p className="text-[11px] text-[var(--color-text-muted)]">{children}</p>
}

function Actions({ busy, onCancel, onSave, error }) {
  return (
    <>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="flex-1 min-h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="flex-1 min-h-9" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save for the whole purchase'}
        </Button>
      </div>
    </>
  )
}

// A SHOP, MONEY or merged purchase. `expenses`: every loaded expense of it
// (the whole purchase, whatever the filters or the person pills show);
// `shopId` its store now.
//   Store    today's sheet content, inline; saved by setTripShop as before
//            (its own toast and Undo). Not part of change_purchase.
//   Date     every expense, the purchase and its receipt photos (K206: not
//            after today, by the device's date).
//   Paid by  the accounts only (K216, K236); every expense, the purchase
//            and its SHOP cards; Shared parts cleared (K205, K208).
// Date and Paid by read the purchase from the database when chosen (the
// app's "was"); the database refuses if it changed after that.
export function PurchaseChangePanel({ trip, expenses, shopId = null, flowReady = true, onClose }) {
  const [choice, setChoice] = useState(null)
  const [shop, setShop] = useState(shopId ?? '')
  const [date, setDate] = useState(trip.trip_date)
  const [dateOk, setDateOk] = useState(true)
  const [payer, setPayer] = useState(() => startPayer(expenses, ACCOUNT_OPTIONS))
  const [seen, setSeen] = useState(null)
  const [busy, setBusyState] = useState(false)
  // Also held in a ref, so a Retry tapped at once (before the screen has
  // drawn again) sees that the save is over.
  const busyRef = useRef(false)
  const setBusy = (value) => {
    busyRef.current = value
    setBusyState(value)
  }
  const [error, setError] = useState('')
  const local = useMemo(() => purchaseState({ trip, expenses }), [trip, expenses])
  const view = seen ?? local
  const n = view.expenses.length

  // Retry (a failed connection) presses Save again while the panel is open.
  const alive = useRef(true)
  const saveRef = useRef(null)
  useEffect(
    () => () => {
      alive.current = false
    },
    []
  )
  const again = () => (alive.current ? saveRef.current?.() : undefined)

  // What the app saw, read once Date or Paid by is chosen (quietly: a
  // failed read is tried again at Save).
  const wantsRead = (choice === 'date' || choice === 'payer') && !seen
  useEffect(() => {
    if (!wantsRead || isOffline()) return
    let stale = false
    readPurchase(trip.id)
      .then((state) => !stale && state && setSeen(state))
      .catch((e) => console.error(e))
    return () => {
      stale = true
    }
  }, [wantsRead, trip.id])

  const pick = (next) => {
    setChoice(next)
    setError('')
  }

  const saveStore = async () => {
    if (busyRef.current) return
    if (shop === (shopId ?? '')) return onClose()
    setBusy(true)
    const { error: failed } = await setTripShop(trip.id, shop, { flowReady })
    if (!alive.current) return
    setBusy(false)
    if (!failed) onClose()
  }

  // Date / Paid by: `build(state)` the purchase afterwards, `same(state)`
  // whether it already is so (nothing is sent), `toastOf(n)` the toast.
  const submit = async ({ build, same, toastOf }) => {
    if (busyRef.current) return
    setError('')
    if (same(view)) return onClose()
    if (isOffline()) return showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
    setBusy(true)
    let was = seen
    if (!was) {
      try {
        was = await readPurchase(trip.id)
      } catch (e) {
        if (!alive.current) return
        setBusy(false)
        return toastSaveError(e, again)
      }
      if (!alive.current) return
      if (!was) {
        setBusy(false)
        return setError(CHANGED_MEANWHILE)
      }
      setSeen(was)
    }
    if (same(was)) {
      setBusy(false)
      return onClose()
    }
    const now = build(was)
    const result = await changePurchase(changePayload(trip.id, was, now), { message: toastOf(now.expenses.length), again })
    if (!alive.current) return
    setBusy(false)
    if (!result.error) return onClose()
    if (result.refusal) setError(result.refusal)
  }

  const saveDate = () => {
    const problem = dateProblem({ date, dateOk, today: localDateString() })
    if (problem) return setError(problem)
    return submit({ build: (s) => withDate(s, date), same: (s) => hasDate(s, date), toastOf: (count) => dateToast(count, date) })
  }

  const savePayer = () => {
    if (!payer) return setError(PAYER_MISSING)
    return submit({ build: (s) => withPayer(s, payer), same: (s) => hasPayer(s, payer), toastOf: (count) => payerToast(count, payer) })
  }

  useEffect(() => {
    saveRef.current = choice === 'store' ? saveStore : choice === 'date' ? saveDate : choice === 'payer' ? savePayer : null
  })
  const nowLine = payerNowLine(view.expenses, ACCOUNT_OPTIONS)

  return (
    <Panel choice={choice} onChoice={pick}>
      {choice === 'store' && (
        <>
          <ShopPicker value={shop} onChange={setShop} label="Bought at" />
          <Grey>{storeLine(trip.trip_date, expenses.length)}</Grey>
          <Actions busy={busy} onCancel={onClose} onSave={saveStore} />
        </>
      )}
      {choice === 'date' && (
        <>
          <div>
            <Label>Date</Label>
            <DateField label="Date" required value={date} onChange={(v) => { setDate(v); setError('') }} onValidity={setDateOk} />
          </div>
          <Grey>{dateLine(n)}</Grey>
          <Actions busy={busy} onCancel={onClose} onSave={saveDate} error={error} />
        </>
      )}
      {choice === 'payer' && (
        <>
          <div>
            <Label>Paid by</Label>
            <PayerSelect value={payer} onChange={(v) => { setPayer(v); setError('') }} options={ACCOUNT_OPTIONS} label="Paid by" />
            {nowLine && <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{nowLine}</p>}
          </div>
          <Grey>{payerLine(n)}</Grey>
          <Actions busy={busy} onCancel={onClose} onSave={savePayer} error={error} />
        </>
      )}
    </Panel>
  )
}

// An order group's row (plan 9I K9; K207): the same three choices, saved
// through save_order_group exactly like the "Order group" sheet (K7: the
// store, order date and payer of all its orders and their expenses; its
// refusals, its amber line, its toast "Order group saved" with Undo). Each
// choice saves only its own field; the discount stays as it is.
export function OrderGroupChangePanel({ groupId, onClose }) {
  const { rows: groups, loaded } = orderGroupStore.useRows()
  const { rows: orders } = orderStore.useRows()
  const group = groups.find((g) => g.id === groupId) ?? null
  const members = useMemo(() => groupMembers(groupId, orders), [groupId, orders])
  const [choice, setChoice] = useState(null)
  if (!group || !members.length) {
    return (
      <Panel choice={choice} onChoice={setChoice}>
        <Grey>{loaded ? ORDER_GROUP_GONE : 'The order group is still loading — it needs a connection.'}</Grey>
      </Panel>
    )
  }
  return <GroupChoices key={group.id} group={group} members={members} choice={choice} onChoice={setChoice} onClose={onClose} />
}

function GroupChoices({ group, members, choice, onChoice, onClose }) {
  const [shopId, setShopId] = useState(group.shop_id ?? '')
  const [orderDate, setOrderDate] = useState(group.order_date)
  const [dateValid, setDateValid] = useState(true)
  // The accounts, plus "Shared" only for a group that is Shared (K216).
  const payerOptions = payerOptionsFor(group.paid_by)
  const [paidBy, setPaidBy] = useState(() => startingPayer(group.paid_by))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Only the open choice is saved; the rest stays as the group has it.
  const place = {
    shop_id: choice === 'store' ? shopId : group.shop_id ?? '',
    order_date: choice === 'date' ? orderDate : group.order_date,
    paid_by: choice === 'payer' ? paidBy : group.paid_by,
  }
  const changed = place.shop_id !== (group.shop_id ?? '') || place.order_date !== group.order_date || place.paid_by !== group.paid_by

  const pick = (next) => {
    onChoice(next)
    setError('')
  }
  const save = async () => {
    if (busy) return
    const problem =
      choice === 'store' && !shopId ? 'Choose the store of the order.' : choice === 'date' && (!orderDate || !dateValid) ? 'Fix the order date first (DD/MM/YYYY).' : choice === 'payer' && !paidBy ? PAYER_MISSING : ''
    setError(problem)
    if (problem) return
    if (!changed) return onClose()
    setBusy(true)
    const { error: failed } = await saveGroupDetails(group, members, { discount: groupDiscount(group), place })
    setBusy(false)
    if (failed) return setError(failed.message)
    onClose()
  }

  return (
    <Panel choice={choice} onChoice={pick}>
      {choice === 'store' && <ShopPicker value={shopId} onChange={(v) => { setShopId(v); setError('') }} defaultOnline label="Store" />}
      {choice === 'date' && (
        <div>
          <Label>Order date</Label>
          <DateField label="Order date" required value={orderDate} onChange={(v) => { setOrderDate(v); setError('') }} onValidity={setDateValid} />
        </div>
      )}
      {choice === 'payer' && (
        <div>
          <Label>Paid by</Label>
          <PayerSelect value={paidBy} onChange={(v) => { setPaidBy(v); setError('') }} options={payerOptions} label="Paid by" />
        </div>
      )}
      {choice && changed && (
        <p className="text-[11px] text-amber-300">
          Saving changes the store, order date and payer of all {members.length} orders and of their expenses
          {place.paid_by !== group.paid_by ? ` (paid by ${payerLabel(place.paid_by)})` : ''}.
        </p>
      )}
      {choice && <Actions busy={busy} onCancel={onClose} onSave={save} error={error} />}
    </Panel>
  )
}
