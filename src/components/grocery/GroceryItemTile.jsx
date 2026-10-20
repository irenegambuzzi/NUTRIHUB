import { useState } from 'react'
import { Check, Globe, Trash2 } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { NoCategoryLabel } from '../ui/NoCategoryLabel'
import { FixCategory } from './FixCategory'
import { PayerPicker } from './shared'
import { EntryEditor, PriceButton, QuantityStepper } from './EntryControls'
import { useEntryEditing } from '../../hooks/useEntryEditing'
import { payerLabel } from '../../lib/grocery'
import { GROCERY_LIST_LABELS, listOf } from '../../lib/grocerySearch'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { RESTOCK_LABELS, SMALL_LABEL, STATUS_STYLES } from '../../lib/inventoryStyles'

// `onOrderOnline` (supabase/021) adds "Order online"; it is the main
// action when the item's usual store is online (`orderFirst`,
// `usualShop`). `oneTime`: a one-time purchase (grey "1× purchase"). A
// group's variants are shown in the group's card instead (GroupShopCard).
export function GroceryItemTile({ item, showList = false, hint = null, reason, pack, total, budgetMark, categoryName, onToggle, onDelete, onUpdatePricing, onUpdatePayer, onUpdateCategory = null, onOrderOnline = null, orderFirst = false, usualShop = null, oneTime = false }) {
  const c = inventoryCategoryColor(item.category_id)
  const edit = useEntryEditing(item, pack, onUpdatePricing)
  const label = RESTOCK_LABELS[reason]
  const [fixing, setFixing] = useState(false)

  // Background follows why the item is here: red Out, yellow Low,
  // purple Expired, blue New; items already in stock keep their category
  // colour.
  const tone = STATUS_STYLES[reason]?.tile ?? cn(c.bg, c.border)

  return (
    <div
      className={cn(
        'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
        item.in_cart ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : tone,
        budgetMark === 'over' && 'opacity-60'
      )}
    >
      <button
        onClick={() => onDelete(item)}
        aria-label={`Remove ${item.name}`}
        className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-red-400 transition p-1 z-10"
      >
        <Trash2 size={13} />
      </button>

      <button onClick={() => onToggle(item)} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
        <div
          className={cn(
            'w-9 h-9 rounded-2xl flex items-center justify-center mb-2 transition-all duration-200',
            item.in_cart ? 'bg-[var(--color-primary)] text-white' : cn(c.solid, 'text-white')
          )}
        >
          {item.in_cart ? <Check size={18} /> : <CategoryIcon category={item.category_id} size={18} />}
        </div>

        <p className={cn('text-sm font-bold leading-tight pr-4', item.in_cart ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          {item.in_cart && 'In the cart · '}
          {item.category_id && categoryName(item.category_id)}
        </p>
        {oneTime && <OneTimeBadge className="inline-block mt-1" />}
      </button>

      <QuantityStepper item={item} pack={pack} edit={edit} className="mt-1.5" />

      {hint && <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{hint}</p>}

      {showList && (
        <span
          className={cn(
            'inline-block mt-1 border',
            SMALL_LABEL,
            item.in_cart ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-soft)]'
          )}
        >
          {GROCERY_LIST_LABELS[listOf(item)]}
        </span>
      )}

      {((!item.in_cart && (label || budgetMark)) || !item.category_id) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {!item.category_id && (onUpdateCategory ? (
            <button type="button" onClick={() => setFixing((v) => !v)} aria-label={`Choose a category for ${item.name}`} aria-expanded={fixing}>
              <NoCategoryLabel />
            </button>
          ) : (
            <NoCategoryLabel />
          ))}
          {!item.in_cart && label && <span className={cn(SMALL_LABEL, label.className)}>{label.label}</span>}
          <BudgetMark mark={budgetMark} />
        </div>
      )}

      {fixing && !item.category_id && <FixCategory item={item} onUpdateCategory={onUpdateCategory} onDone={() => setFixing(false)} />}

      {edit.editing ? <EntryEditor item={item} pack={pack} edit={edit} /> : <PriceButton item={item} pack={pack} total={total} edit={edit} />}

      <div className="mt-1.5" title={`Paid by ${payerLabel(item.payer)}`}>
        <PayerPicker value={item.payer || 'shared'} onChange={(value) => onUpdatePayer(item, value)} size="sm" />
      </div>

      {onOrderOnline && !item.in_cart && (
        <button
          type="button"
          onClick={onOrderOnline}
          title={usualShop ? `Usually bought at ${usualShop.name}` : 'Order it online: the expense is added now, the stock when it arrives'}
          className={cn(
            'mt-2 w-full min-h-9 px-2 rounded-xl text-[11px] font-bold inline-flex items-center justify-center gap-1.5',
            orderFirst ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'
          )}
        >
          <Globe size={12} /> {orderFirst && usualShop ? `Order at ${usualShop.name}` : 'Order online'}
        </button>
      )}
    </div>
  )
}

// "Buy first" / "Over budget" while a budget is set.
export function BudgetMark({ mark }) {
  if (mark === 'fits') return <span className={cn(SMALL_LABEL, STATUS_STYLES.ok.badge)}>Buy first</span>
  if (mark === 'over') return <span className={cn(SMALL_LABEL, 'bg-[var(--color-surface-soft)] text-[var(--color-text-muted)]')}>Over budget</span>
  return null
}
