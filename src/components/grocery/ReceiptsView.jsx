import { useMemo, useState } from 'react'
import { AlertTriangle, ListChecks, RotateCcw, ShoppingCart, Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { PhotoPicker, PhotoThumb, PhotoViewer } from './ReceiptPhoto'
import { PriceCheck } from './PriceCheck'
import { deleteExpenses, setReceiptLineAmount, useCategoryExpenses, useExpenseCategories } from '../../hooks/useExpenses'
import { useReceiptPhotos } from '../../hooks/useReceiptPhotos'
import { deleteTripRecord, reopenTrip } from '../../hooks/usePurchase'
import { goneSummary, tripState } from '../../lib/trips'
import { askDialog, confirmDialog } from '../../lib/feedback'
import { groupByDate, normName } from '../../lib/grocery'
import { money } from '../../lib/pricing'
import { localDateString, parseLocalDate } from '../../lib/week'
import { groceryStore, pantryStore, tripExpenseStore, tripItemStore, tripStore } from '../../lib/stores'

const longDate = (date) => parseLocalDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

// Receipts: every confirmed purchase (shopping trip) with its items,
// expenses and receipt photos — which can be reopened as a whole — and,
// from before purchases were confirmed in one go, each day's Groceries
// expenses. Loaded only when this view is open.
export function ReceiptsView() {
  const { categories } = useExpenseCategories()
  const groceriesId = categories.find((c) => c.name === 'Groceries' && !c.parent_id)?.id
  const { expenses, loaded } = useCategoryExpenses(groceriesId)
  const { rows: trips } = tripStore.useRows()
  const { rows: tripItems } = tripItemStore.useRows()
  const { rows: tripExpenses } = tripExpenseStore.useRows()
  const { photos, addPhoto, replacePhoto, movePhoto, deletePhoto } = useReceiptPhotos()
  const { rows: groceryItems } = groceryStore.useRows()
  const { rows: pantryItems } = pantryStore.useRows()
  const [viewing, setViewing] = useState(null) // a photo
  const [checking, setChecking] = useState(null) // a receipt key
  const [busy, setBusy] = useState(false)

  // Confirmed purchases and (older) days, newest first.
  const receipts = useMemo(() => {
    // Each purchase as it really is now (parts may have been deleted by
    // hand): its total and lines come from what's left.
    const cards = trips.map((trip) => {
      const items = tripItems.filter((i) => i.trip_id === trip.id)
      const list = tripExpenses.filter((e) => e.trip_id === trip.id)
      const state = tripState(items, list)
      return { key: `trip:${trip.id}`, trip, date: trip.trip_date, items, list, state, total: state.total, photos: photos.filter((p) => p.trip_id === trip.id) }
    })
    const days = new Map(groupByDate(expenses.filter((e) => !e.trip_id)).map((r) => [r.date, { ...r, key: `day:${r.date}`, photos: [] }]))
    for (const photo of photos.filter((p) => !p.trip_id)) {
      if (!days.has(photo.receipt_date)) days.set(photo.receipt_date, { key: `day:${photo.receipt_date}`, date: photo.receipt_date, list: [], total: 0, photos: [] })
      days.get(photo.receipt_date).photos.push(photo)
    }
    return [...cards, ...days.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [trips, tripItems, tripExpenses, expenses, photos])

  // The grocery entry a receipt line came from (if still there), and its
  // pantry item for unit conversions.
  const linkFor = (expense) => groceryItems.find((g) => g.expense_id === expense.id) ?? null
  const packFor = (item) => pantryItems.find((p) => p.id === item.pantry_item_id) ?? pantryItems.find((p) => normName(p.name) === normName(item.name)) ?? null

  const askDate = (title, value) =>
    askDialog({
      title,
      message: 'Which shopping day is this receipt from? The photo is linked to that day’s items.',
      fields: [{ name: 'date', type: 'date', required: true, label: 'Shopping day', value }],
      confirmLabel: 'Save',
    })

  const add = async (file, date, tripId) => {
    const day = date ?? (await askDate('Add a receipt photo', receipts[0]?.date ?? localDateString()))?.date
    if (!day) return
    setBusy(true)
    await addPhoto(file, day, tripId)
    setBusy(false)
  }

  const move = async (photo) => {
    const answer = await askDate('Move to another day', photo.receipt_date)
    if (answer?.date && answer.date !== photo.receipt_date) {
      await movePhoto(photo, answer.date)
      setViewing(null)
    }
  }

  // Undoes what's left of the purchase; parts deleted by hand are skipped
  // and named afterwards.
  const reopen = async ({ trip, items, total, state }) => {
    const gone = goneSummary(state.lines)
    const ok = await confirmDialog({
      title: 'Reopen this purchase?',
      message: `The ${items.length} item${items.length === 1 ? '' : 's'} (${money(total)}) go back to the cart, and the stock, history and expenses from this purchase are undone.${gone ? ` ${gone}` : ''}`,
      confirmLabel: 'Reopen',
    })
    if (ok) await reopenTrip(trip.id, gone)
  }

  // Removes only the record of the purchase; stock and expenses stay.
  const deleteRecord = async ({ trip, items }) => {
    const ok = await confirmDialog({
      title: 'Delete this purchase record?',
      message: `Only the record of this purchase (${items.length} item${items.length === 1 ? '' : 's'}) is deleted — its stock, history and expenses stay as they are. You can undo it for a few seconds.`,
      confirmLabel: 'Delete record',
    })
    if (ok) await deleteTripRecord(trip)
  }

  const checked = receipts.find((r) => r.key === checking)

  return (
    <div className="space-y-3">
      <Card className="rounded-3xl space-y-2">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add a receipt photo</p>
        <PhotoPicker onFile={(file) => add(file)} disabled={busy} />
        {busy && <p className="text-[11px] text-[var(--color-text-muted)]">Uploading…</p>}
      </Card>

      {!loaded ? (
        <p className="text-xs text-[var(--color-text-muted)] text-center py-6">Loading receipts…</p>
      ) : receipts.length === 0 ? (
        <Card className="text-center rounded-3xl">
          <p className="text-xs text-[var(--color-text-muted)]">No receipts yet — they appear here when you confirm a purchase.</p>
        </Card>
      ) : (
        receipts.map((receipt) => {
          const { key, trip, date, list, total, photos: cardPhotos } = receipt
          return (
            <Card key={key} className="rounded-3xl">
              <div className="flex justify-between items-center gap-2 border-b border-[var(--color-border)] pb-2 mb-2">
                <span className="text-xs font-bold text-[var(--color-text)] flex items-center gap-1.5">
                  {trip && <ShoppingCart size={13} className="text-[var(--color-primary)]" />}
                  {longDate(date)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
                  {!trip && list.length > 0 && (
                    <button
                      onClick={() => deleteExpenses(list.map((e) => e.id), `Receipt from ${parseLocalDate(date).toLocaleDateString('en-GB')} deleted`)}
                      aria-label="Delete this receipt's expenses"
                      className="text-[var(--color-icon-muted)] hover:text-red-400 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2 overflow-x-auto">
                {cardPhotos.map((photo) => (
                  <PhotoThumb key={photo.id} photo={photo} onOpen={setViewing} />
                ))}
                <PhotoPicker compact onFile={(file) => add(file, date, trip?.id ?? null)} disabled={busy} />
                {cardPhotos.length > 0 && list.length > 0 && (
                  <button
                    onClick={() => setChecking(key)}
                    className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-2xl bg-[var(--color-primary)] text-white"
                  >
                    <ListChecks size={14} /> Check prices
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {trip
                  ? receipt.state.lines.map(({ item: i, amount, expenseGone, pantryGone }) => (
                      <div key={i.id} className="flex justify-between gap-2 text-xs text-[var(--color-text-soft)]">
                        <span className="min-w-0">
                          {i.name}
                          {(expenseGone || pantryGone) && (
                            <span className="block text-[10px] text-amber-300">
                              {[expenseGone && 'expense deleted', pantryGone && 'pantry item deleted'].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="font-mono shrink-0">
                          {expenseGone && <span className="line-through text-[var(--color-icon-muted)] mr-1.5">€{Number(i.line_total).toFixed(2)}</span>}€
                          {amount.toFixed(2)}
                        </span>
                      </div>
                    ))
                  : list.map((e) => (
                      <div key={e.id} className="flex justify-between text-xs text-[var(--color-text-soft)]">
                        <span>{e.description || 'Item'}</span>
                        <span className="font-mono">€{Number(e.amount).toFixed(2)}</span>
                      </div>
                    ))}
                {!trip && list.length === 0 && <p className="text-[11px] text-[var(--color-text-muted)]">No checked-off items on this day.</p>}
              </div>

              {trip && receipt.state.incomplete && (
                <p className="mt-2 text-[11px] text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  Incomplete: part of this purchase was deleted by hand, so it no longer matches stock and expenses.
                </p>
              )}
              {trip && (
                <div className="mt-2 flex flex-wrap gap-4">
                  <button
                    onClick={() => reopen(receipt)}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                  >
                    <RotateCcw size={12} /> Reopen purchase
                  </button>
                  <button
                    onClick={() => deleteRecord(receipt)}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-muted)] hover:text-rose-400"
                  >
                    <Trash2 size={12} /> Delete record
                  </button>
                </div>
              )}
            </Card>
          )
        })
      )}

      {viewing && (
        <PhotoViewer
          photo={viewing}
          onClose={() => setViewing(null)}
          onReplace={async (photo, file) => {
            const { data } = await replacePhoto(photo, file)
            if (data) setViewing(data)
          }}
          onMove={move}
          onDelete={async (photo) => {
            setViewing(null)
            await deletePhoto(photo)
          }}
          onCheckPrices={(photo) => {
            setViewing(null)
            setChecking(photo.trip_id ? `trip:${photo.trip_id}` : `day:${photo.receipt_date}`)
          }}
        />
      )}

      {checked && (
        <PriceCheck
          date={checked.date}
          photos={checked.photos}
          lines={checked.list}
          linkFor={linkFor}
          onSave={(expense, amount) => {
            const item = linkFor(expense)
            return setReceiptLineAmount(expense, amount, item, item && packFor(item))
          }}
          onClose={() => setChecking(null)}
        />
      )}
    </div>
  )
}
