import { useState } from 'react'
import { X, Package } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label, Select, Textarea } from '../ui/Field'
import { cn } from '../../lib/cn'
import { DEFAULT_UNIT, PACK_SIZE_PRESETS, PACKAGING_UNITS, UNIT_GROUPS } from '../../data/constants'

const NEW_SUB = '__new__'

function initialState(item, parents) {
  const perPack = Number(item?.quantity_per_pack) || ''
  return {
    name: item?.name ?? '',
    category_id: item?.category_id ?? parents[0]?.id ?? '',
    subcategory_id: item?.subcategory_id ?? '',
    unit: item?.unit ?? DEFAULT_UNIT,
    multipack: Boolean(item?.packaging_unit && perPack),
    packaging_unit: item?.packaging_unit ?? PACKAGING_UNITS[0],
    quantity_per_pack: perPack || 6,
    current_stock: item ? String(item.current_stock ?? 0) : '1',
    stockInPacks: false,
    min_stock: item ? String(item.min_stock ?? 0) : '1',
    expiry_date: item?.expiry_date ?? '',
    batch_lot: item?.batch_lot ?? '',
    notes: item?.notes ?? '',
  }
}

export function ItemEditor({ item, parents, subsByParent, onAddSubcategory, onSave, onClose }) {
  const [form, setForm] = useState(() => initialState(item, parents))
  const [newSubName, setNewSubName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const subs = subsByParent.get(form.category_id) || []
  const perPack = Number(form.quantity_per_pack) || 0
  const stockValue = parseFloat(form.current_stock) || 0
  const baseStock = form.multipack && form.stockInPacks ? stockValue * perPack : stockValue

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Give the item a name.')
    if (form.multipack && perPack <= 0) return setError('Quantity per pack must be more than 0.')
    setSaving(true)
    setError('')

    let subcategoryId = form.subcategory_id || null
    if (subcategoryId === NEW_SUB) {
      if (!newSubName.trim()) {
        setSaving(false)
        return setError('Name the new sub-category.')
      }
      const { data, error: subError } = await onAddSubcategory(form.category_id, newSubName)
      if (subError) {
        setSaving(false)
        return setError('Could not create the sub-category: ' + subError.message)
      }
      subcategoryId = data.id
    }

    const { error: saveError } = await onSave({
      name: form.name.trim(),
      category_id: form.category_id || null,
      subcategory_id: subcategoryId,
      unit: form.unit,
      packaging_unit: form.multipack ? form.packaging_unit : null,
      quantity_per_pack: form.multipack ? perPack : null,
      current_stock: Math.round(baseStock * 100) / 100,
      min_stock: parseFloat(form.min_stock) || 0,
      expiry_date: form.expiry_date || null,
      batch_lot: form.batch_lot.trim() || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (saveError) return setError('Could not save: ' + saveError.message)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">{item ? 'Edit item' : 'Add an item'}</p>
          <button type="button" onClick={onClose} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <div>
          <Label>Name</Label>
          <Input autoFocus placeholder="e.g. Rice, Dish soap, Paracetamol" value={form.name} onChange={set('name')} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Category</Label>
            <Select
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value, subcategory_id: '' }))}
            >
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Sub-category</Label>
            <Select value={form.subcategory_id} onChange={set('subcategory_id')}>
              <option value="">None</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={NEW_SUB}>+ New sub-category…</option>
            </Select>
          </div>
        </div>
        {form.subcategory_id === NEW_SUB && (
          <Input placeholder="New sub-category name" value={newSubName} onChange={(e) => setNewSubName(e.target.value)} />
        )}

        <div>
          <Label>Unit (what you count stock in)</Label>
          <Select value={form.unit} onChange={set('unit')}>
            {UNIT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.units.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-3">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, multipack: !f.multipack, stockInPacks: false }))}
            className={cn(
              'w-full flex items-center gap-2 text-xs font-bold',
              form.multipack ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
            )}
          >
            <Package size={14} />
            {form.multipack ? 'Comes in a multipack' : 'Comes in a multipack? (6-pack, case of 12, …)'}
          </button>
          {form.multipack && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Packaging</Label>
                  <Select value={form.packaging_unit} onChange={set('packaging_unit')}>
                    {PACKAGING_UNITS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>{form.unit} per {form.packaging_unit}</Label>
                  <Input type="number" min="1" step="1" value={form.quantity_per_pack} onChange={set('quantity_per_pack')} />
                </div>
              </div>
              <div className="flex gap-1.5">
                {PACK_SIZE_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, quantity_per_pack: n }))}
                    className={cn(
                      'px-3 py-1 rounded-full text-[11px] font-bold border',
                      perPack === n
                        ? 'bg-[var(--color-primary)] border-transparent text-white'
                        : 'bg-[var(--color-surface-soft)] border-[var(--color-border)] text-[var(--color-text-muted)]'
                    )}
                  >
                    {n}-{form.packaging_unit}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                1 {form.packaging_unit} = {perPack || '?'} {form.unit}
              </p>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex justify-between items-center">
              <Label>Current stock</Label>
              {form.multipack && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, stockInPacks: !f.stockInPacks }))}
                  className="text-[10px] font-bold text-[var(--color-accent)] mb-1"
                >
                  in {form.stockInPacks ? form.packaging_unit : form.unit} ⇄
                </button>
              )}
            </div>
            <Input type="number" min="0" step="0.01" value={form.current_stock} onChange={set('current_stock')} />
          </div>
          <div>
            <Label>Minimum stock ({form.unit})</Label>
            <Input type="number" min="0" step="0.01" value={form.min_stock} onChange={set('min_stock')} />
          </div>
        </div>
        {form.multipack && form.stockInPacks && (
          <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">
            {stockValue} {form.packaging_unit} × {perPack} = {baseStock} {form.unit}
          </p>
        )}
        <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">
          It goes on the grocery list automatically when stock falls to the minimum or below.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Expiry date</Label>
            <Input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
          </div>
          <div>
            <Label>Batch / lot (optional)</Label>
            <Input value={form.batch_lot} onChange={set('batch_lot')} />
          </div>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea className="h-16" value={form.notes} onChange={set('notes')} />
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add to inventory'}
        </Button>
      </form>
    </div>
  )
}
