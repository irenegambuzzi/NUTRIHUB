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

  it('a tap in the shop only puts the item in the cart — no stock change', () => {
    const before = stock()
    offline.queueCart(entry, true)
    expect(listed().in_cart).toBe(true)
    expect(stock()).toBe(before)
    const ops = getQueue().filter((op) => op.type === 'cart' && op.key === 'g1')
    expect(ops).toHaveLength(1)
    expect(ops[0].payload).toEqual({ id: 'g1', inCart: true })
  })

  it('putting it in and taking it out again offline leaves one "out of the cart" change', () => {
    offline.queueCart(entry, true)
    offline.queueCart(listed(), false)
    expect(listed().in_cart).toBe(false)
    const ops = getQueue().filter((op) => op.type === 'cart' && op.key === 'g1')
    expect(ops).toHaveLength(1)
    expect(ops[0].payload.inCart).toBe(false)
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

  it('sends a cart change as just in_cart, and an old queued check-off as a cart change', async () => {
    resetQueueForTest({ keepHandlers: true })
    const updates = []
    const query = () => {
      const q = { eq: () => q, then: (r) => Promise.resolve({ data: null, error: null }).then(r) }
      return q
    }
    client.supabase = { from: (table) => ({ update: (patch) => (updates.push({ table, patch }), query()) }) }
    setOnlineForTest(false)
    offline.queueCart(entry, true)
    const { enqueue } = await import('./offlineQueue')
    enqueue('toggle', { id: 'g2', completed: true, options: {} })
    setOnlineForTest(true)
    await vi.waitFor(() => expect(getQueue()).toHaveLength(0))
    expect(updates).toEqual([
      { table: 'grocery_items', patch: { in_cart: true } },
      { table: 'grocery_items', patch: { in_cart: true } },
    ])
  })
})
