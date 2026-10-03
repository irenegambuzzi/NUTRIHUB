import { describe, expect, it, vi } from 'vitest'

// A stand-in Supabase client: select() resolves when the test says so,
// and the realtime handler and status callback are kept for the test.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)

const { applyChange, createTableStore, newestFirst } = await import('./tableStore')

function fakeClient() {
  const loads = []
  const realtime = {}
  client.supabase = {
    from: () => ({
      select: () => {
        let resolve
        const promise = new Promise((r) => (resolve = r))
        loads.push(resolve)
        return promise
      },
    }),
    channel: () => {
      const channel = {
        on: (_type, _filter, handler) => ((realtime.change = handler), channel),
        subscribe: (onStatus) => ((realtime.status = onStatus), channel),
      }
      return channel
    },
  }
  return { loads, realtime }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('applyChange', () => {
  const opts = { compare: newestFirst() }
  const rows = [
    { id: 'b', name: 'Bread', created_at: '2026-10-02' },
    { id: 'a', name: 'Apples', created_at: '2026-10-01' },
  ]

  it('adds, updates and removes one row, keeping the order', () => {
    const added = applyChange(rows, { eventType: 'INSERT', new: { id: 'c', name: 'Milk', created_at: '2026-10-03' } }, opts)
    expect(added.map((r) => r.id)).toEqual(['c', 'b', 'a'])
    const updated = applyChange(added, { eventType: 'UPDATE', new: { ...rows[1], name: 'Green apples' } }, opts)
    expect(updated.find((r) => r.id === 'a').name).toBe('Green apples')
    expect(updated).toHaveLength(3)
    expect(applyChange(updated, { eventType: 'DELETE', old: { id: 'b' } }, opts).map((r) => r.id)).toEqual(['c', 'a'])
  })

  it('drops a row that no longer belongs to the slice', () => {
    const accept = (row) => row.expense_date >= '2026-01-01'
    const moved = applyChange([{ id: 'x', expense_date: '2026-05-01' }], { eventType: 'UPDATE', new: { id: 'x', expense_date: '2025-12-31' } }, { accept })
    expect(moved).toEqual([])
  })

  it('keeps to the size limit', () => {
    const limited = applyChange(rows, { eventType: 'INSERT', new: { id: 'c', created_at: '2026-10-03' } }, { ...opts, limit: 2 })
    expect(limited.map((r) => r.id)).toEqual(['c', 'b'])
  })
})

describe('createTableStore', () => {
  it('loads once for everyone and applies realtime changes row by row', async () => {
    const { loads, realtime } = fakeClient()
    const store = createTableStore({ name: 't', table: 't', compare: newestFirst() })
    store.subscribe(() => {})
    store.subscribe(() => {})
    expect(loads).toHaveLength(1)
    loads[0]({ data: [{ id: 'a', created_at: '1' }], error: null })
    await flush()
    realtime.change({ eventType: 'INSERT', new: { id: 'b', created_at: '2' } })
    expect(store.getSnapshot().rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(loads).toHaveLength(1)
  })

  it("doesn't lose a change that arrives while loading", async () => {
    const { loads, realtime } = fakeClient()
    const store = createTableStore({ name: 't', table: 't' })
    store.subscribe(() => {})
    realtime.change({ eventType: 'UPDATE', new: { id: 'a', qty: 2 } })
    loads[0]({ data: [{ id: 'a', qty: 1 }], error: null })
    await flush()
    expect(store.getSnapshot()).toEqual({ rows: [{ id: 'a', qty: 2 }], loaded: true })
  })

  it('reloads after realtime reconnects, to catch missed changes', async () => {
    const { loads, realtime } = fakeClient()
    const store = createTableStore({ name: 't', table: 't' })
    store.subscribe(() => {})
    realtime.status('SUBSCRIBED')
    expect(loads).toHaveLength(1)
    realtime.status('CHANNEL_ERROR')
    realtime.status('SUBSCRIBED')
    expect(loads).toHaveLength(2)
    loads[1]({ data: [{ id: 'z' }], error: null })
    await flush()
    expect(store.getSnapshot().rows).toEqual([{ id: 'z' }])
  })

  it('shows rows saved by this phone at once, without a reload', async () => {
    const { loads } = fakeClient()
    const store = createTableStore({ name: 't', table: 't', columns: 'id, qty' })
    store.subscribe(() => {})
    loads[0]({ data: [{ id: 'a', qty: 1 }], error: null })
    await flush()
    store.patchLocal(['a'], { qty: 3 })
    store.upsertLocal([{ id: 'b', qty: 1, extra: 'not loaded' }])
    expect(store.getSnapshot().rows).toEqual([
      { id: 'a', qty: 3 },
      { id: 'b', qty: 1 },
    ])
    store.removeLocal(['a'])
    expect(store.getSnapshot().rows).toEqual([{ id: 'b', qty: 1 }])
    expect(loads).toHaveLength(1)
  })
})

describe('the copy kept on the phone', () => {
  it('is read only when the list is first used (after login), not when the app loads', async () => {
    const reads = []
    const saved = globalThis.localStorage
    globalThis.localStorage = { getItem: (k) => (reads.push(k), '[{"id":"a"}]'), setItem: () => {} }
    const { loads } = fakeClient()
    const store = createTableStore({ name: 't', table: 't', persist: 'secret' })
    expect(reads).toEqual([])
    expect(store.getSnapshot()).toEqual({ rows: [], loaded: false })
    store.subscribe(() => {})
    expect(reads).toEqual(['nutrihub-cache:secret'])
    expect(store.getSnapshot().rows).toEqual([{ id: 'a' }])
    loads[0]({ data: [], error: null })
    globalThis.localStorage = saved
  })
})
