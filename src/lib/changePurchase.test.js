import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'
import { ACCOUNT_OPTIONS } from './payers'
import { PEOPLE, partColumn } from './sharedParts'
import { localDateString } from './week'
import {
  CHANGED_MEANWHILE,
  CHANGE_PURCHASE_NOTICE,
  FUTURE_PURCHASE,
  changePayload,
  dateLine,
  dateProblem,
  dateToast,
  hasDate,
  hasPayer,
  missingChangePurchase,
  payerLine,
  payerNowLine,
  payerToast,
  purchaseState,
  refusalText,
  refusedByDatabase,
  startPayer,
  storeLine,
  undoPayload,
  withDate,
  withPayer,
} from './changePurchase'

// Plan 9P, Update round prompt 3: "Change purchase ▾" → Date / Paid by
// (K205–K209, K236, K237). The payers come from PAID_BY_OPTIONS (never
// written out here).
const [P1, P2] = PEOPLE
const [C1, C2] = PEOPLE.map(partColumn)
const JOINT = 'joint'
const SHARED = 'shared'
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label

const expense = (id, patch = {}) => ({ id, expense_date: '2026-11-15', paid_by: P1, [C1]: null, [C2]: null, amount: 3.11, description: 'x', ...patch })
const trip = { id: 't', trip_date: '2026-11-15', paid_by: P1, shop_id: 's', total: 40.41 }

afterEach(() => vi.useRealTimers())

describe('the request: purchaseState, withDate, withPayer, the Undo', () => {
  it('keeps only what change_purchase writes, rows sorted by id, parts as numbers or null', () => {
    const state = purchaseState({
      trip,
      expenses: [expense('b', { [C1]: '20.20', [C2]: '20.21', paid_by: SHARED }), expense('a')],
      photos: [{ id: 'p2', receipt_date: '2026-11-16', path: 'x' }, { id: 'p1', receipt_date: '2026-11-15', path: 'y' }],
      cards: [{ id: 'g1', payer: P1, name: 'Milk' }],
    })
    expect(state).toEqual({
      trip: { trip_date: '2026-11-15', paid_by: P1 },
      expenses: [
        { id: 'a', expense_date: '2026-11-15', paid_by: P1, [C1]: null, [C2]: null },
        { id: 'b', expense_date: '2026-11-15', paid_by: SHARED, [C1]: 20.2, [C2]: 20.21 },
      ],
      photos: [{ id: 'p1', receipt_date: '2026-11-15' }, { id: 'p2', receipt_date: '2026-11-16' }],
      cards: [{ id: 'g1', payer: P1 }],
    })
    // A mixed purchase's payer is empty.
    expect(purchaseState({ trip: { ...trip, paid_by: undefined } }).trip.paid_by).toBeNull()
  })

  it('withDate: every expense (also one edited by hand to another day), the purchase and every photo; payers and cards stay', () => {
    const state = purchaseState({ trip, expenses: [expense('a'), expense('b', { expense_date: '2026-11-14', paid_by: P2 })], photos: [{ id: 'p', receipt_date: '2026-11-16' }], cards: [{ id: 'g', payer: P1 }] })
    const now = withDate(state, '2026-11-13')
    expect(now.trip).toEqual({ trip_date: '2026-11-13', paid_by: P1 })
    expect(now.expenses.map((e) => [e.expense_date, e.paid_by])).toEqual([['2026-11-13', P1], ['2026-11-13', P2]])
    expect(now.photos).toEqual([{ id: 'p', receipt_date: '2026-11-13' }])
    expect(now.cards).toEqual(state.cards)
  })

  it('withPayer: every expense (merged ones too), the purchase and its SHOP cards (K208); Shared parts cleared (K205, 9K K11); dates stay', () => {
    const state = purchaseState({
      trip: { ...trip, paid_by: SHARED },
      expenses: [expense('a', { paid_by: SHARED, [C1]: 1.5, [C2]: 1.61 }), expense('b', { paid_by: SHARED, [C1]: 0, [C2]: 3.11, merged_at: 'x' })],
      cards: [{ id: 'g', payer: SHARED }],
    })
    const now = withPayer(state, JOINT)
    expect(now.trip).toEqual({ trip_date: '2026-11-15', paid_by: JOINT })
    expect(now.expenses).toEqual([
      { id: 'a', expense_date: '2026-11-15', paid_by: JOINT, [C1]: null, [C2]: null },
      { id: 'b', expense_date: '2026-11-15', paid_by: JOINT, [C1]: null, [C2]: null },
    ])
    expect(now.cards).toEqual([{ id: 'g', payer: JOINT }])
  })

  it('the Undo is the same call with was and now swapped: every row back exactly, each with its own payer and parts', () => {
    const was = purchaseState({
      trip: { ...trip, paid_by: null },
      expenses: [expense('a'), expense('b', { paid_by: P2 }), expense('c', { paid_by: SHARED, [C1]: 1, [C2]: 2.11 })],
      photos: [{ id: 'p', receipt_date: '2026-11-16' }],
      cards: [{ id: 'g', payer: P1 }],
    })
    const payload = changePayload('t', was, withPayer(was, JOINT))
    const back = undoPayload(payload)
    expect(back).toEqual({ trip_id: 't', was: payload.now, now: was })
    expect(back.now.expenses.map((e) => [e.paid_by, e[C1], e[C2]])).toEqual([[P1, null, null], [P2, null, null], [SHARED, 1, 2.11]])
    expect(back.now.trip.paid_by).toBeNull()
  })

  it('"the value it already has": the date (the purchase and every expense), the payer (every expense, no parts)', () => {
    const state = purchaseState({ trip, expenses: [expense('a'), expense('b')] })
    expect(hasDate(state, '2026-11-15')).toBe(true)
    expect(hasDate(state, '2026-11-14')).toBe(false)
    expect(hasDate(purchaseState({ trip, expenses: [expense('a'), expense('b', { expense_date: '2026-11-14' })] }), '2026-11-15')).toBe(false)
    expect(hasPayer(state, P1)).toBe(true)
    expect(hasPayer(state, JOINT)).toBe(false)
    expect(hasPayer(purchaseState({ trip, expenses: [expense('a', { [C1]: 1, [C2]: 2.11 })] }), P1)).toBe(false)
  })
})

describe('"Paid by" (K236)', () => {
  it('starts on the payer every expense has, when it is one of the accounts; else "Choose…" with a grey line', () => {
    expect(startPayer([expense('a'), expense('b')], ACCOUNT_OPTIONS)).toBe(P1)
    expect(payerNowLine([expense('a'), expense('b')], ACCOUNT_OPTIONS)).toBe('')
    expect(startPayer([expense('a', { paid_by: JOINT })], ACCOUNT_OPTIONS)).toBe(JOINT)
    const shared = [expense('a', { paid_by: SHARED }), expense('b', { paid_by: SHARED })]
    expect(startPayer(shared, ACCOUNT_OPTIONS)).toBe('')
    expect(payerNowLine(shared, ACCOUNT_OPTIONS)).toBe(`Now: ${label(SHARED)} — its parts are cleared when you save.`)
  })

  it('mixed: "Now: {label} (3) · {label} (2)" in the order of PAID_BY_OPTIONS, counts = expenses; a Shared part adds the sentence', () => {
    const mixed = [expense('a', { paid_by: P2 }), expense('b'), expense('c', { paid_by: P2 }), expense('d'), expense('e')]
    expect(startPayer(mixed, ACCOUNT_OPTIONS)).toBe('')
    expect(payerNowLine(mixed, ACCOUNT_OPTIONS)).toBe(`Now: ${label(P1)} (3) · ${label(P2)} (2)`)
    const withShared = [expense('a', { paid_by: SHARED }), expense('b', { paid_by: JOINT }), expense('c')]
    expect(payerNowLine(withShared, ACCOUNT_OPTIONS)).toBe(`Now: ${label(P1)} (1) · ${label(JOINT)} (1) · ${label(SHARED)} (1) — its parts are cleared when you save.`)
  })
})

describe('the texts (K237)', () => {
  it('grey lines and toasts, singular with 1', () => {
    expect(storeLine('2026-11-15', 13)).toBe('Purchase of 15/11/2026: the store changes for all 13 of its expenses, in every budget category.')
    expect(dateLine(13)).toBe('All 13 expenses of this purchase move to this day.')
    expect(dateLine(1)).toBe('The 1 expense of this purchase moves to this day.')
    expect(payerLine(5)).toBe('All 5 expenses of this purchase get this payer.')
    expect(payerLine(1)).toBe('The 1 expense of this purchase gets this payer.')
    expect(dateToast(13, '2026-11-13')).toBe('Date changed for 13 expenses of this purchase · 13/11/2026')
    expect(dateToast(1, '2026-11-13')).toBe('Date changed for 1 expense of this purchase · 13/11/2026')
    expect(payerToast(40, JOINT)).toBe(`Paid by changed for 40 expenses of this purchase · ${label(JOINT)}`)
    expect(payerToast(1, P2)).toBe(`Paid by changed for 1 expense of this purchase · ${label(P2)}`)
    expect(CHANGED_MEANWHILE).toBe('This purchase changed meanwhile (on another device?) — open it again. Nothing was changed.')
    expect(CHANGE_PURCHASE_NOTICE).toBe('This needs the database update supabase/034_change_purchase.sql')
  })

  it('K206: a date after today is refused, today is fine — by the device\'s local date (00:30 on 14/11 in Italy while UTC is still 13/11)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 14, 0, 30))
    const today = localDateString()
    expect(today).toBe('2026-11-14')
    expect(dateProblem({ date: '2026-11-14', dateOk: true, today })).toBe('')
    expect(dateProblem({ date: '2026-11-15', dateOk: true, today })).toBe(FUTURE_PURCHASE)
    expect(FUTURE_PURCHASE).toBe("A purchase can't be after today.")
    expect(dateProblem({ date: '2026-10-28', dateOk: true, today })).toBe('')
    expect(dateProblem({ date: '2026-11-13', dateOk: false, today })).toBe('Fix the date first (DD/MM/YYYY).')
  })

  it('what the database answered: before 034, a refusal (red line) or a failed connection (toast + Retry)', () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function public.change_purchase(payload) in the schema cache' }
    expect(missingChangePurchase(missing)).toBe(true)
    expect(missingChangePurchase({ code: '42883', message: 'function change_purchase(jsonb) does not exist' })).toBe(true)
    expect(refusalText(missing)).toBe(CHANGE_PURCHASE_NOTICE)
    expect(refusalText({ code: 'P0001', message: CHANGED_MEANWHILE })).toBe(CHANGED_MEANWHILE)
    expect(refusalText({ code: '42501', message: 'x' })).toBe('Not allowed: log in with the household account.')
    expect(refusedByDatabase({ code: 'P0001', message: CHANGED_MEANWHILE })).toBe(true)
    expect(refusedByDatabase({ message: 'TypeError: Load failed' })).toBe(false)
  })
})
