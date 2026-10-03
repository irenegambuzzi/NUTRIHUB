import { describe, expect, it } from 'vitest'
import { lineTotal, unitPriceFromTotal } from './pricing'

describe('lineTotal', () => {
  it('is 0 without a price', () => {
    expect(lineTotal({ quantity: 3, unit: 'pcs' })).toBe(0)
    expect(lineTotal({ price: 0, quantity: 3, unit: 'pcs' })).toBe(0)
  })

  it('uses the row unit when there is no price basis', () => {
    expect(lineTotal({ price: 1, quantity: 10, unit: 'can' })).toBe(10)
    expect(lineTotal({ price: 1.99, quantity: 3, unit: 'pcs' })).toBe(5.97)
  })

  it('converts the quantity into the price basis', () => {
    // 1 kg at €2.50 per 500 gr
    expect(lineTotal({ price: 2.5, price_qty: 500, price_unit: 'gr', quantity: 1, unit: 'kg' })).toBe(5)
    // 750 ml at €1.20 per L
    expect(lineTotal({ price: 1.2, price_qty: 1, price_unit: 'L', quantity: 750, unit: 'ml' })).toBe(0.9)
  })

  it('converts through a multipack', () => {
    const pack = { unit: 'btl', packaging_unit: 'case', quantity_per_pack: 6 }
    // 12 bottles at €3 per case of 6
    expect(lineTotal({ price: 3, price_qty: 1, price_unit: 'case', quantity: 12, unit: 'btl' }, pack)).toBe(6)
    // 2 cases at €0.50 per bottle
    expect(lineTotal({ price: 0.5, price_qty: 1, price_unit: 'btl', quantity: 2, unit: 'case' }, pack)).toBe(6)
  })

  it("is null, not a guess, when the units can't be converted", () => {
    // 2 pack at €0.01 per gr, with no pack size known
    expect(lineTotal({ price: 0.01, price_qty: 1, price_unit: 'gr', quantity: 2, unit: 'pack' })).toBeNull()
    expect(lineTotal({ price: 1, price_qty: 1, price_unit: 'gr', quantity: 2, unit: 'pack' }, { unit: 'gr' })).toBeNull()
    expect(lineTotal({ price: 2, price_qty: 1, price_unit: 'kg', quantity: 3, unit: 'pcs' })).toBeNull()
  })

  it('works once the pack size is known', () => {
    const pack = { unit: 'gr', packaging_unit: 'pack', quantity_per_pack: 500 }
    expect(lineTotal({ price: 0.01, price_qty: 1, price_unit: 'gr', quantity: 2, unit: 'pack' }, pack)).toBe(10)
  })

  it('rounds to cents', () => {
    expect(lineTotal({ price: 1, price_qty: 3, price_unit: 'pcs', quantity: 1, unit: 'pcs' })).toBe(0.33)
  })
})

describe('unitPriceFromTotal', () => {
  it('turns a line total back into the unit price', () => {
    expect(unitPriceFromTotal(5, { price_qty: 500, price_unit: 'gr', quantity: 1, unit: 'kg' })).toBe(2.5)
    expect(unitPriceFromTotal(10, { quantity: 10, unit: 'can' })).toBe(1)
  })

  it("is null when the units can't be converted", () => {
    expect(unitPriceFromTotal(5, { price_qty: 1, price_unit: 'gr', quantity: 2, unit: 'pack' })).toBeNull()
  })
})
