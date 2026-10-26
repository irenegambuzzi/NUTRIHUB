import { useState } from 'react'
import { Check, Globe, Plus, X } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { Select } from '../ui/Field'
import { PayerPicker } from './shared'
import { BudgetMark } from './GroceryItemTile'
import { EntryEditor, PriceButton, QuantityStepper } from './EntryControls'
import { useEntryEditing } from '../../hooks/useEntryEditing'
import { GROCERY_LIST_LABELS } from '../../lib/grocerySearch'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { isOneTime } from '../../lib/oneTime'
import { RESTOCK_LABELS, SMALL_LABEL, STATUS_STYLES } from '../../lib/inventoryStyles'

// One card per group on the SHOP list ("Chips & Snacks"), one row per
// variant (`card.entries`, variants at 0 first): each row has its own
// quantity, price, payer, "Order online", and goes into the cart on its own
// tap. The colour and label follow the group (`reason`): red Out, yellow
// Low, sky "Not urgent" (enough in total, but a variant at 0). There is no
// delete for the whole card: a variant at 0 stays until it is bought or
// restocked (to stop it coming back, mark it 1× or delete it in HOME). Only
// a row added with "+ Add another variant" (typed by hand) has ×.
// `addable`: variants with stock that can be added (`onAddVariant`).
// `highlighted`: outlined for a moment after "Go to card" (data-spot).
export function GroupShopCard({ card, reason, pantryFor, totalOf, budgetMarkOf = () => undefined, categoryName, onToggle, onRemove, onUpdatePricing, onUpdatePayer, orderPropsOf = () => ({}), addable = [], onAddVariant = null, showList = false, highlighted = false }) {
  const { group, entries, inCart } = card
  const c = inventoryCategoryColor(group.category_id)
  const label = RESTOCK_LABELS[reason]
  const tone = STATUS_STYLES[reason]?.tile ?? cn(c.bg, c.border)
  return (
    <section
      aria-label={`${group.name} (group)`}
      data-spot={highlighted ? '' : undefined}
      className={cn('col-span-2 rounded-3xl border p-3.5 shadow-sm space-y-2', inCart ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)]' : tone, highlighted && 'ring-2 ring-[var(--color-primary)]')}
    >
      <div className="flex items-center gap-2">
        <span className={cn('w-9 h-9 rounded-2xl flex items-center justify-center text-white shrink-0', inCart ? 'bg-[var(--color-primary)]' : c.solid)}>
          {inCart ? <Check size={18} /> : <CategoryIcon category={group.category_id} size={18} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight text-[var(--color-text)] truncate">{group.name}</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {inCart && 'In the cart · '}
            {categoryName(group.category_id)}
          </p>
        </div>
        {!inCart && label && <span className={cn(SMALL_LABEL, 'shrink-0', label.className)}>{label.label}</span>}
        {showList && (
          <span className={cn(SMALL_LABEL, 'shrink-0 border', inCart ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-soft)]')}>
            {GROCERY_LIST_LABELS[inCart ? 'inCart' : 'toBuy']}
          </span>
        )}
      </div>

      <ul className="divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <GroupRow
            key={entry.id}
            entry={entry}
            pantry={pantryFor(entry)}
            total={totalOf(entry)}
            budgetMark={budgetMarkOf(entry)}
            onToggle={onToggle}
            onRemove={onRemove}
            onUpdatePricing={onUpdatePricing}
            onUpdatePayer={onUpdatePayer}
            {...orderPropsOf(entry)}
          />
        ))}
      </ul>

      {!inCart && onAddVariant && addable.length > 0 && <AddVariant group={group} addable={addable} onAdd={onAddVariant} />}
    </section>
  )
}

// One variant: tap its name to put it in the cart (or take it out).
function GroupRow({ entry, pantry, total, budgetMark, onToggle, onRemove, onUpdatePricing, onUpdatePayer, onOrderOnline = null, orderFirst = false, usualShop = null }) {
  const edit = useEntryEditing(entry, pantry, onUpdatePricing)
  // A group-level entry from before: the variant is chosen when confirming.
  const groupLevel = Boolean(pantry?.is_group)
  const stock = pantry && !groupLevel ? Number(pantry.current_stock) || 0 : null
  return (
    <li className={cn('py-2 space-y-1.5', budgetMark === 'over' && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onToggle(entry)} className="flex-1 min-w-0 min-h-9 flex items-center gap-2 text-left">
          <span
            className={cn(
              'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0',
              entry.in_cart ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-checkbox-border)]'
            )}
          >
            {entry.in_cart && <Check size={14} />}
          </span>
          <span className="min-w-0">
            <span className={cn('flex flex-wrap items-center gap-1.5 text-sm font-bold leading-tight', entry.in_cart ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
              <span className="break-words">{entry.name}</span>
              {pantry && isOneTime(pantry) && <OneTimeBadge className="no-underline" />}
            </span>
            <span className="block text-[10px] text-[var(--color-text-muted)]">
              {groupLevel ? 'You choose the variant when confirming' : `${stock} ${pantry?.unit ?? ''} at home`}
            </span>
          </span>
        </button>
        {!entry.auto_generated && !entry.in_cart && (
          <button type="button" onClick={() => onRemove(entry)} aria-label={`Remove ${entry.name}`} className="w-9 h-9 -mr-1 flex items-center justify-center text-[var(--color-icon-muted)] hover:text-rose-400 shrink-0">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pl-8">
        <QuantityStepper item={entry} pack={pantry} edit={edit} />
        <PriceButton item={entry} pack={pantry} total={total} edit={edit} compact />
      </div>
      {edit.editing && (
        <div className="pl-8">
          <EntryEditor item={entry} pack={pantry} edit={edit}>
            <PayerPicker value={entry.payer || 'shared'} onChange={(value) => onUpdatePayer(entry, value)} size="sm" />
          </EntryEditor>
        </div>
      )}
      {(onOrderOnline && !entry.in_cart) || budgetMark ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-8">
          <BudgetMark mark={budgetMark} />
          {onOrderOnline && !entry.in_cart && (
            <button
              type="button"
              onClick={onOrderOnline}
              title={usualShop ? `Usually bought at ${usualShop.name}` : 'Order it online: the expense is added now, the stock when it arrives'}
              className={cn(
                'ml-auto min-h-9 px-2.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5',
                orderFirst ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'
              )}
            >
              <Globe size={12} /> {orderFirst && usualShop ? `Order at ${usualShop.name}` : 'Order online'}
            </button>
          )}
        </div>
      ) : null}
    </li>
  )
}

// "+ Add another variant": one of the group's variants that still has
// stock (e.g. on offer) joins the card.
function AddVariant({ group, addable, onAdd }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
        <Plus size={13} /> Add another variant
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value=""
        onChange={(e) => {
          const variant = addable.find((v) => v.id === e.target.value)
          if (!variant) return
          setOpen(false)
          onAdd(variant)
        }}
        aria-label={`Add another variant of ${group.name}`}
        className="flex-1 text-xs p-2"
      >
        <option value="">Choose a variant…</option>
        {addable.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({Number(v.current_stock) || 0} {v.unit} at home)
          </option>
        ))}
      </Select>
      <button type="button" onClick={() => setOpen(false)} className="min-h-9 px-2 text-[11px] font-bold text-[var(--color-text-muted)]">
        Cancel
      </button>
    </div>
  )
}
