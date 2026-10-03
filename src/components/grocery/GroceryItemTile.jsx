import { useState } from 'react'
import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { Input } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { PriceFields } from '../inventory/PriceFields'
import { PayerPicker } from './shared'
import { payerLabel } from '../../lib/grocery'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { quantityStep, roundQuantity, stepQuantity } from '../../lib/inventory'
import { RESTOCK_LABELS, STATUS_STYLES } from '../../lib/inventoryStyles'
import { formatUnitPrice, lineTotal, money, priceUnitOptions } from '../../lib/pricing'

export function GroceryItemTile({ item, reason, pack, total, budgetMark, categoryName, onToggle, onDelete, onUpdatePricing, onUpdatePayer }) {
  const c = inventoryCategoryColor(item.category_id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [savingQuantity, setSavingQuantity] = useState(false)
  const label = RESTOCK_LABELS[reason]
  const unitPrice = formatUnitPrice(item)
  const priceUnits = priceUnitOptions(item, pack)

  const startEditing = () => {
    setDraft({
      quantity: String(item.quantity ?? 1),
      price: Number(item.price) > 0 ? String(item.price) : '',
      price_qty: String(item.price_qty || 1),
      price_unit: item.price_unit || item.unit,
    })
    setEditing(true)
  }

  // − / + on the tile: saves right away, with the line total (and the
  // budget) following. One change at a time, so quick taps never use a
  // stale quantity.
  const changeQuantity = async (direction) => {
    const quantity = stepQuantity(item.quantity, item.unit, direction)
    if (quantity === null || savingQuantity) return
    setSavingQuantity(true)
    await onUpdatePricing(item, { quantity }, lineTotal({ ...item, quantity }, pack))
    setSavingQuantity(false)
  }

  const save = async () => {
    const price = parseFloat(draft.price) || 0
    const patch = {
      // Stock was already added for a checked-off item, so its quantity stays.
      quantity: item.completed ? item.quantity : roundQuantity(draft.quantity, item.unit) || 1,
      price,
      price_qty: price > 0 ? parseFloat(draft.price_qty) || 1 : null,
      price_unit: price > 0 ? draft.price_unit : null,
    }
    const { error } = await onUpdatePricing(item, patch, lineTotal({ ...item, ...patch }, pack))
    if (!error) setEditing(false)
  }

  // Background follows why the item is here: red Out, yellow Low,
  // purple Expired, blue New; items already in stock keep their
  // category colour.
  const tone = STATUS_STYLES[reason]?.tile ?? cn(c.bg, c.border)

  return (
    <div
      className={cn(
        'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
        item.completed ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : tone,
        budgetMark === 'over' && 'opacity-60'
      )}
    >
      <button
        onClick={() => onDelete(item)}
        className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-red-400 transition p-1 z-10"
      >
        <Trash2 size={13} />
      </button>

      <button onClick={() => onToggle(item)} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
        <div
          className={cn(
            'w-9 h-9 rounded-2xl flex items-center justify-center mb-2 transition-all duration-200',
            item.completed ? 'bg-[var(--color-primary)] text-white' : cn(c.solid, 'text-white')
          )}
        >
          {item.completed ? <Check size={18} /> : <CategoryIcon category={item.category_id} size={18} />}
        </div>

        <p className={cn('text-sm font-bold leading-tight pr-4', item.completed ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          {item.completed && `${item.quantity} ${item.unit} · `}
          {categoryName(item.category_id)}
        </p>
      </button>

      {!item.completed && (
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={() => changeQuantity(-1)}
            disabled={savingQuantity || stepQuantity(item.quantity, item.unit, -1) === null}
            aria-label={`Buy less ${item.name}`}
            className="bg-[var(--color-surface-soft)] p-1 rounded-lg text-[var(--color-text)] disabled:opacity-40"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={startEditing}
            title="Type the quantity"
            className={cn('min-w-12 px-1.5 text-center text-xs font-bold text-[var(--color-text)]', savingQuantity && 'opacity-50')}
          >
            {item.quantity} {item.unit}
          </button>
          <button
            onClick={() => changeQuantity(1)}
            disabled={savingQuantity}
            aria-label={`Buy more ${item.name}`}
            className="bg-[var(--color-surface-soft)] p-1 rounded-lg text-[var(--color-text)] disabled:opacity-40"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {!item.completed && (label || budgetMark) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {label && <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full', label.className)}>{label.label}</span>}
          {budgetMark === 'fits' && <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full', STATUS_STYLES.ok.badge)}>Buy first</span>}
          {budgetMark === 'over' && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[var(--color-surface-soft)] text-[var(--color-text-muted)]">Over budget</span>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">Qty</span>
            <Input
              type="number"
              min="0"
              step={quantityStep(item.unit)}
              value={draft.quantity}
              onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              disabled={item.completed}
              autoFocus={!item.completed}
              className="text-xs p-2"
              aria-label="Quantity"
            />
            <span className="text-[10px] text-[var(--color-text-muted)]">{item.unit}</span>
          </div>
          {item.completed && (
            <p className="text-[10px] text-[var(--color-text-muted)]">Uncheck it to change the quantity — its stock was already added.</p>
          )}
          <PriceFields
            compact
            value={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            unitOptions={priceUnits}
            line={{ quantity: roundQuantity(draft.quantity, item.unit) || 1, unit: item.unit }}
            pack={pack}
          />
          <div className="flex gap-1.5">
            <button onClick={save} className="flex-1 py-1 rounded-xl bg-[var(--color-primary)] text-white text-[11px] font-bold">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-1 rounded-xl text-[11px] font-bold text-[var(--color-text-muted)]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startEditing} className="flex flex-col items-start mt-1.5 hover:opacity-80 transition text-left" title="Edit quantity and price">
          {unitPrice ? (
            <>
              {total === null ? (
                <span
                  className={cn('text-sm font-mono font-bold flex items-center gap-1', STATUS_STYLES.low.text)}
                  title={`Can't convert ${item.unit} to the price's unit — set the pack size or change the price unit.`}
                >
                  ? <Pencil size={10} className="text-[var(--color-icon-muted)]" />
                </span>
              ) : (
                <span className="text-sm font-mono font-bold text-[var(--color-accent)] flex items-center gap-1">
                  {money(total)} <Pencil size={10} className="text-[var(--color-icon-muted)]" />
                </span>
              )}
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{unitPrice}</span>
            </>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)] font-semibold flex items-center gap-1">
              + Add price <Pencil size={10} className="text-[var(--color-icon-muted)]" />
            </span>
          )}
        </button>
      )}

      <div className="mt-1.5" title={`Paid by ${payerLabel(item.payer)}`}>
        <PayerPicker value={item.payer || 'shared'} onChange={(value) => onUpdatePayer(item, value)} size="sm" />
      </div>
    </div>
  )
}
