import { PEOPLE, payerLabel, personalExpenses } from './sharedParts'
import { FULL_MONTH_NAMES } from './expensePeriods'

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

// Counted in cents, so a leftover that shows as €0.00 is exactly 0.
const centsOf = (rows) => rows.reduce((sum, row) => sum + Math.round((Number(row.amount) || 0) * 100), 0)

// The leftover in cents of `person` ('all' or one of PEOPLE) from rows that
// are all before the period. `partsReady`: the database has the part
// columns (supabase/029); before it a person's pill has only their own
// expenses, and so does their leftover.
export function leftoverCents(expenses, income, person, { partsReady = true } = {}) {
  if (person === 'all') return centsOf(income) - centsOf(expenses)
  const own = income.filter((i) => i.received_by === person)
  const spent = partsReady ? personalExpenses(expenses, person) : expenses.filter((e) => e.paid_by === person)
  return centsOf(own) - centsOf(spent)
}

// Whose leftover the top card may show (K168): both pills "Everyone" →
// the household ('all'); both on the same person → that person; any other
// combination (two persons, a "Shared" pill) → null.
export function leftoverScope(incomePerson, expensesPerson) {
  if (incomePerson === 'all' && expensesPerson === 'all') return 'all'
  if (incomePerson === expensesPerson && PEOPLE.includes(incomePerson)) return incomePerson
  return null
}

// "October 2026": the month before a month number (year × 12 + month).
export const monthBefore = (month) => `${FULL_MONTH_NAMES[(month - 1 + 12) % 12]} ${Math.floor((month - 1) / 12)}`

// What the top card shows about the leftover (K166–K172):
//   view          – the period on screen (lib/expensePeriods)
//   incomePerson, expensesPerson – the two pills
//   income, expenses – the INCOME and EXPENSES tiles (€)
//   before        – { expenses, income } dated before the period, or null
//                   while they can't be trusted (not read yet, offline,
//                   a failed read): then nothing new is shown
//   partsReady    – see leftoverCents
// → { line, available }
//   line      – null, or { amount: €, month: "October 2026", word: "This
//               month" | "This range", breakdown: null | [{ code, label,
//               amount }] }
//   available – null, or { amount: € (leftover shown + income), percent
//               (whole number), over: percent > 100 (full bar, red text) }
export function leftoverCard({ view, incomePerson, expensesPerson, income, expenses, before, partsReady = true }) {
  const none = { line: null, available: null }
  // Week: never (K169). Other pill combinations: nothing (K168).
  if (!view || view.pill === 'week') return none
  const scope = leftoverScope(incomePerson, expensesPerson)
  if (!scope || !before) return none
  const leftover = leftoverCents(before.expenses, before.income, scope, { partsReady })
  // ≤ 0, or a period starting in or before the first month with data (no
  // row before it): no line (K166, K169, K170).
  const line =
    leftover > 0
      ? {
          amount: leftover / 100,
          month: monthBefore(view.from),
          word: view.pill === 'month' ? 'This month' : 'This range',
          breakdown:
            scope === 'all'
              ? PEOPLE.map((code) => ({ code, label: payerLabel(code), amount: leftoverCents(before.expenses, before.income, code, { partsReady }) / 100 }))
              : null,
        }
      : null
  // "Available €{a} · spent {p}%" (K172): a = the leftover shown + income.
  const availableCents = (line ? leftover : 0) + Math.round((Number(income) || 0) * 100)
  if (availableCents <= 0) return { line, available: null }
  const percent = Math.round((Math.round((Number(expenses) || 0) * 100) / availableCents) * 100)
  return { line, available: { amount: availableCents / 100, percent, over: percent > 100 } }
}
