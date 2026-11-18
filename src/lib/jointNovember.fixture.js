import { PAID_BY_OPTIONS } from '../data/constants'

// Made-up rows with the totals of plan 9P section 5 (the shared bank
// account, November 2026), for the tests only — never live data. The
// payers come from PAID_BY_OPTIONS (never written out here).
//   October 2026: household +€2344.77, first person +€1906.36, second
//   +€438.41 (no transfer, no Joint row); the 27/10 Shared expense €268.58
//   with parts €100.00 / €168.58.
//   November 2026: the 14/11 purchases €146.81 paid by Joint; transfers
//   second → Joint €300 (13/11) + €20 (14/11), first → Joint €300 (13/11);
//   Joint's starting balance €52.48 (01/11/2026).
export const [P1, P2] = PAID_BY_OPTIONS.filter((o) => o.kind === 'person').map((o) => o.value)
export const JOINT = 'joint'
export const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label

const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })
let n = 0
const spent = (amount, paidBy, date, extra = {}) => ({ id: `x${++n}`, description: `TEST expense ${n}`, amount, category_id: 'groceries', expense_date: date, paid_by: paidBy, ...parts(null, null), ...extra })
const earned = (amount, receivedBy, date) => ({ id: `i${++n}`, amount, income_date: date, category_id: 'salary', received_by: receivedBy, source: `TEST income ${n}` })
const moved = (id, from, to, amount, date, note = null) => ({ id, transfer_date: date, from_code: from, to_code: to, amount, note, created_at: `${date}T10:00:00Z` })

export const OCTOBER = {
  expenses: [spent(900, P1, '2026-10-10'), spent(793.01, P2, '2026-10-11'), spent(268.58, 'shared', '2026-10-27', { description: 'TEST condo fees', ...parts(100, 168.58) })],
  income: [earned(2906.36, P1, '2026-10-05'), earned(1400, P2, '2026-10-05')],
}

export const NOVEMBER = {
  expenses: [spent(456.36, P1, '2026-11-10'), spent(625.25, P2, '2026-11-11'), spent(111.05, JOINT, '2026-11-14', { description: 'TEST shop A' }), spent(35.76, JOINT, '2026-11-14', { description: 'TEST shop B' })],
  income: [earned(2648, P1, '2026-11-05'), earned(1400, P2, '2026-11-05')],
  transfers: [
    moved('t-start', null, JOINT, 52.48, '2026-11-01'),
    moved('t-1', P2, JOINT, 300, '2026-11-13', 'TEST deposit'),
    moved('t-2', P1, JOINT, 300, '2026-11-13'),
    moved('t-3', P2, JOINT, 20, '2026-11-14'),
  ],
}

// The K228 example: first → second €50 in November.
export const PERSON_TO_PERSON = moved('t-4', P1, P2, 50, '2026-11-16')
