// Shopping mode: open items grouped by category, in the order of the
// shop's aisles as arranged on this phone.

const ORDER_KEY = 'nutrihub-shop-order'

export function readCategoryOrder() {
  try {
    const order = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]')
    return Array.isArray(order) ? order : []
  } catch {
    return []
  }
}

export function saveCategoryOrder(order) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    // Not remembered; the order still applies until the app closes.
  }
}

// Groups `items` by category: arranged categories first in the saved
// order, the rest after in their usual order (`defaultOrder`); items
// without a category last. Each group is [{ categoryId, items }].
export function groupByCategory(items, savedOrder, defaultOrder = []) {
  const groups = new Map()
  for (const item of items) {
    const id = item.category_id ?? null
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(item)
  }
  const rank = (id) => {
    if (id === null) return [2, 0]
    const saved = savedOrder.indexOf(id)
    if (saved >= 0) return [0, saved]
    const usual = defaultOrder.indexOf(id)
    return [1, usual >= 0 ? usual : Infinity]
  }
  return [...groups.entries()]
    .map(([categoryId, list]) => ({ categoryId, items: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      const [ga, ia] = rank(a.categoryId)
      const [gb, ib] = rank(b.categoryId)
      return ga - gb || ia - ib
    })
}

// Moves a category one place up (-1) or down (1) among the shown ones and
// returns the new saved order (every shown category, in order).
export function moveCategory(shownIds, id, direction) {
  const order = [...shownIds]
  const from = order.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= order.length) return order
  ;[order[from], order[to]] = [order[to], order[from]]
  return order
}

// Shown categories in their new order, plus arranged ones not on the list
// today (so their place is kept for next time).
export function mergeOrder(newShownOrder, savedOrder) {
  return [...newShownOrder, ...savedOrder.filter((id) => !newShownOrder.includes(id))]
}
