import { describe, expect, it } from 'vitest'
import { guessCategory } from './categoryGuess'

const sub = (name) => guessCategory(name)?.subcategoryId
const parent = (name) => guessCategory(name)?.categoryId

describe('guessCategory', () => {
  it('only matches short keywords as whole words', () => {
    expect(guessCategory('TEST')).toBeNull()
    expect(guessCategory('Testo')).toBeNull()
    expect(sub('steak')).toBe('meat:beef')
  })

  it('lets a specific phrase beat the single words inside it', () => {
    expect(parent('air freshener')).toBe('household')
    expect(sub('tea tree oil')).toBe('personal-care:skin')
    expect(sub('latte detergente')).toBe('personal-care:skin')
    expect(sub('olio per bambini')).toBe('personal-care:skin')
    expect(parent('Deodorante per ambienti')).toBe('household')
    expect(sub('vacuum cleaner')).toBe('appliances:cleaning')
    expect(sub('carta forno')).toBe('household:paper')
    expect(sub('pasta gigi')).toBe('toiletries:oral')
    expect(sub('Rice cooker')).toBe('appliances:kitchen')
    expect(sub('Air purifier')).toBe('appliances:air')
  })

  it("doesn't put car supplies with cooking oils", () => {
    expect(sub('spray olio motore')).not.toBe('pantry-staples:oils')
    expect(parent('spray olio motore')).toBe('misc')
  })

  it('still recognises the plain words', () => {
    expect(sub('Latte')).toBe('beverages:milk')
    expect(sub('Olio extra vergine')).toBe('pantry-staples:oils')
    expect(sub('Deodorant')).toBe('personal-care:deodorant')
    expect(sub('Green tea')).toBe('beverages:coffee-tea')
    expect(sub('Chicken wings')).toBe('meat:poultry')
    expect(sub('Detersivo piatti')).toBe('cleaning:dish')
  })

  it('accepts ambiguous short words only as the whole name', () => {
    expect(sub('Air')).toBe('beverages:water')
    expect(sub('Air 1,5 L')).toBe('beverages:water')
    expect(sub('Te')).toBe('beverages:coffee-tea')
    expect(sub('Sale')).toBe('pantry-staples:spices')
    expect(guessCategory('air conditioner filter')?.subcategoryId).toBe('appliances:air')
    expect(guessCategory('sale per lavastoviglie')?.subcategoryId).toBe('cleaning:dish')
  })

  it('prefers the word that says what the product is', () => {
    expect(sub('Beef Mix Seasoning')).toBe('pantry-staples:spices')
    expect(sub("Tonno all'olio")).toBe('canned:fish-meat')
  })

  it("doesn't guess when the name points to different categories", () => {
    expect(guessCategory('chocolate milk')).toBeNull()
  })

  it('ignores empty and one-letter names', () => {
    expect(guessCategory('')).toBeNull()
    expect(guessCategory(' a ')).toBeNull()
    expect(guessCategory(null)).toBeNull()
  })
})
