// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Plan 9L K11: a unit change in HOME "Edit item" that converts the stock
// ("Convert with the pack size", or kg ↔ gr "Convert the numbers") writes
// ONE history row 'converted' ("Unit changed", shown as "→ 8 pcs"); "Keep
// the numbers as they are" keeps today's behaviour.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../lib/feedback', async (original) => ({ ...(await original()), showToast: vi.fn() }))
vi.mock('../lib/stores', () => {
  const store = () => ({ useRows: () => ({ rows: [], loaded: true }), getSnapshot: () => ({ rows: [] }), refresh: vi.fn(async () => {}), upsertLocal: vi.fn(), removeLocal: vi.fn(), patchLocal: vi.fn() })
  return { pantryStore: store(), groceryStore: store(), stockLogStore: store() }
})
const saved = vi.hoisted(() => ({ row: null }))
vi.mock('../lib/inventory', async (original) => ({
  ...(await original()),
  updateRows: vi.fn(async (table, id, patch) => ({ data: [{ ...saved.row, ...patch }], error: null })),
  stockChangeWithLog: vi.fn(async (item, parts) => ({ item: { ...item, current_stock: Number(item.current_stock) + parts.reduce((s, p) => s + p.change, 0) }, logIds: ['log'] })),
  syncShoppingForItem: vi.fn(async () => {}),
}))

const inventory = await import('../lib/inventory')
const { usePantryItems } = await import('./usePantryItems')

const soft = { id: 's', name: 'Soft drink', unit: 'pack', current_stock: 2, min_stock: 1, category_id: 'beverages' }

beforeEach(() => {
  saved.row = { ...soft }
  vi.mocked(inventory.stockChangeWithLog).mockClear()
})

describe('history of a unit change in "Edit item"', () => {
  it('"Convert with the pack size" 2 pack → 8 pcs: one row "converted", in pcs, to 8', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(soft, { unit: 'pcs', current_stock: 8, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4 }, { converted: true })
    const calls = vi.mocked(inventory.stockChangeWithLog).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatchObject({ unit: 'pcs' })
    expect(calls[0][1]).toEqual([{ change: 6, reason: 'converted' }])
  })

  it('kg → gr "Convert the numbers" (2 kg → 2000 gr): one row "converted" (before 9L: "edited", shown "+1998 gr")', async () => {
    saved.row = { ...soft, unit: 'kg' }
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem({ ...soft, unit: 'kg' }, { unit: 'gr', current_stock: 2000, min_stock: 1000 }, { converted: true })
    expect(vi.mocked(inventory.stockChangeWithLog).mock.calls[0][1]).toEqual([{ change: 1998, reason: 'converted' }])
  })

  it('"Keep the numbers as they are": no row (the numbers are the same); a stock then typed by hand is "edited", as before', async () => {
    const { result } = renderHook(() => usePantryItems())
    await result.current.updateItem(soft, { unit: 'pcs', current_stock: 2, min_stock: 1 }, { converted: false })
    expect(inventory.stockChangeWithLog).not.toHaveBeenCalled()
    await result.current.updateItem(soft, { unit: 'pcs', current_stock: 8, min_stock: 1 })
    expect(vi.mocked(inventory.stockChangeWithLog).mock.calls[0][1]).toEqual([{ change: 6, reason: 'edited' }])
  })
})
