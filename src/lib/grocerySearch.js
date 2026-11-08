// Searching the grocery list (SHOP): case-insensitive, partial, over the
// item name and its category, both the items still to buy and those in
// the cart.
//
// An entry of an item is also found by the item's other names
// (`otherNames`, plan 9N).
export function matchesGrocerySearch(item, query, categoryName, otherNames = []) {
  if (!query) return true
  return (
    item.name.toLowerCase().includes(query) ||
    Boolean(item.category_id && categoryName(item.category_id)?.toLowerCase().includes(query)) ||
    matchingNames(otherNames, query).length > 0
  )
}

export const matchingNames = (names, query) => (query ? names.filter((n) => n.toLowerCase().includes(query)) : [])

// "In it: Corn Snack" when an entry was found through another name of its
// item.
export function namesHint(item, query, otherNames) {
  if (!query || item.name.toLowerCase().includes(query)) return null
  const hit = matchingNames(otherNames, query)
  return hit.length ? `In it: ${hit.join(', ')}` : null
}

export const GROCERY_LIST_LABELS = { toBuy: 'To buy', inCart: 'In the cart' }

export const listOf = (item) => (item.in_cart ? 'inCart' : 'toBuy')
