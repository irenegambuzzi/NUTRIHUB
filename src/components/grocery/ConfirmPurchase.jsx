import { useState } from 'react'
import { AlertTriangle, Check, Trash2, X } from 'lucide-react'
import { Input, Label } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { PayerPicker } from './shared'
import { PhotoPicker, PhotoThumb } from './ReceiptPhoto'
import { cn } from '../../lib/cn'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { parseNumber } from '../../lib/feedback'
import { formatUnitPrice, lineTotal, money } from '../../lib/pricing'
import { purchaseLine } from '../../lib/purchase'
import { findMismatches, suggestionChange } from '../../lib/receiptMatch'
import { localDateString, parseLocalDate } from '../../lib/week'
import { usePurchase } from '../../hooks/usePurchase'
import { useReceiptPhotos } from '../../hooks/useReceiptPhotos'

// The last step of shopping: everything in the cart with quantity, price,
// line total and payer (all still editable), the shopping day, and an
// optional receipt photo. Questions about single items (pack size, expired
// stock) are answered here. Nothing is saved to the pantry, history or
// expenses until "Confirm purchase" — then all of it at once.
export function ConfirmPurchase({ cartItems, pantryItems, categoryName, totalOf, updatePricing, updatePayer, toggleCart, onClose }) {
  const { confirmPurchase } = usePurchase()
  const { photos, addPhoto, deletePhoto } = useReceiptPhotos()
  // One id per purchase: pressing Confirm again after a dropped connection
  // can't save it twice.
  const [tripId] = useState(() => crypto.randomUUID())
  const [date, setDate] = useState(localDateString)
  const [answers, setAnswers] = useState({})
  const [photoIds, setPhotoIds] = useState([])
  const [busy, setBusy] = useState(false)

  const lines = cartItems.map((item) => purchaseLine(item, pantryItems, answers[item.id]))
  const total = cartItems.reduce((sum, i) => sum + (totalOf(i) ?? 0), 0)
  const open = lines.filter((l) => !l.ready).length
  const unknown = cartItems.filter((i) => totalOf(i) === null).length
  const attached = photos.filter((p) => photoIds.includes(p.id))
  // The receipt compared with the cart, once receipts can be read
  // automatically (lib/receiptMatch.js); empty for now.
  const mismatches = findMismatches(attached.flatMap((p) => p.parsed?.lines ?? []), cartItems)

  const answer = (itemId, patch) => setAnswers((a) => ({ ...a, [itemId]: { ...a[itemId], ...patch } }))

  const attach = async (file) => {
    setBusy(true)
    const { data } = await addPhoto(file, date)
    if (data) setPhotoIds((ids) => [...ids, data.id])
    setBusy(false)
  }

  const confirm = async () => {
    setBusy(true)
    const { error } = await confirmPurchase({ id: tripId, date, lines, answers, totalOf, photoIds })
    setBusy(false)
    if (!error) onClose()
  }

  return (
    <div className="fixed inset-0 z-40 bg-[var(--color-bg)] flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <div>
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Confirm purchase</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">Check everything — nothing is added to the pantry or expenses until you confirm.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Back to the cart" className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 max-w-2xl w-full mx-auto">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="trip-date">Shopping day</Label>
            <Input id="trip-date" type="date" value={date} onChange={(e) => setDate(e.target.value || localDateString())} />
          </div>
          <div>
            <Label>Paid by (everything)</Label>
            <div className="flex gap-1 flex-wrap">
              {PAID_BY_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => updatePayer(cartItems, o.value)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-full text-[11px] font-bold border',
                    cartItems.every((i) => (i.payer || 'shared') === o.value) ? 'bg-[var(--color-accent)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="space-y-2">
          {lines.map((line) => (
            <PurchaseLine
              key={line.item.id}
              line={line}
              answer={answers[line.item.id] ?? {}}
              total={totalOf(line.item)}
              categoryName={categoryName}
              onAnswer={(patch) => answer(line.item.id, patch)}
              updatePricing={updatePricing}
              updatePayer={updatePayer}
              onRemove={() => toggleCart(line.item)}
            />
          ))}
          {lines.length === 0 && <p className="text-xs text-[var(--color-text-muted)] text-center py-6">The cart is empty.</p>}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Receipt (optional)</p>
          <div className="flex items-center gap-2 flex-wrap">
            {attached.map((photo) => (
              <div key={photo.id} className="relative">
                <PhotoThumb photo={photo} onOpen={() => {}} />
                <button
                  type="button"
                  onClick={async () => {
                    setPhotoIds((ids) => ids.filter((id) => id !== photo.id))
                    await deletePhoto(photo)
                  }}
                  aria-label="Remove this receipt photo"
                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-icon-muted)]"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <PhotoPicker onFile={attach} compact={attached.length > 0} disabled={busy} />
          </div>
          <ReceiptMismatches mismatches={mismatches} />
        </section>
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-text-muted)]">
              {lines.length} item{lines.length === 1 ? '' : 's'} · {parseLocalDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              {unknown > 0 && ` · ${unknown} without a total`}
            </span>
            <span className="text-lg font-mono font-extrabold text-[var(--color-accent)]">{money(total)}</span>
          </div>
          {open > 0 && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Answer the {open === 1 ? 'question' : `${open} questions`} above to confirm.
            </p>
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={busy || open > 0 || lines.length === 0}
            className="w-full py-3 rounded-2xl bg-[var(--color-primary)] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check size={18} /> {busy ? 'Saving…' : `Confirm purchase · ${money(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// One item: quantity and line total to correct, payer, remove, and its
// questions.
function PurchaseLine({ line, answer, total, categoryName, onAnswer, updatePricing, updatePayer, onRemove }) {
  const { item, pantry, needsPackSize, expired, expiredStock } = line
  const [quantityDraft, setQuantityDraft] = useState(null)
  const [totalDraft, setTotalDraft] = useState(null)

  const saveQuantity = async () => {
    const quantity = parseNumber(quantityDraft)
    setQuantityDraft(null)
    if (!(quantity > 0) || quantity === Number(item.quantity)) return
    await updatePricing(item, { quantity }, lineTotal({ ...item, quantity }, pantry))
  }

  // A total typed here becomes the price for exactly this quantity.
  const saveTotal = async () => {
    const amount = Math.round(parseNumber(totalDraft) * 100) / 100
    setTotalDraft(null)
    if (!(amount >= 0) || amount === total) return
    await updatePricing(item, { price: amount, price_qty: Number(item.quantity) || 1, price_unit: item.unit }, amount)
  }

  const unitPrice = formatUnitPrice(item)
  const needsAnswer = needsPackSize || (expiredStock > 0 && typeof answer.discard !== 'boolean')

  return (
    <div className={cn('rounded-2xl border p-3 space-y-2 bg-[var(--color-surface)]', needsAnswer ? 'border-amber-400/60' : 'border-[var(--color-border)]')}>
      <div className="flex items-start gap-2">
        <CategoryIcon category={item.category_id} size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)] truncate">{item.name}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            {[item.category_id && categoryName(item.category_id), unitPrice, pantry ? `restocks "${pantry.name}"` : line.durable ? 'expense only' : 'new in the pantry'].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Take ${item.name} out of the cart`} className="p-1 text-[var(--color-icon-muted)] hover:text-rose-400">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Input
            inputMode="decimal"
            value={quantityDraft ?? String(item.quantity)}
            onChange={(e) => setQuantityDraft(e.target.value)}
            onBlur={saveQuantity}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label={`Quantity of ${item.name}`}
            className="w-20 text-sm p-2 text-right"
          />
          <span className="text-xs text-[var(--color-text-muted)]">{item.unit}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">€</span>
          <Input
            inputMode="decimal"
            value={totalDraft ?? (total === null ? '' : total.toFixed(2))}
            placeholder={total === null ? '?' : '0.00'}
            onChange={(e) => setTotalDraft(e.target.value)}
            onBlur={saveTotal}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label={`Total for ${item.name}`}
            className="w-24 text-sm p-2 text-right font-mono"
          />
        </div>
        <div className="ml-auto">
          <PayerPicker value={item.payer || 'shared'} onChange={(value) => updatePayer(item, value)} size="sm" />
        </div>
      </div>
      {total === null && <p className="text-[10px] text-amber-300">The total can't be worked out from the price's unit — type the total paid.</p>}

      {needsPackSize && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-2 space-y-1">
          <p className="text-[11px] text-amber-200">
            "{pantry.name}" is counted in {pantry.unit} in the pantry. How many {pantry.unit} are in 1 {item.unit}?
          </p>
          <div className="flex items-center gap-1">
            <Input
              inputMode="decimal"
              value={answer.packSizeText ?? ''}
              onChange={(e) => onAnswer({ packSizeText: e.target.value, packSize: parseNumber(e.target.value) })}
              aria-label={`${pantry.unit} in 1 ${item.unit}`}
              className="w-24 text-sm p-2"
            />
            <span className="text-xs text-[var(--color-text-muted)]">{pantry.unit}</span>
          </div>
        </div>
      )}

      {expired && (
        <div className="rounded-xl bg-purple-500/10 border border-purple-400/30 p-2 space-y-1.5">
          {expiredStock > 0 ? (
            <>
              <p className="text-[11px] text-purple-200">
                The {expiredStock} {pantry.unit} of "{pantry.name}" in the pantry have expired.
              </p>
              <div className="flex gap-1.5 flex-wrap" role="radiogroup">
                {[
                  [true, `Throw them away`],
                  [false, 'Keep them'],
                ].map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={answer.discard === value}
                    onClick={() => onAnswer({ discard: value })}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-[11px] font-bold border',
                      answer.discard === value ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[11px] text-purple-200">"{pantry.name}" had expired.</p>
          )}
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            New expiry date (optional)
            <Input type="date" value={answer.expiryDate ?? ''} onChange={(e) => onAnswer({ expiryDate: e.target.value || null })} className="text-xs p-1.5 w-auto" />
          </label>
        </div>
      )}
    </div>
  )
}

// Differences between the receipt and the cart, with a suggestion each —
// shown once receipts are read automatically. Nothing is applied without
// the user's approval.
function ReceiptMismatches({ mismatches, onApprove }) {
  if (!mismatches.length) return null
  return (
    <div className="rounded-2xl border border-amber-400/40 p-3 space-y-2">
      <p className="text-xs font-bold text-amber-200">The receipt and the cart differ</p>
      {mismatches.map((m, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="flex-1 text-[var(--color-text-soft)]">
            {m.kind === 'not-in-cart' ? `"${m.receipt.description}" is on the receipt but not in the cart` : m.kind === 'not-on-receipt' ? 'In the cart but not on the receipt' : `Different ${m.kind}`}
          </span>
          {onApprove && (
            <button type="button" onClick={() => onApprove(suggestionChange(m))} className="px-2 py-1 rounded-full bg-[var(--color-primary)] text-white font-bold">
              {m.suggestion.action === 'add' ? 'Add' : m.suggestion.action === 'remove' ? 'Remove' : 'Adjust'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
