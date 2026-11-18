import { describe, expect, it } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'
import { leftoverCard, leftoverCents, leftoverScope, monthBefore } from './leftover'
import { defaultView, monthNumber, quickSpans } from './expensePeriods'

// Plan 9O K164–K172. The payers come from PAID_BY_OPTIONS (never written out).
const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })
const spent = (amount, paidBy, p = parts(null, null)) => ({ amount, paid_by: paidBy, expense_date: '2026-10-10', ...p })
const earned = (amount, receivedBy) => ({ amount, received_by: receivedBy, income_date: '2026-10-05' })

// October 2026 of the prompt.
const OCT = {
  expenses: [spent(300, P1), spent(200, P2), spent(100, 'shared', parts(40, 60))],
  income: [earned(1200, P1), earned(800, P2)],
}
const NOVEMBER = defaultView('month', new Date(2026, 10, 15))

describe('leftoverCents (K165)', () => {
  it('household +€1400.00; first person 1200 − (300 + 40) = +€860.00; second 800 − (200 + 60) = +€540.00', () => {
    expect(leftoverCents(OCT.expenses, OCT.income, 'all')).toBe(140000)
    expect(leftoverCents(OCT.expenses, OCT.income, P1)).toBe(86000)
    expect(leftoverCents(OCT.expenses, OCT.income, P2)).toBe(54000)
  })

  it('a Shared expense without parts and Shared income are in no person (K4); parts scaled to the amount (K9), €0 parts left out (K14)', () => {
    const expenses = [spent(10, 'shared'), spent(50, 'shared', parts(30, 30)), spent(20, 'shared', parts(0, 20))]
    const income = [earned(100, 'shared'), earned(100, P1)]
    expect(leftoverCents(expenses, income, 'all')).toBe(20000 - 8000)
    // 50 with parts typed for 60 → 25 / 25.
    expect(leftoverCents(expenses, income, P1)).toBe(10000 - 2500)
    expect(leftoverCents(expenses, income, P2)).toBe(-2500 - 2000)
  })

  it('before supabase/029 a person has only their own expenses', () => {
    expect(leftoverCents([spent(300, P1), { amount: 100, paid_by: 'shared' }], [earned(1200, P1)], P1, { partsReady: false })).toBe(90000)
  })

  it('in cents: 0.1 + 0.2 − 0.3 is exactly 0', () => {
    expect(leftoverCents([spent(0.3, P1)], [earned(0.1, P1), earned(0.2, P1)], 'all')).toBe(0)
  })
})

describe('leftoverScope (K168)', () => {
  it('Everyone/Everyone → household; same person → that person; anything else → none', () => {
    expect(leftoverScope('all', 'all')).toBe('all')
    expect(leftoverScope(P1, P1)).toBe(P1)
    expect(leftoverScope(P2, P2)).toBe(P2)
    expect(leftoverScope(P1, P2)).toBeNull()
    expect(leftoverScope('all', P1)).toBeNull()
    expect(leftoverScope('shared', 'shared')).toBeNull()
    expect(leftoverScope('all', 'shared')).toBeNull()
  })
})

describe('leftoverCard (K166–K172)', () => {
  const card = (over) => leftoverCard({ view: NOVEMBER, incomePerson: 'all', expensesPerson: 'all', income: 2900, expenses: 2400, before: OCT, ...over })

  it('November, Everyone: the line, the breakdown, "This month", "Available €4300.00 · spent 56%"', () => {
    const { line, available } = card()
    expect(line).toEqual({
      amount: 1400,
      month: 'October 2026',
      word: 'This month',
      breakdown: [
        { code: P1, label: label(P1), amount: 860 },
        { code: P2, label: label(P2), amount: 540 },
      ],
    })
    expect(available).toEqual({ amount: 4300, percent: 56, over: false })
  })

  it('both pills on one person: no breakdown', () => {
    const { line, available } = card({ incomePerson: P1, expensesPerson: P1, income: 1500, expenses: 1000 })
    expect(line.amount).toBe(860)
    expect(line.breakdown).toBeNull()
    expect(available).toEqual({ amount: 2360, percent: 42, over: false })
  })

  it('other pill combinations, the Week pill, rows not read: nothing', () => {
    const none = { line: null, available: null, moves: null }
    const noTransfers = { netCents: 0, lines: [] }
    expect(card({ incomePerson: P1, expensesPerson: P2 })).toEqual(none)
    expect(card({ expensesPerson: 'shared' })).toEqual(none)
    expect(card({ view: defaultView('week', new Date(2026, 10, 15)) })).toEqual({ ...none, moves: noTransfers })
    expect(card({ before: null })).toEqual({ ...none, moves: noTransfers })
    expect(card({ transfers: null })).toEqual(none)
  })

  it('a leftover ≤ 0: no line; the bar counts only the income (K166, K172)', () => {
    const { line, available } = card({ before: { expenses: [spent(300, P1)], income: [earned(100, P1)] } })
    expect(line).toBeNull()
    expect(available).toEqual({ amount: 2900, percent: 83, over: false })
    expect(card({ before: { expenses: [spent(100, P1)], income: [earned(100, P1)] } }).line).toBeNull()
  })

  it('the first month with data (nothing before it): no line (K170)', () => {
    const october = { pill: 'month', from: monthNumber(new Date(2026, 9, 1)), months: 1, choice: null }
    const { line, available } = card({ view: october, before: { expenses: [], income: [] }, income: 2000, expenses: 600 })
    expect(line).toBeNull()
    expect(available).toEqual({ amount: 2000, percent: 30, over: false })
  })

  it('more spent than available → over (percent > 100); nothing available → no bar', () => {
    expect(card({ before: { expenses: [], income: [] }, income: 100, expenses: 300 }).available).toEqual({ amount: 100, percent: 300, over: true })
    expect(card({ before: { expenses: [], income: [] }, income: 0, expenses: 50 }).available).toBeNull()
  })

  it('K198: over whenever the spending in cents is above the available (€100.40 of €100.00 → "100%" and over)', () => {
    const none = { expenses: [], income: [] }
    expect(card({ before: none, income: 100, expenses: 100.4 }).available).toEqual({ amount: 100, percent: 100, over: true })
    expect(card({ before: none, income: 100, expenses: 100 }).available).toEqual({ amount: 100, percent: 100, over: false })
    expect(card({ before: none, income: 100, expenses: 100.01 }).available).toEqual({ amount: 100, percent: 100, over: true })
    expect(card({ before: none, income: 100, expenses: 99.99 }).available).toEqual({ amount: 100, percent: 100, over: false })
  })

  it('other periods: "This range", the month before the span (K169)', () => {
    const q1 = quickSpans('3months', 2027)[0]
    const { line } = card({ view: q1, before: { expenses: OCT.expenses, income: OCT.income } })
    expect(line.word).toBe('This range')
    expect(line.month).toBe('December 2026')
  })

  it('monthBefore: "October 2026" for November, "December 2026" for January 2027', () => {
    expect(monthBefore(2026 * 12 + 10)).toBe('October 2026')
    expect(monthBefore(2027 * 12)).toBe('December 2026')
  })
})
