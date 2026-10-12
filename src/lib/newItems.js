// "New Item" in HOME, derived from data the app already stores — no
// extra column. An item is new from the moment it enters HOME (added
// there, or arriving from a New Item bought in SHOP) until the next time
// it is bought or restocked.
//
// The history can't say which items were new before this feature, so only
// items created after NEW_ITEM_SINCE can be new; everything older never is.
export const NEW_ITEM_SINCE = '2026-10-14T19:55:00Z'

// History entries that count as "bought or restocked" (the + buttons in
// HOME, a confirmed purchase in SHOP). Fixing the stock by hand in the
// editor does not: that is often a correction right after adding.
export const RESTOCK_REASONS = ['purchased', 'restocked']

// `restocks`: the stock history rows (item_id, created_at) with one of
// RESTOCK_REASONS since NEW_ITEM_SINCE. A purchase that creates the item
// is saved in the same moment as the item itself, so only entries after
// the item was created count — and so does one within a few seconds, like
// the purchase that fills a variant made on the spot.
export const ENTRY_GRACE_MS = 30000

export function isNewItem(item, restocks) {
  const created = Date.parse(item.created_at)
  if (!(created >= Date.parse(NEW_ITEM_SINCE))) return false
  return !restocks.some((r) => r.item_id === item.id && Date.parse(r.created_at) > created + ENTRY_GRACE_MS)
}
