// Searching the grocery list (SHOP): case-insensitive, partial, over the
// item name and its category, both the items still to buy and those in
// the cart.
//
// An entry for a group ("Chips & Snacks") is also found by the name or
// brand of any of its variants (`variantNames`).
export function matchesGrocerySearch(item, query, categoryName, variantNames = []) {
  if (!query) return true
  return (
    item.name.toLowerCase().includes(query) ||
    Boolean(item.category_id && categoryName(item.category_id)?.toLowerCase().includes(query)) ||
    matchingVariants(variantNames, query).length > 0
  )
}

export const matchingVariants = (names, query) => (query ? names.filter((n) => n.toLowerCase().includes(query)) : [])

// "Lays paprika" when a group entry was found through its variant.
export function variantHint(item, query, variantNames) {
  if (!query || item.name.toLowerCase().includes(query)) return null
  const hit = matchingVariants(variantNames, query)
  return hit.length ? `In it: ${hit.join(', ')}` : null
}

export const GROCERY_LIST_LABELS = { toBuy: 'To buy', inCart: 'In the cart' }

export const listOf = (item) => (item.in_cart ? 'inCart' : 'toBuy')
