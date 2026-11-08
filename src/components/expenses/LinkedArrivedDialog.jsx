import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PackageCheck, X } from 'lucide-react'
import { RestockForm } from '../inventory/RestockForm'
import { alreadyArrivedMessage, arriveLinkedOrder, arrivedToast } from '../../hooks/useOrders'
import { formatPurchaseQuantity } from '../../lib/inventory'
import { packColumnsReady } from '../../lib/orders'
import { boughtAsOtherName } from '../../lib/itemNames'
import { localDateString } from '../../lib/week'

// "Arrived" on an order linked to a HOME item (ordered from the SHOP
// list): a simple check of the quantity that arrived — in the item's
// purchase unit or stock unit, started with what was ordered. Bought in a
// package, it asks how many stock units are in 1 package of this arrival
// (plan 9H: started with the order's own size, else the item's usual one);
// a first-time size becomes the item's usual size only once the database can remember the size it had before (supabase/027),
// so "Put back on the way" undoes it exactly. Confirming marks the order
// arrived and adds the stock in one step; only the first confirmation
// adds anything, on whichever phone. Never an expense: that was made when
// ordering. The toast after it has Undo (plan 9J). An order under another
// name of the item (plan 9N, K90) counts its pack with that name's size, and
// a first-time size is saved on the name. Closed
// with × or a tap outside, nothing happens: the order stays on the way.
// An order linked to a group row from an older version of the app never
// opens here (linkedItemOf, K138): it asks "It arrived!" instead.
export function LinkedArrivedDialog({ order, item, onClose }) {
  const [busy, setBusy] = useState(false)

  const finish = (result, message) => {
    if (result.error) return result
    arrivedToast(result.added ? message : alreadyArrivedMessage(order), result.arrival)
    onClose()
    return result
  }

  const submit = async ({ delta, pack = null }) => {
    const result = await arriveLinkedOrder(order, { itemId: item.id, delta, date: localDateString(), pack, packItem: item })
    return finish(result, `Arrived — added ${formatPurchaseQuantity(delta, item.unit, item)} to "${item.name}"`)
  }

  const withoutStock = async () => {
    setBusy(true)
    const result = await arriveLinkedOrder(order, { itemId: null, delta: 0, date: localDateString() })
    setBusy(false)
    finish(result, `"${order.item_name}" marked as arrived — nothing added to HOME`)
  }

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`"${order.item_name}" arrived`}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2">
              <PackageCheck size={16} /> "{order.item_name}" arrived?
            </p>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">
              Check how much arrived: it is added to "{item.name}" in HOME and the item leaves the SHOP list. The expense stays as it is — nothing new is added to your expenses.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>
        <RestockForm
          item={item}
          initial={{ quantity: Number(order.quantity) || 1, unit: order.unit || null, packSize: order.pack_size ?? null }}
          packs
          canSaveUsual={packColumnsReady(order)}
          boughtAs={boughtAsOtherName(item, order.item_name) ? order.item_name : null}
          submitLabel="Arrived — add to HOME"
          onSubmit={submit}
          onClose={onClose}
        />
        <button
          type="button"
          onClick={withoutStock}
          disabled={busy}
          className="w-full min-h-10 rounded-2xl text-[11px] font-bold text-[var(--color-text-muted)] border border-[var(--color-border)] disabled:opacity-40"
        >
          Arrived, but don't add anything to HOME
        </button>
      </div>
    </div>,
    document.body
  )
}
