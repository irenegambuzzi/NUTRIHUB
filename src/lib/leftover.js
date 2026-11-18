import { payerLabel, personalExpenses } from './sharedParts'
import { FULL_MONTH_NAMES } from './expensePeriods'
import { ACCOUNTS, JOINT } from './payers'
import { accountMoves, startCentsOf } from './transfers'

// The leftover from earlier months (plan 9O K164–K172). Computed from the
// rows and only shown, never saved: every later edit, delete or add of an
// old expense or income changes it at once. Pure, so every rule can be
// tested.
//
// The leftover of a period starting in month S = everything from the first
// month with data up to the month before S: all income − all expenses
// (K165). Carried on, so it is simply every row dated before the period's
// first day. A person's leftover uses the numbers of the person pills (A1,
// plan 9K): income received by that person − their own expenses − their
// parts of Shared expenses with parts (K9 scaling, K14); Shared expenses
// without parts and Shared income are in no person (K4).
//
// Plan 9P (K218, K221–K224): every pill is one bank account (each person's
// own, and Joint). Transfers between them and Joint's starting balance are no
// income and no expense, but they are money: an account's leftover and
// BALANCE count its transfers in and out and its starting balance; the
// household's count every starting balance (the transfers cancel out).

// Counted in cents, so a leftover that shows as €0.00 is exactly 0.
const centsOf = (rows) => rows.reduce((sum, row) => sum + Math.round((Number(row.amount) || 0) * 100), 0)

// The leftover in cents of `person` ('all' or one of the accounts) from
// rows that are all before the period. `partsReady`: the database has the
// part columns (supabase/029); before it a person's pill has only their
// own expenses, and so does their leftover. `transfers`: the transfers
// before the period (none before supabase/033).
export function leftoverCents(expenses, income, person, { partsReady = true, transfers = [] } = {}) {
  if (person === 'all') return centsOf(income) - centsOf(expenses) + startCentsOf(transfers)
  const own = income.filter((i) => i.received_by === person)
  const spent = partsReady ? personalExpenses(expenses, person) : expenses.filter((e) => e.paid_by === person)
  const moved = accountMoves(transfers, person)
  return centsOf(own) - centsOf(spent) + moved.inCents - moved.outCents + moved.startCents
}

// Joint's money before `day` (YYYY-MM-DD) in cents (plan 9P K233, K234):
// income received by Joint − expenses paid by Joint + transfers into Joint
// − transfers out of Joint + Joint's starting balances, every row dated
// before `day`. The sum of the Joint card's leftover, but without K166 (it
// can be ≤ 0) and for every period kind, Week included. `rows`: { expenses,
// income, transfers } (any dates; only those before `day` count).
export function jointCentsBefore({ expenses = [], income = [], transfers = [] }, day) {
  return leftoverCents(
    expenses.filter((e) => e.expense_date < day),
    income.filter((i) => i.income_date < day),
    JOINT,
    { transfers: transfers.filter((t) => t.transfer_date < day) }
  )
}

// Whose leftover the top card may show (K168, K222): both pills "Everyone"
// → the household ('all'); both on the same account (a person or
// Joint) → that account; any other combination (two different pills, a
// "Shared" pill) → null.
export function leftoverScope(incomePerson, expensesPerson) {
  if (incomePerson === 'all' && expensesPerson === 'all') return 'all'
  if (incomePerson === expensesPerson && ACCOUNTS.includes(incomePerson)) return incomePerson
  return null
}

// What the period's transfers add to the card of `scope` (K221, K223):
//   netCents – into BALANCE, "This month" / "This range" and "Available":
//              an account's transfers in − out + its starting balance;
//              the household's starting balances
//   lines    – the grey lines, [{ key, text, amount: € }]:
//              "Transfers · {label}" (an account with a transfer in the
//              period: the net, signed) and "Starting balance · {label}"
// null for no scope.
export function periodMoves(transfers, scope) {
  if (!scope) return null
  const lines = []
  const startLine = (code, cents) => cents && lines.push({ key: `start-${code}`, text: `Starting balance · ${payerLabel(code)}`, amount: cents / 100 })
  if (scope === 'all') {
    for (const code of ACCOUNTS) startLine(code, accountMoves(transfers, code).startCents)
    return { netCents: startCentsOf(transfers), lines }
  }
  const moved = accountMoves(transfers, scope)
  if (moved.count) lines.push({ key: 'transfers', text: `Transfers · ${payerLabel(scope)}`, amount: (moved.inCents - moved.outCents) / 100 })
  startLine(scope, moved.startCents)
  return { netCents: moved.inCents - moved.outCents + moved.startCents, lines }
}

// "October 2026": the month before a month number (year × 12 + month).
export const monthBefore = (month) => `${FULL_MONTH_NAMES[(month - 1 + 12) % 12]} ${Math.floor((month - 1) / 12)}`

// What the top card shows about the leftover (K166–K172):
//   view          – the period on screen (lib/expensePeriods)
//   incomePerson, expensesPerson – the two pills
//   income, expenses – the INCOME and EXPENSES tiles (€)
//   before        – { expenses, income, transfers } dated before the
//                   period, or null while they can't be trusted (not read
//                   yet, offline, a failed read): then nothing new is shown
//   transfers     – the period's transfers ([] before supabase/033), or
//                   null while they can't be trusted: then no transfer
//                   number, no leftover line and no bar (K196)
//   partsReady    – see leftoverCents
// → { line, available, moves }
//   line      – null, or { amount: €, month: "October 2026", word: "This
//               month" | "This range", breakdown: null | [{ code, label,
//               amount }] }
//   available – null, or { amount: € (leftover shown + income + the
//               period's transfers and starting balance, K223), percent
//               (whole number), over: spent more than available, counted
//               in cents (full bar, red text; K198: €100.40 of €100.00 is
//               "spent 100%" and over) }
//   moves     – null, or periodMoves (one account or the household; also
//               in Week)
export function leftoverCard({ view, incomePerson, expensesPerson, income, expenses, before, transfers = [], partsReady = true }) {
  const none = { line: null, available: null, moves: null }
  // Other pill combinations: nothing (K168). Transfers not known: nothing.
  const scope = leftoverScope(incomePerson, expensesPerson)
  if (!view || !scope || !transfers) return none
  const moves = periodMoves(transfers, scope)
  // Week: no leftover, no bar (K169); its transfers still count.
  if (view.pill === 'week' || !before) return { ...none, moves }
  const options = { partsReady, transfers: before.transfers ?? [] }
  const leftover = leftoverCents(before.expenses, before.income, scope, options)
  // ≤ 0, or a period starting in or before the first month with data (no
  // row before it): no line (K166, K169, K170).
  const line =
    leftover > 0
      ? {
          amount: leftover / 100,
          month: monthBefore(view.from),
          word: view.pill === 'month' ? 'This month' : 'This range',
          // Each account; Joint only when it isn't €0.00 (K224).
          breakdown:
            scope === 'all'
              ? ACCOUNTS.map((code) => ({ code, label: payerLabel(code), cents: leftoverCents(before.expenses, before.income, code, options) }))
                  .filter((p) => p.code !== JOINT || p.cents !== 0)
                  .map(({ code, label, cents }) => ({ code, label, amount: cents / 100 }))
              : null,
        }
      : null
  // "Available €{a} · spent {p}%" (K172, K223): a = the leftover shown +
  // income + the period's transfers and starting balance.
  const availableCents = (line ? leftover : 0) + Math.round((Number(income) || 0) * 100) + moves.netCents
  if (availableCents <= 0) return { line, available: null, moves }
  const spentCents = Math.round((Number(expenses) || 0) * 100)
  const percent = Math.round((spentCents / availableCents) * 100)
  return { line, available: { amount: availableCents / 100, percent, over: spentCents > availableCents }, moves }
}

// The card's BALANCE in cents (K167, K221): the leftover shown + income −
// expenses + the period's transfers and starting balance.
export const balanceCents = ({ line, moves, income, expenses }) =>
  (line ? Math.round(line.amount * 100) : 0) + Math.round((Number(income) || 0) * 100) - Math.round((Number(expenses) || 0) * 100) + (moves?.netCents ?? 0)
