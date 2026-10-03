import { normName } from './grocery'

// Suggestions for the quick-add box: everything bought or listed before,
// with what to fill in when it's picked.

const HISTORY_KEY = 'nutrihub-quick-add-history'
const HISTORY_LIMIT = 100

// What was quick-added on this phone, newest first — keeps names that
// never reach the pantry (appliances) after the list is cleared.
export function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function rememberAdded(entry) {
  const list = [entry, ...readHistory().filter((e) => normName(e.name) !== normName(entry.name))].slice(0, HISTORY_LIMIT)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Not remembered; suggestions still come from the pantry and list.
  }
}

const fromRow = (row, source) => ({
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
// unit and payer), then the newest grocery entry, then this phone's
// history.
export function buildSuggestions(pantryItems, groceryItems, history = []) {
  const byName = new Map()
  const add = (s) => {
    const key = normName(s.name)
    if (key && !byName.has(key)) byName.set(key, s)
  }
  pantryItems.forEach((p) => add(fromRow(p, 'pantry')))
  ;[...groceryItems].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).forEach((g) => add(fromRow(g, 'list')))
  history.forEach((h) => add({ ...h, source: 'history' }))
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
