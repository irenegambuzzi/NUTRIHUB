// Searching the grocery list (SHOP): case-insensitive, partial, over the
// item name and its category, both the items still to buy and those in
// the cart.
export function matchesGrocerySearch(item, query, categoryName) {
  if (!query) return true
  return item.name.toLowerCase().includes(query) || Boolean(item.category_id && categoryName(item.category_id)?.toLowerCase().includes(query))
}

export const GROCERY_LIST_LABELS = { toBuy: 'To buy', inCart: 'In the cart' }

export const listOf = (item) => (item.in_cart ? 'inCart' : 'toBuy')
