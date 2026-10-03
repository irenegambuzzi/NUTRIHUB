import { describe, expect, it, vi } from 'vitest'

// inventory.js imports the Supabase client, which needs env variables;
// tests that touch the database swap in a fake (see fakeDb below).
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)

const {
  pickDurableCategory,
  quantityStep,
  roundQuantity,
  stepQuantity,
  stockLogEntries,
  suggestedPurchase,
  syncShoppingForItem,
  tapStep,
  toBaseQuantity,
} = await import('./inventory')

// A stand-in for the Supabase client: reads return `openRows`, writes are
// recorded in `writes`.
function fakeDb(openRows) {
  const writes = []
  const query = (result) => {
    const q = { eq: () => q, in: () => q, select: () => q, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }
    return q
  }
  client.supabase = {
    from: (table) => ({
      select: () => query({ data: openRows, error: null }),
      insert: (rows) => (writes.push({ op: 'insert', table, rows }), query({ data: rows, error: null })),
      update: (patch) => (writes.push({ op: 'update', table, patch }), query({ data: [], error: null })),
      delete: () => (writes.push({ op: 'delete', table }), query({ data: [], error: null })),
    }),
  }
  return writes
}

describe('roundQuantity', () => {
  it('keeps kg and L in steps of 0.05', () => {
    expect(roundQuantity(0.3, 'kg')).toBe(0.3)
    expect(roundQuantity(0.2, 'L')).toBe(0.2)
    expect(roundQuantity(0.33, 'kg')).toBe(0.35)
    expect(roundQuantity(1.26, 'L')).toBe(1.25)
  })

  it('keeps gr and ml whole', () => {
    expect(roundQuantity(12.4, 'gr')).toBe(12)
    expect(roundQuantity(249.5, 'ml')).toBe(250)
    expect(roundQuantity(0.3, 'gr')).toBe(0)
  })

  it('keeps counts in steps of 0.5', () => {
    expect(roundQuantity(0.3, 'pcs')).toBe(0.5)
    expect(roundQuantity(0.2, 'pcs')).toBe(0)
    expect(roundQuantity(2.74, 'pack')).toBe(2.5)
    expect(roundQuantity(3, 'btl')).toBe(3)
  })

  it('understands old unit spellings', () => {
    expect(quantityStep('g')).toBe(1)
    expect(quantityStep('l')).toBe(0.05)
    expect(quantityStep('pc')).toBe(0.5)
  })

  it('turns negative or invalid values into 0', () => {
    expect(roundQuantity(-1, 'kg')).toBe(0)
    expect(roundQuantity('abc', 'pcs')).toBe(0)
    expect(roundQuantity('', 'gr')).toBe(0)
  })
})

describe('toBaseQuantity', () => {
  const rice = { unit: 'gr' }
  const water = { unit: 'btl', packaging_unit: 'case', quantity_per_pack: 12 }

  it('converts metric units', () => {
    expect(toBaseQuantity(rice, 1, 'kg')).toBe(1000)
    expect(toBaseQuantity({ unit: 'L' }, 500, 'ml')).toBe(0.5)
    expect(toBaseQuantity(rice, 250, 'g')).toBe(250)
  })

  it('converts multipacks by their size', () => {
    expect(toBaseQuantity(water, 2, 'case')).toBe(24)
    expect(toBaseQuantity(water, 3, 'btl')).toBe(3)
  })

  it("returns null instead of the raw number when it can't convert", () => {
    expect(toBaseQuantity(rice, 2, 'pack')).toBeNull()
    expect(toBaseQuantity(water, 2, 'box')).toBeNull()
    expect(toBaseQuantity({ unit: 'pcs' }, 1, 'kg')).toBeNull()
  })
})

describe('suggestedPurchase', () => {
  it("rounds up to the unit's step", () => {
    expect(suggestedPurchase({ unit: 'gr', current_stock: 100.4, min_stock: 250 })).toEqual({ quantity: 400, unit: 'gr' })
    expect(suggestedPurchase({ unit: 'kg', current_stock: 0, min_stock: 1.2 })).toEqual({ quantity: 2.4, unit: 'kg' })
  })

  it('buys whole packs for multipacks', () => {
    const water = { unit: 'btl', packaging_unit: 'case', quantity_per_pack: 12, current_stock: 2, min_stock: 6 }
    expect(suggestedPurchase(water)).toEqual({ quantity: 1, unit: 'case' })
  })
})

describe('pickDurableCategory', () => {
  const rows = [
    { id: 'p', name: 'Home & Appliances', parent_id: null },
    { id: 'k', name: 'Kitchen Appliances', parent_id: 'p' },
    { id: 'x', name: 'Air & Climate', parent_id: 'other-parent' },
  ]

  it('uses the sub-category named like the item sub-category', () => {
    expect(pickDurableCategory(rows, 'Kitchen Appliances')).toBe('k')
  })

  it('falls back to Home & Appliances itself', () => {
    expect(pickDurableCategory(rows, null)).toBe('p')
    expect(pickDurableCategory(rows, 'Air & Climate')).toBe('p')
  })

  it("never creates the category; it says to run the migration", () => {
    expect(() => pickDurableCategory([], null)).toThrow(/008_durable_category\.sql/)
  })
})

describe('stockLogEntries', () => {
  it('logs throwing away expired stock and the purchase separately', () => {
    // 2 expired yogurts thrown away, 4 bought: stock 2 → 4
    expect(
      stockLogEntries(2, 4, [
        { change: -2, reason: 'discarded' },
        { change: 4, reason: 'purchased' },
      ])
    ).toEqual([
      { change: -2, newStock: 0, reason: 'discarded' },
      { change: 4, newStock: 4, reason: 'purchased' },
    ])
  })

  it('logs only what really left when stock hits 0', () => {
    expect(stockLogEntries(1, 0, [{ change: -3, reason: 'used' }])).toEqual([{ change: -1, newStock: 0, reason: 'used' }])
  })

  it('skips parts that change nothing', () => {
    expect(
      stockLogEntries(3, 7, [
        { change: 0, reason: 'discarded' },
        { change: 4, reason: 'purchased' },
      ])
    ).toEqual([{ change: 4, newStock: 7, reason: 'purchased' }])
  })

  it("lines the stock up with what was saved, including someone else's change", () => {
    // Someone used 1 at the same moment: saved stock is 3, not 4.
    expect(
      stockLogEntries(2, 3, [
        { change: -2, reason: 'discarded' },
        { change: 4, reason: 'purchased' },
      ]).map((e) => e.newStock)
    ).toEqual([0, 3])
  })
})

describe('tapStep and stepQuantity', () => {
  it('change a quantity by a sensible amount for the unit', () => {
    expect(tapStep('pack')).toBe(1)
    expect(tapStep('kg')).toBe(0.5)
    expect(tapStep('gr')).toBe(100)
    expect(stepQuantity(3, 'pack', -1)).toBe(2)
    expect(stepQuantity(3, 'pack', 1)).toBe(4)
    expect(stepQuantity(1.5, 'kg', 1)).toBe(2)
    expect(stepQuantity(250, 'gr', -1)).toBe(150)
  })

  it("can't go to 0 or below", () => {
    expect(stepQuantity(1, 'pack', -1)).toBeNull()
    expect(stepQuantity(0.5, 'kg', -1)).toBeNull()
    expect(stepQuantity(1.5, 'pcs', -1)).toBe(0.5)
  })
})

describe('syncShoppingForItem', () => {
  const expired = { id: 'p1', name: 'TEST3', unit: 'pack', current_stock: 3, min_stock: 0, expiry_date: '2020-01-01', category_id: 'misc' }

  it("never changes a quantity already on the list (e.g. 3 pack lowered to 1 by hand)", async () => {
    const writes = fakeDb([{ id: 'g1', auto_generated: true }])
    await syncShoppingForItem(expired)
    expect(writes).toEqual([])
  })

  it('adds the suggested quantity only when the item is not on the list yet', async () => {
    const writes = fakeDb([])
    await syncShoppingForItem(expired)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ op: 'insert', table: 'grocery_items', rows: [{ quantity: 3, unit: 'pack', auto_generated: true }] })
  })

  it('removes the automatic entry once the item is fine again', async () => {
    const writes = fakeDb([{ id: 'g1', auto_generated: true }])
    await syncShoppingForItem({ ...expired, expiry_date: null })
    expect(writes).toEqual([{ op: 'delete', table: 'grocery_items' }])
  })
})
