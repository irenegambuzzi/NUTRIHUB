// "Bought at": the stores expenses were made in. Pure helpers, so they can
// be tested. A store is { id, name, is_online }; an expense points to one
// with shop_id (or to none).

export const NO_STORE = 'none'

export const SHOPS_NOTICE = 'Stores need a one-time database update (supabase/019_stores_and_orders.sql). Until then expenses are saved without a store.'

const amountOf = (row) => Number(row.amount || 0)

// Whether the stores can be used: loaded, and the database has them
// (supabase/019 has been run). `state` is a table store's snapshot.
export const shopsAvailable = (state) => Boolean(state?.loaded) && !state?.missing

// The key an expense is filed under: its store's id, or NO_STORE. A
// store id the list doesn't know counts as none.
export function shopKeyFor(shopById) {
  return (expense) => (expense.shop_id && shopById.has(expense.shop_id) ? expense.shop_id : NO_STORE)
}

// Spending per store, highest first, each with its share of the total in
// percent. Expenses without a store are one row, "No store".
export function shopTotals(expenses, shopById) {
  const keyOf = shopKeyFor(shopById)
  const byKey = new Map()
  for (const e of expenses) {
    const key = keyOf(e)
    if (!byKey.has(key)) {
      const shop = shopById.get(key)
      byKey.set(key, { key, id: shop?.id ?? null, name: shop?.name ?? 'No store', online: Boolean(shop?.is_online), total: 0, count: 0 })
    }
    const row = byKey.get(key)
    row.total += amountOf(e)
    row.count += 1
  }
  const total = expenses.reduce((sum, e) => sum + amountOf(e), 0)
  return [...byKey.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((s) => ({ ...s, share: total > 0 ? (s.total / total) * 100 : 0 }))
}

// What was spent online, in a physical store, and with no store at all.
export function onlineSplit(expenses, shopById) {
  const out = { online: { total: 0, count: 0 }, inStore: { total: 0, count: 0 }, none: { total: 0, count: 0 } }
  const keyOf = shopKeyFor(shopById)
  for (const e of expenses) {
    const key = keyOf(e)
    const part = key === NO_STORE ? out.none : shopById.get(key).is_online ? out.online : out.inStore
    part.total += amountOf(e)
    part.count += 1
  }
  return out
}

// The stores used most often first (ties and unused ones by name), with
// the ids in `alwaysInclude` (e.g. the one picked) added if they didn't
// make it. `usage` is the expenses that have a store ({ shop_id }).
export function quickShops(shops, usage, { limit = 4, alwaysInclude = [] } = {}) {
  const counts = new Map()
  for (const row of usage) if (row.shop_id) counts.set(row.shop_id, (counts.get(row.shop_id) ?? 0) + 1)
  const ranked = [...shops].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
  const chosen = ranked.slice(0, limit)
  for (const id of alwaysInclude) {
    const shop = shops.find((s) => s.id === id)
    if (shop && !chosen.includes(shop)) chosen.push(shop)
  }
  return chosen
}

export const SHOP_NAME_MAX = 40

// What's wrong with a store name, or '' when it's fine. `ignoreId`: the
// store being renamed (its own name is allowed).
export function shopNameProblem(shops, name, ignoreId = null) {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the store a name.'
  if (trimmed.length > SHOP_NAME_MAX) return `A store name can have at most ${SHOP_NAME_MAX} letters.`
  if (shops.some((s) => s.id !== ignoreId && s.name.toLowerCase() === trimmed.toLowerCase())) return `"${trimmed}" already exists.`
  return ''
}
