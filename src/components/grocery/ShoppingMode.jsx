import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, ListOrdered } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { isDurable } from '../../lib/inventory'
import { money } from '../../lib/pricing'
import { groupByCategory, moveCategoryWrites, moveItemWrites, routeOrder } from '../../lib/shopMode'
import { useShopOrder } from '../../hooks/useShopOrder'
import { SortableList } from '../ui/SortableList'

const SORT_KEY = 'nutrihub-shop-sort'
function readSort() {
  try {
    return localStorage.getItem(SORT_KEY) === 'route' ? 'route' : 'category'
  } catch {
    return 'category'
  }
}
function rememberSort(sort) {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // Not remembered; nothing else changes.
  }
}

// In the shop: big tiles to tap, what's left on top and what's in the
// cart below, with a running total at the bottom of the screen. What's
// left is shown in the order of the shop, shared by both phones: either
// by category (categories in aisle order) or as "my route", where each
// item can be put anywhere, whatever its category. Items not arranged
// yet go where their category is.
export function ShoppingMode({ items, parents, categoryName, totalOf, costOf, budget, onCheck, onConfirm }) {
  const [sort, setSortState] = useState(readSort)
  const [arranging, setArranging] = useState(false)
  const { positions, savePositions } = useShopOrder()
  const defaultOrder = parents.map((p) => p.id)

  const open = items.filter((i) => !i.in_cart)
  const inCart = items.filter((i) => i.in_cart)
  const groups = groupByCategory(open, positions, defaultOrder)
  const route = routeOrder(open, positions, defaultOrder)
  const shownIds = groups.map((g) => g.categoryId).filter(Boolean)

  const setSort = (next) => {
    setSortState(next)
    rememberSort(next)
  }

  const moveCategory = (id, direction) => savePositions(moveCategoryWrites(shownIds, id, direction, positions, defaultOrder))
  const moveItem = (from, to) => savePositions(moveItemWrites(route, from, to, positions, defaultOrder))

  const sum = (list) => list.reduce((total, i) => total + costOf(i), 0)
  const cartTotal = sum(inCart)
  const leftTotal = sum(open)
  // The budget only counts groceries, not appliances.
  const budgetLeft = budget != null ? budget - sum(inCart.filter((i) => !isDurable(i))) : null
  const unknown = items.filter((i) => totalOf(i) === null).length

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-[var(--color-text-soft)]">
          {open.length === 0 ? 'Everything is in the cart.' : `${open.length} to get`}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-0.5 text-xs font-bold" role="group" aria-label="Order">
            {[
              ['category', 'By category'],
              ['route', 'My route'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setSort(value)}
                aria-pressed={sort === value}
                className={cn('px-3 py-1.5 rounded-full', sort === value ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]')}
              >
                {label}
              </button>
            ))}
          </div>
          {open.length > 1 && (
            <button
              onClick={() => setArranging((a) => !a)}
              className={cn(
                'flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border',
                arranging ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              )}
            >
              <ListOrdered size={14} /> {arranging ? 'Done' : 'Arrange'}
            </button>
          )}
        </div>
      </div>

      {arranging && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {sort === 'route'
            ? 'Drag the handle to put each item where you find it in the shop. Both phones get the same order.'
            : 'Move categories up or down into the order of the aisles. Both phones get the same order.'}
        </p>
      )}

      {sort === 'route' ? (
        arranging ? (
          <SortableList
            items={route}
            getKey={(item) => item.id}
            itemLabel={(item) => item.name}
            onMove={moveItem}
            renderItem={(item) => (
              <span className="flex items-center gap-2">
                <CategoryIcon category={item.category_id} size={15} />
                <span className="flex-1 min-w-0 text-sm font-semibold text-[var(--color-text)] truncate">{item.name}</span>
                <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{item.category_id ? categoryName(item.category_id) : ''}</span>
              </span>
            )}
          />
        ) : (
          <div className="space-y-2">
            {route.map((item) => (
              <ShopTile key={item.id} item={item} total={totalOf(item)} onCheck={onCheck} showCategory />
            ))}
          </div>
        )
      ) : (
        groups.map(({ categoryId, items: list }, index) => {
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
                      onClick={() => moveCategory(categoryId, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${categoryName(categoryId)} up`}
                      className="p-2.5 rounded-xl bg-[var(--color-surface-soft)] text-[var(--color-text)] disabled:opacity-30"
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      onClick={() => moveCategory(categoryId, 1)}
                      disabled={index >= shownIds.length - 1}
                      aria-label={`Move ${categoryName(categoryId)} down`}
                      className="p-2.5 rounded-xl bg-[var(--color-surface-soft)] text-[var(--color-text)] disabled:opacity-30"
                    >
                      <ArrowDown size={18} />
                    </button>
                  </span>
                )}
              </div>
              {!arranging && list.map((item) => <ShopTile key={item.id} item={item} total={totalOf(item)} onCheck={onCheck} />)}
            </section>
          )
        })
      )}

      {inCart.length > 0 && !arranging && (
        <section className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Check size={15} /> In the cart ({inCart.length})
            </h3>
            <button onClick={onConfirm} className="text-xs font-bold px-3 py-2 rounded-2xl bg-[var(--color-primary)] text-white">
              Confirm purchase
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">Tap an item to take it out again. Nothing is added to the pantry or expenses until you confirm.</p>
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
          {inCart.length > 0 && (
            <button onClick={onConfirm} className="shrink-0 text-xs font-bold px-3 py-2 rounded-xl bg-[var(--color-primary)] text-white">
              Confirm
            </button>
          )}
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

// One big tile: tap to put it in the cart (or take it out again) — only
// the cart changes; the purchase is confirmed separately.
function ShopTile({ item, total, onCheck, showCategory = false }) {
  return (
    <button
      onClick={() => onCheck(item)}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left min-h-16 active:scale-[0.99] transition',
        item.in_cart ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : 'bg-[var(--color-surface)] border-[var(--color-border)]'
      )}
    >
      <span
        className={cn(
          'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0',
          item.in_cart ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-checkbox-border)]'
        )}
      >
        {item.in_cart && <Check size={16} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={cn('block text-base font-bold truncate', item.in_cart ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {showCategory && <CategoryIcon category={item.category_id} size={12} />}
          {item.quantity} {item.unit}
        </span>
      </span>
      <span className="text-sm font-mono font-bold text-[var(--color-accent)] shrink-0">{total === null ? '?' : total > 0 ? money(total) : ''}</span>
    </button>
  )
}
