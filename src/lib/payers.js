import { PAID_BY_OPTIONS } from '../data/constants'

// Who paid, for new data (plan 9P K210, K216, K217, K225). Every Money pill
// is one real bank account: each person's own, and "Joint" (the household's
// shared account). "Shared" (one expense split between the two people,
// plan 9K) stays only on the rows that already have it.

export const SHARED_PAYER = 'shared'
export const JOINT = 'joint'

// The accounts, in the order of PAID_BY_OPTIONS: the two people and Joint.
export const ACCOUNT_OPTIONS = PAID_BY_OPTIONS.filter((o) => o.kind === 'person' || o.kind === 'account')
export const ACCOUNTS = ACCOUNT_OPTIONS.map((o) => o.value)
const SHARED_OPTION = PAID_BY_OPTIONS.find((o) => o.value === SHARED_PAYER)

export const isAccount = (code) => ACCOUNTS.includes(code)

// A payer that counts as chosen (K225): one of the accounts. On a SHOP card
// "Shared" (the database's default for grocery_items.payer) or an empty
// text means "not chosen yet" → ''.
export const chosenPayer = (code) => (isAccount(code) ? code : '')

// What a payer field offers (K216): the accounts, plus "Shared" only for a
// row that is Shared itself (it keeps it, with its parts).
export const payerOptionsFor = (current) => (current === SHARED_PAYER ? [...ACCOUNT_OPTIONS, SHARED_OPTION] : ACCOUNT_OPTIONS)

// The value an edit form starts on: the row's payer when it is on offer,
// else '' ("Choose…", saving waits; K217).
export const startingPayer = (current) => (payerOptionsFor(current).some((o) => o.value === current) ? current : '')

// The SHOP budget card's bottom line (K225): what each account pays of the
// list, then "No payer yet" for the cards not chosen yet — only when that
// is above €0.00 (in cents). `costOf(item)` is a card's cost.
export function payerTotals(items, costOf) {
  const totalOf = (code) => items.filter((i) => chosenPayer(i.payer) === code).reduce((sum, i) => sum + costOf(i), 0)
  const none = totalOf('')
  return [
    ...ACCOUNT_OPTIONS.map((o) => ({ value: o.value, label: o.label, total: totalOf(o.value) })),
    ...(Math.round(none * 100) > 0 ? [{ value: 'none', label: 'No payer yet', total: none }] : []),
  ]
}

export const PAYER_MISSING = 'Choose who paid.'
export const RECEIVER_MISSING = 'Choose who received it.'
