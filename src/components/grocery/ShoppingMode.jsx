import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, ListOrdered } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { isDurable } from '../../lib/inventory'
import { money } from '../../lib/pricing'
import { groupByCategory, mergeOrder, moveCategory, readCategoryOrder, saveCategoryOrder } from '../../lib/shopMode'

// In the shop: big tiles to tap, what's left on top grouped by category in
// the order of the aisles (arranged once, remembered on this phone), what's
// in the cart below, and a running total at the bottom of the screen.
export function ShoppingMode({ items, parents, categoryName, totalOf, costOf, budget, onCheck }) {
  const [order, setOrder] = useState(readCategoryOrder)
  const [arranging, setArranging] = useState(false)

  const open = items.filter((i) => !i.completed)
  const inCart = items.filter((i) => i.completed)
  const groups = groupByCategory(open, order, parents.map((p) => p.id))
  const shownIds = groups.map((g) => g.categoryId).filter(Boolean)

  const move = (id, direction) => {
    const next = mergeOrder(moveCategory(shownIds, id, direction), order)
    setOrder(next)
    saveCategoryOrder(next)
  }

  const sum = (list) => list.reduce((total, i) => total + costOf(i), 0)
  const cartTotal = sum(inCart)
  const leftTotal = sum(open)
  // The budget only counts groceries, not appliances.
  const budgetLeft = budget != null ? budget - sum(inCart.filter((i) => !isDurable(i))) : null
  const unknown = items.filter((i) => totalOf(i) === null).length

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-[var(--color-text-soft)]">
          {open.length === 0 ? 'Everything is in the cart.' : `${open.length} to get`}
        </p>
        {shownIds.length > 1 && (
          <button
            onClick={() => setArranging((a) => !a)}
            className={cn(
              'flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border',
              arranging ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            )}
          >
            <ListOrdered size={14} /> {arranging ? 'Done' : 'Arrange aisles'}
          </button>
        )}
      </div>

      {groups.map(({ categoryId, items: list }, index) => {
        const c = inventoryCategoryColor(categoryId)
        return (
          <section key={categoryId ?? 'none'} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn('w-7 h-7 rounded-xl flex items-center justify-center text-white', c.solid)}>
                <CategoryIcon category={categoryId} size={15} />
              </span>
              <h3 className="flex-1 text-sm font-extrabold text-[var(--color-text)]">{categoryId ? categoryName(categoryId) : 'Other'}</h3>
              {arranging && categoryId && (
                <span className="flex gap-1">
                  <button
                    onClick={() => move(categoryId, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${categoryName(categoryId)} up`}
                    className="p-2 rounded-xl bg-[var(--color-surface-soft)] text-[var(--color-text)] disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    onClick={() => move(categoryId, 1)}
                    disabled={index >= shownIds.length - 1}
                    aria-label={`Move ${categoryName(categoryId)} down`}
                    className="p-2 rounded-xl bg-[var(--color-surface-soft)] text-[var(--color-text)] disabled:opacity-30"
                  >
                    <ArrowDown size={16} />
                  </button>
                </span>
              )}
            </div>
            {!arranging && list.map((item) => <ShopTile key={item.id} item={item} total={totalOf(item)} onCheck={onCheck} />)}
          </section>
        )
      })}

      {inCart.length > 0 && !arranging && (
        <section className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <h3 className="text-sm font-extrabold text-[var(--color-text-muted)] flex items-center gap-1.5">
            <Check size={15} /> In the cart ({inCart.length})
          </h3>
          {inCart.map((item) => (
            <ShopTile key={item.id} item={item} total={totalOf(item)} onCheck={onCheck} />
          ))}
        </section>
      )}

      {/* Running total, above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] md:bottom-4 z-20 px-4 pointer-events-none">
        <div className="max-w-md mx-auto pointer-events-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-[var(--color-text-muted)]">In the cart</p>
            <p className="text-lg font-mono font-extrabold text-[var(--color-accent)] leading-tight">{money(cartTotal)}</p>
          </div>
          <div className="text-right text-[11px] text-[var(--color-text-muted)] leading-snug">
            <p>
              Still to get <b className="font-mono text-[var(--color-text-soft)]">{money(leftTotal)}</b>
            </p>
            {budgetLeft != null && (
              <p className={budgetLeft < 0 ? 'text-rose-400 font-bold' : ''}>
                {budgetLeft < 0 ? `Over budget by ${money(-budgetLeft)}` : `${money(budgetLeft)} left in budget`}
              </p>
            )}
            {unknown > 0 && <p>{unknown} without a total</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// One big tile: tap to put it in the cart (or take it out again).
function ShopTile({ item, total, onCheck }) {
  return (
    <button
      onClick={() => onCheck(item)}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left min-h-16 active:scale-[0.99] transition',
        item.completed ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : 'bg-[var(--color-surface)] border-[var(--color-border)]'
      )}
    >
      <span
        className={cn(
          'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0',
          item.completed ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-checkbox-border)]'
        )}
      >
        {item.completed && <Check size={16} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={cn('block text-base font-bold truncate', item.completed ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </span>
        <span className="block text-xs text-[var(--color-text-muted)]">
          {item.quantity} {item.unit}
        </span>
      </span>
      <span className="text-sm font-mono font-bold text-[var(--color-accent)] shrink-0">{total === null ? '?' : total > 0 ? money(total) : ''}</span>
    </button>
  )
}
