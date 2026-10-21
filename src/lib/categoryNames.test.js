import { describe, expect, it } from 'vitest'
import { editDistance, findExisting, freeNameSuggestions, nameDistance, nameKey, sameName, similarCategories, similarName, synonymsOf, takenMessage } from './categoryNames'

const categories = [
  { id: 'shopping', name: 'Shopping', parent_id: null },
  { id: 'gifts', name: 'Gifts', parent_id: 'shopping' },
  { id: 'dairy', name: 'Dairy & Eggs', parent_id: null },
  { id: 'holiday', name: 'Holiday', parent_id: null },
]

describe('similar names', () => {
  it.each([
    ['Gifts', 'gift'],
    ['  GIFTS ', 'gifts'],
    ['Dairy & Eggs', 'dairy and eggs'],
    ['Dairy  &  Eggs', 'Dairy and Egg'],
    ['Café', 'cafe'],
    ['Berries', 'berry'],
  ])('"%s" and "%s" are the same name', (a, b) => {
    expect(similarName(a, b)).toBe(true)
  })

  it('different names are not similar', () => {
    expect(similarName('Gifts', 'Gift cards')).toBe(false)
    expect(similarName('', '')).toBe(false)
    expect(nameKey('Dairy & Eggs')).toBe('dairy and egg')
  })

  it('sameName ignores only capitals, accents and spaces (not plurals)', () => {
    expect(sameName(' gifts ', 'GIFTS')).toBe(true)
    expect(sameName('Gift', 'Gifts')).toBe(false)
  })
})

describe('findExisting (the cross-check before "+ New category")', () => {
  it('finds a similar name at any level, so the existing chip is shown instead', () => {
    expect(findExisting('Gift', categories)?.id).toBe('gifts')
    expect(findExisting('dairy and eggs', categories)?.id).toBe('dairy')
  })

  it('an exact match wins over a similar one', () => {
    const list = [...categories, { id: 'gift', name: 'Gift', parent_id: 'holiday' }]
    expect(findExisting('Gift', list)?.id).toBe('gift')
  })

  it('returns null when nothing is similar or the name is empty', () => {
    expect(findExisting('Kefir', categories)).toBeNull()
    expect(findExisting('  ', categories)).toBeNull()
  })
})

describe('typo distance (Damerau-Levenshtein)', () => {
  it.each([
    ['gift', 'gift', 0],
    ['gfit', 'gift', 1], // two neighbouring letters swapped
    ['git', 'gift', 1], // a letter missing
    ['gifft', 'gift', 1], // a letter extra
    ['gafts', 'gifts', 1], // a letter wrong
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
  ])('%s → %s is %i', (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance)
  })

  it('allows 1 typo for names of 4 letters or fewer, 2 for longer ones', () => {
    expect(nameDistance('Car', 'Cart')).toBe(1)
    expect(nameDistance('Cat', 'Cart')).toBe(1)
    expect(nameDistance('Cabs', 'Cart')).toBeNull() // 2 apart, short names
    expect(nameDistance('Resturant', 'Restaurant')).toBe(1)
    expect(nameDistance('Restarant', 'Restaurant')).toBe(1)
    expect(nameDistance('Resturnat', 'Restaurant')).toBe(2)
    expect(nameDistance('Garden', 'Gardening')).toBeNull() // 3 apart
    expect(nameDistance('', 'Gifts')).toBeNull()
  })

  it('"Gfits", "Gits" and "Giffts" are all similar to "Gifts"', () => {
    for (const typo of ['Gfits', 'Gits', 'Giffts']) expect(similarCategories(typo, categories).map((c) => c.id)).toEqual(['gifts'])
  })

  it('shows at most 3, closest first, and never the category being renamed', () => {
    const list = [
      { id: 'a', name: 'Gifte', parent_id: null }, // 1 away
      { id: 'b', name: 'Gift', parent_id: null }, // same name once singular
      { id: 'c', name: 'Gifta', parent_id: null },
      { id: 'd', name: 'Giftz', parent_id: null },
      { id: 'e', name: 'Hats', parent_id: null },
    ]
    expect(similarCategories('Gifts', list).map((c) => c.id)).toEqual(['b', 'a', 'c'])
    expect(similarCategories('Gifts', list, { exceptId: 'b' }).map((c) => c.id)).toEqual(['a', 'c', 'd'])
    expect(similarCategories('Gifts', list, { limit: 1 }).map((c) => c.id)).toEqual(['b'])
  })

  it('a different word is not similar', () => {
    expect(similarCategories('Kefir', categories)).toEqual([])
    expect(similarCategories('  ', categories)).toEqual([])
  })
})

describe('the "already exists" message', () => {
  it('says where the name is used', () => {
    expect(takenMessage('Gifts', categories[1], categories)).toBe('Gifts already exists in Shopping')
    expect(takenMessage('Holiday', categories[3], categories)).toBe('Holiday already exists as a main category')
  })
})

describe('free name suggestions', () => {
  const taken = (name) => categories.some((c) => sameName(c.name, name))

  it('offers "<main> <name>" and a synonym, both free', () => {
    expect(freeNameSuggestions('Gifts', 'Holiday', taken)).toEqual(['Holiday Gifts', 'Souvenirs'])
  })

  it('never offers a name that is taken', () => {
    const more = [...categories, { id: 'x', name: 'Holiday Gifts', parent_id: 'holiday' }, { id: 'y', name: 'Souvenirs', parent_id: null }]
    const isTaken = (name) => more.some((c) => sameName(c.name, name))
    const out = freeNameSuggestions('Gifts', 'Holiday', isTaken)
    expect(out).toEqual(['Presents'])
    expect(out.every((n) => !isTaken(n))).toBe(true)
  })

  it('has at most two, and only the synonym for a new main category', () => {
    expect(freeNameSuggestions('Gifts', 'Holiday', () => false)).toHaveLength(2)
    expect(freeNameSuggestions('Gifts', null, taken)).toEqual(['Souvenirs', 'Presents'])
  })

  it('has built-in pairs such as Restaurant → Dining and Electronics → Gadgets', () => {
    expect(synonymsOf('Restaurant')[0]).toBe('Dining')
    expect(synonymsOf('electronics')[0]).toBe('Gadgets')
    expect(synonymsOf('Kefir')).toEqual([])
  })

  it('nothing for an empty name', () => {
    expect(freeNameSuggestions('', 'Holiday', taken)).toEqual([])
  })
})
