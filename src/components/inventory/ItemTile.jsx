import { Minus, Plus, Pencil, Trash2, ShoppingCart, CalendarClock } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { STOCK_STATUS_LABELS, expiryLabel, expiryState, formatStock, restockReason, stockFill, stockStatus } from '../../lib/inventory'
import { formatUnitPrice } from '../../lib/pricing'
import { EXPIRY_STYLES, STATUS_STYLES } from '../../lib/inventoryStyles'

// One tap changes stock by a sensible amount for the unit.
function stepFor(unit) {
  if (unit === 'gr' || unit === 'ml') return 100
  if (unit === 'kg' || unit === 'L') return 0.5
  return 1
}

export function ItemTile({ item, subcategoryName, onAdjust, onEdit, onDelete, onSendToGrocery }) {
  const c = inventoryCategoryColor(item.category_id)
  const status = stockStatus(item)
  // Tile colour: red Out, purple Expired, yellow Low, green OK.
  const tone = restockReason(item) || 'ok'
  const unitPrice = formatUnitPrice(item)
  const expiry = expiryState(item)
  const step = stepFor(item.unit)
  const perPack = Number(item.quantity_per_pack)
  const hasPack = item.packaging_unit && perPack > 0

  return (
    <div className={cn('relative rounded-3xl border p-3.5 shadow-sm flex flex-col', STATUS_STYLES[tone].tile)}>
      <div className="absolute top-2 right-2 flex gap-0.5">
        <button onClick={() => onEdit(item)} title="Edit" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
          <Pencil size={12} />
        </button>
        <button
          onClick={() => window.confirm(`Remove "${item.name}" from the inventory?`) && onDelete(item.id)}
          title="Delete"
          className="text-[var(--color-icon-muted)] hover:text-rose-400 p-1"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className={cn('w-9 h-9 rounded-2xl flex items-center justify-center mb-2 text-white', c.solid)}>
        <CategoryIcon category={item.category_id} size={18} />
      </div>

      <button onClick={() => onEdit(item)} className="text-left pr-10">
        <p className="text-sm font-bold leading-tight text-[var(--color-text)]">{item.name}</p>
      </button>
      {subcategoryName && (
        <span className={cn('self-start mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', c.bg, c.border, c.text)}>{subcategoryName}</span>
      )}

      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[status].badge)}>{STOCK_STATUS_LABELS[status]}</span>
        {expiry !== 'none' && (
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1', EXPIRY_STYLES[expiry])}>
            <CalendarClock size={10} />
            {expiryLabel(item)}
          </span>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-text-soft)] mt-2">{formatStock(item)}</p>
      <div className="h-1.5 rounded-full bg-[var(--color-surface-soft)] mt-1 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', STATUS_STYLES[tone].bar)} style={{ width: `${stockFill(item) * 100}%` }} />
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
        min {Number(item.min_stock) || 0} {item.unit}
        {unitPrice && <span className="font-mono text-[var(--color-accent)]"> · {unitPrice}</span>}
      </p>

      <div className="flex flex-wrap items-center gap-1 mt-auto pt-2">
        <button
          onClick={() => onAdjust(item, -step)}
          disabled={Number(item.current_stock) <= 0}
          title={`Use ${step} ${item.unit}`}
          className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)] disabled:opacity-40"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => onAdjust(item, step)}
          title={`Add ${step} ${item.unit}`}
          className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)]"
        >
          <Plus size={14} />
        </button>
        {hasPack && (
          <button
            onClick={() => onAdjust(item, perPack)}
            title={`Add 1 ${item.packaging_unit} (${perPack} ${item.unit})`}
            className="bg-[var(--color-surface-soft)] px-2 py-1.5 rounded-xl text-[10px] font-bold text-[var(--color-text)]"
          >
            +1 {item.packaging_unit}
          </button>
        )}
        <button
          onClick={() => onSendToGrocery(item)}
          title="Add to grocery list"
          className="ml-auto bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-accent)]"
        >
          <ShoppingCart size={14} />
        </button>
      </div>
    </div>
  )
}
