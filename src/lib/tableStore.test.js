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

// Plan 9P (report A2.9 part 2): each reload has its own buffer, an older
// read never goes over a newer one, a failed read keeps what came in.
describe('reloads that overlap or fail', () => {
  const bought = (id) => ({ id, completed: true, in_cart: false })
  const inCart = (id) => ({ id, completed: false, in_cart: true })
  const ids = (store, test) => store.getSnapshot().rows.filter(test).map((r) => r.id).sort()
  const cart = (store) => ids(store, (r) => r.in_cart && !r.completed)

  async function loaded(rows) {
    const { loads, realtime } = fakeClient()
    const store = createTableStore({ name: 't', table: 't' })
    store.subscribe(() => {})
    loads[0]({ data: rows, error: null })
    await flush()
    return { store, loads, realtime }
  }

  it('a failed read keeps the changes that came in while it was reading (and shows the usual toast)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, loads, realtime } = await loaded([bought('a'), bought('b')])
    const reload = store.refresh()
    realtime.change({ eventType: 'UPDATE', new: inCart('a') })
    realtime.change({ eventType: 'UPDATE', new: inCart('b') })
    loads[1]({ data: null, error: { message: 'Failed to fetch' } })
    await reload
    expect(cart(store)).toEqual(['a', 'b'])
    const { getToasts, dismissToast } = await import('./feedback')
    expect(getToasts().map((t) => t.message)).toContain("Couldn't load — check your connection.")
    getToasts().forEach((t) => dismissToast(t.id))
    errors.mockRestore()
  })

  it('a failed first read (nothing read yet): the changes go on the rows shown, the list still counts as not read', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loads, realtime } = fakeClient()
    const store = createTableStore({ name: 't', table: 't' })
    store.subscribe(() => {})
    realtime.change({ eventType: 'INSERT', new: inCart('a') })
    loads[0]({ data: null, error: { message: 'Failed to fetch' } })
    await flush()
    expect(store.getSnapshot()).toEqual({ rows: [inCart('a')], loaded: false })
    const { getToasts, dismissToast } = await import('./feedback')
    getToasts().forEach((t) => dismissToast(t.id))
    errors.mockRestore()
  })

  it('three overlapping reloads, the oldest (read before the Reopen) answered last → the newest read stays, no exception', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, loads, realtime } = await loaded([bought('a'), bought('b'), bought('c')])
    const r1 = store.refresh() // its read was made before the Reopen
    const r2 = store.refresh()
    realtime.change({ eventType: 'UPDATE', new: inCart('a') }) // the burst starts
    const r3 = store.refresh() // starts mid-burst
    realtime.change({ eventType: 'UPDATE', new: inCart('b') })
    realtime.change({ eventType: 'UPDATE', new: inCart('c') })
    loads[3]({ data: [inCart('a'), inCart('b'), bought('c')], error: null })
    await flush()
    expect(cart(store)).toEqual(['a', 'b', 'c'])
    loads[2]({ data: [inCart('a'), bought('b'), bought('c')], error: null })
    loads[1]({ data: [bought('a'), bought('b'), bought('c')], error: null })
    await Promise.all([r1, r2, r3])
    expect(cart(store)).toEqual(['a', 'b', 'c'])
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('an older read answered after a newer one is dropped — also when realtime missed the change only the newer read has', async () => {
    const { store, loads } = await loaded([bought('a')])
    const old = store.refresh() // read before the Reopen
    const fresh = store.refresh() // read after it; realtime lost
    loads[2]({ data: [inCart('a')], error: null })
    await flush()
    expect(cart(store)).toEqual(['a'])
    loads[1]({ data: [bought('a')], error: null })
    await Promise.all([old, fresh])
    expect(cart(store)).toEqual(['a'])
  })

  it('a change during two reloads ends in both results (whichever is applied)', async () => {
    for (const order of [
      [1, 2],
      [2, 1],
    ]) {
      const { store, loads, realtime } = await loaded([bought('a')])
      const reloads = [store.refresh(), store.refresh()]
      realtime.change({ eventType: 'UPDATE', new: inCart('a') })
      for (const n of order) {
        loads[n]({ data: [bought('a'), bought(`x${n}`)], error: null })
        await flush()
        expect(cart(store)).toEqual(['a'])
      }
      await Promise.all(reloads)
      // The read applied is the one of the reload that started last.
      expect(ids(store, () => true)).toEqual(['a', 'x2'])
    }
  })

  it('a change after the newer read is on screen, while an older reload is still reading, is not lost', async () => {
    const { store, loads, realtime } = await loaded([bought('a'), bought('b')])
    const r1 = store.refresh()
    const r2 = store.refresh()
    loads[2]({ data: [bought('a'), bought('b')], error: null })
    await flush()
    realtime.change({ eventType: 'UPDATE', new: inCart('b') })
    loads[1]({ data: [bought('a'), bought('b')], error: null })
    await Promise.all([r1, r2])
    expect(cart(store)).toEqual(['b'])
  })

  it('rows put in by this device (Reopen reads its cards back) are never replaced by a read that started before them', async () => {
    const { store, loads } = await loaded([bought('a'), bought('b')])
    const old = store.refresh() // e.g. the reload after waking the device
    store.upsertLocal([inCart('a'), inCart('b')]) // fresh from the database
    expect(cart(store)).toEqual(['a', 'b'])
    loads[1]({ data: [bought('a'), bought('b')], error: null })
    await old
    expect(cart(store)).toEqual(['a', 'b'])
  })

  it('the same for a row taken off or patched by this device', async () => {
    const { store, loads } = await loaded([bought('a'), bought('b')])
    const old = store.refresh()
    store.removeLocal(['a'])
    store.patchLocal(['b'], { in_cart: true, completed: false })
    loads[1]({ data: [bought('a'), bought('b')], error: null })
    await old
    expect(ids(store, () => true)).toEqual(['b'])
    expect(cart(store)).toEqual(['b'])
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
