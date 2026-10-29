// Order groups (plan 9I, supabase/028): several online orders of the same
// store, order date and payer that were one order at the store, with ONE
// discount for the whole order ("Promotion Applied −€3.23"). Each order
// stays its own row with its own expense; the group's discount is spread
// over its orders with the purchase coupon's rule (spreadCoupon), and each
// order keeps its part (`group_share`), so a cancel or return never moves
// anything. Pure rules, so every one can be tested; the database checks
// them again (save_order_group).

import { PAID_BY_OPTIONS } from '../data/constants'
import { spreadCoupon } from './discounts'
import { orderBase, orderPriceNote } from './orders'
import { parseLocalDate } from './week'

export const GROUPS_NOTICE = 'This needs the database update supabase/028_order_groups.sql'

const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label ?? value
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const money = (n) => `€${(Math.round(Number(n) * 100) / 100).toFixed(2)}`

// "17/10" for an order date.
export const dayMonth = (date) => {
  const [, m, d] = String(date ?? '').split('-')
  return d && m ? `${d}/${m}` : ''
}

// Orders in the order they were saved: by created_at, then id. The last
// one takes the cents left over when the discount is spread.
export const savedOrder = (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id))

// The orders of a group (every status), in the order they were saved.
export const groupMembers = (groupId, orders) => (groupId ? orders.filter((o) => o.group_id === groupId).sort(savedOrder) : [])

// The discount typed on a group ({ kind, value }) or null.
export const groupDiscount = (group) =>
  group?.discount_kind && Number(group.discount_value) > 0 ? { kind: group.discount_kind, value: Number(group.discount_value) } : null

// The discount the group gave, in €: what its orders carry (cancelled and
// returned ones too).
export const groupDiscountTotal = (members) => Math.round(members.reduce((s, o) => s + (Number(o.group_share) || 0), 0) * 100) / 100

// "(order discount −€3.23)" for the group's row; '' without a discount.
export function groupDiscountNote(members) {
  const total = groupDiscountTotal(members)
  return total > 0 ? `(order discount −${money(total)})` : ''
}

// "Amazon.it · 17/10 (7 items)": how a group is named on the order cards
// (after "Order: ") and on its buttons. `shopName(shopId)` → its name.
export function groupLabel(members, shopName = () => null) {
  const first = members[0]
  if (!first) return ''
  return `${shopName(first.shop_id) ?? 'Store'} · ${dayMonth(first.order_date)} (${plural(members.length, 'item')})`
}

// "Cat Dry Food, Cat Wet Food, Hairs all Relief +4 more"
export function itemNames(orders) {
  const names = orders.map((o) => o.item_name)
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ')
}

// What each order of a group pays when `discount` is spread over all of
// them by their price before it (`bases`, default each order's own): the
// shares in the order of `members` (saved order), rounded to cents, the
// cents left over on the order saved last. → { total, shares }
export function spreadGroup(members, discount, bases = members.map(orderBase)) {
  return spreadCoupon(bases, discount)
}

// What the database is told an order was, so it can refuse when the other
// phone changed it meanwhile.
const was = (order) => ({ price: Number(order.price), group_share: Number(order.group_share) || 0, group_id: order.group_id ?? null })

// The request for save_order_group with the shares given:
//   id                     the group
//   group                  { shop_id, order_date, paid_by, discount_kind,
//                            discount_value, discount_total, created_at? }
//   members                [{ order, base, share }] — in the group afterwards
//   leaving                [{ order, base }] — out of it afterwards
// `order` is each order as it is now (its row).
export function rawGroupPayload({ id, group, members, leaving = [], undo = false }) {
  return {
    id,
    shop_id: group?.shop_id ?? null,
    order_date: group?.order_date ?? null,
    paid_by: group?.paid_by ?? null,
    discount_kind: group?.discount_kind ?? null,
    discount_value: group?.discount_kind ? Number(group.discount_value) : null,
    discount_total: Number(group?.discount_total) || 0,
    orders: members.map(({ order, base, share }) => ({ id: order.id, base, share, was: was(order) })),
    leaving: leaving.map(({ order, base }) => ({ id: order.id, base, was: was(order) })),
    ...(undo ? { undo: true } : {}),
    ...(undo && group?.created_at ? { created_at: group.created_at } : {}),
  }
}

// The request that puts `members` (orders as they are now) in group `id`
// with `discount` spread over all of them, and takes `leaving` out (their
// share back to 0, their price back to what it was before the discount).
// `bases`: an order's price before the group discount, when it is not its
// own (an order being edited: id → base). Store, date and payer are the
// group's (`place`).
export function groupPayload({ id, place, discount = null, members, leaving = [], bases = {} }) {
  const sorted = [...members].sort(savedOrder)
  const before = sorted.map((o) => bases[o.id] ?? orderBase(o))
  const { total, shares } = spreadGroup(sorted, discount, before)
  return rawGroupPayload({
    id,
    group: { ...place, discount_kind: discount?.kind ?? null, discount_value: discount?.value ?? null, discount_total: discount ? total : 0 },
    members: sorted.map((order, i) => ({ order, base: before[i], share: discount ? shares[i] : 0 })),
    leaving: leaving.map((order) => ({ order, base: orderBase(order) })),
  })
}

// The request that undoes a change: every order back exactly as it was
// before (`before`: the orders then; `now`: the same orders as they are
// now), the group too (`groupBefore`, null when it didn't exist: then
// everything leaves it again and it is removed).
export function undoGroupPayload({ id, groupBefore, before, now }) {
  const nowById = new Map(now.map((o) => [o.id, o]))
  const current = (o) => nowById.get(o.id) ?? o
  const members = groupBefore ? before.filter((o) => o.group_id === id).sort(savedOrder) : []
  const leaving = before.filter((o) => !members.includes(o))
  return rawGroupPayload({
    id,
    group: groupBefore,
    members: members.map((o) => ({ order: current(o), base: orderBase(o), share: Number(o.group_share) || 0 })),
    leaving: leaving.map((o) => ({ order: current(o), base: orderBase(o) })),
    undo: true,
  })
}

// Where a group is: the store, order date and payer of its orders.
export const placeOf = (order) => ({ shop_id: order.shop_id ?? null, order_date: order.order_date, paid_by: order.paid_by })

// The groups and single orders a new order could join (K2): the same
// store, order date and payer — a group once, a single order (not in a
// group, any status) on its own. No store → none. Oldest first.
//   → [{ key, groupId, orders }]   (groupId null for a single order)
export function joinCandidates(orders, { shopId, orderDate, paidBy }, exceptId = null) {
  if (!shopId || !orderDate || !paidBy) return []
  const same = orders.filter((o) => o.id !== exceptId && o.shop_id === shopId && o.order_date === orderDate && o.paid_by === paidBy).sort(savedOrder)
  const out = []
  const seen = new Set()
  for (const o of same) {
    if (!o.group_id) out.push({ key: o.id, groupId: null, orders: [o] })
    else if (!seen.has(o.group_id)) {
      seen.add(o.group_id)
      out.push({ key: o.group_id, groupId: o.group_id, orders: groupMembers(o.group_id, orders) })
    }
  }
  return out
}

// "Same order as: Cat Dry Food, Cat Wet Food (Amazon.it · 17/10)"
export function candidateLabel(candidate, shopName = () => null) {
  const first = candidate.orders[0]
  return `Same order as: ${itemNames(candidate.orders)} (${shopName(first.shop_id) ?? 'Store'} · ${dayMonth(first.order_date)})`
}

// "The order discount will be spread again over N items." — said before an
// order joins (or a member's price changes) when its group has a discount.
// `count`: how many orders the group has afterwards.
export const respreadNote = (count) => `The order discount will be spread again over ${plural(count, 'item')}.`

// What "Group orders" can do with the ticked orders (all orders known to
// the phone in `orders`):
//   { problem }                          — why nothing can be done
//   { newGroup: bool, targets: [{ groupId, members }], singles }
// A new group needs two or more orders not in a group. When a group of the
// same store, date and payer exists, the ticked orders can only be added to
// it ("Add to …"; the group's own ticked orders are simply part of it).
// Every status counts.
export function groupingPlan(selected, orders, shopName = () => null) {
  if (selected.length === 0) return { problem: 'Tick at least two orders to group them as one order.' }
  const noStore = selected.find((o) => !o.shop_id)
  if (noStore) return { problem: `"${noStore.item_name}" has no store. Set the store on the order first.` }
  const stores = [...new Set(selected.map((o) => o.shop_id))]
  if (stores.length > 1) return { problem: `Only orders of the same store can be one order — these are from ${stores.map((s) => shopName(s) ?? 'a store').join(' and ')}.` }
  const dates = [...new Set(selected.map((o) => o.order_date))].sort()
  if (dates.length > 1) return { problem: `Only orders of the same order date can be one order — these are on ${dates.map((d) => parseLocalDate(d).toLocaleDateString('en-GB')).join(', ')}.` }
  const payers = [...new Set(selected.map((o) => o.paid_by))]
  if (payers.length > 1) return { problem: `Only orders paid by the same person can be one order — these are paid by ${payers.map(payerLabel).join(' and ')}.` }
  const groupIds = [...new Set(selected.map((o) => o.group_id).filter(Boolean))]
  if (groupIds.length > 1) {
    const other = selected.find((o) => o.group_id === groupIds[1])
    return { problem: `"${other.item_name}" is already in another order group.` }
  }
  const singles = selected.filter((o) => !o.group_id)
  if (groupIds.length === 1) {
    if (singles.length === 0) return { problem: 'These orders are already one order.' }
    return { newGroup: false, targets: [{ groupId: groupIds[0], members: groupMembers(groupIds[0], orders) }], singles }
  }
  const [{ shop_id: shopId, order_date: orderDate, paid_by: paidBy }] = singles
  const targets = joinCandidates(orders, { shopId, orderDate, paidBy })
    .filter((c) => c.groupId)
    .map((c) => ({ groupId: c.groupId, members: c.orders }))
  const newGroup = singles.length >= 2 && targets.length === 0
  if (!newGroup && targets.length === 0) return { problem: 'Tick at least two orders to group them as one order.' }
  return { newGroup, targets, singles }
}

// Each order of a group as the "Order group" sheet lists it, with
// `discount` (as typed) spread over all of them: its price before the
// order discount, its share, what it pays and the line it would say.
export function groupPreview(members, discount) {
  const sorted = [...members].sort(savedOrder)
  const bases = sorted.map(orderBase)
  const { total, shares } = spreadGroup(sorted, discount, bases)
  return {
    total: discount ? total : 0,
    rows: sorted.map((order, i) => {
      const share = discount ? shares[i] : 0
      const paid = Math.round((bases[i] - share) * 100) / 100
      return { order, base: bases[i], share, paid, note: orderPriceNote({ ...order, price: paid, group_share: share }) }
    }),
  }
}

// The database answered that 028 hasn't been run (no function, table or
// column yet): said in one line.
export function missingGroups(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`
  return (
    ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code) ||
    (['PGRST204', '42703'].includes(error?.code) && /group_id|group_share|order_groups/.test(text)) ||
    (/save_order_group|order_groups/.test(text) && /does not exist|could not find/i.test(text))
  )
}

// The message for a refused or failed group change.
export function groupErrorMessage(error) {
  if (missingGroups(error)) return GROUPS_NOTICE
  if (error?.code === '42501') return 'Not allowed: log in with the household account.'
  return String(error?.message ?? '') || "Couldn't save — check your connection."
}

// What is said when an expense was edited by hand and so left alone
// (save_order_group's `kept`): '' when there was none.
export function keptNote(kept = []) {
  if (!kept.length) return ''
  return kept.map((k) => `"${k.name}": its expense was changed by hand (${money(k.amount)}), so it was left as it is.`).join(' ')
}
