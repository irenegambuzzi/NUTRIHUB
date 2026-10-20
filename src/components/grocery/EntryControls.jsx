import { Minus, Pencil, Plus } from 'lucide-react'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { PriceFields } from '../inventory/PriceFields'
import { cn } from '../../lib/cn'
import { formatPurchaseQuantity, roundQuantity, stepQuantity } from '../../lib/inventory'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
import { formatStockUnitPrice, formatUnitPrice, money, priceUnitOptions } from '../../lib/pricing'

// The quantity and price of one SHOP entry, shared by a single item's tile
// and the rows of a group's card (state: hooks/useEntryEditing.js).

export function QuantityStepper({ item, pack, edit, className }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => edit.changeQuantity(-1)}
        disabled={edit.savingQuantity || stepQuantity(item.quantity, item.unit, -1) === null}
        aria-label={`Buy less ${item.name}`}
        className="bg-[var(--color-surface-soft)] p-1 rounded-lg text-[var(--color-text)] disabled:opacity-40"
      >
        <Minus size={12} />
      </button>
      <button
        type="button"
        onClick={edit.startEditing}
        title="Type the quantity"
        className={cn('min-w-12 px-1.5 text-center text-xs font-bold text-[var(--color-text)]', edit.savingQuantity && 'opacity-50')}
      >
        {formatPurchaseQuantity(item.quantity, item.unit, pack)}
      </button>
      <button
        type="button"
        onClick={() => edit.changeQuantity(1)}
        disabled={edit.savingQuantity}
        aria-label={`Buy more ${item.name}`}
        className="bg-[var(--color-surface-soft)] p-1 rounded-lg text-[var(--color-text)] disabled:opacity-40"
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

// Quantity and price typed in, with Save / Cancel. `children` go above the
// buttons (e.g. who pays).
export function EntryEditor({ item, pack, edit, children = null }) {
  const { draft, setDraft } = edit
  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--color-text-muted)]">Qty</span>
        <DecimalInput
          value={draft.quantity}
          onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
          autoFocus
          className="text-xs p-2"
          aria-label="Quantity"
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">{item.unit}</span>
      </div>
      <DecimalHint value={draft.quantity} />
      <PriceFields
        compact
        value={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        unitOptions={priceUnitOptions(item, pack)}
        line={{ quantity: roundQuantity(draft.quantity, item.unit) || 1, unit: item.unit }}
        pack={pack}
      />
      {children}
      <div className="flex gap-1.5">
        <button type="button" onClick={edit.save} className="flex-1 py-1 rounded-xl bg-[var(--color-primary)] text-white text-[11px] font-bold">
          Save
        </button>
        <button type="button" onClick={edit.cancel} className="px-2 py-1 rounded-xl text-[11px] font-bold text-[var(--color-text-muted)]">
          Cancel
        </button>
      </div>
    </div>
  )
}

// The line total with its unit price; tap to edit. "+ Add price" without one.
export function PriceButton({ item, pack, total, edit, compact = false }) {
  const unitPrice = formatUnitPrice(item)
  const stockUnitPrice = formatStockUnitPrice(item, pack)
  return (
    <button type="button" onClick={edit.startEditing} className={cn('flex flex-col hover:opacity-80 transition', compact ? 'items-end text-right' : 'items-start mt-1.5 text-left')} title="Edit quantity and price">
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
          {stockUnitPrice && !compact && <span className="text-[10px] text-[var(--color-text-muted)] font-mono">≈ {stockUnitPrice}</span>}
        </>
      ) : (
        <span className="text-xs text-[var(--color-text-muted)] font-semibold flex items-center gap-1">
          + Add price <Pencil size={10} className="text-[var(--color-icon-muted)]" />
        </span>
      )}
    </button>
  )
}
