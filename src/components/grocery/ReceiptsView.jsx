import { useMemo, useState } from 'react'
import { ListChecks, Trash2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { PhotoPicker, PhotoThumb, PhotoViewer } from './ReceiptPhoto'
import { PriceCheck } from './PriceCheck'
import { deleteExpenses, setReceiptLineAmount, useCategoryExpenses, useExpenseCategories } from '../../hooks/useExpenses'
import { useReceiptPhotos } from '../../hooks/useReceiptPhotos'
import { askDialog } from '../../lib/feedback'
import { groupByDate, normName } from '../../lib/grocery'
import { localDateString, parseLocalDate } from '../../lib/week'
import { groceryStore, pantryStore } from '../../lib/stores'

const longDate = (date) => parseLocalDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

// Every checked-off grocery item logs a "Groceries" expense; a receipt is
// one day's worth, with any photos of the paper receipt taken that day.
// Loaded only when this view is open.
export function ReceiptsView() {
  const { categories } = useExpenseCategories()
  const groceriesId = categories.find((c) => c.name === 'Groceries' && !c.parent_id)?.id
  const { expenses, loaded } = useCategoryExpenses(groceriesId)
  const { photos, addPhoto, replacePhoto, movePhoto, deletePhoto } = useReceiptPhotos()
  const { rows: groceryItems } = groceryStore.useRows()
  const { rows: pantryItems } = pantryStore.useRows()
  const [viewing, setViewing] = useState(null) // a photo
  const [checking, setChecking] = useState(null) // a date
  const [busy, setBusy] = useState(false)

  // Days with expenses or photos, newest first.
  const receipts = useMemo(() => {
    const byDate = new Map(groupByDate(expenses).map((r) => [r.date, { ...r, photos: [] }]))
    for (const photo of photos) {
      if (!byDate.has(photo.receipt_date)) byDate.set(photo.receipt_date, { date: photo.receipt_date, list: [], total: 0, photos: [] })
      byDate.get(photo.receipt_date).photos.push(photo)
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [expenses, photos])

  // The grocery entry a receipt line came from (if still on the list), and
  // its pantry item for unit conversions.
  const linkFor = (expense) => groceryItems.find((g) => g.expense_id === expense.id) ?? null
  const packFor = (item) => pantryItems.find((p) => p.id === item.pantry_item_id) ?? pantryItems.find((p) => normName(p.name) === normName(item.name)) ?? null

  const askDate = (title, value) =>
    askDialog({
      title,
      message: 'Which shopping day is this receipt from? The photo is linked to that day’s items.',
      fields: [{ name: 'date', type: 'date', required: true, label: 'Shopping day', value }],
      confirmLabel: 'Save',
    })

  const add = async (file, date) => {
    const day = date ?? (await askDate('Add a receipt photo', receipts[0]?.date ?? localDateString()))?.date
    if (!day) return
    setBusy(true)
    await addPhoto(file, day)
    setBusy(false)
  }

  const move = async (photo) => {
    const answer = await askDate('Move to another day', photo.receipt_date)
    if (answer?.date && answer.date !== photo.receipt_date) {
      await movePhoto(photo, answer.date)
      setViewing(null)
    }
  }

  const checked = receipts.find((r) => r.date === checking)

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
          <p className="text-xs text-[var(--color-text-muted)]">No receipts yet — they appear here as you check off priced items.</p>
        </Card>
      ) : (
        receipts.map(({ date, list, total, photos: dayPhotos }) => (
          <Card key={date} className="rounded-3xl">
            <div className="flex justify-between items-center gap-2 border-b border-[var(--color-border)] pb-2 mb-2">
              <span className="text-xs font-bold text-[var(--color-text)]">{longDate(date)}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
                {list.length > 0 && (
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
              {dayPhotos.map((photo) => (
                <PhotoThumb key={photo.id} photo={photo} onOpen={setViewing} />
              ))}
              <PhotoPicker compact onFile={(file) => add(file, date)} disabled={busy} />
              {dayPhotos.length > 0 && list.length > 0 && (
                <button
                  onClick={() => setChecking(date)}
                  className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-2xl bg-[var(--color-primary)] text-white"
                >
                  <ListChecks size={14} /> Check prices
                </button>
              )}
            </div>

            <div className="space-y-1">
              {list.map((e) => (
                <div key={e.id} className="flex justify-between text-xs text-[var(--color-text-soft)]">
                  <span>{e.description || 'Item'}</span>
                  <span className="font-mono">€{Number(e.amount).toFixed(2)}</span>
                </div>
              ))}
              {list.length === 0 && <p className="text-[11px] text-[var(--color-text-muted)]">No checked-off items on this day.</p>}
            </div>
          </Card>
        ))
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
            setChecking(photo.receipt_date)
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
