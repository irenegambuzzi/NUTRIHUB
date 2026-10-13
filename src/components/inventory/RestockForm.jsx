import { useState } from 'react'
import { Input, Select } from '../ui/Field'
import { parseNumber } from '../../lib/feedback'
import { toBaseQuantity } from '../../lib/inventory'

// Adding bought stock by hand: a quantity in the stock unit or, when the
// item has a purchase unit, in that ("2 pack" = 24 pcs). `variants`, for a
// group: which variant the stock goes to, or a new one. Calls
// onSubmit({ delta, variantId | newName }) with the amount in the stock
// unit. `initial` ({ quantity, unit }) starts it with what was ordered; a
// unit that converts to the stock unit (kg → gr) is offered too.
export function RestockForm({ item, variants = null, onSubmit, onClose, initial = null, submitLabel = 'Add to stock' }) {
  const purchaseUnit = item.packaging_unit && Number(item.quantity_per_pack) > 0 ? item.packaging_unit : null
  const extraUnit = initial?.unit && initial.unit !== purchaseUnit && initial.unit !== item.unit && toBaseQuantity(item, 1, initial.unit) !== null ? initial.unit : null
  const [text, setText] = useState(initial?.quantity > 0 ? String(initial.quantity) : '1')
  const [unit, setUnit] = useState(extraUnit ?? (initial?.unit === item.unit ? item.unit : purchaseUnit ?? item.unit))
  const [target, setTarget] = useState(variants?.length ? variants[0].id : 'new')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const quantity = parseNumber(text)
  const delta = quantity > 0 ? toBaseQuantity(item, quantity, unit) : null
  const base = delta === null ? null : Math.round(delta * 100) / 100
  const needsName = variants && target === 'new' && !newName.trim()
  const valid = base > 0 && !needsName

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const { error } = (await onSubmit(variants ? { delta: base, variantId: target === 'new' ? null : target, newName: newName.trim() } : { delta: base })) ?? {}
    setBusy(false)
    if (!error) onClose()
  }

  return (
    <form onSubmit={submit} className="basis-full space-y-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      {variants && (
        <>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="text-xs p-2" aria-label="Which variant">
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value="new">New variant…</option>
          </Select>
          {target === 'new' && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name / brand of the new variant" className="text-xs p-2" aria-label="New variant name" />}
        </>
      )}
      <div className="flex items-center gap-1.5">
        <Input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className="w-16 text-sm p-2 text-right" aria-label="Quantity bought" autoFocus />
        <Select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-auto text-xs p-2" aria-label="Unit">
          {purchaseUnit && <option value={purchaseUnit}>{purchaseUnit}</option>}
          <option value={item.unit}>{item.unit}</option>
          {extraUnit && <option value={extraUnit}>{extraUnit}</option>}
        </Select>
      </div>
      {base > 0 && unit !== item.unit && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          = {base} {item.unit} added to the stock
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!valid || busy} className="flex-1 py-1.5 rounded-xl bg-[var(--color-primary)] text-white text-[11px] font-bold disabled:opacity-40">
          {busy ? 'Adding…' : submitLabel}
        </button>
        <button type="button" onClick={onClose} className="px-2 py-1.5 rounded-xl text-[11px] font-bold text-[var(--color-text-muted)]">
          Cancel
        </button>
      </div>
    </form>
  )
}
