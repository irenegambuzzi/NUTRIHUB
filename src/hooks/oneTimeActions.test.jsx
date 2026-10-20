// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// The HOME and SHOP actions around one-time items, group variants and the
// cart time, with the database and the stock functions replaced.
const db = vi.hoisted(() => ({ calls: [], toBuy: [], rows: [] }))
const toasts = vi.hoisted(() => [])
const net = vi.hoisted(() => ({ offline: false }))

vi.mock('../lib/connection', async (importOriginal) => ({ ...(await importOriginal()), isOffline: () => net.offline }))
vi.mock('../lib/feedback', () => ({
  showToast: (t) => (toasts.push(t), t),
  toastSaveError: vi.fn(),
}))
vi.mock('../lib/supabaseClient', () => {
  const chain = (record) => {
    const q = {
      eq: (...a) => (record.filters.push(['eq', ...a]), q),
      in: (...a) => (record.filters.push(['in', ...a]), q),
      not: (...a) => (record.filters.push(['not', ...a]), q),
      select: () => q,
      then: (resolve) => Promise.resolve({ data: db.rows, error: null }).then(resolve),
    }
    return q
  }
  const from = (table) => ({
    update: (patch) => {
      const record = { table, op: 'update', patch, filters: [] }
      db.calls.push(record)
      return chain(record)
    },
    delete: () => {
      const record = { table, op: 'delete', filters: [] }
      db.calls.push(record)
      return chain(record)
    },
    upsert: async (rows) => (db.calls.push({ table, op: 'upsert', rows }), { error: null }),
    select: () => chain({ filters: [] }),
  })
  return { supabase: { from } }
})
vi.mock('../lib/stores', () => {
  const store = () => ({
    useRows: () => ({ rows: [], loaded: true }),
    getSnapshot: () => ({ rows: [] }),
    refresh: vi.fn(async () => {}),
    upsertLocal: vi.fn(),
    removeLocal: vi.fn(),
    patchLocal: vi.fn(),
  })
  return { pantryStore: store(), groceryStore: store(), stockLogStore: store() }
})
vi.mock('../lib/inventory', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    changeStock: vi.fn(async (item, delta) => ({ ...item, current_stock: Math.max(0, Number(item.current_stock) + delta) })),
    stockChangeWithLog: vi.fn(async (item, parts) => ({
      item: { ...item, current_stock: Math.max(0, Number(item.current_stock) + parts.reduce((sum, p) => sum + p.change, 0)) },
      logIds: ['log1'],
    })),
    undoStockChange: vi.fn(async (item, delta) => ({ ...item, current_stock: Number(item.current_stock) + delta })),
    latestLogId: vi.fn(async () => 'sentLog'),
    orderedEntryIds: vi.fn(async () => new Set()),
    updateRows: vi.fn(async (table, id, patch) => ({ data: [{ ...db.saved, ...patch }], error: null })),
    syncShoppingForItem: vi.fn(async () => {}),
    insertRows: vi.fn(async (table, rows) => ({ data: rows, error: null })),
    toBuyEntriesOf: vi.fn(async () => db.toBuy),
  }
})

const inventory = await import('../lib/inventory')
const { getQueue, resetQueueForTest } = await import('../lib/offlineQueue')
const { usePantryItems } = await import('./usePantryItems')
const { useGroceryItems } = await import('./useGroceryItems')

const sun = { id: 's', name: 'Sun cream', unit: 'pcs', current_stock: 1, min_stock: 0, one_time: true, category_id: 'personal-care' }

beforeEach(() => {
  db.calls.length = 0
  toasts.length = 0
  db.toBuy = []
  db.rows = []
  db.saved = sun
  net.offline = false
  resetQueueForTest({ keepHandlers: true })
  vi.clearAllMocks()
})

describe('a one-time item used up in HOME', () => {
  it('says it is finished; Undo puts the stock back and deletes its "Used" row — no "Adjusted" row is written', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock(sun, -1, 'used')
    const toast = toasts.find((t) => /finished/.test(t.message))
    expect(toast.message).toBe('"Sun cream" is finished — moved to Finished one-time items')
    await toast.action.onClick()
    expect(inventory.undoStockChange).toHaveBeenCalledWith(expect.objectContaining({ id: 's', current_stock: 0 }), 1, ['log1'])
    // The only stock change written is the "used" one itself.
    expect(inventory.stockChangeWithLog).toHaveBeenCalledTimes(1)
    expect(inventory.changeStock).not.toHaveBeenCalled()
  })

  it('a normal item at 0 is just Out: no "finished" toast', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock({ ...sun, one_time: false }, -1, 'used')
    expect(toasts.some((t) => /finished/.test(t.message))).toBe(false)
  })

  it('setting the stock to 0 in the editor finishes it too; Undo takes its "Adjusted" row away again', async () => {
    const { result } = renderHook(() => usePantryItems())
    db.saved = sun
    await result.current.updateItem(sun, { name: 'Sun cream', current_stock: 0 })
    const toast = toasts.find((t) => /is finished/.test(t.message))
    await toast.action.onClick()
    expect(inventory.undoStockChange).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }), 1, ['log1'])
    expect(inventory.stockChangeWithLog).toHaveBeenCalledTimes(1)
  })

  it('offline: Undo takes the change out of the queue, so it is never sent (no history at all)', async () => {
    net.offline = true
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock(sun, -1, 'used')
    expect(getQueue()).toHaveLength(1)
    const toast = toasts.find((t) => /finished/.test(t.message))
    await toast.action.onClick()
    expect(getQueue()).toHaveLength(0)
    expect(inventory.undoStockChange).not.toHaveBeenCalled()
  })

  it('made offline and sent meanwhile: Undo finds its history row and deletes it', async () => {
    net.offline = true
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock(sun, -1, 'used')
    const toast = toasts.find((t) => /finished/.test(t.message))
    resetQueueForTest({ keepHandlers: true })
    net.offline = false
    await toast.action.onClick()
    expect(inventory.latestLogId).toHaveBeenCalledWith('s', -1, 'used')
    expect(inventory.undoStockChange).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }), 1, ['sentLog'])
  })
})

describe('discarding expired stock', () => {
  it('Undo puts the stock and the date back and deletes the "Discarded" row (nothing new in History)', async () => {
    const milk = { id: 'm', name: 'Milk', unit: 'btl', current_stock: 2, min_stock: 1, expiry_date: '2020-01-01', category_id: 'dairy' }
    const { result } = renderHook(() => usePantryItems())
    await result.current.discardExpired(milk)
    const toast = toasts.find((t) => /Discarded 2 btl/.test(t.message))
    await toast.action.onClick()
    expect(inventory.undoStockChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'm', expiry_date: '2020-01-01' }), 2, ['log1'])
    expect(inventory.stockChangeWithLog).toHaveBeenCalledTimes(1)
  })
})

describe('marking an item one-time', () => {
  const batteries = { id: 'b', name: 'Batteries', unit: 'pcs', current_stock: 0, min_stock: 2, one_time: false, category_id: 'household' }
  const entries = [{ id: 'auto', pantry_item_id: 'b', auto_generated: true }, { id: 'typed', pantry_item_id: null, name: 'batteries' }]

  it('takes what is "to buy" off the SHOP list (typed by hand too), with Undo putting it back exactly', async () => {
    db.toBuy = entries
    db.saved = batteries
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(batteries, { one_time: true })
    expect(inventory.toBuyEntriesOf).toHaveBeenCalledWith(batteries)
    const removed = db.calls.find((c) => c.table === 'grocery_items' && c.op === 'delete')
    expect(removed.filters).toContainEqual(['in', 'id', ['auto', 'typed']])
    const toast = toasts.find((t) => /one-time: taken off the SHOP list/.test(t.message))
    await toast.action.onClick()
    expect(db.calls.find((c) => c.op === 'upsert').rows).toEqual(entries)
  })

  it('leaves entries in the cart or on the way alone (toBuyEntriesOf never returns them)', async () => {
    db.toBuy = []
    db.saved = batteries
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(batteries, { one_time: true })
    expect(db.calls.some((c) => c.table === 'grocery_items' && c.op === 'delete')).toBe(false)
  })

  it('never looks at the list when the flag is removed or was already on', async () => {
    db.saved = sun
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(sun, { one_time: false })
    await result.current.updateItem(sun, { one_time: true })
    expect(inventory.toBuyEntriesOf).not.toHaveBeenCalled()
  })

  it('never touches expenses or shopping trips', async () => {
    db.toBuy = entries
    db.saved = batteries
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(batteries, { one_time: true })
    await result.current.adjustStock(sun, -1, 'used')
    expect(db.calls.filter((c) => ['expenses', 'shopping_trips', 'shopping_trip_items'].includes(c.table))).toEqual([])
  })
})

describe('the cart time', () => {
  const milk = { id: 'g1', name: 'Milk', in_cart: false, completed: false }

  it('sends the tap time when an entry goes into the cart, only if it is not in the cart yet', async () => {
    db.rows = [{ ...milk, in_cart: true, cart_added_at: '2026-10-20T10:00:00.000Z' }]
    const { result } = renderHook(() => useGroceryItems())
    await result.current.toggleCart(milk)
    const update = db.calls.find((c) => c.table === 'grocery_items' && c.op === 'update')
    expect(update.patch).toEqual({ in_cart: true, cart_added_at: expect.any(String) })
    expect(update.filters).toContainEqual(['not', 'in_cart', 'is', true])
  })

  it('taking it out sends no time (the database clears it)', async () => {
    db.rows = [{ ...milk }]
    const { result } = renderHook(() => useGroceryItems())
    await result.current.toggleCart({ ...milk, in_cart: true })
    const update = db.calls.find((c) => c.table === 'grocery_items' && c.op === 'update')
    expect(update.patch).toEqual({ in_cart: false })
  })

  it('a new SHOP item not in HOME can be one-time; others are sent without the flag', async () => {
    const { result } = renderHook(() => useGroceryItems())
    await result.current.addItem({ name: 'Balloons', categoryId: 'misc', oneTime: true })
    await result.current.addItem({ name: 'Rice', categoryId: 'pantry-staples' })
    expect(inventory.insertRows.mock.calls[0][1][0]).toMatchObject({ name: 'Balloons', one_time: true })
    expect(inventory.insertRows.mock.calls[1][1][0]).not.toHaveProperty('one_time')
  })
})

describe('"+ Add another variant"', () => {
  const lays = { id: 'lays', name: 'Lays', unit: 'pcs', current_stock: 5, category_id: 'snacks', group_id: 'g', price: 1.5, price_qty: 1, price_unit: 'pcs', packaging_unit: 'pack', quantity_per_pack: 4 }

  it('adds an entry typed by hand for the variant: 1 of its pack, its last price', async () => {
    db.rows = []
    const { result } = renderHook(() => useGroceryItems())
    await result.current.addVariant(lays)
    const [row] = inventory.insertRows.mock.calls[0][1]
    expect(row).toMatchObject({ name: 'Lays', pantry_item_id: 'lays', quantity: 1, unit: 'pack', price: 1.5, completed: false })
    expect(row).not.toHaveProperty('auto_generated')
  })

  it('never a second entry for the same variant', async () => {
    db.rows = [{ id: 'e1', pantry_item_id: 'lays' }]
    const { result } = renderHook(() => useGroceryItems())
    await result.current.addVariant(lays)
    expect(inventory.insertRows).not.toHaveBeenCalled()
  })
})
