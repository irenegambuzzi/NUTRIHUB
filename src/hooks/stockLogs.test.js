import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in Supabase client that records what is sent.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { deleteStockLogs } = await import('./usePantryItems')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

const logs = [
  { id: 'l1', item_name: 'Milk', change: 2, new_stock: 2, unit: 'btl', reason: 'purchased' },
  { id: 'l2', item_name: 'Rice', change: -1, new_stock: 0, unit: 'pack', reason: 'used' },
]

function fakeDb() {
  const calls = []
  const answer = (data) => {
    const q = { in: () => q, select: () => q, order: () => q, limit: () => q, then: (r) => Promise.resolve({ data, error: null }).then(r) }
    return q
  }
  client.supabase = {
    from: (table) => ({
      delete: () => (calls.push({ op: 'delete', table }), answer(logs)),
      upsert: (rows) => (calls.push({ op: 'upsert', table, rows }), answer(rows)),
      select: () => answer(logs),
      update: () => (calls.push({ op: 'update', table }), answer([])),
      insert: () => (calls.push({ op: 'insert', table }), answer([])),
    }),
    rpc: () => (calls.push({ op: 'rpc' }), answer(null)),
  }
  return calls
}

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

describe('deleting history entries', () => {
  it('deletes only the history rows, and Undo puts back exactly those', async () => {
    const calls = fakeDb()
    const { error } = await deleteStockLogs(['l1', 'l2'])
    expect(error).toBeNull()
    expect(getToasts().at(-1)).toMatchObject({ message: '2 entries deleted', action: { label: 'Undo' } })
    // Nothing but stock_logs is touched: no stock change, no item, no expense.
    expect(calls).toEqual([{ op: 'delete', table: 'stock_logs' }])

    await runToastAction(getToasts().at(-1).id)
    expect(calls.at(-1)).toEqual({ op: 'upsert', table: 'stock_logs', rows: logs })
    expect(calls.some((c) => c.op === 'rpc' || c.table !== 'stock_logs')).toBe(false)
  })

  it('says "Deleted" for one entry', async () => {
    fakeDb()
    await deleteStockLogs(['l1'])
    expect(getToasts().at(-1).message).toBe('Deleted')
  })
})
