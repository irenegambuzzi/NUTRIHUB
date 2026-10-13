// Online orders waiting to arrive: dates, reminders and the expense each
// order creates. Pure helpers, so they can be tested. An order is
// { id, item_name, details, shop_id, order_date, price, paid_by,
//   category_id, expected_date, expected_until, order_url, status,
//   arrived_date, expense_id }, with status 'on_the_way' | 'arrived' |
// 'cancelled' | 'returned' (returned and expense_outcome need
// supabase/020). arrived_date is the day it arrived, or was cancelled or
// returned. expense_outcome is 'kept' | 'deleted': what was done with the
// expense when it was cancelled or returned. Dates are YYYY-MM-DD strings
// in local time.

import { parseLocalDate } from './week'
import { newestFirst } from './recency'

export const ORDER_STATUS = { on_the_way: 'On the way', arrived: 'Arrived', cancelled: 'Cancelled', returned: 'Returned' }

// Whether the database knows "Returned" and the expense outcome yet
// (supabase/020): every order it sends has the expense_outcome column.
export const outcomeSupported = (orders) => orders.some((o) => 'expense_outcome' in o)

// The day an order arrived, was cancelled or returned; '' when it isn't known
// (orders cancelled before the day was kept).
export const closedDate = (order) => order.arrived_date || ''

// What was done with the expense of a cancelled or returned order, for the
// history; null for the others.
export function expenseOutcomeLabel(order) {
  if (order.status !== 'cancelled' && order.status !== 'returned') return null
  if (order.expense_outcome === 'deleted') return 'Expense deleted'
  if (order.expense_outcome === 'kept') return 'Expense kept'
  return order.expense_id ? 'Expense kept' : 'No expense'
}

// An order with no expected date is brought up this long after ordering.
export const NO_DATE_REMINDER_DAYS = 14
// An order is brought up from this many days before it is expected.
export const SOON_DAYS = 2

// Whole days from `from` to `to` (negative when `to` is earlier).
export const dayDiff = (from, to) => Math.round((parseLocalDate(to) - parseLocalDate(from)) / 86400000)

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago".
export function agoLabel(date, today) {
  const days = dayDiff(date, today)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

const shortDate = (date) => parseLocalDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// The last day the order can reasonably arrive.
export const latestExpected = (order) => order.expected_until || order.expected_date || null

// Where an order on the way stands today:
//   'overdue' – past its (latest) expected date
//   'today'   – expected today, or inside its range of dates
//   'soon'    – expected within SOON_DAYS days
//   'later'   – expected further away
//   'nodate'  – no expected date
export function orderState(order, today) {
  if (!order.expected_date) return 'nodate'
  if (dayDiff(latestExpected(order), today) > 0) return 'overdue'
  const untilStart = dayDiff(today, order.expected_date)
  if (untilStart <= 0) return 'today'
  return untilStart <= SOON_DAYS ? 'soon' : 'later'
}

// How the expected date reads: "expected today", "expected in 3 days",
// "expected 14–20 Oct", "overdue by 2 days".
export function expectedLabel(order, today) {
  const state = orderState(order, today)
  if (state === 'nodate') return 'no expected date'
  const start = order.expected_date
  const end = latestExpected(order)
  if (state === 'overdue') return `overdue by ${plural(dayDiff(end, today), 'day')}`
  if (state === 'today') {
    if (start === today || start === end) return 'expected today'
    return `expected until ${shortDate(end)}`
  }
  if (state === 'soon') {
    const days = dayDiff(today, start)
    return days === 1 ? 'expected tomorrow' : `expected in ${days} days`
  }
  return start === end ? `expected ${shortDate(start)}` : `expected ${shortDate(start)} – ${shortDate(end)}`
}

// Orders on the way: earliest expected first, those with no date last
// (oldest order first among them).
export function sortOnTheWay(orders) {
  return [...orders].sort((a, b) => {
    if (a.expected_date && b.expected_date) return a.expected_date.localeCompare(b.expected_date) || a.order_date.localeCompare(b.order_date)
    if (a.expected_date) return -1
    if (b.expected_date) return 1
    return a.order_date.localeCompare(b.order_date) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })
}

// The orders on the way, and the finished ones (arrived, cancelled or
// returned) for the history: the latest change first, and on the same day
// the one entered last.
export function splitOrders(orders) {
  const finished = orders.filter((o) => o.status !== 'on_the_way')
  finished.sort(newestFirst((o) => closedDate(o) || o.order_date))
  return { onTheWay: sortOnTheWay(orders.filter((o) => o.status === 'on_the_way')), history: finished }
}

// The orders to remind about today, most pressing first: overdue, expected
// today, expected within 2 days; and orders with no expected date once
// NO_DATE_REMINDER_DAYS have passed since ordering. `shopName(shopId)`
// gives the store's name. Each: { order, state, message }.
export function reminders(orders, today, shopName = () => null) {
  const rank = { overdue: 0, today: 1, soon: 2, nodate: 3 }
  const out = []
  for (const order of orders) {
    if (order.status !== 'on_the_way') continue
    const state = orderState(order, today)
    if (state === 'later') continue
    if (state === 'nodate' && dayDiff(order.order_date, today) < NO_DATE_REMINDER_DAYS) continue
    const store = shopName(order.shop_id)
    out.push({
      order,
      state,
      message: `${order.item_name}${store ? ` from ${store}` : ''}, ordered ${agoLabel(order.order_date, today)}, ${expectedLabel(order, today)}`,
    })
  }
  const order = new Map(sortOnTheWay(out.map((r) => r.order)).map((o, i) => [o.id, i]))
  return out.sort((a, b) => rank[a.state] - rank[b.state] || order.get(a.order.id) - order.get(b.order.id))
}

// A link typed for an order, as something safe to open: http(s) only
// ("amazon.it/x" gets https://). null when empty or not a web address.
export function normalizeUrl(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.href : null
  } catch {
    return null
  }
}

// The expense an order creates when it is placed (the money is spent when
// ordering): its order date, price, category, payer and store.
export function expenseRowForOrder(order, shopsAvailable = true) {
  return {
    category_id: order.category_id ?? null,
    amount: Number(order.price),
    description: order.item_name,
    paid_by: order.paid_by,
    expense_date: order.order_date,
    ...(shopsAvailable ? { shop_id: order.shop_id ?? null } : {}),
  }
}

// Which fields of the linked expense an edit of the order changes: only
// those the order's price, date, category, payer or store changed, so an
// expense edited on its own isn't overwritten by an unrelated edit.
// `before` and `after` are order rows.
export function expensePatchForOrder(before, after, shopsAvailable = true) {
  const patch = {}
  if (Number(before.price) !== Number(after.price)) patch.amount = Number(after.price)
  if (before.order_date !== after.order_date) patch.expense_date = after.order_date
  if ((before.category_id ?? null) !== (after.category_id ?? null)) patch.category_id = after.category_id ?? null
  if (before.paid_by !== after.paid_by) patch.paid_by = after.paid_by
  if (shopsAvailable && (before.shop_id ?? null) !== (after.shop_id ?? null)) patch.shop_id = after.shop_id ?? null
  return patch
}

// The units an order for a SHOP list entry can be counted in: the entry's
// own unit, its HOME item's purchase unit and its stock unit.
export function orderUnits(entry, pantry) {
  const purchase = pantry?.packaging_unit && Number(pantry.quantity_per_pack) > 0 ? pantry.packaging_unit : null
  return [...new Set([entry.unit, purchase, pantry?.unit].filter(Boolean))]
}
