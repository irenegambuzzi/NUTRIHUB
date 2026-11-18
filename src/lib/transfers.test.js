import { describe, expect, it } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'
import { PEOPLE, PART_COLUMNS, SHARED, checkSplit, emptySplit, partsColumnsReady, personalExpenses, storedParts } from './sharedParts'
import { ACCOUNTS, ACCOUNT_OPTIONS, chosenPayer, payerOptionsFor, startingPayer } from './payers'
import { balanceCents, jointCentsBefore, leftoverCard, leftoverCents, leftoverScope, periodMoves } from './leftover'
import { accountMoves, savedMessage, transferProblem, transferRow, transferText, transfersBetween, typedAmount } from './transfers'
import { defaultView, monthNumber } from './expensePeriods'
import { JOINT, JOINT_600, NOVEMBER, OCTOBER, P1, P2, PERSON_TO_PERSON, label } from './jointNovember.fixture'

// Plan 9P, Update round prompt 2: the 4th payer "Joint", transfers and the
// starting balance (K210, K216–K229). The numbers are those of section 5
// (made-up rows, lib/jointNovember.fixture.js).

describe('the payers (report §0.1, rule 9K)', () => {
  it('PAID_BY_OPTIONS: the two people, Joint, Shared — PEOPLE stays the two people, the part columns theirs', () => {
    expect(PAID_BY_OPTIONS.map((o) => o.kind)).toEqual(['person', 'person', 'account', 'split'])
    expect(PAID_BY_OPTIONS.find((o) => o.value === JOINT).label).toBe('Joint')
    expect(PEOPLE).toEqual([P1, P2])
    expect(PART_COLUMNS).toEqual([`part_${P1}`, `part_${P2}`])
    expect(ACCOUNTS).toEqual([P1, P2, JOINT])
    expect(ACCOUNT_OPTIONS.map((o) => o.label)).toEqual([label(P1), label(P2), 'Joint'])
  })

  it('029 is still found on a row with only the two part columns; parts and checks never mention Joint', () => {
    expect(partsColumnsReady([{ id: 'e', amount: 1, paid_by: JOINT, [`part_${P1}`]: null, [`part_${P2}`]: null }])).toBe(true)
    const condo = OCTOBER.expenses.find((e) => e.paid_by === SHARED)
    expect(storedParts(condo)).toEqual({ [P1]: 100, [P2]: 168.58 })
    expect(checkSplit(emptySplit(), 268.58).problem).toBe(`Type what ${label(P1)} and ${label(P2)} paid.`)
    expect(checkSplit(emptySplit(), 268.58).problem).not.toContain('Joint')
  })

  it('the Joint pill: Joint\'s own expenses whole (€146.81), no parts; the persons\' October pills keep their parts of 27/10', () => {
    const joint = personalExpenses([...OCTOBER.expenses, ...NOVEMBER.expenses], JOINT)
    expect(joint.map((e) => e.amount)).toEqual([111.05, 35.76])
    expect(joint.every((e) => !e.sharedPart)).toBe(true)
    expect(personalExpenses(OCTOBER.expenses, P1).find((e) => e.sharedPart)?.amount).toBe(100)
    expect(personalExpenses(OCTOBER.expenses, P2).find((e) => e.sharedPart)?.amount).toBe(168.58)
  })

  it('K225: on a SHOP card only the accounts count as chosen; "shared" or empty = not chosen yet', () => {
    expect(ACCOUNTS.map(chosenPayer)).toEqual(ACCOUNTS)
    expect([SHARED, '', null, undefined, 'unknown'].map(chosenPayer)).toEqual(['', '', '', '', ''])
  })

  it('K216: a form offers the accounts; "Shared" only for a row that is Shared; no default (K217)', () => {
    expect(payerOptionsFor(undefined).map((o) => o.value)).toEqual(ACCOUNTS)
    expect(payerOptionsFor(JOINT).map((o) => o.value)).toEqual(ACCOUNTS)
    expect(payerOptionsFor(SHARED).map((o) => o.value)).toEqual([...ACCOUNTS, SHARED])
    expect([startingPayer(undefined), startingPayer(P2), startingPayer(SHARED), startingPayer('')]).toEqual(['', P2, SHARED, ''])
  })
})

describe('the transfer form (K228, K229, K231)', () => {
  const base = { kind: 'transfer', from: P2, to: JOINT, amountText: '300', date: '2026-11-13', dateOk: true, note: '' }
  const check = (values, extra = {}) => transferProblem({ ...base, ...values }, { rows: NOVEMBER.transfers, today: '2026-11-18', ...extra })

  it('the texts, in order', () => {
    expect(check({ from: '' })).toBe('Choose where the money came from.')
    expect(check({ from: SHARED })).toBe('Choose where the money came from.')
    expect(check({ to: '' })).toBe('Choose where the money went.')
    expect(check({ to: SHARED })).toBe('Choose where the money went.')
    expect(check({ to: P2 })).toBe('"From" and "To" must be different.')
    expect(check({ amountText: ' ' })).toBe('Enter the amount.')
    for (const bad of ['0', '-5', 'abc', '1,2,3']) expect(check({ amountText: bad })).toBe('Enter an amount above 0, like 300 or 19,52.')
    expect(check({ dateOk: false })).toBe('Fix the date first (DD/MM/YYYY).')
    expect(check({ date: '2026-11-19' })).toBe("A transfer can't be after today.")
    expect(check({})).toBe('')
  })

  it('K228: all six directions between the three accounts, also person → person', () => {
    for (const from of ACCOUNTS) for (const to of ACCOUNTS) if (from !== to) expect(check({ from, to })).toBe('')
  })

  it('K229: a starting balance only into Joint; a second one is refused with the real amount and date of the first; changing the first is fine', () => {
    const start = { kind: 'start', from: '', to: '', amountText: '35,67', date: '2026-11-01' }
    expect(check(start)).toBe('Joint already has a starting balance (€52.48 on 01/11/2026). Change that one instead.')
    expect(check(start, { editingId: 't-start' })).toBe('')
    expect(check(start, { rows: [] })).toBe('')
    expect(transferRow({ ...start, amountText: '52,48' })).toEqual({ transfer_date: '2026-11-01', from_code: null, to_code: JOINT, amount: 52.48, note: null })
  })

  it('rounded to cents as typed (19,52 → 19.52; 10,005 → 10.01); the note trimmed', () => {
    expect(typedAmount('19,52')).toBe(19.52)
    expect(typedAmount('10,005')).toBe(10.01)
    expect(transferRow({ ...base, amountText: '19,52', note: '  TEST note ' })).toEqual({ transfer_date: '2026-11-13', from_code: P2, to_code: JOINT, amount: 19.52, note: 'TEST note' })
  })

  it('the row text and the toasts', () => {
    expect(transferText(NOVEMBER.transfers[1])).toBe(`${label(P2)} → Joint`)
    expect(transferText(NOVEMBER.transfers[0])).toBe('Starting balance → Joint')
    expect(savedMessage(NOVEMBER.transfers[1])).toBe(`Transfer saved · ${label(P2)} → Joint · €300.00`)
    expect(savedMessage(NOVEMBER.transfers[0])).toBe('Starting balance saved · Joint · €52.48')
  })

  it('the period\'s rows newest first; the net per account in cents', () => {
    expect(transfersBetween(NOVEMBER.transfers, '2026-11-01', '2026-12-01').map((t) => t.id)).toEqual(['t-3', 't-1', 't-2', 't-start'])
    expect(transfersBetween(NOVEMBER.transfers, '2026-12-01', '2027-01-01')).toEqual([])
    expect(accountMoves(NOVEMBER.transfers, JOINT)).toEqual({ inCents: 62000, outCents: 0, startCents: 5248, count: 3 })
    expect(accountMoves(NOVEMBER.transfers, P2)).toEqual({ inCents: 0, outCents: 32000, startCents: 0, count: 2 })
    expect(accountMoves(NOVEMBER.transfers, P1)).toEqual({ inCents: 0, outCents: 30000, startCents: 0, count: 1 })
  })
})

// The top card of section 5, from the rows.
const sum = (rows) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
const between = (rows, field, from, to) => rows.filter((r) => r[field] >= from && r[field] < to)
function topCard(who, view, { transfers = NOVEMBER.transfers, extra = [], extraExpenses = [], expensesWho = who } = {}) {
  const start = view.start
  const end = view.end
  const all = { expenses: [...OCTOBER.expenses, ...NOVEMBER.expenses, ...extraExpenses], income: [...OCTOBER.income, ...NOVEMBER.income], transfers: [...transfers, ...extra] }
  const incomeRows = between(all.income, 'income_date', start, end).filter((i) => who === 'all' || i.received_by === who)
  const expenseRows = personalExpenses(between(all.expenses, 'expense_date', start, end), expensesWho)
  const income = sum(incomeRows)
  const expenses = sum(expenseRows)
  const before = { expenses: all.expenses.filter((e) => e.expense_date < start), income: all.income.filter((i) => i.income_date < start), transfers: all.transfers.filter((t) => t.transfer_date < start) }
  const c = leftoverCard({ view: view.view, incomePerson: who, expensesPerson: expensesWho, income, expenses, before, transfers: between(all.transfers, 'transfer_date', start, end) })
  return { ...c, income, expenses, balance: balanceCents({ ...c, income, expenses }) / 100 }
}
const month = (y, m) => ({ view: defaultView('month', new Date(y, m, 15)), start: `${y}-${String(m + 1).padStart(2, '0')}-01`, end: m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, '0')}-01` })
const NOV = month(2026, 10)
const DEC = month(2026, 11)
const result = (c) => Math.round((c.income - c.expenses + (c.moves?.netCents ?? 0) / 100) * 100) / 100

describe('the top card, November 2026 (section 5; K221–K224)', () => {
  it('Joint/Joint: no leftover (K166), INCOME €0.00, EXPENSES €146.81, Transfers · Joint +€620.00, Starting balance · Joint +€52.48, BALANCE +€525.67, Available €672.48 · 22%', () => {
    const c = topCard(JOINT, NOV)
    expect(c.line).toBeNull()
    expect([c.income, c.expenses, c.balance]).toEqual([0, 146.81, 525.67])
    expect(c.moves.lines).toEqual([
      { key: 'transfers', text: 'Transfers · Joint', amount: 620 },
      { key: 'start-joint', text: 'Starting balance · Joint', amount: 52.48 },
    ])
    expect(c.available).toEqual({ amount: 672.48, percent: 22, over: false })
  })

  it('second person: Leftover from October 2026 · +€438.41, €1400.00, €625.25, Transfers −€320.00, BALANCE +€893.16, This month +€454.75, €1518.41 · 41%', () => {
    const c = topCard(P2, NOV)
    expect(c.line).toMatchObject({ amount: 438.41, month: 'October 2026', word: 'This month', breakdown: null })
    expect([c.income, c.expenses, c.balance, result(c)]).toEqual([1400, 625.25, 893.16, 454.75])
    expect(c.moves.lines).toEqual([{ key: 'transfers', text: `Transfers · ${label(P2)}`, amount: -320 }])
    expect(c.available).toEqual({ amount: 1518.41, percent: 41, over: false })
  })

  it('first person: +€1906.36, €2648.00, €456.36, Transfers −€300.00, BALANCE +€3798.00, This month +€1891.64, €4254.36 · 11%', () => {
    const c = topCard(P1, NOV)
    expect(c.line.amount).toBe(1906.36)
    expect([c.income, c.expenses, c.balance, result(c)]).toEqual([2648, 456.36, 3798, 1891.64])
    expect(c.moves.lines).toEqual([{ key: 'transfers', text: `Transfers · ${label(P1)}`, amount: -300 }])
    expect(c.available).toEqual({ amount: 4254.36, percent: 11, over: false })
  })

  it('Everyone: +€2344.77 with the breakdown of the two people (Joint €0.00 left out, K224), €4048.00, €1228.42, only the starting balance line, BALANCE +€5216.83, +€2872.06, €6445.25 · 19%', () => {
    const c = topCard('all', NOV)
    expect(c.line.amount).toBe(2344.77)
    expect(c.line.breakdown.map((p) => [p.code, p.amount])).toEqual([
      [P1, 1906.36],
      [P2, 438.41],
    ])
    expect([c.income, c.expenses, c.balance, result(c)]).toEqual([4048, 1228.42, 5216.83, 2872.06])
    expect(c.moves.lines).toEqual([{ key: 'start-joint', text: 'Starting balance · Joint', amount: 52.48 }])
    expect(c.available).toEqual({ amount: 6445.25, percent: 19, over: false })
  })

  it('December 2026: Leftover from November 2026 · +€5216.83 = the three accounts (Joint +€525.67 now in the breakdown); Joint\'s card +€525.67', () => {
    const c = topCard('all', DEC)
    expect(c.line).toMatchObject({ amount: 5216.83, month: 'November 2026' })
    expect(c.line.breakdown.map((p) => [p.code, p.amount])).toEqual([
      [P1, 3798],
      [P2, 893.16],
      [JOINT, 525.67],
    ])
    expect(Math.round(c.line.breakdown.reduce((s, p) => s + p.amount * 100, 0))).toBe(521683)
    expect(c.moves).toEqual({ netCents: 0, lines: [] })
    expect(topCard(JOINT, DEC).line.amount).toBe(525.67)
  })

  it('October 2026 is unchanged: +€2344.77 / +€1906.36 / +€438.41 (in November\'s leftover), and no transfer line in October', () => {
    const oct = month(2026, 9)
    expect(topCard('all', oct).moves).toEqual({ netCents: 0, lines: [] })
    const before = { expenses: OCTOBER.expenses, income: OCTOBER.income }
    expect([leftoverCents(before.expenses, before.income, 'all'), leftoverCents(before.expenses, before.income, P1), leftoverCents(before.expenses, before.income, P2)]).toEqual([234477, 190636, 43841])
  })

  it('K228: first → second €50 in November → first +€3748.00, second +€943.16, Everyone still +€5216.83 (expenses €1228.42, income €4048.00)', () => {
    expect(topCard(P1, NOV, { extra: [PERSON_TO_PERSON] }).balance).toBe(3748)
    expect(topCard(P2, NOV, { extra: [PERSON_TO_PERSON] }).balance).toBe(943.16)
    const all = topCard('all', NOV, { extra: [PERSON_TO_PERSON] })
    expect([all.balance, all.expenses, all.income]).toEqual([5216.83, 1228.42, 4048])
  })

  it('other combinations (two different pills, a Shared pill): no transfers, no starting balance, as before', () => {
    expect(topCard(P1, NOV, { expensesWho: JOINT })).toMatchObject({ line: null, available: null, moves: null })
    expect(leftoverScope(JOINT, 'all')).toBeNull()
    expect(leftoverScope(SHARED, SHARED)).toBeNull()
    expect(leftoverScope(JOINT, JOINT)).toBe(JOINT)
    expect(periodMoves(NOVEMBER.transfers, null)).toBeNull()
  })

  it('Week 9–15 Nov: no leftover, no bar; the transfers still count (second person −€320.00; Everyone: no starting balance that week)', () => {
    const week = { view: defaultView('week', new Date(2026, 10, 12)), start: '2026-11-09', end: '2026-11-16' }
    const c = topCard(P2, week)
    expect([c.line, c.available]).toEqual([null, null])
    expect(c.moves.lines).toEqual([{ key: 'transfers', text: `Transfers · ${label(P2)}`, amount: -320 }])
    expect(c.balance).toBe(Math.round((0 - 625.25 - 320) * 100) / 100)
    expect(topCard('all', week).moves).toEqual({ netCents: 0, lines: [] })
  })

  it('Year 2026: no leftover (starts before the first month), "This range" +€5216.83 with the starting balance', () => {
    const year = { view: defaultView('year', new Date(2026, 10, 16)), start: '2026-01-01', end: '2027-01-01' }
    const c = topCard('all', year)
    expect(c.line).toBeNull()
    expect(c.balance).toBe(5216.83)
    expect(c.moves.lines).toEqual([{ key: 'start-joint', text: 'Starting balance · Joint', amount: 52.48 }])
    expect(monthNumber(new Date(2026, 0, 1))).toBe(year.view.from)
  })

  it('transfers not known (not read, offline, failed): no transfer number, no leftover line, no bar (K196)', () => {
    const c = leftoverCard({ view: NOV.view, incomePerson: 'all', expensesPerson: 'all', income: 4048, expenses: 1228.42, before: { expenses: OCTOBER.expenses, income: OCTOBER.income, transfers: [] }, transfers: null })
    expect(c).toEqual({ line: null, available: null, moves: null })
  })
})

// Update round prompt 2b: Joint's money before a day (K233 the "Received
// by: Joint" pill, K234 "Joint now").
describe("Joint's money before a day (K233, K234; prompt 2b section 5)", () => {
  const A = { expenses: [...OCTOBER.expenses, ...NOVEMBER.expenses], income: [...OCTOBER.income, ...NOVEMBER.income], transfers: NOVEMBER.transfers }
  const B = { ...A, expenses: [...A.expenses, JOINT_600] }
  const at = (rows, day) => jointCentsBefore(rows, day) / 100

  it('fixture A: before 01/10 and 01/11 €0.00; before 02/11 and 09/11 €52.48 (the starting balance); before 16/11, 23/11, 01/12 and 01/01/2027 €525.67', () => {
    expect([at(A, '2026-10-01'), at(A, '2026-11-01')]).toEqual([0, 0])
    expect([at(A, '2026-11-02'), at(A, '2026-11-09')]).toEqual([52.48, 52.48])
    expect([at(A, '2026-11-16'), at(A, '2026-11-23'), at(A, '2026-12-01'), at(A, '2027-01-01')]).toEqual([525.67, 525.67, 525.67, 525.67])
  })

  it('section 5 per period: K233 pill = "before the first day" ≠ 0; "Joint now" = "before the day after the last day"', () => {
    const periods = [
      ['October 2026', '2026-10-01', '2026-11-01', 0, 0],
      ['November 2026', '2026-11-01', '2026-12-01', 0, 525.67],
      ['Week 2–8 Nov', '2026-11-02', '2026-11-09', 52.48, 52.48],
      ['Week 9–15 Nov', '2026-11-09', '2026-11-16', 52.48, 525.67],
      ['Week 16–22 Nov', '2026-11-16', '2026-11-23', 525.67, 525.67],
      ['December 2026', '2026-12-01', '2027-01-01', 525.67, 525.67],
    ]
    for (const [name, start, end, beforeStart, now] of periods) expect([name, at(A, start), at(A, end)]).toEqual([name, beforeStart, now])
  })

  it('fixture B (Joint €600.00 on 20/11): before 01/12 −€74.33 (shown, ≤ 0 is not €0.00); before 16/11 still €525.67', () => {
    expect(at(B, '2026-12-01')).toBe(-74.33)
    expect(at(B, '2026-11-16')).toBe(525.67)
    expect(jointCentsBefore(B, '2026-12-01')).not.toBe(0)
  })

  it('December, both pills Joint (fixture A): Leftover from November 2026 · +€525.67, €0.00 / €0.00, BALANCE +€525.67, This month €0.00, Available €525.67 · spent 0%', () => {
    const c = topCard(JOINT, DEC)
    expect(c.line).toMatchObject({ amount: 525.67, month: 'November 2026', word: 'This month' })
    expect([c.income, c.expenses, c.balance, result(c)]).toEqual([0, 0, 525.67, 0])
    expect(c.available).toEqual({ amount: 525.67, percent: 0, over: false })
  })

  it('fixture B: November Joint/Joint BALANCE −€74.33 = "Joint now"; December: no leftover line (K166)', () => {
    const nov = topCard(JOINT, NOV, { extraExpenses: [JOINT_600] })
    expect(nov.balance).toBe(-74.33)
    expect(at(B, NOV.end)).toBe(nov.balance)
    expect(topCard(JOINT, DEC, { extraExpenses: [JOINT_600] }).line).toBeNull()
  })

  it('only Joint\'s own rows count; the other people\'s rows, Shared and transfers between the two people never do; the transfers table missing ([]) = no transfers', () => {
    const noTransfers = { ...A, transfers: [] }
    expect(at(noTransfers, '2026-12-01')).toBe(-146.81)
    expect(at({ ...A, transfers: [...A.transfers, PERSON_TO_PERSON] }, '2026-12-01')).toBe(525.67)
    expect(at({ expenses: [], income: [], transfers: [] }, '2026-12-01')).toBe(0)
    expect(at({ ...A, income: [...A.income, { id: 'ij', amount: 10, income_date: '2026-11-30', received_by: JOINT }] }, '2026-12-01')).toBe(535.67)
  })
})
