import { PACKAGING_UNITS, PAID_BY_OPTIONS, UNIT_VALUES } from '../data/constants'

// Helpers for the grocery list.

// Packaging units that aren't also regular units (offered separately).
export const EXTRA_PACKAGING_UNITS = PACKAGING_UNITS.filter((u) => !UNIT_VALUES.includes(u))

export const normName = (s) => (s || '').trim().toLowerCase()
export const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || 'Shared'

// The cart in the order things went into it: oldest first by
// cart_added_at (set by the database, supabase/023), then by when the
// entry was made (items put back together by Reopen share one time). An
// entry without a cart time goes last.
export function byCartOrder(a, b) {
  const at = (g) => g.cart_added_at || null
  if (at(a) !== at(b)) {
    if (!at(a)) return 1
    if (!at(b)) return -1
    const diff = new Date(at(a)) - new Date(at(b))
    if (diff) return diff
  }
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
}

export const inCartOrder = (items) => items.filter((i) => i.in_cart).sort(byCartOrder)

// Reason order for each sort; 'stocked' = in the pantry and fine;
// 'not-urgent' = a group whose total is fine but with a variant at 0, at
// the bottom. Budget planning always uses PRIORITY, whatever the chosen
// sort; A–Z, price and recent keep their own order.
export const PRIORITY = ['out', 'low', 'expired', 'new', 'stocked', 'not-urgent']
const REASON_ORDERS = {
  priority: PRIORITY,
  low: ['low', 'out', 'expired', 'new', 'stocked', 'not-urgent'],
  new: ['new', 'out', 'low', 'expired', 'stocked', 'not-urgent'],
}

// The list in the chosen order (`mode`: priority, low, new, az, price,
// recent). `reasonOf(entry)` and `costOf(entry)` come from the list.
// What's in the cart always sinks to the bottom, in the order it went
// into the cart.
export function sortGroceryItems(list, mode, { reasonOf, costOf }) {
  const order = REASON_ORDERS[mode]
  const rank = (g) => (order ? order.indexOf(reasonOf(g)) : 0)
  const tie =
    {
      az: (a, b) => a.name.localeCompare(b.name),
      price: (a, b) => costOf(b) - costOf(a),
    }[mode] || ((a, b) => b.created_at.localeCompare(a.created_at))
  return [...list].sort((a, b) => Number(Boolean(a.in_cart)) - Number(Boolean(b.in_cart)) || (a.in_cart ? byCartOrder(a, b) : rank(a) - rank(b) || tie(a, b)))
}

// Newest day first, with each day's total.
export function groupByDate(expenses) {
  const map = new Map()
  for (const e of expenses) {
    const list = map.get(e.expense_date) || []
    list.push(e)
    map.set(e.expense_date, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, list, total: list.reduce((sum, e) => sum + Number(e.amount || 0), 0) }))
}
