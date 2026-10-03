import { normalizeName } from './categoryGuess'

// Shopping mode: the order of the shop, shared by both phones
// (supabase/012). Items and categories each may have a position; an item
// without one goes where its category is, a category without one keeps
// its usual place.

const GAP = 1000
const NO_CATEGORY = 1e9

export const itemKey = (name) => `item:${normalizeName(name)}`
export const categoryKey = (id) => `category:${id}`

// Map key → position from the saved rows.
export const positionsFrom = (rows) => new Map(rows.map((r) => [r.id, Number(r.position)]))

// Where a category sits: saved, or its usual place (`defaultOrder`).
export function categoryPosition(categoryId, positions, defaultOrder = []) {
  if (!categoryId) return NO_CATEGORY
  const saved = positions.get(categoryKey(categoryId))
  if (saved != null) return saved
  const usual = defaultOrder.indexOf(categoryId)
  return (usual >= 0 ? usual + 1 : defaultOrder.length + 1) * GAP
}

// Where an item sits: its own position, or its category's.
export function itemPosition(item, positions, defaultOrder) {
  return positions.get(itemKey(item.name)) ?? categoryPosition(item.category_id, positions, defaultOrder)
}

const byName = (a, b) => a.name.localeCompare(b.name)

// Items in the order of the shop ("My route").
export function routeOrder(items, positions, defaultOrder) {
  return [...items].sort((a, b) => itemPosition(a, positions, defaultOrder) - itemPosition(b, positions, defaultOrder) || byName(a, b))
}

// Items grouped by category, the categories in shop order and the items
// in each in their own order ("By category"). [{ categoryId, items }]
export function groupByCategory(items, positions, defaultOrder) {
  const groups = new Map()
  for (const item of items) {
    const id = item.category_id ?? null
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(item)
  }
  return [...groups.entries()]
    .map(([categoryId, list]) => ({ categoryId, items: routeOrder(list, positions, defaultOrder) }))
    .sort((a, b) => categoryPosition(a.categoryId, positions, defaultOrder) - categoryPosition(b.categoryId, positions, defaultOrder))
}

// The rows to save to move list[from] to index `to` (items shown in
// route order). Usually one: the item gets a position between its new
// neighbours. When they're too close to fit one in between (e.g. both
// still at their category's place), every shown item is numbered afresh.
export function moveItemWrites(list, from, to, positions, defaultOrder) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return []
  const order = [...list]
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  const pos = (item) => itemPosition(item, positions, defaultOrder)
  const before = order[to - 1]
  const after = order[to + 1]
  const low = before ? pos(before) : null
  const high = after ? pos(after) : null
  let position
  if (low == null) position = high - GAP
  else if (high == null) position = low + GAP
  else position = (low + high) / 2
  const fits = (low == null || position > low + 1e-6) && (high == null || position < high - 1e-6)
  if (fits) return [{ id: itemKey(moved.name), position }]
  // Spread every shown item evenly over the same stretch of the shop.
  const all = order.map(pos)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const step = max > min ? (max - min) / (order.length - 1) : GAP
  return order.map((item, i) => ({ id: itemKey(item.name), position: min + i * step }))
}

// The rows to save to move a category one place up (-1) or down (1)
// among the shown ones: the two swap places.
export function moveCategoryWrites(shownIds, id, direction, positions, defaultOrder) {
  const from = shownIds.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= shownIds.length) return []
  const other = shownIds[to]
  const a = categoryPosition(id, positions, defaultOrder)
  const b = categoryPosition(other, positions, defaultOrder)
  // Equal places (both unsaved and unknown) get pulled apart.
  const [newA, newB] = a === b ? [b + direction, a] : [b, a]
  return [
    { id: categoryKey(id), position: newA },
    { id: categoryKey(other), position: newB },
  ]
}

// The category order kept on this phone before it was shared, to move
// into the database once.
const OLD_ORDER_KEY = 'nutrihub-shop-order'
export function readOldCategoryOrder() {
  try {
    const order = JSON.parse(localStorage.getItem(OLD_ORDER_KEY) || '[]')
    return Array.isArray(order) ? order : []
  } catch {
    return []
  }
}
export function forgetOldCategoryOrder() {
  try {
    localStorage.removeItem(OLD_ORDER_KEY)
  } catch {
    // Nothing to forget.
  }
}
