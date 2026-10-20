import { useCallback, useMemo } from 'react'
import { PAID_BY_OPTIONS } from '../data/constants'
import { inCartOrder, normName, PRIORITY, sortGroceryItems } from '../lib/grocery'
import { isDurable, shopReason } from '../lib/inventory'
import { lineTotal } from '../lib/pricing'
import { useGroceryItems } from './useGroceryItems'
import { usePantryItems } from './usePantryItems'
import { useBudget } from './useBudget'
import { orderStore } from '../lib/stores'

// Reason order for each sort (lib/grocery.js); budget planning always
// uses PRIORITY.
export { PRIORITY }

// The grocery list as the page shows it: each entry's reason and line
// total, the totals and budget plan, and the cart. Tapping an item only
// puts it in the cart; the purchase itself is confirmed separately
// (ConfirmPurchase).
//
// An entry ordered online (an order on the way linked to it, supabase/021)
// is not "to buy": it is left out of the list, totals and budget, and
// shown apart (`onTheWay`). `openOrderOf(entry)` gives its order.
export function useGroceryList() {
  const grocery = useGroceryItems()
  const { items: allItems, toggleCart } = grocery
  const { rows: orders } = orderStore.useRows()
  const openOrders = useMemo(() => new Map(orders.filter((o) => o.status === 'on_the_way' && o.grocery_item_id).map((o) => [o.grocery_item_id, o])), [orders])
  const openOrderOf = useCallback((g) => openOrders.get(g.id) ?? null, [openOrders])
  const items = useMemo(() => allItems.filter((i) => !openOrders.has(i.id)), [allItems, openOrders])
  const onTheWay = useMemo(() => allItems.filter((i) => openOrders.has(i.id)), [allItems, openOrders])
  // Everything in the cart, an entry ordered meanwhile on the other phone
  // included: the confirm screen warns about that one. Oldest in the cart
  // first.
  const cartItems = useMemo(() => inCartOrder(allItems), [allItems])
  const { items: pantryItems } = usePantryItems()
  const { groceryBudget, saveGroceryBudget } = useBudget()

  const pantryById = useMemo(() => new Map(pantryItems.map((p) => [p.id, p])), [pantryItems])
  // By name, never a group (see pantryItemFor): only a link by id points to one.
  const pantryByName = useMemo(() => new Map(pantryItems.filter((p) => !p.is_group).map((p) => [normName(p.name), p])), [pantryItems])

  const pantryFor = useCallback((g) => pantryById.get(g.pantry_item_id) || pantryByName.get(normName(g.name)), [pantryById, pantryByName])

  // Why each entry is on the list, worked out live from its pantry item.
  const reasonOf = useMemo(() => {
    const cache = new Map()
    for (const g of items) {
      const p = pantryFor(g)
      cache.set(g.id, isDurable(g) ? 'durable' : p ? shopReason(p) || 'stocked' : 'new')
    }
    return (g) => cache.get(g.id) || 'new'
  }, [items, pantryFor])

  // What each line really costs: unit price × quantity bought. null when
  // the units can't be converted; sums and the budget leave those out.
  const totalOf = useCallback((g) => lineTotal(g, pantryFor(g)), [pantryFor])
  const costOf = useCallback((g) => totalOf(g) ?? 0, [totalOf])

  const sortItems = useCallback((list, mode) => sortGroceryItems(list, mode, { reasonOf, costOf }), [reasonOf, costOf])

  // Durable purchases (Home & Appliances) get their own section and stay
  // out of the grocery totals and budget.
  const groceryItems = useMemo(() => items.filter((i) => !isDurable(i)), [items])
  const durableItems = useMemo(() => items.filter(isDurable), [items])

  const listTotal = groceryItems.reduce((sum, i) => sum + costOf(i), 0)
  // What's in the cart counts as bought for the budget.
  const boughtTotal = groceryItems.filter((i) => i.in_cart).reduce((sum, i) => sum + costOf(i), 0)
  const payerTotals = PAID_BY_OPTIONS.map((o) => ({
    ...o,
    total: groceryItems.filter((i) => (i.payer || 'shared') === o.value).reduce((sum, i) => sum + costOf(i), 0),
  }))
  const unpricedCount = groceryItems.filter((i) => !i.in_cart && !(Number(i.price) > 0)).length
  const unknownTotalCount = groceryItems.filter((i) => totalOf(i) === null).length

  // Budget planning ignores the chosen sort: open items are taken by need
  // (Out → Low → Expired → New; cheaper first within the same need, so
  // more essentials fit) and each one is kept if it still fits in what's
  // left of the budget after what's already been bought.
  const budgetActive = groceryBudget != null
  const overBudget = budgetActive && listTotal > groceryBudget
  const budgetPlan = useMemo(() => {
    if (!budgetActive) return null
    const open = groceryItems
      .filter((i) => !i.in_cart)
      .sort((a, b) => PRIORITY.indexOf(reasonOf(a)) - PRIORITY.indexOf(reasonOf(b)) || costOf(a) - costOf(b))
    let remaining = groceryBudget - boughtTotal
    const marks = new Map()
    for (const g of open) {
      const cost = totalOf(g)
      if (cost === null) marks.set(g.id, 'unknown')
      else if (cost <= remaining) {
        remaining -= cost
        marks.set(g.id, 'fits')
      } else marks.set(g.id, 'over')
    }
    // Display order while a budget is set: what fits first, then the rest,
    // each in priority order; checked-off items last.
    const order = ['fits', 'unknown', 'over'].flatMap((mark) => open.filter((g) => marks.get(g.id) === mark))
    return { marks, order, remaining }
  }, [budgetActive, groceryBudget, boughtTotal, groceryItems, reasonOf, totalOf, costOf])

  return {
    ...grocery,
    items,
    onTheWay,
    openOrderOf,
    pantryItems,
    pantryByName,
    pantryFor,
    reasonOf,
    totalOf,
    costOf,
    sortItems,
    groceryItems,
    durableItems,
    listTotal,
    boughtTotal,
    payerTotals,
    unpricedCount,
    unknownTotalCount,
    groceryBudget,
    saveGroceryBudget,
    budgetActive,
    overBudget,
    budgetPlan,
    cartItems,
    cartTotal: boughtTotal,
    checkOff: toggleCart,
  }
}
