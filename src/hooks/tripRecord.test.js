import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { deleteTripRecord } = await import('./usePurchase')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

function fakeDb() {
  const calls = []
  const answer = (data) => {
    const q = { eq: () => q, in: () => q, select: () => q, order: () => q, then: (r) => Promise.resolve({ data, error: null }).then(r) }
    return q
  }
  const rows = {
    grocery_items: [{ id: 'g1' }],
    expenses: [{ id: 'e1' }],
    receipt_photos: [],
    shopping_trip_items: [{ id: 'ti1', trip_id: 't1', name: 'Milk' }],
  }
  client.supabase = {
    from: (table) => ({
      select: () => answer(rows[table] ?? []),
      delete: () => (calls.push({ op: 'delete', table }), answer([{ id: 't1', trip_date: '2026-10-06' }])),
      upsert: (data) => (calls.push({ op: 'upsert', table, data }), answer(data)),
      update: (patch) => (calls.push({ op: 'update', table, patch }), answer([])),
      insert: () => (calls.push({ op: 'insert', table }), answer([])),
    }),
    rpc: () => (calls.push({ op: 'rpc' }), answer(null)),
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
      { op: 'upsert', table: 'shopping_trips', data: { id: 't1', trip_date: '2026-10-06' } },
      { op: 'upsert', table: 'shopping_trip_items', data: [{ id: 'ti1', trip_id: 't1', name: 'Milk' }] },
      { op: 'update', table: 'grocery_items', patch: { trip_id: 't1' } },
      { op: 'update', table: 'expenses', patch: { trip_id: 't1' } },
    ])
    expect(calls.some((c) => c.op === 'rpc' || c.table === 'pantry_items' || c.table === 'stock_logs')).toBe(false)
  })
})
