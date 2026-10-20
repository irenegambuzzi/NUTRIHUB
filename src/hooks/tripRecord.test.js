import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { deleteTripRecord } = await import('./usePurchase')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

// A fake database: `merged` expenses are those merged into the purchase
// (supabase/023); split_merged_purchase unlinks them, as the real one does.
function fakeDb({ merged = [] } = {}) {
  const calls = []
  const answer = (data) => {
    let rows = data
    const q = {
      eq: () => q,
      in: () => q,
      select: () => q,
      order: () => q,
      // .not('merged_at', 'is', null): only the merged ones.
      not: () => ((rows = rows.filter((r) => r.merged_at)), q),
      then: (r) => Promise.resolve({ data: rows, error: null }).then(r),
    }
    return q
  }
  const rows = {
    shopping_trips: [{ id: 't1', trip_date: '2026-10-06', total: 2 + merged.reduce((s, e) => s + e.amount, 0) }],
    grocery_items: [{ id: 'g1' }],
    expenses: [{ id: 'e1', amount: 2 }, ...merged],
    receipt_photos: [],
    shopping_trip_items: [{ id: 'ti1', trip_id: 't1', name: 'Milk' }],
  }
  client.supabase = {
    from: (table) => ({
      select: () => answer(rows[table] ?? []),
      delete: () => (calls.push({ op: 'delete', table }), answer([])),
      upsert: (data) => (calls.push({ op: 'upsert', table, data }), answer(data)),
      update: (patch) => (calls.push({ op: 'update', table, patch }), answer([])),
      insert: () => (calls.push({ op: 'insert', table }), answer([])),
    }),
    rpc: (name, args) => {
      calls.push({ op: 'rpc', name, args })
      if (name === 'split_merged_purchase') rows.expenses = rows.expenses.filter((e) => !e.merged_at)
      return answer(null)
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return calls
}

describe('Delete record (Receipts)', () => {
  it('deletes only the purchase record — no stock, history or expense change — and Undo links everything back', async () => {
    const calls = fakeDb()
    const { error } = await deleteTripRecord({ id: 't1' })
    expect(error).toBeNull()
    expect(calls).toEqual([{ op: 'delete', table: 'shopping_trips' }])
    expect(getToasts().at(-1)).toMatchObject({ message: 'Purchase record deleted', action: { label: 'Undo' } })

    await runToastAction(getToasts().at(-1).id)
    expect(calls.slice(1)).toEqual([
      { op: 'upsert', table: 'shopping_trips', data: { id: 't1', trip_date: '2026-10-06', total: 2 } },
      { op: 'upsert', table: 'shopping_trip_items', data: [{ id: 'ti1', trip_id: 't1', name: 'Milk' }] },
      { op: 'update', table: 'grocery_items', patch: { trip_id: 't1' } },
      { op: 'update', table: 'expenses', patch: { trip_id: 't1' } },
    ])
    expect(calls.some((c) => c.op === 'rpc' || c.table === 'pantry_items' || c.table === 'stock_logs')).toBe(false)
  })

  it('splits merged expenses off first (their stores come back), and Undo merges them in again', async () => {
    const calls = fakeDb({ merged: [{ id: 'm1', amount: 5, merged_at: '2026-10-06T10:00:00Z' }] })
    const { error } = await deleteTripRecord({ id: 't1' })
    expect(error).toBeNull()
    expect(calls.slice(0, 2)).toEqual([
      { op: 'rpc', name: 'split_merged_purchase', args: { trip_id: 't1', expense_ids: null } },
      { op: 'delete', table: 'shopping_trips' },
    ])
    // The merged expense is never deleted, nor relinked by hand.
    expect(calls.some((c) => c.op === 'delete' && c.table === 'expenses')).toBe(false)

    const before = calls.length
    await runToastAction(getToasts().at(-1).id)
    const undo = calls.slice(before)
    // The record comes back without the merged amount, which the merge adds again.
    expect(undo[0]).toEqual({ op: 'upsert', table: 'shopping_trips', data: { id: 't1', trip_date: '2026-10-06', total: 2 } })
    expect(undo.filter((c) => c.op === 'update' && c.table === 'expenses')).toEqual([{ op: 'update', table: 'expenses', patch: { trip_id: 't1' } }])
    expect(undo.at(-1)).toEqual({ op: 'rpc', name: 'merge_expenses_into_purchase', args: { payload: { trip_id: 't1', expense_ids: ['m1'] } } })
  })
})
