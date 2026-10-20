import { describe, expect, it, vi } from 'vitest'

// Undo of a stock change leaves no trace: the stock goes back and the
// history rows of the change are deleted, never a new "Adjusted" row.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)
const { stockChangeWithLog, undoStockChange } = await import('./inventory')

// pantry_items, stock_logs, grocery_items and orders in memory, with
// increment_stock as the database does it (never below 0).
function fakeDb(tables) {
  let next = 1
  const from = (table) => {
    const rows = () => (tables[table] ??= [])
    const filters = []
    let op = { kind: 'select' }
    const matches = (r) => filters.every((f) => f(r))
    const q = {
      select: () => q,
      eq: (k, v) => (filters.push((r) => r[k] === v), q),
      in: (k, vs) => (filters.push((r) => vs.includes(r[k])), q),
      maybeSingle: () => q,
      then: (resolve, reject) => {
        let data = []
        if (op.kind === 'select') data = rows().filter(matches)
        if (op.kind === 'insert') {
          data = op.rows.map((r) => ({ id: `log${next++}`, ...r }))
          rows().push(...data)
        }
        if (op.kind === 'delete') {
          data = rows().filter(matches)
          tables[table] = rows().filter((r) => !matches(r))
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return {
      select: () => q,
      insert: (r) => ((op = { kind: 'insert', rows: r }), q),
      delete: () => ((op = { kind: 'delete' }), q),
    }
  }
  const rpc = async (name, { item_id, delta }) => {
    const item = tables.pantry_items.find((p) => p.id === item_id)
    if (!item) return { data: null, error: null }
    item.current_stock = Math.max(0, item.current_stock + delta)
    return { data: { ...item }, error: null }
  }
  client.supabase = { from, rpc }
}

const test1x = () => ({ id: 't', name: 'TEST 1x', unit: 'pcs', current_stock: 1, min_stock: 0, one_time: true, category_id: 'misc' })

describe('Undo of a stock change', () => {
  it('TEST 1x: 1 → − → 0 ("Used −1") → Undo → 1, and History has nothing for it', async () => {
    const tables = { pantry_items: [test1x()], stock_logs: [{ id: 'older', item_id: 't', change: 1, reason: 'added' }], grocery_items: [], orders: [] }
    fakeDb(tables)
    const { item, logIds } = await stockChangeWithLog({ ...tables.pantry_items[0] }, [{ change: -1, reason: 'used' }])
    expect(item.current_stock).toBe(0)
    expect(tables.stock_logs.map((l) => l.reason)).toEqual(['added', 'used'])
    const restored = await undoStockChange(item, 1, logIds)
    expect(restored.current_stock).toBe(1)
    // Only what was there before stays: no "used", no "edited" (Adjusted).
    expect(tables.stock_logs.map((l) => l.id)).toEqual(['older'])
  })

  it('a history row already deleted on the other phone: the stock still comes back, without an error', async () => {
    const tables = { pantry_items: [test1x()], stock_logs: [], grocery_items: [], orders: [] }
    fakeDb(tables)
    const { item, logIds } = await stockChangeWithLog({ ...tables.pantry_items[0] }, [{ change: -1, reason: 'used' }])
    tables.stock_logs = []
    await expect(undoStockChange(item, 1, logIds)).resolves.toMatchObject({ current_stock: 1 })
    expect(tables.stock_logs).toEqual([])
  })

  it('also puts the SHOP list back as it was (an Out item undone leaves the list)', async () => {
    const milk = { id: 'm', name: 'Milk', unit: 'btl', current_stock: 1, min_stock: 0, category_id: 'dairy' }
    const tables = { pantry_items: [milk], stock_logs: [], grocery_items: [], orders: [] }
    fakeDb(tables)
    const { item, logIds } = await stockChangeWithLog({ ...milk }, [{ change: -1, reason: 'used' }])
    expect(tables.grocery_items).toHaveLength(1)
    await undoStockChange(item, 1, logIds)
    expect(tables.grocery_items).toEqual([])
    expect(tables.stock_logs).toEqual([])
  })
})
