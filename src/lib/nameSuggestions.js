import { normName } from './grocery'

// Name suggestions for the "Add to SHOP list" form: HOME items and open
// SHOP cards, with what to fill in when one is picked.

// What a pantry item (source 'pantry') or a SHOP entry ('list') fills in.
export const suggestionFrom = (row, source) => ({
  name: row.name.trim(),
  categoryId: row.category_id ?? null,
  subcategoryId: row.subcategory_id ?? null,
  unit: row.unit,
  price: Number(row.price) > 0 ? Number(row.price) : 0,
  priceQty: Number(row.price) > 0 ? row.price_qty ?? null : null,
  priceUnit: Number(row.price) > 0 ? row.price_unit ?? null : null,
  payer: row.payer || 'shared',
  pantryItemId: source === 'pantry' ? row.id : row.pantry_item_id ?? null,
  source,
})

// One suggestion per name. The pantry item wins (it has the last price,
// unit and payer), then the newest grocery entry.
export function buildSuggestions(pantryItems, groceryItems) {
  const byName = new Map()
  const add = (s) => {
    const key = normName(s.name)
    if (key && !byName.has(key)) byName.set(key, s)
  }
  pantryItems.forEach((p) => add(suggestionFrom(p, 'pantry')))
  ;[...groceryItems].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).forEach((g) => add(suggestionFrom(g, 'list')))
  return [...byName.values()]
}

// Best matches for what's typed: names starting with it first, then
// names with a word starting with it, then names containing it.
export function matchSuggestions(suggestions, query, limit = 6) {
  const q = normName(query)
  if (!q) return []
  const rank = (s) => {
    const name = normName(s.name)
    if (name.startsWith(q)) return 0
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1
    if (name.includes(q)) return 2
    return -1
  }
  return suggestions
    .map((s) => ({ s, r: rank(s) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s)
}
