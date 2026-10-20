import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Minus, Pencil, Plus, PackagePlus, ShoppingCart, Trash, Trash2, Unlink, CalendarClock } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { RestockForm } from './RestockForm'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { STOCK_STATUS_LABELS, displayReason, expiryLabel, expiryState, formatStock, stockFill, stockStatus, tapStep } from '../../lib/inventory'
import { formatUnitPrice } from '../../lib/pricing'
import { EXPIRY_STYLES, RESTOCK_LABELS, STATUS_STYLES } from '../../lib/inventoryStyles'
import { isOneTime } from '../../lib/oneTime'
import { OneTimeBadge } from '../ui/OneTimeBadge'

const newBadge = (
  <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full self-center', RESTOCK_LABELS.new.className)}>{RESTOCK_LABELS.new.label}</span>
)

// A group ("Chips & Snacks") as one card: the total of its variants,
// coloured by that total and the group's own minimum like any item. Open
// it to see and change each variant (A–Z; finished one-time variants are
// not passed in: they are listed under "Finished one-time items").
export function GroupTile({ group, variants, newIds, isNew, subcategoryName, onAdjust, onDiscard, onEdit, onDelete, onSendToGrocery, onAddVariant, onTakeOut, onRestock }) {
  const [open, setOpen] = useState(false)
  const [restocking, setRestocking] = useState(false)
  const c = inventoryCategoryColor(group.category_id)
  const status = stockStatus(group)
  const tone = displayReason(group) || 'ok'
  const unitPrice = formatUnitPrice(group)

  return (
    <div className={cn('relative rounded-3xl border p-3.5 shadow-sm flex flex-col', STATUS_STYLES[tone].tile, open && 'col-span-full')}>
      <div className="absolute top-2 right-2 flex gap-0.5">
        <button onClick={() => onEdit(group)} title="Edit group" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
          <Pencil size={12} />
        </button>
        <button onClick={() => onDelete(group)} title="Delete group" className="text-[var(--color-icon-muted)] hover:text-rose-400 p-1">
          <Trash2 size={12} />
        </button>
      </div>

      <div className={cn('w-9 h-9 rounded-2xl flex items-center justify-center mb-2 text-white', c.solid)}>
        <CategoryIcon category={group.category_id} size={18} />
      </div>
      <button onClick={() => onEdit(group)} className="text-left pr-10">
        <p className="text-sm font-bold leading-tight text-[var(--color-text)]">{group.name}</p>
      </button>
      {subcategoryName && (
        <span className={cn('self-start mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', c.bg, c.border, c.text)}>{subcategoryName}</span>
      )}

      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 bg-[var(--color-surface-soft)] text-[var(--color-text-soft)]">
          <Layers size={10} /> {variants.length} variant{variants.length === 1 ? '' : 's'}
        </span>
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[status].badge)}>{STOCK_STATUS_LABELS[status]}</span>
        {isNew && newBadge}
      </div>

      <p className="text-[11px] text-[var(--color-text-soft)] mt-2">Total: {formatStock(group)}</p>
      <div className="h-1.5 rounded-full bg-[var(--color-surface-soft)] mt-1 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', STATUS_STYLES[tone].bar)} style={{ width: `${stockFill(group) * 100}%` }} />
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
        min {Number(group.min_stock) || 0} {group.unit}
        {unitPrice && <span className="font-mono text-[var(--color-accent)]"> · {unitPrice}</span>}
      </p>

      <div className="flex flex-wrap items-center gap-1 mt-auto pt-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="bg-[var(--color-surface-soft)] px-2 py-1.5 rounded-xl text-[10px] font-bold text-[var(--color-text)] flex items-center gap-1"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? 'Hide' : 'Variants'}
        </button>
        <button onClick={() => setRestocking((r) => !r)} title="Add bought stock" aria-expanded={restocking} className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)]">
          <PackagePlus size={14} />
        </button>
        <button onClick={() => onSendToGrocery(group)} title="Add to grocery list" className="ml-auto bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-accent)]">
          <ShoppingCart size={14} />
        </button>
        {restocking && <RestockForm item={group} variants={variants} onSubmit={(args) => onRestock(group, args)} onClose={() => setRestocking(false)} />}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">
          {variants.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No variants yet — add one, or move existing items in from their Edit form.</p>}
          {variants.map((v) => (
            <VariantRow key={v.id} group={group} variant={v} isNew={newIds.has(v.id)} onAdjust={onAdjust} onDiscard={onDiscard} onEdit={onEdit} onTakeOut={onTakeOut} />
          ))}
          <button onClick={() => onAddVariant(group)} className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)]">
            <Plus size={13} /> Add a variant
          </button>
        </div>
      )}
    </div>
  )
}

function VariantRow({ group, variant: v, isNew, onAdjust, onDiscard, onEdit, onTakeOut }) {
  const [restocking, setRestocking] = useState(false)
  const expiry = expiryState(v)
  const step = tapStep(v.unit)
  // A variant without a purchase unit of its own buys in the group's.
  const buyable = v.packaging_unit ? v : { ...v, packaging_unit: group.packaging_unit, quantity_per_pack: group.quantity_per_pack }
  return (
    <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)] break-words">{v.name}</p>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <span className="text-[11px] text-[var(--color-text-soft)]">{formatStock(v)}</span>
            {isOneTime(v) && <OneTimeBadge />}
            {isNew && newBadge}
            {expiry !== 'none' && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1', EXPIRY_STYLES[expiry])}>
                <CalendarClock size={10} />
                {expiryLabel(v)}
              </span>
            )}
            {v.batch_lot && <span className="text-[10px] text-[var(--color-text-muted)]">lot {v.batch_lot}</span>}
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
          <button onClick={() => onEdit(v)} title="Edit variant" aria-label={`Edit ${v.name}`} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1.5">
            <Pencil size={13} />
          </button>
          <button onClick={() => onTakeOut(v)} title="Take out of the group (becomes a normal item again)" aria-label={`Take ${v.name} out of the group`} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1.5">
            <Unlink size={13} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {expiry === 'expired' && (
          <button onClick={() => onDiscard(v)} className={cn('px-2 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1', EXPIRY_STYLES.expired)}>
            <Trash size={12} /> Discard
          </button>
        )}
        <button
          onClick={() => onAdjust(v, -step)}
          disabled={Number(v.current_stock) <= 0}
          title={`Use ${step} ${v.unit}`}
          aria-label={`Use ${step} ${v.unit} of ${v.name}`}
          className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)] disabled:opacity-40"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => onAdjust(v, step)}
          title={`Add ${step} ${v.unit}`}
          aria-label={`Add ${step} ${v.unit} to ${v.name}`}
          className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)]"
        >
          <Plus size={14} />
        </button>
        <button onClick={() => setRestocking((r) => !r)} title="Add bought stock" aria-expanded={restocking} className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)]">
          <PackagePlus size={14} />
        </button>
        {restocking && <RestockForm item={buyable} onSubmit={({ delta }) => onAdjust(v, delta, 'restocked')} onClose={() => setRestocking(false)} />}
      </div>
    </div>
  )
}
