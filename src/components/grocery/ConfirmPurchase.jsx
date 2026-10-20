import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Trash2, X } from 'lucide-react'
import { DateField } from '../ui/DateField'
import { Input, Label, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { CategoryIcon } from '../ui/CategoryIcon'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { PayerPicker, UnitOptions } from './shared'
import { PhotoPicker, PhotoThumb } from './ReceiptPhoto'
import { ShopPicker } from '../expenses/ShopPicker'
import { cn } from '../../lib/cn'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { showToast } from '../../lib/feedback'
import { decimalProblem, parseDecimal } from '../../lib/decimal'
import { formatUnitPrice, money } from '../../lib/pricing'
import { editPatch, editedItem, pantryItemFor, purchaseLine } from '../../lib/purchase'
import { variantOrder } from '../../lib/groups'
import { shopUnits } from '../../lib/groupShop'
import { entryIsOneTime } from '../../lib/oneTime'
import { findMismatches, suggestionChange } from '../../lib/receiptMatch'
import { localDateString, parseLocalDate } from '../../lib/week'
import { usePurchase } from '../../hooks/usePurchase'
import { useReceiptPhotos } from '../../hooks/useReceiptPhotos'

// The last step of shopping: everything in the cart with quantity, unit,
// price, line total and payer (all still editable), the shopping day, and
// an optional receipt photo. Questions about single items (pack size,
// expired stock) are answered here. Nothing is saved to the pantry,
// history or expenses until "Confirm purchase" — then all of it at once,
// with exactly the values on screen: edits are kept here as typed and
// saved to the grocery entries just before confirming.
//
// One confirmation is one shopping trip, at one store (chosen once, for
// every item). With `splitTrips` (supabase/021) items can be left out of
// this trip: they stay in the cart, to confirm as another trip (e.g. the
// second store). An entry ordered online and on the way (`openOrderOf`)
// is never bought here: it says so, with "Cancel the order…"
// (`onCancelOrder`) or "Take out of the cart".
export function ConfirmPurchase({ cartItems, pantryItems, categoryName, totalOf, updatePricing, updatePayer, toggleCart, onClose, openOrderOf = () => null, onCancelOrder = () => {}, splitTrips = false }) {
  const { confirmPurchase } = usePurchase()
  const { photos, addPhoto, deletePhoto } = useReceiptPhotos()
  // One id per purchase: pressing Confirm again after a dropped connection
  // can't save it twice.
  const [tripId] = useState(() => crypto.randomUUID())
  const [date, setDate] = useState(localDateString)
  // Typed dates that aren't real dates yet (the shopping day, or the new
  // expiry date of an item, by key): confirming waits until they are fixed.
  const [badDates, setBadDates] = useState(() => new Set())
  const reportDate = useCallback(
    (key, ok) =>
      setBadDates((prev) => {
        if (prev.has(key) === !ok) return prev
        const next = new Set(prev)
        if (ok) next.delete(key)
        else next.add(key)
        return next
      }),
    []
  )
  // Quantities, totals and pack sizes typed as something that isn't a
  // number (by item id): confirming waits until they are fixed.
  const [badNumbers, setBadNumbers] = useState(() => new Set())
  const reportNumber = useCallback(
    (key, ok) =>
      setBadNumbers((prev) => {
        if (prev.has(key) === !ok) return prev
        const next = new Set(prev)
        if (ok) next.delete(key)
        else next.add(key)
        return next
      }),
    []
  )
  const reportTripDate = useCallback((ok) => reportDate('trip', ok), [reportDate])
  const [shopId, setShopId] = useState('')
  // Items kept in the cart for another trip.
  const [later, setLater] = useState(() => new Set())
  const inTrip = (item) => !later.has(item.id) && !openOrderOf(item)
  const toggleLater = (id) =>
    setLater((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const [answers, setAnswers] = useState({})
  // Ids of the new variants made for group lines, fixed for this screen.
  const variantIds = useRef(new Map())
  const [photoIds, setPhotoIds] = useState([])
  const [busy, setBusy] = useState(false)
  // Edits by item id ({ quantity, unit, total, payer }). Also kept in a ref,
  // so Confirm pressed while a field is still focused sees the last digit.
  const [edits, setEdits] = useState({})
  const editsRef = useRef(edits)
  const edit = (itemId, patch) => {
    editsRef.current = { ...editsRef.current, [itemId]: { ...editsRef.current[itemId], ...patch } }
    setEdits(editsRef.current)
  }

  const itemsFor = (allEdits) => cartItems.map((item) => editedItem(item, allEdits[item.id]))
  const allLines = itemsFor(edits).map((item) => purchaseLine(item, pantryItems, answers[item.id]))
  // A group's lines together in one card, one line per variant (each its
  // own stock and its own expense), variants at 0 first.
  const pantryById = useMemo(() => new Map(pantryItems.map((p) => [p.id, p])), [pantryItems])
  const lineOf = new Map(allLines.map((l) => [l.item.id, l]))
  const groupOfItem = (item) => {
    const entry = pantryItemFor(item, pantryItems)
    if (!entry) return null
    return entry.is_group ? entry : entry.group_id ? pantryById.get(entry.group_id) ?? null : null
  }
  const lineUnits = shopUnits(
    allLines.map((l) => l.item),
    groupOfItem,
    (item) => pantryItemFor(item, pantryItems)
  )
  const lines = allLines.filter((l) => inTrip(l.item))
  const items = lines.map((l) => l.item)
  const total = items.reduce((sum, i) => sum + (totalOf(i) ?? 0), 0)
  const open = lines.filter((l) => !l.ready).length
  const unknown = items.filter((i) => totalOf(i) === null).length
  const leftInCart = allLines.length - lines.length
  // Who paid for the whole trip; null when it was shared out differently.
  const payers = new Set(items.map((i) => i.payer || 'shared'))
  const tripPayer = payers.size === 1 ? [...payers][0] : null
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
    const latest = editsRef.current
    const confirmed = itemsFor(latest).filter(inTrip)
    const confirmedLines = confirmed.map((item) => purchaseLine(item, pantryItems, answers[item.id]))
    if (confirmedLines.length === 0 || confirmedLines.some((l) => !l.ready)) return
    const ids = new Set(confirmed.map((i) => i.id))
    const patches = cartItems.filter((item) => ids.has(item.id)).map((item) => ({ id: item.id, patch: editPatch(item, latest[item.id]) })).filter((p) => Object.keys(p.patch).length)
    const confirmedPayers = new Set(confirmed.map((i) => i.payer || 'shared'))
    setBusy(true)
    const { error } = await confirmPurchase({
      id: tripId,
      date,
      lines: confirmedLines,
      answers,
      totalOf,
      photoIds,
      patches,
      variantIds: variantIds.current,
      shopId: shopId || null,
      paidBy: confirmedPayers.size === 1 ? [...confirmedPayers][0] : null,
    })
    setBusy(false)
    if (error) return
    if (leftInCart > 0) showToast({ message: `${leftInCart} item${leftInCart === 1 ? '' : 's'} stay in the cart — confirm ${leftInCart === 1 ? 'it' : 'them'} as another trip (e.g. the other store).`, duration: 8000 })
    onClose()
  }

  const purchaseLineFor = (line) => (
    <PurchaseLine
      key={line.item.id}
      line={line}
      ordered={openOrderOf(line.item)}
      onCancelOrder={onCancelOrder}
      inTrip={inTrip(line.item)}
      onToggleTrip={splitTrips ? () => toggleLater(line.item.id) : null}
      answer={answers[line.item.id] ?? {}}
      total={totalOf(line.item)}
      categoryName={categoryName}
      onAnswer={(patch) => answer(line.item.id, patch)}
      onDateValidity={(ok) => reportDate(line.item.id, ok)}
      onNumberValidity={reportNumber}
      onEdit={(patch) => edit(line.item.id, patch)}
      updatePricing={updatePricing}
      updatePayer={updatePayer}
      onRemove={() => toggleCart(cartItems.find((i) => i.id === line.item.id))}
    />
  )

  return (
    <div data-unsaved className="fixed inset-0 z-40 bg-[var(--color-bg)] flex flex-col pt-[env(safe-area-inset-top)]">
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
            <DateField id="trip-date" label="Shopping day" required value={date} onChange={setDate} onValidity={reportTripDate} />
          </div>
          <div>
            <Label>Paid by (everything)</Label>
            <div className="flex gap-1 flex-wrap">
              {PAID_BY_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    const trip = cartItems.filter(inTrip)
                    trip.forEach((i) => edit(i.id, { payer: o.value }))
                    updatePayer(trip, o.value)
                  }}
                  className={cn(
                    'px-2.5 py-1.5 rounded-full text-[11px] font-bold border',
                    tripPayer === o.value ? 'bg-[var(--color-accent)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ShopPicker value={shopId} onChange={setShopId} label={splitTrips ? 'Store (for this whole trip)' : undefined} />
        {splitTrips && (
          <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">
            Shopped at two stores? Untick what you bought at the other one: it stays in the cart for a second trip.
          </p>
        )}

        <section className="space-y-2">
          {lineUnits.map((unit) =>
            unit.kind === 'group' ? (
              <div key={unit.key} role="group" aria-label={`${unit.group.name} (group)`} className="rounded-3xl border border-[var(--color-border)] p-2 space-y-2">
                <p className="px-1 text-xs font-extrabold text-[var(--color-text-soft)] flex items-center gap-1.5">
                  <CategoryIcon category={unit.group.category_id} size={13} /> {unit.group.name}
                </p>
                {unit.entries.map((item) => purchaseLineFor(lineOf.get(item.id)))}
              </div>
            ) : (
              purchaseLineFor(lineOf.get(unit.entry.id))
            )
          )}
          {allLines.length === 0 && <p className="text-xs text-[var(--color-text-muted)] text-center py-6">The cart is empty.</p>}
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
              {leftInCart > 0 && ` · ${leftInCart} stay in the cart`}
            </span>
            <span className="text-lg font-mono font-extrabold text-[var(--color-accent)]">{money(total)}</span>
          </div>
          {badDates.size > 0 && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Fix the date (DD/MM/YYYY) above to confirm.
            </p>
          )}
          {badNumbers.size > 0 && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Fix the numbers in red above to confirm.
            </p>
          )}
          {open > 0 && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Answer the {open === 1 ? 'question' : `${open} questions`} above to confirm.
            </p>
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={busy || open > 0 || badDates.size > 0 || badNumbers.size > 0 || lines.length === 0}
            className="w-full py-3 rounded-2xl bg-[var(--color-primary)] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check size={18} /> {busy ? 'Saving…' : `Confirm purchase · ${money(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// One item: quantity, unit and line total to correct, payer, remove, and
// its questions. Every change goes to the screen's edits at once (that's
// what Confirm uses) and is also saved to the grocery entry when the field
// is left, so the other phone sees it.
// `ordered`: the order on the way for this entry (it can't be bought
// here); `inTrip` / `onToggleTrip`: whether it is part of this trip.
function PurchaseLine({ line, answer, total, categoryName, onAnswer, onDateValidity, onEdit, updatePricing, updatePayer, onRemove, ordered = null, onCancelOrder, inTrip = true, onToggleTrip = null, onNumberValidity = () => {} }) {
  const { item, pantry, group, needsVariant, add, needsPackSize, expired, expiredStock } = line
  const [quantityText, setQuantityText] = useState(null)
  const [totalText, setTotalText] = useState(null)

  // A typed number that isn't one is kept as typed (and refused when
  // confirming), never swapped for the old value.
  const numbersBad = Boolean(decimalProblem(quantityText) || decimalProblem(totalText) || decimalProblem(answer.packSizeText))
  useEffect(() => {
    onNumberValidity(item.id, !numbersBad)
    return () => onNumberValidity(item.id, true)
  }, [item.id, numbersBad, onNumberValidity])

  const changeQuantity = (text) => {
    setQuantityText(text)
    const quantity = parseDecimal(text)
    if (quantity > 0) onEdit({ quantity })
  }

  // A total typed here becomes the price for exactly this quantity.
  const changeTotal = (text) => {
    setTotalText(text)
    const amount = Math.round(parseDecimal(text) * 100) / 100
    if (amount >= 0) onEdit({ total: amount })
  }

  // A new unit keeps the line total (the price is now for this unit).
  const changeUnit = (unit) => {
    onEdit(total === null ? { unit } : { unit, total })
    const patch = total === null ? { unit } : { unit, price: total, price_qty: Number(item.quantity) || 1, price_unit: unit }
    updatePricing(item, patch, total)
  }

  const saveToEntry = () => {
    if (numbersBad) return
    setQuantityText(null)
    setTotalText(null)
    updatePricing(item, { quantity: item.quantity, unit: item.unit, price: item.price ?? 0, price_qty: item.price_qty ?? null, price_unit: item.price_unit ?? null }, total)
  }

  const unitPrice = formatUnitPrice(item)
  const needsAnswer = needsPackSize || needsVariant || (expiredStock > 0 && typeof answer.discard !== 'boolean')

  if (ordered) {
    return (
      <div className="rounded-2xl border border-amber-400/60 bg-amber-500/10 p-3 space-y-2">
        <p className="text-sm font-bold text-[var(--color-text)]">{item.name}</p>
        <p className="text-[11px] text-amber-200 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Already ordered on {parseLocalDate(ordered.order_date).toLocaleDateString('en-GB')}
          {ordered.expected_date ? `, expected ${parseLocalDate(ordered.expected_date).toLocaleDateString('en-GB')}` : ''}. It isn't part of this trip, so it isn't recorded twice.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRemove} className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text)]">
            Take out of the cart
          </button>
          <button type="button" onClick={() => onCancelOrder(ordered)} className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text-muted)]">
            Cancel the order…
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('rounded-2xl border p-3 space-y-2 bg-[var(--color-surface)]', needsAnswer && inTrip ? 'border-amber-400/60' : 'border-[var(--color-border)]', !inTrip && 'opacity-60')}>
      {onToggleTrip && (
        <label className="flex items-center gap-2 text-[11px] font-bold text-[var(--color-text-soft)] cursor-pointer">
          <input type="checkbox" checked={inTrip} onChange={onToggleTrip} className="w-4 h-4 accent-[var(--color-primary)]" />
          {inTrip ? 'In this trip' : 'Not in this trip — stays in the cart'}
        </label>
      )}
      <div className="flex items-start gap-2">
        <CategoryIcon category={item.category_id} size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5 min-w-0">
            <span className="truncate">{item.name}</span>
            {entryIsOneTime(item, pantry) && <OneTimeBadge className="shrink-0" />}
          </p>
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
          <DecimalInput
            value={quantityText ?? String(item.quantity)}
            onChange={(e) => changeQuantity(e.target.value)}
            onBlur={saveToEntry}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label={`Quantity of ${item.name}`}
            className="w-20 text-sm p-2 text-right"
          />
          <Select value={item.unit} onChange={(e) => changeUnit(e.target.value)} aria-label={`Unit of ${item.name}`} className="w-auto text-xs p-2">
            <UnitOptions />
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">€</span>
          <DecimalInput
            value={totalText ?? (total === null ? '' : total.toFixed(2))}
            placeholder={total === null ? '?' : '0.00'}
            onChange={(e) => changeTotal(e.target.value)}
            onBlur={saveToEntry}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label={`Total for ${item.name}`}
            className="w-24 text-sm p-2 text-right font-mono"
          />
        </div>
        <div className="ml-auto">
          <PayerPicker
            value={item.payer || 'shared'}
            onChange={(value) => {
              onEdit({ payer: value })
              updatePayer(item, value)
            }}
            size="sm"
          />
        </div>
      </div>
      <DecimalHint value={[quantityText, totalText].find((t) => decimalProblem(t)) ?? ''} />
      {pantry && add > 0 && item.unit !== pantry.unit && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          = {add} {pantry.unit} added to the stock
        </p>
      )}
      {total === null && <p className="text-[10px] text-amber-300">The total can't be worked out from the price's unit — type the total paid.</p>}

      {group && (
        <div className={cn('rounded-xl border p-2 space-y-1.5', needsVariant ? 'bg-amber-500/10 border-amber-400/30' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)]')}>
          <p className="text-[11px] text-[var(--color-text-soft)]">Which variant of "{group.name}" gets this stock?</p>
          <Select
            value={answer.newVariantName !== undefined && !answer.variantId ? 'new' : line.target?.id ?? ''}
            onChange={(e) => (e.target.value === 'new' ? onAnswer({ variantId: null, newVariantName: answer.newVariantName ?? '' }) : onAnswer({ variantId: e.target.value || null, newVariantName: undefined }))}
            aria-label={`Variant for ${item.name}`}
            className="text-xs p-2"
          >
            <option value="">Choose a variant…</option>
            {variantOrder(group.variants).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.current_stock} {v.unit})
              </option>
            ))}
            <option value="new">New variant…</option>
          </Select>
          {answer.newVariantName !== undefined && !answer.variantId && (
            <Input
              value={answer.newVariantName}
              onChange={(e) => onAnswer({ newVariantName: e.target.value })}
              placeholder="Name / brand of the new variant"
              aria-label={`New variant of ${group.name}`}
              className="text-xs p-2"
            />
          )}
        </div>
      )}

      {needsPackSize && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-2 space-y-1">
          <p className="text-[11px] text-amber-200">
            "{pantry.name}" is counted in {pantry.unit} in the pantry. How many {pantry.unit} are in 1 {item.unit}?
          </p>
          <div className="flex items-center gap-1">
            <DecimalInput
              value={answer.packSizeText ?? ''}
              onChange={(e) => onAnswer({ packSizeText: e.target.value, packSize: parseDecimal(e.target.value) })}
              aria-label={`${pantry.unit} in 1 ${item.unit}`}
              className="w-24 text-sm p-2"
            />
            <span className="text-xs text-[var(--color-text-muted)]">{pantry.unit}</span>
          </div>
          <DecimalHint value={answer.packSizeText} />
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
          <div className="space-y-1 text-[11px] text-[var(--color-text-muted)]">
            <span>New expiry date (optional)</span>
            <DateField label="New expiry date" value={answer.expiryDate ?? ''} onChange={(iso) => onAnswer({ expiryDate: iso || null })} onValidity={onDateValidity} />
          </div>
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
