import { describe, expect, it } from 'vitest'
import { buildSuggestions, matchSuggestions } from './nameSuggestions'

const pantry = [
  { id: 'p1', name: 'Milk', category_id: 'beverages', subcategory_id: 'beverages:milk', unit: 'btl', price: 1.2, price_qty: 1, price_unit: 'btl', payer: 'akbar' },
  { id: 'p2', name: 'Oat milk', category_id: 'beverages', subcategory_id: null, unit: 'btl', price: 0, payer: null },
]
const list = [
  { id: 'g1', name: 'milk', category_id: 'misc', unit: 'pcs', price: 9, created_at: '2', pantry_item_id: null },
  { id: 'g2', name: 'Vacuum cleaner', category_id: 'appliances', subcategory_id: 'appliances:cleaning', unit: 'pcs', price: 150, payer: 'irene', created_at: '1' },
]

describe('buildSuggestions', () => {
  it('fills in what the pantry knows: category, unit, last price — never its payer (plan 9P K226)', () => {
    const milk = buildSuggestions(pantry, list).find((s) => s.name === 'Milk')
    expect(milk).toMatchObject({
      categoryId: 'beverages',
      subcategoryId: 'beverages:milk',
      unit: 'btl',
      price: 1.2,
      priceQty: 1,
      priceUnit: 'btl',
      payer: '',
      pantryItemId: 'p1',
      source: 'pantry',
    })
  })

  it('has one suggestion per name, and keeps list-only items like appliances', () => {
    const names = buildSuggestions(pantry, list).map((s) => s.name)
    expect(names).toEqual(['Milk', 'Oat milk', 'Vacuum cleaner'])
  })

  it('no payer and no price', () => {
    expect(buildSuggestions(pantry, []).find((s) => s.name === 'Oat milk')).toMatchObject({ payer: '', price: 0, priceQty: null })
    expect(buildSuggestions([], list).find((s) => s.name === 'Vacuum cleaner')).toMatchObject({ payer: '' })
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
