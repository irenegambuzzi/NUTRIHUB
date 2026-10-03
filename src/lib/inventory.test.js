import { describe, expect, it, vi } from 'vitest'

// inventory.js imports the Supabase client, which needs env variables.
vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { quantityStep, roundQuantity, suggestedPurchase, toBaseQuantity } = await import('./inventory')

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
