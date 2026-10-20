import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { lastPriceFor } = await import('./lastPrice')

const line = (extra) => ({ name: 'Nutella', line_total: 3, list_total: null, quantity: 750, unit: 'gr', created_at: '2026-10-10T10:00:00Z', ...extra })

describe('the last normal price of a name', () => {
  it('is the price before the discount (list_total), for the quantity and unit it was bought in', () => {
    // €6.00 −50% → paid €3.00: next time €6.00 fills in
    const last = lastPriceFor('nutella', { tripLines: [line({ list_total: 6 })] })
    expect(last).toMatchObject({ price: 6, quantity: 750, unit: 'gr' })
  })

  it('uses line_total while there is no discount info (before round 6)', () => {
    expect(lastPriceFor('Nutella', { tripLines: [line()] })).toMatchObject({ price: 3 })
  })

  it('takes quantity and unit from the SHOP snapshot of an older line', () => {
    const old = line({ quantity: null, unit: null, grocery_snapshot: { quantity: 2, unit: 'pack' } })
    expect(lastPriceFor('Nutella', { tripLines: [old] })).toMatchObject({ quantity: 2, unit: 'pack' })
  })

  it('the most recent of purchase line, order and HOME item wins', () => {
    const order = { item_name: 'Nutella', price: 5, list_price: 8, quantity: 1, unit: 'pcs', status: 'arrived', created_at: '2026-10-15T10:00:00Z' }
    const pantry = { name: 'Nutella', price: 4, price_qty: 1, price_unit: 'pcs', unit: 'pcs', updated_at: '2026-10-01T10:00:00Z' }
    expect(lastPriceFor('Nutella', { tripLines: [line()], orders: [order], pantryItems: [pantry] })).toMatchObject({ price: 8, source: 'order' })
    const later = { ...pantry, updated_at: '2026-10-19T10:00:00Z' }
    expect(lastPriceFor('Nutella', { tripLines: [line()], orders: [order], pantryItems: [later] })).toMatchObject({ price: 4, source: 'pantry', unit: 'pcs' })
  })

  it('uses the HOME item price for its price quantity and unit', () => {
    const pantry = { name: 'Rice', price: 2.5, price_qty: 500, price_unit: 'gr', unit: 'gr', updated_at: '2026-10-01T10:00:00Z' }
    expect(lastPriceFor('rice', { pantryItems: [pantry] })).toMatchObject({ price: 2.5, quantity: 500, unit: 'gr' })
  })

  it('maps an old unit spelling to the current one', () => {
    expect(lastPriceFor('Nutella', { tripLines: [line({ unit: 'g' })] }).unit).toBe('gr')
  })

  it('knows nothing for a new name, a free line or a cancelled order; groups are not items', () => {
    expect(lastPriceFor('Kefir', { tripLines: [line()] })).toBeNull()
    expect(lastPriceFor('Nutella', { tripLines: [line({ line_total: 0 })] })).toBeNull()
    expect(lastPriceFor('Nutella', { orders: [{ item_name: 'Nutella', price: 5, quantity: 1, unit: 'pcs', status: 'cancelled' }] })).toBeNull()
    expect(lastPriceFor('Chips', { pantryItems: [{ name: 'Chips', is_group: true, price: 3, unit: 'pack' }] })).toBeNull()
    expect(lastPriceFor('', { tripLines: [line()] })).toBeNull()
  })
})
