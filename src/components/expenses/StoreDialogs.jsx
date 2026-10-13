import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Store, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { SearchBox } from '../ui/SearchBox'
import { ShopTag } from '../ui/ShopIcon'
import { ShopPicker } from './ShopPicker'
import { setExpensesShop } from '../../hooks/useExpenses'
import { setTripShop } from '../../hooks/usePurchase'
import { parseLocalDate } from '../../lib/week'
import { cn } from '../../lib/cn'

function Sheet({ label, onClose, children }) {
  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2">
            <Store size={16} /> {label}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

// The store of a whole shopping trip, changed at once: every expense of
// the trip (in every budget category) and the trip itself. Undo is offered.
export function TripStoreDialog({ trip, count, current, flowReady, onClose }) {
  const [shopId, setShopId] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const { error } = await setTripShop(trip.id, shopId, { flowReady })
    setBusy(false)
    if (!error) onClose()
  }
  return (
    <Sheet label="Store of this trip" onClose={onClose}>
      <p className="text-xs text-[var(--color-text-soft)]">
        Shopping trip of {parseLocalDate(trip.trip_date).toLocaleDateString('en-GB')}: the store changes for all {count} of its expenses, in every budget category.
      </p>
      <ShopPicker value={shopId} onChange={setShopId} label="Bought at" />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save for the whole trip'}
        </Button>
      </div>
    </Sheet>
  )
}

// One store for several single expenses at once (e.g. older ones, from
// before stores, or from before trips were saved). Expenses of a shopping
// trip aren't listed: their store is set for the whole trip.
export function BulkStoreDialog({ expenses, shopOf, names, onClose }) {
  const [picked, setPicked] = useState(() => new Set())
  const [shopId, setShopId] = useState('')
  const [search, setSearch] = useState('')
  const [onlyWithout, setOnlyWithout] = useState(true)
  const [busy, setBusy] = useState(false)
  const query = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      expenses.filter((e) => {
        if (e.trip_id) return false
        if (onlyWithout && e.shop_id) return false
        if (!query) return true
        const { main, sub } = names(e.category_id)
        return [e.description, main, sub].some((t) => t?.toLowerCase().includes(query))
      }),
    [expenses, onlyWithout, query, names]
  )
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const allPicked = shown.length > 0 && shown.every((e) => picked.has(e.id))
  const save = async () => {
    setBusy(true)
    const { error } = await setExpensesShop([...picked], shopId)
    setBusy(false)
    if (!error) onClose()
  }
  return (
    <Sheet label="Set the store of several expenses" onClose={onClose}>
      <p className="text-xs text-[var(--color-text-soft)]">Tick the expenses (of the period on screen), pick the store, save. Only their store changes.</p>
      <SearchBox value={search} onChange={setSearch} placeholder="Search description or category…" />
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <label className="flex items-center gap-2 text-[var(--color-text-soft)]">
          <input type="checkbox" checked={onlyWithout} onChange={(e) => setOnlyWithout(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary)]" />
          Only those without a store
        </label>
        <button
          type="button"
          onClick={() => setPicked(allPicked ? new Set() : new Set(shown.map((e) => e.id)))}
          disabled={shown.length === 0}
          className="font-bold text-[var(--color-accent)] disabled:opacity-40"
        >
          {allPicked ? 'Untick all' : 'Tick all shown'}
        </button>
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto rounded-2xl border border-[var(--color-border)] p-1">
        {shown.length === 0 && <p className="text-xs text-[var(--color-text-muted)] text-center p-3">No single expenses here.</p>}
        {shown.map((e) => {
          const shop = shopOf(e.shop_id)
          const { main, sub } = names(e.category_id)
          return (
            <label key={e.id} className={cn('flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs cursor-pointer', picked.has(e.id) && 'bg-[var(--color-surface-soft)]')}>
              <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} className="w-4 h-4 accent-[var(--color-primary)] shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[var(--color-text)]">{e.description || sub || main || 'Expense'}</span>
                <span className="block text-[10px] text-[var(--color-text-muted)] truncate">
                  {parseLocalDate(e.expense_date).toLocaleDateString('en-GB')} · {main || 'Uncategorized'}
                  {shop && (
                    <>
                      {' · '}
                      <ShopTag shop={shop} />
                    </>
                  )}
                </span>
              </span>
              <span className="font-mono text-[var(--color-text-soft)] shrink-0">€{Number(e.amount).toFixed(2)}</span>
            </label>
          )
        })}
      </div>
      <ShopPicker value={shopId} onChange={setShopId} label="Bought at" />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={busy || picked.size === 0 || !shopId} onClick={save}>
          {busy ? 'Saving…' : `Set for ${picked.size} expense${picked.size === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Sheet>
  )
}
