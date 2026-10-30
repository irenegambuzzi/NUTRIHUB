import { useState } from 'react'
import { Input, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { parseDecimal } from '../../lib/decimal'
import { toBaseQuantity } from '../../lib/inventory'
import { normalizeUnit } from '../../lib/units'
import { hasPackField, packField, packStartText, packTextFor } from '../../lib/packSize'
import { PackSizeField } from '../ui/PackSizeField'

// Adding bought stock by hand: a quantity in the stock unit or, when the
// item has a purchase unit, in that ("2 pack" = 24 pcs). `variants`, for a
// group: which variant the stock goes to, or a new one. Calls
// onSubmit({ delta, variantId | newName }) with the amount in the stock
// unit. `initial` ({ quantity, unit, packSize }) starts it with what was
// ordered; a unit that converts to the stock unit (kg → gr) is offered too.
// `packs` (Arrived, plan 9H): bought in a package, it asks how many stock
// units are in 1 package of THIS arrival — the pack field, started with
// the order's own size (`initial.packSize`) for its unit, else the item's
// usual size, and required; the order's unit is offered when it is such a
// package ("1 pack" of an item usually bought by the box). `canSaveUsual`:
// this arrival may save a first-time usual size (onSubmit then gets
// `pack.firstTime`). Restocking in HOME has no pack field (unchanged).
// `initial.variantId`: the variant chosen at the start (a group).
export function RestockForm({ item, variants = null, onSubmit, onClose, initial = null, submitLabel = 'Add to stock', packs = false, canSaveUsual = false }) {
  const purchaseUnit = item.packaging_unit && Number(item.quantity_per_pack) > 0 ? item.packaging_unit : null
  const orderedUnit = initial?.unit ? normalizeUnit(initial.unit) : null
  const packUnit = packs && orderedUnit && orderedUnit !== purchaseUnit && hasPackField(item, orderedUnit) ? orderedUnit : null
  const extraUnit = orderedUnit && orderedUnit !== purchaseUnit && orderedUnit !== item.unit && toBaseQuantity(item, 1, orderedUnit) !== null ? orderedUnit : null
  // The ordered quantity is only proposed in a unit that converts to the
  // stock unit (the purchase unit, kg ↔ gr…) or, with the pack field, in
  // its own package: never a number in another unit.
  const orderedUnitConverts = !orderedUnit || toBaseQuantity(item, 1, orderedUnit) !== null || Boolean(packUnit)
  const [text, setText] = useState(initial?.quantity > 0 && orderedUnitConverts ? String(initial.quantity) : '1')
  const [unit, setUnit] = useState(packUnit ?? extraUnit ?? (orderedUnit === item.unit ? item.unit : purchaseUnit ?? item.unit))
  const [packTyped, setPackTyped] = useState(() => (packs && Number(initial?.packSize) > 0 && orderedUnit ? { text: String(Number(initial.packSize)), unit: orderedUnit } : null))
  const [target, setTarget] = useState(variants?.some((v) => v.id === initial?.variantId) ? initial.variantId : variants?.length ? variants[0].id : 'new')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const quantity = parseDecimal(text)
  const pack = packs ? packField({ item, unit, quantity: quantity > 0 ? quantity : 1, text: packTextFor(packTyped, unit, packStartText(item, unit)), canSave: canSaveUsual }) : null
  const delta = !(quantity > 0) ? null : pack ? (pack.value ? quantity * pack.value : null) : toBaseQuantity(item, quantity, unit)
  const base = delta === null ? null : Math.round(delta * 100) / 100
  const needsName = variants && target === 'new' && !newName.trim()
  const valid = base > 0 && !needsName

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const packed = pack ? { pack: { unit: pack.unit, value: pack.value, firstTime: pack.firstTime } } : {}
    const { error } = (await onSubmit(variants ? { delta: base, variantId: target === 'new' ? null : target, newName: newName.trim(), ...packed } : { delta: base, ...packed })) ?? {}
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
        <DecimalInput value={text} onChange={(e) => setText(e.target.value)} className="w-16 text-sm p-2 text-right" aria-label="Quantity bought" autoFocus />
        <Select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-auto text-xs p-2" aria-label="Unit">
          {purchaseUnit && <option value={purchaseUnit}>{purchaseUnit}</option>}
          {packUnit && <option value={packUnit}>{packUnit}</option>}
          <option value={item.unit}>{item.unit}</option>
          {extraUnit && <option value={extraUnit}>{extraUnit}</option>}
        </Select>
      </div>
      <DecimalHint value={text} />
      {pack && <PackSizeField pack={pack} onChange={(value) => setPackTyped({ text: value, unit: pack.unit })} />}
      {base > 0 && unit !== item.unit && !pack && (
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
