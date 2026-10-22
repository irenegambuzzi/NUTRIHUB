import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, ListOrdered } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { cn } from '../../lib/cn'
import { inventoryCategoryColor } from '../../lib/categoryColors'
import { isDurable, shopReason } from '../../lib/inventory'
import { byCartOrder } from '../../lib/grocery'
import { shopUnits, unitItem } from '../../lib/groupShop'
import { entryIsOneTime } from '../../lib/oneTime'
import { RESTOCK_LABELS, SMALL_LABEL } from '../../lib/inventoryStyles'
import { money } from '../../lib/pricing'
import { GROCERY_LIST_LABELS, matchesGrocerySearch, variantHint } from '../../lib/grocerySearch'
import { formatPurchaseQuantity } from '../../lib/inventory'
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
// yet go where their category is. A group is one card ("Chips &
// Snacks") with a row per variant, each tapped into the cart on its own
// (`groupOf(entry)`, see lib/groupShop.js).
export function ShoppingMode({ items, parents, categoryName, totalOf, costOf, budget, search = '', pantryFor = () => null, groupOf = () => null, variantNamesOf = () => [], searchNamesOf = variantNamesOf, onCheck, onConfirm }) {
  const [sort, setSortState] = useState(readSort)
  const [arranging, setArranging] = useState(false)
  const { positions, savePositions } = useShopOrder()
  const defaultOrder = parents.map((p) => p.id)

  const open = items.filter((i) => !i.in_cart)
  // In the order they went into the cart, oldest first.
  const inCart = items.filter((i) => i.in_cart).sort(byCartOrder)
  // What's left as tiles and group cards, placed in the shop by name and
  // category (a card by its group's).
  const units = (list) => shopUnits(list, groupOf, pantryFor)
  const placed = units(open).map((unit) => ({ ...unitItem(unit), id: unit.key, unit }))
  const groups = groupByCategory(placed, positions, defaultOrder)
  const route = routeOrder(placed, positions, defaultOrder)
  const shownIds = groups.map((g) => g.categoryId).filter(Boolean)

  const query = search.trim().toLowerCase()
  const found = query ? items.filter((i) => matchesGrocerySearch(i, query, categoryName, searchNamesOf(i))) : []

  const show = (unit, extra = {}) =>
    unit.kind === 'group' ? (
      <ShopGroupCard key={unit.key} card={unit} pantryFor={pantryFor} totalOf={totalOf} onCheck={onCheck} showList={extra.showList} />
    ) : (
      <ShopTile key={unit.key} item={unit.entry} pack={pantryFor(unit.entry)} total={totalOf(unit.entry)} onCheck={onCheck} {...extra} hint={extra.showList ? variantHint(unit.entry, query, variantNamesOf(unit.entry)) : null} />
    )

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

      {query ? (
        <div className="space-y-2">
          {found.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              Nothing matches "{search.trim()}" — not to buy and not in the cart.
            </p>
          ) : (
            [false, true].map((cart) => {
              const list = found.filter((i) => Boolean(i.in_cart) === cart)
              if (cart) list.sort(byCartOrder)
              return (
                list.length > 0 && (
                  <section key={String(cart)} className="space-y-2">
                    <h3 className="text-xs font-extrabold uppercase text-[var(--color-text-muted)]">
                      {GROCERY_LIST_LABELS[cart ? 'inCart' : 'toBuy']} ({list.length})
                    </h3>
                    {units(list).map((unit) => show(unit, { showCategory: true, showList: true }))}
                  </section>
                )
              )
            })
          )}
        </div>
      ) : (
        <>
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
          <div className="space-y-2">{route.map((placedUnit) => show(placedUnit.unit, { showCategory: true }))}</div>
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
              {!arranging && list.map((placedUnit) => show(placedUnit.unit))}
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
          {units(inCart).map((unit) => show(unit))}
        </section>
      )}

        </>
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
// the cart changes; the purchase is confirmed separately. A one-time
// purchase shows the grey "1× purchase".
function ShopTile({ item, pack = null, total, onCheck, showCategory = false, showList = false, hint = null }) {
  return (
    <button
      onClick={() => onCheck(item)}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left min-h-16 active:scale-[0.99] transition',
        item.in_cart ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : 'bg-[var(--color-surface)] border-[var(--color-border)]'
      )}
    >
      <CheckCircle checked={item.in_cart} />
      <span className="flex-1 min-w-0">
        <span className={cn('flex items-center gap-1.5 text-base font-bold min-w-0', item.in_cart ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          <span className="truncate">{item.name}</span>
          {entryIsOneTime(item, pack) && <OneTimeBadge className="shrink-0 no-underline" />}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {showCategory && <CategoryIcon category={item.category_id} size={12} />}
          {formatPurchaseQuantity(item.quantity, item.unit, pack)}
          {hint && <span className="ml-1">· {hint}</span>}
          {showList && <ListLabel inCart={item.in_cart} />}
        </span>
      </span>
      <span className="text-sm font-mono font-bold text-[var(--color-accent)] shrink-0">{total === null ? '?' : total > 0 ? money(total) : ''}</span>
    </button>
  )
}

// A group's card: its name ("Not urgent" when the total is still fine but
// a variant is at 0) and a big row per variant, each tapped into the cart
// on its own, variants at 0 first.
function ShopGroupCard({ card, pantryFor, totalOf, onCheck, showList = false }) {
  const { group, entries, inCart } = card
  const notUrgent = !inCart && shopReason(group) === 'not-urgent'
  return (
    <section aria-label={`${group.name} (group)`} className={cn('rounded-2xl border px-3 py-2 space-y-1', inCart ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : 'bg-[var(--color-surface)] border-[var(--color-border)]')}>
      <p className="flex items-center gap-1.5 px-1 text-xs font-extrabold text-[var(--color-text-soft)] min-w-0">
        <CategoryIcon category={group.category_id} size={12} />
        <span className="truncate">{group.name}</span>
        {notUrgent && <span className={cn(SMALL_LABEL, 'shrink-0', RESTOCK_LABELS['not-urgent'].className)}>{RESTOCK_LABELS['not-urgent'].label}</span>}
        {showList && <ListLabel inCart={inCart} />}
      </p>
      {entries.map((entry) => {
        const pack = pantryFor(entry)
        const total = totalOf(entry)
        return (
          <button key={entry.id} onClick={() => onCheck(entry)} className="w-full flex items-center gap-3 rounded-xl px-1 py-2 text-left min-h-12 active:scale-[0.99] transition">
            <CheckCircle checked={entry.in_cart} />
            <span className="flex-1 min-w-0">
              <span className={cn('flex items-center gap-1.5 text-base font-bold min-w-0', entry.in_cart ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
                <span className="truncate">{entry.name}</span>
                {entryIsOneTime(entry, pack) && <OneTimeBadge className="shrink-0 no-underline" />}
              </span>
              <span className="block text-xs text-[var(--color-text-muted)]">{formatPurchaseQuantity(entry.quantity, entry.unit, pack)}</span>
            </span>
            <span className="text-sm font-mono font-bold text-[var(--color-accent)] shrink-0">{total === null ? '?' : total > 0 ? money(total) : ''}</span>
          </button>
        )
      })}
    </section>
  )
}

function CheckCircle({ checked }) {
  return (
    <span
      className={cn(
        'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0',
        checked ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-checkbox-border)]'
      )}
    >
      {checked && <Check size={16} />}
    </span>
  )
}

function ListLabel({ inCart }) {
  return (
    <span className={cn('ml-1 border', SMALL_LABEL, inCart ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-soft)]')}>
      {GROCERY_LIST_LABELS[inCart ? 'inCart' : 'toBuy']}
    </span>
  )
}
