import { describe, expect, it } from 'vitest'
import { buildSuggestions, matchSuggestions } from './quickAdd'

const pantry = [
  { id: 'p1', name: 'Milk', category_id: 'beverages', subcategory_id: 'beverages:milk', unit: 'btl', price: 1.2, price_qty: 1, price_unit: 'btl', payer: 'akbar' },
  { id: 'p2', name: 'Oat milk', category_id: 'beverages', subcategory_id: null, unit: 'btl', price: 0, payer: null },
]
const list = [
  { id: 'g1', name: 'milk', category_id: 'misc', unit: 'pcs', price: 9, created_at: '2', pantry_item_id: null },
  { id: 'g2', name: 'Vacuum cleaner', category_id: 'appliances', subcategory_id: 'appliances:cleaning', unit: 'pcs', price: 150, payer: 'irene', created_at: '1' },
]

describe('buildSuggestions', () => {
  it('fills in what the pantry knows: category, unit, last price, payer', () => {
    const milk = buildSuggestions(pantry, list).find((s) => s.name === 'Milk')
    expect(milk).toMatchObject({
      categoryId: 'beverages',
      subcategoryId: 'beverages:milk',
      unit: 'btl',
      price: 1.2,
      priceQty: 1,
      priceUnit: 'btl',
      payer: 'akbar',
      pantryItemId: 'p1',
      source: 'pantry',
    })
  })

  it('has one suggestion per name, and keeps list-only items like appliances', () => {
    const names = buildSuggestions(pantry, list).map((s) => s.name)
    expect(names).toEqual(['Milk', 'Oat milk', 'Vacuum cleaner'])
  })

  it('falls back to "shared" and no price', () => {
    expect(buildSuggestions(pantry, []).find((s) => s.name === 'Oat milk')).toMatchObject({ payer: 'shared', price: 0, priceQty: null })
  })

  it('adds names from this phone’s history last', () => {
    const history = [{ name: 'Light bulbs', categoryId: 'household', unit: 'pcs', price: 0, payer: 'shared' }]
    expect(buildSuggestions([], [], history)[0]).toMatchObject({ name: 'Light bulbs', source: 'history' })
  })
})

describe('matchSuggestions', () => {
  const all = buildSuggestions(pantry, list)
  it('puts names starting with the text first, then word starts, then the rest', () => {
    expect(matchSuggestions(all, 'mi').map((s) => s.name)).toEqual(['Milk', 'Oat milk'])
    expect(matchSuggestions(all, 'clean').map((s) => s.name)).toEqual(['Vacuum cleaner'])
    expect(matchSuggestions(all, 'ilk').map((s) => s.name)).toEqual(['Milk', 'Oat milk'])
  })

  it('suggests nothing for an empty box', () => {
    expect(matchSuggestions(all, '  ')).toEqual([])
  })
})
