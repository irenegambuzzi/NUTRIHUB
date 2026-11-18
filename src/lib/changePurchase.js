// "Change purchase ▾" (plan 9P, K204–K209, K236, K237): the date or the
// payer of a whole purchase (SHOP, MONEY or merged) changed at once, after a
// mistake, by one database function (supabase/034_change_purchase.sql,
// change_purchase). Pure rules and texts, so every one can be tested; the
// database checks the request again.
//
// The request carries what the app saw (`was`) and what it wants (`now`),
// in the same shape, for every row the function writes:
//
//   { trip_id,
//     was: { trip:     { trip_date, paid_by },
//            expenses: [{ id, expense_date, paid_by, part_<code>… }],   every expense of the purchase, merged ones too
//            photos:   [{ id, receipt_date }],                           its receipt photos
//            cards:    [{ id, payer }] },                                its SHOP cards (grocery_items.trip_id)
//     now: { the same, with the same ids } }
//
// The Undo is the same call with `was` and `now` swapped, so every value
// comes back exactly, row by row (mixed payers, each Shared part, a photo
// that was on its own day).

import { PAID_BY_OPTIONS } from '../data/constants'
import { PART_COLUMNS, SHARED } from './sharedParts'
import { parseLocalDate } from './week'

export const CHANGE_PURCHASE_FILE = 'supabase/034_change_purchase.sql'
export const CHANGE_PURCHASE_NOTICE = `This needs the database update ${CHANGE_PURCHASE_FILE}`
export const FUTURE_PURCHASE = "A purchase can't be after today."
export const CHANGED_MEANWHILE = 'This purchase changed meanwhile (on another device?) — open it again. Nothing was changed.'
export const DATE_INVALID = 'Fix the date first (DD/MM/YYYY).'
export const CLEARED_PARTS = ' — its parts are cleared when you save.'

const labelOf = (code) => PAID_BY_OPTIONS.find((o) => o.value === code)?.label ?? code
const byId = (a, b) => String(a.id).localeCompare(String(b.id))
const part = (value) => (value == null || value === '' ? null : Number(value))
export const dayText = (date) => parseLocalDate(date).toLocaleDateString('en-GB')

// What a purchase is now, in the request's shape, from its rows as read
// (any extra columns are left out; rows sorted by id).
export function purchaseState({ trip, expenses = [], photos = [], cards = [] }) {
  return {
    trip: { trip_date: trip.trip_date, paid_by: trip.paid_by ?? null },
    expenses: expenses
      .map((e) => ({ id: e.id, expense_date: e.expense_date, paid_by: e.paid_by, ...Object.fromEntries(PART_COLUMNS.map((c) => [c, part(e[c])])) }))
      .sort(byId),
    photos: photos.map((p) => ({ id: p.id, receipt_date: p.receipt_date })).sort(byId),
    cards: cards.map((c) => ({ id: c.id, payer: c.payer })).sort(byId),
  }
}

// Every expense, the purchase itself and its receipt photos on `date`
// (one date per purchase: an expense edited by hand to another day moves
// too). Payers and cards stay as they are.
export function withDate(state, date) {
  return {
    ...state,
    trip: { ...state.trip, trip_date: date },
    expenses: state.expenses.map((e) => ({ ...e, expense_date: date })),
    photos: state.photos.map((p) => ({ ...p, receipt_date: date })),
  }
}

// One payer for the whole purchase (K92, K205): every expense (merged ones
// too), the purchase, and its SHOP cards (K208). Never "Shared" (K216), so
// every part is cleared (9K K11).
export function withPayer(state, payer) {
  const noParts = Object.fromEntries(PART_COLUMNS.map((c) => [c, null]))
  return {
    ...state,
    trip: { ...state.trip, paid_by: payer },
    expenses: state.expenses.map((e) => ({ ...e, paid_by: payer, ...noParts })),
    cards: state.cards.map((c) => ({ ...c, payer })),
  }
}

export const changePayload = (tripId, was, now) => ({ trip_id: tripId, was, now })
export const undoPayload = (payload) => changePayload(payload.trip_id, payload.now, payload.was)

// "Saving the value it already has": nothing is sent. The date: the
// purchase and every expense already on it. The payer: every expense
// already paid by it, without parts.
export const hasDate = (state, date) => state.trip.trip_date === date && state.expenses.every((e) => e.expense_date === date)
export const hasPayer = (state, payer) => state.expenses.length > 0 && state.expenses.every((e) => e.paid_by === payer && PART_COLUMNS.every((c) => e[c] == null))

// The payer the "Paid by" select starts on (K236): the one every expense
// has, when it is one of `options` (the accounts); else '' ("Choose…").
export function startPayer(expenses, options) {
  const payers = [...new Set(expenses.map((e) => e.paid_by))]
  return payers.length === 1 && options.some((o) => o.value === payers[0]) ? payers[0] : ''
}

// The grey line under a select that starts on "Choose…" (K236):
//   all Shared             "Now: Shared — its parts are cleared when you save."
//   mixed payers           "Now: Irene (3) · Akbar (2)" (labels in the order
//                          of PAID_BY_OPTIONS, counts = expenses), plus the
//                          Shared sentence when one of them is Shared.
// '' when the select starts on a payer.
export function payerNowLine(expenses, options) {
  if (!expenses.length || startPayer(expenses, options)) return ''
  const counts = new Map()
  for (const e of expenses) counts.set(e.paid_by, (counts.get(e.paid_by) ?? 0) + 1)
  const cleared = counts.has(SHARED) ? CLEARED_PARTS : ''
  if (counts.size === 1) return `Now: ${labelOf([...counts.keys()][0])}${cleared}`
  const known = PAID_BY_OPTIONS.map((o) => o.value).filter((code) => counts.has(code))
  const others = [...counts.keys()].filter((code) => !known.includes(code))
  return `Now: ${[...known, ...others].map((code) => `${labelOf(code)} (${counts.get(code)})`).join(' · ')}${cleared}`
}

// The grey lines and toasts (K237); singular with 1.
export const storeLine = (date, n) => `Purchase of ${dayText(date)}: the store changes for all ${n} of its expenses, in every budget category.`
export const dateLine = (n) => (n === 1 ? 'The 1 expense of this purchase moves to this day.' : `All ${n} expenses of this purchase move to this day.`)
export const payerLine = (n) => (n === 1 ? 'The 1 expense of this purchase gets this payer.' : `All ${n} expenses of this purchase get this payer.`)
const expensesText = (n) => `${n} expense${n === 1 ? '' : 's'}`
export const dateToast = (n, date) => `Date changed for ${expensesText(n)} of this purchase · ${dayText(date)}`
export const payerToast = (n, payer) => `Paid by changed for ${expensesText(n)} of this purchase · ${labelOf(payer)}`

// Why a date can't be saved ('' when it can): the field's own check, then
// after today (K206), by the device's local date like the transfer form.
export function dateProblem({ date, dateOk, today }) {
  if (!dateOk || !date) return DATE_INVALID
  if (date > today) return FUTURE_PURCHASE
  return ''
}

// The database answered that 034 hasn't been run (no such function).
export function missingChangePurchase(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`
  return ['PGRST202', '42883'].includes(error?.code) || (/change_purchase/.test(text) && /does not exist|could not find/i.test(text))
}

// The database refused (it answered with a reason): said in the panel's
// red line. A failed connection has no code: toast + Retry instead.
export const refusedByDatabase = (error) => Boolean(error?.code) || missingChangePurchase(error)

export function refusalText(error) {
  if (missingChangePurchase(error)) return CHANGE_PURCHASE_NOTICE
  if (error?.code === '42501') return 'Not allowed: log in with the household account.'
  if (String(error?.message ?? '').includes('changed meanwhile')) return CHANGED_MEANWHILE
  return String(error?.message ?? '') || CHANGED_MEANWHILE
}
