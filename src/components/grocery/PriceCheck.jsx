import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '../ui/Field'
import { PhotoView } from './ReceiptPhoto'
import { money } from '../../lib/pricing'
import { parseNumber } from '../../lib/feedback'
import { parseLocalDate } from '../../lib/week'

// "Check prices": a receipt photo next to that day's items and prices
// (stacked on a phone). Each price can be corrected right there; the
// expense — and the grocery entry it came from — follow.
export function PriceCheck({ date, photos, lines, linkFor, onSave, onClose }) {
  const [photoIndex, setPhotoIndex] = useState(0)
  const photo = photos[Math.min(photoIndex, photos.length - 1)]
  const total = lines.reduce((sum, e) => sum + Number(e.amount || 0), 0)

  return (
    <div className="fixed inset-0 z-40 bg-[var(--color-bg)] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <div>
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Check prices</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {parseLocalDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="h-[45vh] md:h-auto md:flex-1 flex flex-col p-3 gap-2 border-b md:border-b-0 md:border-r border-[var(--color-border)]">
          {photo ? <PhotoView photo={photo} className="flex-1 min-h-0" /> : <p className="text-xs text-[var(--color-text-muted)] m-auto">No photo for this day yet.</p>}
          {photos.length > 1 && (
            <div className="flex justify-center gap-1">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPhotoIndex(i)}
                  aria-label={`Photo ${i + 1}`}
                  className={`w-2.5 h-2.5 rounded-full ${i === photoIndex ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5 md:max-w-sm">
          {lines.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">No items were checked off on this day.</p>
          ) : (
            lines.map((e) => <PriceLine key={e.id} expense={e} linked={Boolean(linkFor(e))} onSave={onSave} />)
          )}
          <div className="flex justify-between items-center pt-2 mt-1 border-t border-[var(--color-border)] text-sm font-bold">
            <span className="text-[var(--color-text-soft)]">Total</span>
            <span className="font-mono text-[var(--color-accent)]">{money(total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// One line: name and an editable price, saved when the field is left or
// Enter is pressed.
function PriceLine({ expense, linked, onSave }) {
  const [draft, setDraft] = useState(null) // null = not editing
  const [saving, setSaving] = useState(false)
  const shown = draft ?? Number(expense.amount).toFixed(2)

  const save = async () => {
    if (draft === null) return
    const amount = Math.round(parseNumber(draft) * 100) / 100
    if (!(amount >= 0) || amount === Number(expense.amount)) return setDraft(null)
    setSaving(true)
    const { error } = await onSave(expense, amount)
    setSaving(false)
    if (!error) setDraft(null)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-[var(--color-text)] truncate">{expense.description || 'Item'}</span>
        {!linked && <span className="block text-[10px] text-[var(--color-text-muted)]">Only the expense changes (no longer on the list)</span>}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">€</span>
      <Input
        inputMode="decimal"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(null)
        }}
        disabled={saving}
        aria-label={`Price of ${expense.description || 'item'}`}
        className="w-24 text-right font-mono text-sm p-2"
      />
    </div>
  )
}
