// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// The HOME and SHOP actions around one-time items, group variants and the
// cart time, with the database and the stock functions replaced.
const db = vi.hoisted(() => ({ calls: [], toBuy: [], rows: [] }))
const toasts = vi.hoisted(() => [])

vi.mock('../lib/connection', async (importOriginal) => ({ ...(await importOriginal()), isOffline: () => false }))
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
    updateRows: vi.fn(async (table, id, patch) => ({ data: [{ ...db.saved, ...patch }], error: null })),
    syncShoppingForItem: vi.fn(async () => {}),
    insertRows: vi.fn(async (table, rows) => ({ data: rows, error: null })),
    toBuyEntriesOf: vi.fn(async () => db.toBuy),
    setVariantsDismissed: vi.fn(async (group, ids, at) => ids.map((id) => ({ id, shop_dismissed_at: at }))),
  }
})

const inventory = await import('../lib/inventory')
const { usePantryItems } = await import('./usePantryItems')
const { useGroceryItems } = await import('./useGroceryItems')

const sun = { id: 's', name: 'Sun cream', unit: 'pcs', current_stock: 1, min_stock: 0, one_time: true, category_id: 'personal-care' }

beforeEach(() => {
  db.calls.length = 0
  toasts.length = 0
  db.toBuy = []
  db.rows = []
  db.saved = sun
  vi.clearAllMocks()
})

describe('a one-time item used up in HOME', () => {
  it('says it is finished, and Undo puts the stock back (logged as edited)', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock(sun, -1, 'used')
    const toast = toasts.find((t) => /finished/.test(t.message))
    expect(toast.message).toBe('"Sun cream" is finished — moved to Finished one-time items')
    await toast.action.onClick()
    expect(inventory.changeStock).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's', current_stock: 0 }), 1, 'edited')
  })

  it('a normal item at 0 is just Out: no "finished" toast', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.adjustStock({ ...sun, one_time: false }, -1, 'used')
    expect(toasts.some((t) => /finished/.test(t.message))).toBe(false)
  })

  it('setting the stock to 0 in the editor finishes it too', async () => {
    const { result } = renderHook(() => usePantryItems())
    db.saved = sun
    await result.current.updateItem(sun, { name: 'Sun cream', current_stock: 0 })
    expect(toasts.some((t) => /is finished/.test(t.message))).toBe(true)
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

describe('a group row on the SHOP list', () => {
  const group = { id: 'g', name: 'Chips & Snacks', is_group: true, variants: [{ id: 'tuc', name: 'Tuc', current_stock: 0 }, { id: 'pr', name: 'Pringles', current_stock: 0 }, { id: 'lays', name: 'Lays', current_stock: 5 }] }

  it('× on a variant takes just that one off, with Undo', async () => {
    const { result } = renderHook(() => useGroceryItems())
    await result.current.dismissVariant(group, group.variants[0])
    expect(inventory.setVariantsDismissed).toHaveBeenCalledWith(group, ['tuc'], expect.any(String))
    const toast = toasts.find((t) => /"Tuc" taken off the SHOP list/.test(t.message))
    await toast.action.onClick()
    expect(inventory.setVariantsDismissed).toHaveBeenLastCalledWith(group, ['tuc'], null)
  })

  it('deleting a "Not urgent" row dismisses every listed variant; Undo clears the marks and puts the row back', async () => {
    db.rows = [{ id: 'e1', name: 'Chips & Snacks', pantry_item_id: 'g' }]
    const { result } = renderHook(() => useGroceryItems())
    await result.current.removeGroupRow({ id: 'e1', name: 'Chips & Snacks' }, group)
    const marks = db.calls.filter((c) => c.table === 'pantry_items' && c.op === 'update')
    expect(marks[0].patch.shop_dismissed_at).toEqual(expect.any(String))
    expect(marks[0].filters).toContainEqual(['in', 'id', ['pr', 'tuc']])
    const toast = toasts.find((t) => t.message === 'Removed "Chips & Snacks"')
    await toast.action.onClick()
    const cleared = db.calls.filter((c) => c.table === 'pantry_items' && c.op === 'update').at(-1)
    expect(cleared.patch).toEqual({ shop_dismissed_at: null })
    expect(db.calls.find((c) => c.op === 'upsert' && c.table === 'grocery_items').rows).toEqual(db.rows)
  })
})
