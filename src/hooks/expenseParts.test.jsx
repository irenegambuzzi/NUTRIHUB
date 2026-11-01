// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Round 9K: each person's part of a Shared expense, as written by the app
// (plain expense, Edit expense) and how the app finds out that
// supabase/029 has run.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { addExpenseOnce, useExpenses } = await import('./useExpenses')
const { useExpensePartsReady } = await import('./useExpenseParts')
const { PAID_BY_OPTIONS } = await import('../data/constants')
const { dismissToast, getToasts } = await import('../lib/feedback')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const [C1, C2] = [`part_${P1}`, `part_${P2}`]

afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

// A Supabase stand-in: every query is a chain that records its calls and
// answers `answer(table, calls)`.
function fakeDb(answer) {
  const log = []
  client.supabase = {
    from: (table) => {
      const calls = []
      log.push({ table, calls })
      const q = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'then'
              ? (ok, fail) => Promise.resolve(answer(table, calls)).then(ok, fail)
              : (...args) => {
                  calls.push([key, ...args])
                  return q
                },
        }
      )
      return q
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return log
}
const written = (log, method) => log.flatMap((q) => q.calls).find(([k]) => k === method)?.[1]

describe('a plain Shared expense with parts ("+ Add expense", one row)', () => {
  it('writes both parts with the expense; without parts, no part column is sent (as before 029)', async () => {
    const log = fakeDb(() => ({ data: [{ id: 'e1' }], error: null }))
    await addExpenseOnce({ id: 'e1', categoryId: 'housing', amount: 268.58, description: 'SPESE CONDOMINIO', paidBy: 'shared', expenseDate: '2026-10-27', parts: { [P1]: 168.58, [P2]: 100 } })
    expect(written(log, 'upsert')[0]).toMatchObject({ amount: 268.58, paid_by: 'shared', [C1]: 168.58, [C2]: 100 })
    const log2 = fakeDb(() => ({ data: [{ id: 'e2' }], error: null }))
    await addExpenseOnce({ id: 'e2', categoryId: 'housing', amount: 12, description: 'Bread', paidBy: P1, expenseDate: '2026-10-27' })
    expect(Object.keys(written(log2, 'upsert')[0])).not.toContain(C1)
  })

  it('a database without the part columns: the toast says "This needs the database update supabase/029_shared_parts.sql"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb(() => ({ data: null, error: { code: 'PGRST204', message: `Could not find the '${C1}' column of 'expenses' in the schema cache` } }))
    const { error } = await addExpenseOnce({ id: 'e3', amount: 10, description: 'x', paidBy: 'shared', expenseDate: '2026-10-27', parts: { [P1]: 4, [P2]: 6 } })
    expect(error).toBeTruthy()
    expect(getToasts().at(-1)).toMatchObject({ message: 'This needs the database update supabase/029_shared_parts.sql', tone: 'error' })
  })
})

describe('"Edit expense" (useExpenses().updateExpense)', () => {
  it('parts given → written; null → both emptied; not given → the columns are left alone', async () => {
    const log = fakeDb((table, calls) => ({ data: calls.some(([k]) => k === 'update') ? [{ id: 'e1' }] : [], error: null }))
    const { result } = renderHook(() => useExpenses('2026-10-01'))
    const values = { categoryId: 'housing', amount: 260, description: 'SPESE CONDOMINIO', paidBy: 'shared', expenseDate: '2026-10-27' }
    await result.current.updateExpense('e1', { ...values, parts: { [P1]: 100, [P2]: 160 } })
    await result.current.updateExpense('e1', { ...values, paidBy: P2, parts: null })
    await result.current.updateExpense('e1', values)
    const updates = log.flatMap((q) => q.calls).filter(([k]) => k === 'update').map(([, patch]) => patch)
    expect(updates[0]).toMatchObject({ amount: 260, [C1]: 100, [C2]: 160 })
    expect(updates[1]).toMatchObject({ paid_by: P2, [C1]: null, [C2]: null })
    expect(Object.keys(updates[2])).not.toContain(C1)
  })
})

describe('has 029 run? (rows read with all their columns)', () => {
  it('from the expenses already loaded (Money)', () => {
    expect(renderHook(() => useExpensePartsReady([{ id: 'a', amount: 1, [C1]: null, [C2]: null }])).result.current).toBe(true)
    expect(renderHook(() => useExpensePartsReady([{ id: 'a', amount: 1 }])).result.current).toBe(false)
    expect(renderHook(() => useExpensePartsReady([])).result.current).toBe(false)
  })

  it('without them (SHOP Confirm purchase): one expense is read; no columns, an error or no connection → no', async () => {
    fakeDb(() => ({ data: [{ id: 'a', amount: 1 }], error: null }))
    const before = renderHook(() => useExpensePartsReady())
    await new Promise((done) => setTimeout(done, 20))
    expect(before.result.current).toBe(false)
    fakeDb(() => ({ data: null, error: { message: 'offline' } }))
    expect(renderHook(() => useExpensePartsReady()).result.current).toBe(false)
    client.supabase = {}
    expect(renderHook(() => useExpensePartsReady()).result.current).toBe(false)
    const log = fakeDb(() => ({ data: [{ id: 'a', amount: 1, [C1]: null, [C2]: null }], error: null }))
    const after = renderHook(() => useExpensePartsReady())
    await waitFor(() => expect(after.result.current).toBe(true))
    expect(log[0].calls).toEqual([
      ['select', '*'],
      ['limit', 1],
    ])
    // Known from then on.
    client.supabase = {}
    expect(renderHook(() => useExpensePartsReady()).result.current).toBe(true)
  })
})
