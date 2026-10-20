import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { addToPurchase, mergeExpenses, splitPurchase } = await import('./useMerge')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

// A fake database: answers each rpc with `answers[name]` (data or error),
// and the reads Split does first.
function fakeDb({ answers = {}, merged = [], trip = { id: 't1', shop_id: 'conad' }, tripAfter = null } = {}) {
  const calls = []
  let split = false
  const result = (value) => {
    const q = {
      eq: () => q,
      in: () => q,
      not: () => q,
      select: () => q,
      maybeSingle: () => Promise.resolve({ data: split ? tripAfter : trip, error: null }),
      then: (r) => Promise.resolve(value).then(r),
    }
    return q
  }
  client.supabase = {
    from: () => ({ select: () => result({ data: merged, error: null }) }),
    rpc: (name, args) => {
      calls.push({ name, args })
      if (name === 'split_merged_purchase') split = true
      return Promise.resolve(answers[name] ?? { data: null, error: null })
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return calls
}

describe('Merge into one purchase', () => {
  it('sends the ticked expenses with one id and the store; Undo splits them again', async () => {
    const calls = fakeDb()
    const { error } = await mergeExpenses({ id: 'new', expenseIds: ['a', 'b'], shopId: 'conad', total: 6 })
    expect(error).toBeNull()
    expect(calls).toEqual([{ name: 'merge_expenses_into_purchase', args: { payload: { id: 'new', expense_ids: ['a', 'b'], shop_id: 'conad' } } }])
    expect(getToasts().at(-1)).toMatchObject({ message: '2 expenses merged into one purchase · €6.00', action: { label: 'Undo' } })
    await runToastAction(getToasts().at(-1).id)
    expect(calls.at(-1)).toEqual({ name: 'split_merged_purchase', args: { trip_id: 'new', expense_ids: ['a', 'b'] } })
  })

  it('adds to an existing purchase', async () => {
    const calls = fakeDb()
    await addToPurchase({ tripId: 't1', expenseIds: ['a'], total: 3 })
    expect(calls[0]).toEqual({ name: 'merge_expenses_into_purchase', args: { payload: { trip_id: 't1', expense_ids: ['a'] } } })
    expect(getToasts().at(-1).message).toBe('1 expense added to the purchase · €3.00')
  })

  it('two phones: the second is refused clearly, and nothing changed', async () => {
    fakeDb({ answers: { merge_expenses_into_purchase: { data: null, error: { message: '"Bread" is already part of a purchase — only single expenses can be merged.' } } } })
    const { error } = await mergeExpenses({ id: 'new', expenseIds: ['a', 'b'], shopId: 'conad' })
    expect(error.message).toMatch(/already part of a purchase.*other phone — nothing was changed/)
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: error.message })
  })
})

describe('Split', () => {
  it('gives the merged expenses back (the database restores each store); Undo makes the same purchase again when it is gone', async () => {
    const calls = fakeDb({ answers: { split_merged_purchase: { data: 2, error: null } }, merged: [{ id: 'a', amount: 2 }, { id: 'b', amount: 4 }] })
    await splitPurchase('t1')
    expect(calls[0]).toEqual({ name: 'split_merged_purchase', args: { trip_id: 't1', expense_ids: null } })
    expect(getToasts().at(-1).message).toBe('2 expenses single again, each with its own store')
    await runToastAction(getToasts().at(-1).id)
    expect(calls.at(-1)).toEqual({ name: 'merge_expenses_into_purchase', args: { payload: { id: 't1', expense_ids: ['a', 'b'], shop_id: 'conad' } } })
  })

  it('Undo of taking one out puts it back into the purchase that is still there', async () => {
    const calls = fakeDb({ answers: { split_merged_purchase: { data: 1, error: null } }, merged: [{ id: 'a', amount: 2 }], tripAfter: { id: 't1' } })
    await splitPurchase('t1', ['a'])
    await runToastAction(getToasts().at(-1).id)
    expect(calls.at(-1)).toEqual({ name: 'merge_expenses_into_purchase', args: { payload: { trip_id: 't1', expense_ids: ['a'] } } })
  })

  it('says so when there was nothing left to split', async () => {
    fakeDb({ answers: { split_merged_purchase: { data: 0, error: null } } })
    await splitPurchase('t1')
    expect(getToasts().at(-1).message).toMatch(/already split/)
  })
})
