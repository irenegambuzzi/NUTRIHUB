import { useState } from 'react'
import { X, Package, AlertTriangle } from 'lucide-react'
import { DateField, CalendarPick } from '../ui/DateField'
import { formatTypedDate, looksLikeDate, parseTypedDate } from '../../lib/dateInput'
import { Button } from '../ui/Button'
import { Input, Label, Select, Textarea } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { decimalProblem, firstDecimalProblem, moneyText, parseDecimal } from '../../lib/decimal'
import { cn } from '../../lib/cn'
import { DEFAULT_UNIT, PACK_SIZE_PRESETS, PACKAGING_UNITS, SUGGESTED_UNITS, UNIT_GROUPS } from '../../data/constants'
import { purchaseUnitOptions } from '../../lib/units'
import { askDialog, confirmDialog } from '../../lib/feedback'
import { checkMoveIntoGroup } from '../../lib/groups'
import { roundQuantity, unitFactor } from '../../lib/inventory'
import { priceUnitOptions } from '../../lib/pricing'
import { PriceFields } from './PriceFields'
import { CategoryFields } from './CategoryFields'
import { OneTimeToggle } from './OneTimeToggle'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { durableLookalike } from '../../lib/durable'
import { useFlow } from '../../hooks/useFlow'
import { ShopPicker } from '../expenses/ShopPicker'

function initialState(item, group, prefill) {
  const perPack = Number(item?.quantity_per_pack) || ''
  return {
    name: item?.name ?? prefill?.name ?? '',
    category_id: item?.category_id ?? group?.category_id ?? '',
    subcategory_id: item?.subcategory_id ?? group?.subcategory_id ?? '',
    unit: item?.unit ?? group?.unit ?? DEFAULT_UNIT,
    group_id: item?.group_id ?? group?.id ?? '',
    multipack: Boolean(item?.packaging_unit && perPack),
    packaging_unit: item?.packaging_unit ?? PACKAGING_UNITS[0],
    quantity_per_pack: perPack || 6,
    current_stock: item ? String(item.current_stock ?? 0) : '1',
    stockInPacks: false,
    min_stock: item ? String(item.min_stock ?? 0) : '1',
    expiry_date: item?.expiry_date ?? '',
    batch_lot: item?.batch_lot ?? '',
    notes: item?.notes ?? '',
    price: Number(item?.price) > 0 ? moneyText(item.price) : '',
    price_qty: item?.price_qty ? String(item.price_qty) : '1',
    price_unit: item?.price_unit ?? '',
    usual_shop_id: item?.usual_shop_id ?? group?.usual_shop_id ?? '',
    one_time: Boolean(item?.one_time),
  }
}

// Adding or editing a pantry item. For a new item the category is
// suggested from the name until the user picks one; a pick by hand is
// remembered for that name on both phones.
// `asGroup`: making (or editing) a group — a total of variants, with no
// stock, expiry or batch of its own. `groups`: the groups an item can be
// moved into; `group`: the group a new variant is made in; `variantCount`:
// how many variants the edited group has. `prefill` ({ name }): a new item
// that starts with this name and the category suggested for it.
// `allParents`: every HOME main, the Durables tree too (HOME itself offers
// only `parents`), so a name that looks durable can be pointed out.
export function ItemEditor({ item, parents, subsByParent, onAddCategory, onAddSubcategory, onSave, onClose, asGroup = false, groups = [], group = null, variantCount = 0, prefill = null, allParents = null }) {
  const isGroup = asGroup || Boolean(item?.is_group)
  const { suggest, remember } = useCategorySuggestions({ parents, subsByParent })
  const [startPick] = useState(() => (!item && !group && prefill?.name ? suggest(prefill.name) : null))
  const [form, setForm] = useState(() => ({
    ...initialState(item, group, prefill),
    ...(startPick ? { category_id: startPick.categoryId ?? '', subcategory_id: startPick.subcategoryId ?? '' } : {}),
  }))
  const [categoryTouched, setCategoryTouched] = useState(Boolean(item?.category_id || group))
  const [categoryPicked, setCategoryPicked] = useState(false)
  const [suggested, setSuggested] = useState(Boolean(startPick))
  const [categoryError, setCategoryError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unitNote, setUnitNote] = useState('')
  const [expiryValid, setExpiryValid] = useState(true)
  const [groupNote, setGroupNote] = useState('')
  // "Usually bought at" (supabase/021): for items and groups, not variants
  // (their group's store counts).
  const flow = useFlow()
  const showUsualShop = flow.ready && !(form.group_id && !isGroup)
  // A name the keywords call durable (plan 9F): HOME stock is only for
  // consumables. Only a warning — saving stays possible.
  const durablePath = durableLookalike(form.name, { parents: allParents ?? parents, subsByParent })

  // Until a category is picked, it follows the name's suggestion.
  const changeName = (name) => {
    if (categoryTouched) return setForm((f) => ({ ...f, name }))
    const pick = suggest(name)
    setForm((f) => ({ ...f, name, category_id: pick?.categoryId ?? '', subcategory_id: pick?.subcategoryId ?? '' }))
    setSuggested(Boolean(pick))
    if (pick) setCategoryError('')
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  // Quantities snap to their unit's step when the field is left (stock
  // entered in packs snaps like any count).
  const fieldUnit = (f, field) => (field === 'current_stock' && f.multipack && f.stockInPacks ? f.packaging_unit : f.unit)
  const snap = (field) => () => setForm((f) => (decimalProblem(f[field]) ? f : { ...f, [field]: String(roundQuantity(f[field], fieldUnit(f, field))) }))

  // Changing the unit never changes a quantity by itself. For a saved item
  // the user is asked what happens to the stock and the minimum; a new
  // item has nothing to lose.
  const applyUnit = (next, convert) => {
    const factor = unitFactor(form.unit, next)
    const options = purchaseUnitOptions(next, form.packaging_unit)
    const packaging = form.packaging_unit === next ? options[0] : form.packaging_unit
    if (convert && factor !== null && factor !== 1 && !form.stockInPacks) {
      const stock = roundQuantity((parseDecimal(form.current_stock) || 0) * factor, next)
      const min = roundQuantity((parseDecimal(form.min_stock) || 0) * factor, next)
      setForm((f) => ({ ...f, unit: next, packaging_unit: packaging, current_stock: String(stock), min_stock: String(min) }))
      setUnitNote(`Converted from ${form.unit}: stock ${stock} ${next}, minimum ${min} ${next}.`)
    } else {
      setForm((f) => ({ ...f, unit: next, packaging_unit: packaging }))
      setUnitNote(item && next !== item.unit ? `Quantities weren't converted — check stock and minimum in ${next}.` : '')
    }
  }

  const changeUnit = async (e) => {
    const next = e.target.value
    if (next === form.unit) return
    if (!item || isGroup) return applyUnit(next, true)
    const factor = unitFactor(form.unit, next)
    const problem = firstDecimalProblem(form.current_stock, form.min_stock)
    if (problem) return setError(`Fix the stock and minimum first. ${problem}`)
    const stock = parseDecimal(form.current_stock) || 0
    const min = parseDecimal(form.min_stock) || 0
    const options = [
      ...(factor !== null && factor !== 1
        ? [{ value: 'convert', label: 'Convert the numbers', hint: `${stock} ${form.unit} → ${roundQuantity(stock * factor, next)} ${next} (the same amount, counted differently)` }]
        : []),
      { value: 'keep', label: 'Keep the numbers as they are', hint: `${stock} ${form.unit} becomes ${stock} ${next} — a different amount` },
    ]
    const answer = await askDialog({
      title: `Count "${form.name || item.name}" in ${next} instead of ${form.unit}?`,
      message: `Stock is ${stock} ${form.unit} and the minimum ${min} ${form.unit}. Nothing changes until you save — choose what should happen to those numbers.`,
      fields: [{ name: 'how', type: 'choice', options, value: options[0].value }],
      confirmLabel: 'Change unit',
    })
    if (answer) applyUnit(next, answer.how === 'convert')
  }

  // Moving an item into a group: same unit, or a confirmed conversion, or
  // blocked — never mixed silently.
  const changeGroup = async (e) => {
    const id = e.target.value
    setGroupNote('')
    if (!id) return setForm((f) => ({ ...f, group_id: '' }))
    const target = groups.find((g) => g.id === id)
    const check = checkMoveIntoGroup({ ...item, name: form.name || item?.name, unit: form.unit }, target)
    if (check.blocked) return setGroupNote(check.blocked)
    if (check.convert) {
      const stock = roundQuantity((parseDecimal(form.current_stock) || 0) * check.convert.factor, target.unit)
      const ok = await confirmDialog({
        title: `Move into "${target.name}"?`,
        message: `"${target.name}" counts in ${target.unit}, this item in ${form.unit}. Its stock ${form.current_stock} ${form.unit} will be converted to ${stock} ${target.unit} (the same amount). Nothing is saved until you press Save.`,
        confirmLabel: 'Convert and move',
      })
      if (!ok) return
      const min = roundQuantity((parseDecimal(form.min_stock) || 0) * check.convert.factor, target.unit)
      return setForm((f) => ({ ...f, group_id: id, unit: target.unit, current_stock: String(stock), min_stock: String(min) }))
    }
    setForm((f) => ({ ...f, group_id: id }))
  }

  const oneTime = !isGroup && form.one_time
  const perPack = parseDecimal(form.quantity_per_pack) || 0
  const pack = form.multipack ? { unit: form.unit, packaging_unit: form.packaging_unit, quantity_per_pack: perPack } : null
  const priceUnits = priceUnitOptions({ unit: form.unit }, pack)
  const suggestedUnits = SUGGESTED_UNITS[form.category_id] || []
  const unusualUnit = suggestedUnits.length > 0 && !suggestedUnits.includes(form.unit)
  const stockValue = parseDecimal(form.current_stock) || 0
  const baseStock = form.multipack && form.stockInPacks ? stockValue * perPack : stockValue

  // A batch / lot that looks like a date (day, month and year split by
  // "/", "-" or ".") has to be a real one, checked for what was typed, not
  // for lots saved earlier. Like any date, it is only called wrong once the
  // field has lost focus. Plain numbers stay as typed: they are lot codes.
  const [batchLeft, setBatchLeft] = useState(false)
  const batchDateError =
    looksLikeDate(form.batch_lot) && form.batch_lot !== (item?.batch_lot ?? '') ? parseTypedDate(form.batch_lot).error ?? '' : ''
  const batchProblem = batchLeft ? batchDateError : ''
  const batchAsDate = (text) => {
    const { iso } = looksLikeDate(text) ? parseTypedDate(text) : {}
    return iso ? formatTypedDate(iso) : text
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Give the item a name.')
    if (!form.category_id) return setCategoryError('Pick a category (or add a new one).')
    const decimalError = firstDecimalProblem(form.current_stock, form.min_stock, form.price, form.price_qty, form.multipack ? form.quantity_per_pack : '')
    if (decimalError) return setError(decimalError)
    if (form.multipack && perPack <= 0) return setError('Quantity per pack must be more than 0.')
    if (!expiryValid) return setError('Fix the expiry date first (DD/MM/YYYY), or remove it.')
    if (batchDateError) return setError(batchDateError)
    setSaving(true)
    setError('')

    const subcategoryId = form.subcategory_id || null

    const { error: saveError } = await onSave({
      name: form.name.trim(),
      category_id: form.category_id || null,
      subcategory_id: subcategoryId,
      unit: form.unit,
      packaging_unit: form.multipack ? form.packaging_unit : null,
      quantity_per_pack: form.multipack ? perPack : null,
      // A group has no stock, expiry or batch of its own.
      ...(isGroup
        ? item
          ? {}
          : { current_stock: 0, is_group: true }
        : { current_stock: roundQuantity(baseStock, form.unit), expiry_date: form.expiry_date || null, batch_lot: form.batch_lot.trim() || null }),
      // Only sent when it changes: until supabase/018 has been run the
      // column doesn't exist.
      ...(!isGroup && (form.group_id || null) !== (item?.group_id ?? null) ? { group_id: form.group_id || null } : {}),
      // A one-time item has no minimum: a new one gets 0, an edited one
      // keeps what it had (the field is only hidden).
      min_stock: oneTime && !item ? 0 : roundQuantity(form.min_stock, form.unit),
      // A group can never be one-time (the database refuses it too).
      ...(!isGroup ? { one_time: form.one_time } : {}),
      notes: form.notes.trim() || null,
      ...(showUsualShop ? { usual_shop_id: form.usual_shop_id || null } : {}),
      ...(parseDecimal(form.price) > 0
        ? { price: parseDecimal(form.price), price_qty: parseDecimal(form.price_qty) || 1, price_unit: priceUnits.includes(form.price_unit) ? form.price_unit : form.unit }
        : { price: null, price_qty: null, price_unit: null }),
    })
    setSaving(false)
    // The toast explains; the editor stays open so Save can be pressed again.
    if (saveError) return
    if (categoryPicked) remember(form.name, form.category_id, subcategoryId)
    onClose()
  }

  return (
    <div data-unsaved className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">{isGroup ? (item ? 'Edit group' : 'Add a group') : group && !item ? `Add a variant to ${group.name}` : item ? 'Edit item' : 'Add an item'}</p>
          <button type="button" onClick={onClose} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <div>
          <Label>Name</Label>
          <Input autoFocus placeholder={isGroup ? 'e.g. Chips & Snacks' : group ? 'Name or brand, e.g. Lays paprika' : 'e.g. Rice, Dish soap, Paracetamol'} value={form.name} onChange={(e) => changeName(e.target.value)} />
          {durablePath && (
            <p className="text-[11px] text-yellow-300 flex items-start gap-1.5 mt-1">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> “{form.name.trim()}” looks like a durable item ({durablePath}). Durable items don't go into HOME stock — record it in MONEY instead.
            </p>
          )}
        </div>

        <CategoryFields
          categoryId={form.category_id}
          subcategoryId={form.subcategory_id}
          parents={parents}
          subsByParent={subsByParent}
          onAddCategory={onAddCategory}
          onAddSubcategory={onAddSubcategory}
          onChange={(pick) => {
            setForm((f) => ({ ...f, category_id: pick.categoryId, subcategory_id: pick.subcategoryId }))
            setCategoryTouched(true)
            setCategoryPicked(true)
            setSuggested(false)
            setCategoryError('')
          }}
          suggested={suggested}
          error={categoryError}
        />

        <div>
          <Label>Unit (what you count stock in)</Label>
          <Select value={form.unit} onChange={changeUnit} disabled={Boolean(form.group_id) || (isGroup && variantCount > 0)}>
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
          {form.group_id && <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Counted in the unit of its group. Take it out of the group to change it.</p>}
          {isGroup && variantCount > 0 && <p className="text-[11px] text-[var(--color-text-muted)] mt-1">The variants count in this unit — move them out of the group before changing it.</p>}
          {unitNote && <p className="text-[11px] text-[var(--color-text-muted)] mt-1">{unitNote}</p>}
          {unusualUnit && (
            <div className="mt-1.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-2 space-y-1.5">
              <p className="text-[11px] text-yellow-300 flex items-center gap-1.5">
                <AlertTriangle size={12} /> "{form.unit}" is unusual for {parents.find((p) => p.id === form.category_id)?.name}. You can still save it.
              </p>
              <div className="flex flex-wrap gap-1">
                {suggestedUnits.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => changeUnit({ target: { value: u } })}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-surface-soft)] border border-[var(--color-border)] text-[var(--color-text)]"
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-3">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, multipack: !f.multipack, stockInPacks: false, packaging_unit: f.packaging_unit === f.unit ? purchaseUnitOptions(f.unit)[0] : f.packaging_unit }))}
            className={cn(
              'w-full flex items-center gap-2 text-xs font-bold',
              form.multipack ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
            )}
          >
            <Package size={14} />
            {form.multipack ? 'Bought in a different unit' : 'Bought in a different unit? (1 pack = 12 pcs, 1 bottle = 1.5 L, …)'}
          </button>
          {form.multipack && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Purchase unit</Label>
                  <Select value={form.packaging_unit} onChange={set('packaging_unit')}>
                    {purchaseUnitOptions(form.unit, form.packaging_unit).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>{form.unit} per {form.packaging_unit}</Label>
                  <DecimalInput value={form.quantity_per_pack} onChange={set('quantity_per_pack')} />
                  <DecimalHint value={form.quantity_per_pack} />
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

        {!isGroup && (
          <OneTimeToggle
            checked={form.one_time}
            onChange={(checked) => setForm((f) => ({ ...f, one_time: checked }))}
            hint={
              item?.one_time && !form.one_time
                ? 'Turning it off makes it a normal item: at 0 it is Out and goes on the SHOP list like any other.'
                : undefined
            }
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          {!isGroup && (
          <div className={oneTime ? 'col-span-2' : undefined}>
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
            <DecimalInput value={form.current_stock} onChange={set('current_stock')} onBlur={snap('current_stock')} />
            <DecimalHint value={form.current_stock} />
          </div>
          )}
          {!oneTime && (
          <div className={isGroup ? 'col-span-2' : undefined}>
            <Label>Minimum stock ({form.unit})</Label>
            <DecimalInput value={form.min_stock} onChange={set('min_stock')} onBlur={snap('min_stock')} />
            <DecimalHint value={form.min_stock} />
          </div>
          )}
        </div>
        {form.multipack && form.stockInPacks && (
          <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">
            {stockValue} {form.packaging_unit} × {perPack} = {roundQuantity(baseStock, form.unit)} {form.unit}
          </p>
        )}
        <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">
          {isGroup
            ? 'The group goes on the grocery list as one line when the total of its variants falls to the minimum or below, or when one of its variants is at 0.'
            : oneTime
              ? 'One-time: no minimum, and it never goes on the grocery list by itself.'
              : form.group_id
              ? "While it's in a group, the group's minimum decides when to buy — this one isn't used."
              : 'It goes on the grocery list automatically when stock falls to the minimum or below.'}
        </p>

        {!isGroup && !group && (groups.length > 0 || item?.group_id) && (
          <div>
            <Label>Group (optional)</Label>
            <Select value={form.group_id} onChange={changeGroup} aria-label="Group">
              <option value="">No group — a normal item</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.unit})
                </option>
              ))}
            </Select>
            {groupNote && <p className="text-[11px] text-red-400 mt-1">{groupNote}</p>}
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Put it in a group like "Chips &amp; Snacks" to count it with the others. Its stock, expiry, batch and history stay with it.</p>
          </div>
        )}

        {!isGroup && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label>Expiry date</Label>
            <DateField
              label="Expiry date"
              value={form.expiry_date}
              onChange={(expiry_date) => setForm((f) => ({ ...f, expiry_date }))}
              onValidity={setExpiryValid}
            />
          </div>
          <div>
            <Label>Batch / lot (optional)</Label>
            <div className="relative">
              <Input
                value={form.batch_lot}
                onChange={(e) => {
                  setBatchLeft(false)
                  set('batch_lot')(e)
                }}
                onBlur={() => {
                  setBatchLeft(true)
                  setForm((f) => ({ ...f, batch_lot: batchAsDate(f.batch_lot.trim()) }))
                }}
                aria-invalid={Boolean(batchProblem)}
                className={`pr-16 ${batchProblem ? 'border-red-400' : ''}`}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
                {form.batch_lot && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, batch_lot: '' }))}
                    title="Remove batch / lot"
                    aria-label="Remove batch / lot"
                    className="p-1.5 text-[var(--color-icon-muted)] hover:text-[var(--color-text)]"
                  >
                    <X size={14} />
                  </button>
                )}
                <CalendarPick
                  value={looksLikeDate(form.batch_lot) ? parseTypedDate(form.batch_lot).iso : ''}
                  onPick={(iso) => setForm((f) => ({ ...f, batch_lot: formatTypedDate(iso) }))}
                  label="Batch / lot date"
                />
              </div>
            </div>
            {batchProblem && <p className="text-[11px] text-red-400 mt-1">{batchProblem}</p>}
          </div>
        </div>
        )}

        <div>
          <Label>Price (e.g. €2.50 per 500 gr, €1 per can, €6 per pack)</Label>
          <PriceFields
            value={{ price: form.price, price_qty: form.price_qty, price_unit: priceUnits.includes(form.price_unit) ? form.price_unit : form.unit }}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            unitOptions={priceUnits}
          />
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Used as the estimate when this item goes on the grocery list.</p>
        </div>

        {showUsualShop && (
          <div>
            <ShopPicker value={form.usual_shop_id} onChange={(id) => setForm((f) => ({ ...f, usual_shop_id: id }))} label="Usually bought at (optional)" />
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">An online store (e.g. Amazon) means you usually order it: on the SHOP list "Order online" comes first.</p>
          </div>
        )}

        <div>
          <Label>Notes</Label>
          <Textarea className="h-16" value={form.notes} onChange={set('notes')} />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : item ? 'Save changes' : isGroup ? 'Create group' : 'Add to inventory'}
        </Button>
      </form>
    </div>
  )
}
