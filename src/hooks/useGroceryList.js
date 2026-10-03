import { useCallback, useMemo } from 'react'
import { PAID_BY_OPTIONS } from '../data/constants'
import { normName } from '../lib/grocery'
import { isDurable, restockReason, roundQuantity } from '../lib/inventory'
import { askDialog, showToast } from '../lib/feedback'
import { expiredChoice, expiredDialog, packSizeDialog } from '../lib/purchaseDialogs'
import { lineTotal } from '../lib/pricing'
import { useGroceryItems } from './useGroceryItems'
import { usePantryItems } from './usePantryItems'
import { useBudget } from './useBudget'

// Reason order for each sort; 'stocked' = in the pantry and fine.
// Budget planning always uses PRIORITY, whatever the chosen sort.
export const PRIORITY = ['out', 'low', 'expired', 'new', 'stocked']
const REASON_ORDERS = {
  priority: PRIORITY,
  low: ['low', 'out', 'expired', 'new', 'stocked'],
  new: ['new', 'out', 'low', 'expired', 'stocked'],
}

// The grocery list as the page shows it: each entry's reason and line
// total, the totals and budget plan, and checking off with the questions
// it may need.
export function useGroceryList() {
  const grocery = useGroceryItems()
  const { items, toggleComplete } = grocery
  const { items: pantryItems } = usePantryItems()
  const { groceryBudget, saveGroceryBudget } = useBudget()

  const pantryById = useMemo(() => new Map(pantryItems.map((p) => [p.id, p])), [pantryItems])
  const pantryByName = useMemo(() => new Map(pantryItems.map((p) => [normName(p.name), p])), [pantryItems])

  const pantryFor = useCallback((g) => pantryById.get(g.pantry_item_id) || pantryByName.get(normName(g.name)), [pantryById, pantryByName])

  // Why each entry is on the list, worked out live from its pantry item.
  const reasonOf = useMemo(() => {
    const cache = new Map()
    for (const g of items) {
      const p = pantryFor(g)
      cache.set(g.id, isDurable(g) ? 'durable' : p ? restockReason(p) || 'stocked' : 'new')
    }
    return (g) => cache.get(g.id) || 'new'
  }, [items, pantryFor])

  // What each line really costs: unit price × quantity bought. null when
  // the units can't be converted; sums and the budget leave those out.
  const totalOf = useCallback((g) => lineTotal(g, pantryFor(g)), [pantryFor])
  const costOf = useCallback((g) => totalOf(g) ?? 0, [totalOf])

  const sortItems = useCallback(
    (list, mode) => {
      const order = REASON_ORDERS[mode]
      const rank = (g) => (order ? order.indexOf(reasonOf(g)) : 0)
      const tie =
        {
          az: (a, b) => a.name.localeCompare(b.name),
          price: (a, b) => costOf(b) - costOf(a),
        }[mode] || ((a, b) => b.created_at.localeCompare(a.created_at))
      // Checked-off items always sink to the bottom.
      return [...list].sort((a, b) => Number(a.completed) - Number(b.completed) || rank(a) - rank(b) || tie(a, b))
    },
    [reasonOf, costOf]
  )

  // Durable purchases (Home & Appliances) get their own section and stay
  // out of the grocery totals and budget.
  const groceryItems = useMemo(() => items.filter((i) => !isDurable(i)), [items])
  const durableItems = useMemo(() => items.filter(isDurable), [items])

  const listTotal = groceryItems.reduce((sum, i) => sum + costOf(i), 0)
  const boughtTotal = groceryItems.filter((i) => i.completed).reduce((sum, i) => sum + costOf(i), 0)
  const payerTotals = PAID_BY_OPTIONS.map((o) => ({
    ...o,
    total: groceryItems.filter((i) => (i.payer || 'shared') === o.value).reduce((sum, i) => sum + costOf(i), 0),
  }))
  const unpricedCount = groceryItems.filter((i) => !i.completed && !(Number(i.price) > 0)).length
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
      .filter((i) => !i.completed)
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

  // Checking off may need answers first: the pack size when the list unit
  // can't be converted to the pantry unit (e.g. 2 pack of rice counted in
  // gr), and what to do with stock that has expired. Each is asked in a
  // dialog, then the check-off is tried again with the answers.
  const handleToggle = async (item) => {
    const options = {}
    for (;;) {
      // The total follows a quantity changed in the expiry dialog.
      const total = totalOf(options.quantity ? { ...item, quantity: options.quantity } : item)
      const result = await toggleComplete(item, total, options)
      if (result?.needsPackSize) {
        const answer = await askDialog(packSizeDialog(result.needsPackSize))
        if (!answer) return showToast({ message: `"${item.name}" wasn't ${item.completed ? 'unchecked' : 'checked off'}.` })
        options.packSize = answer.packSize
      } else if (result?.needsExpiryChoice) {
        const answer = await askDialog(expiredDialog({ ...result.needsExpiryChoice, quantity: item.quantity, listUnit: item.unit }))
        if (!answer) return showToast({ message: `"${item.name}" wasn't checked off.` })
        options.expired = expiredChoice(answer)
        options.quantity = roundQuantity(answer.quantity, item.unit) || item.quantity
      } else return
    }
  }

  return {
    ...grocery,
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
    checkOff: handleToggle,
  }
}
