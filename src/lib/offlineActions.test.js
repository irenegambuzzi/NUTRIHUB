import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in Supabase client that records calls.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)

const { setOnlineForTest } = await import('./connection')
const { flush, getQueue, resetQueueForTest } = await import('./offlineQueue')
const { groceryStore, pantryStore } = await import('./stores')
const { dismissToast, getToasts } = await import('./feedback')
const offline = await import('./offlineActions')

const milk = { id: 'p1', name: 'Milk', unit: 'btl', current_stock: 2, min_stock: 0, expiry_date: null, category_id: 'beverages', created_at: '1' }
const entry = { id: 'g1', name: 'Milk', unit: 'btl', quantity: 3, completed: false, pantry_item_id: 'p1', category_id: 'beverages', created_at: '1' }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setOnlineForTest(false)
  pantryStore.upsertLocal([milk])
  groceryStore.upsertLocal([entry])
})
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  setOnlineForTest(true)
  vi.restoreAllMocks()
})

const stock = () => pantryStore.getSnapshot().rows.find((p) => p.id === 'p1').current_stock
const listed = () => groceryStore.getSnapshot().rows.find((g) => g.id === 'g1')

describe('offline changes', () => {
  it('shows a stock tap at once, and gives each tap its own id', () => {
    const before = getQueue().length
    offline.queueStock(milk, 1, 'restocked')
    offline.queueStock({ ...milk, current_stock: 3 }, 1, 'restocked')
    expect(stock()).toBe(4)
    const ops = getQueue().slice(before)
    expect(ops.map((op) => op.type)).toEqual(['stock', 'stock'])
    expect(ops[0].payload.opId).not.toBe(ops[1].payload.opId)
  })

  it('checking off then unchecking offline leaves one "unchecked" change and the stock as it was', () => {
    offline.queueToggle(entry)
    expect(listed().completed).toBe(true)
    expect(stock()).toBe(5)
    offline.queueToggle(listed())
    expect(listed().completed).toBe(false)
    expect(stock()).toBe(2)
    const toggles = getQueue().filter((op) => op.type === 'toggle' && op.key === 'g1')
    expect(toggles).toHaveLength(1)
    expect(toggles[0].payload.completed).toBe(false)
  })

  it('asks the same questions as online, from the copy on the phone', () => {
    expect(offline.queueToggle({ ...entry, unit: 'pack' })).toHaveProperty('needsPackSize')
    pantryStore.patchLocal(['p1'], { expiry_date: '2020-01-01' })
    expect(offline.queueToggle(entry)).toHaveProperty('needsExpiryChoice')
  })

  it('sends a stock tap with apply_stock_change, so a resend never counts twice', async () => {
    resetQueueForTest({ keepHandlers: true })
    const rpc = vi.fn(async () => ({ data: { ...milk, current_stock: 3 }, error: null }))
    const query = () => {
      const q = { select: () => q, eq: () => q, in: () => q, then: (r) => Promise.resolve({ data: [{ id: 'g1', auto_generated: false }], error: null }).then(r) }
      return q
    }
    client.supabase = { rpc, from: query }
    offline.queueStock(milk, 1, 'restocked')
    const { opId } = getQueue()[0].payload
    setOnlineForTest(true)
    await vi.waitFor(() => expect(getQueue()).toHaveLength(0))
    expect(rpc).toHaveBeenCalledWith('apply_stock_change', { op_id: opId, item_id: 'p1', delta: 1, reason: 'restocked' })
    await flush()
  })
})
