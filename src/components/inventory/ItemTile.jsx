import { useState } from 'react'
import { Minus, Plus, Pencil, Trash, Trash2, ShoppingCart, CalendarClock, PackagePlus } from 'lucide-react'
import { RestockForm } from './RestockForm'
import { CategoryIcon } from '../ui/CategoryIcon'
import { NoCategoryLabel } from '../ui/NoCategoryLabel'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { STOCK_STATUS_LABELS, displayReason, expiryLabel, expiryState, formatStock, stockFill, stockStatus, tapStep } from '../../lib/inventory'
import { isOneTime } from '../../lib/oneTime'
import { alsoLine } from '../../lib/itemNames'
import { OLD_GROUP_NOTE, isGroup } from '../../lib/groups'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { formatUnitPrice } from '../../lib/pricing'
import { EXPIRY_STYLES, RESTOCK_LABELS, SMALL_LABEL, STATUS_STYLES } from '../../lib/inventoryStyles'

// `namesReady`: supabase/032 is known to have run (plan 9N); only then the
// grey line with the item's other names shows.
// A group row made by an older version of the app (K138) shows its own
// stored stock with a grey note under the name, and nothing that changes
// stock or adds it to the SHOP list: it never receives either.
export function ItemTile({ item, isNew = false, subcategoryName, namesReady = false, onAdjust, onDiscard, onEdit, onDelete, onSendToGrocery }) {
  const c = inventoryCategoryColor(item.category_id)
  const status = stockStatus(item)
  // A one-time purchase (1×) has no minimum and is never Low or Out.
  const oneTime = isOneTime(item)
  // Tile colour: red Out, purple Expired, yellow Low, green OK.
  const tone = displayReason(item) || 'ok'
  const [restocking, setRestocking] = useState(false)
  const unitPrice = formatUnitPrice(item)
  const expiry = expiryState(item)
  const step = tapStep(item.unit)
  const perPack = Number(item.quantity_per_pack)
  const hasPack = item.packaging_unit && perPack > 0
  const also = namesReady ? alsoLine(item) : null
  const oldGroup = isGroup(item)

  return (
    <div className={cn('relative rounded-3xl border p-3.5 shadow-sm flex flex-col', STATUS_STYLES[tone].tile)}>
      <div className="absolute top-2 right-2 flex gap-0.5">
        <button onClick={() => onEdit(item)} title="Edit" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
          <Pencil size={12} />
        </button>
        <button
          onClick={() => onDelete(item)}
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
      {also && (
        <p className="mt-0.5 flex items-end gap-1 text-[10px] leading-snug text-[var(--color-text-muted)]">
          <span className="min-w-0 line-clamp-2 break-words">{also.text}</span>
          {also.more > 0 && <span className="shrink-0"> +{also.more}</span>}
        </p>
      )}
      {oldGroup && <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-text-muted)] break-words">{OLD_GROUP_NOTE}</p>}
      {subcategoryName && (
        <span className={cn('self-start mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', c.bg, c.border, c.text)}>{subcategoryName}</span>
      )}

      <div className="flex flex-wrap gap-1 mt-1.5">
        {oneTime ? (
          <OneTimeBadge className="self-center" />
        ) : oldGroup ? null : (
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_STYLES[status].badge)}>{STOCK_STATUS_LABELS[status]}</span>
        )}
        {isNew && (
          <span className={cn(SMALL_LABEL, 'self-center', RESTOCK_LABELS.new.className)}>{RESTOCK_LABELS.new.label}</span>
        )}
        {!item.category_id && <NoCategoryLabel className="self-center" />}
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
        {oneTime ? 'one-time' : `min ${Number(item.min_stock) || 0} ${item.unit}`}
        {unitPrice && <span className="font-mono text-[var(--color-accent)]"> · {unitPrice}</span>}
      </p>

      {!oldGroup && (
      <div className="flex flex-wrap items-center gap-1 mt-auto pt-2">
        {expiry === 'expired' && (
          <button
            onClick={() => onDiscard(item)}
            title={Number(item.current_stock) > 0 ? `Throw away the expired ${formatStock(item)}` : 'Clear the expiry date'}
            className={cn('px-2 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1', EXPIRY_STYLES.expired)}
          >
            <Trash size={12} /> Discard
          </button>
        )}
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
          onClick={() => setRestocking((r) => !r)}
          title="Add bought stock"
          aria-expanded={restocking}
          className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-text)]"
        >
          <PackagePlus size={14} />
        </button>
        <button
          onClick={() => onSendToGrocery(item)}
          title="Add to grocery list"
          className="ml-auto bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-accent)]"
        >
          <ShoppingCart size={14} />
        </button>
        {restocking && <RestockForm item={item} onSubmit={({ delta }) => onAdjust(item, delta, 'restocked')} onClose={() => setRestocking(false)} />}
      </div>
      )}
    </div>
  )
}
