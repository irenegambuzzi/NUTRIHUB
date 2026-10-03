import { afterEach, describe, expect, it } from 'vitest'
import { ASYNC_SUGGESTERS, suggestCategory, suggestCategoryAsync, worthRemembering } from './categorySuggest'

const parents = [{ id: 'frozen' }, { id: 'snacks' }, { id: 'dairy' }, { id: 'my-stuff' }]
const subsByParent = new Map([
  ['frozen', [{ id: 'frozen:ice-cream' }]],
  ['snacks', [{ id: 'snacks:sweet' }]],
  ['dairy', []],
])
const context = (extra = {}) => ({ memory: new Map(), pantryByName: new Map(), parents, subsByParent, ...extra })

describe('suggestCategory', () => {
  it('uses the keyword list when nothing else is known', () => {
    expect(suggestCategory('Ice cream', context())).toEqual({ categoryId: 'frozen', subcategoryId: 'frozen:ice-cream', source: 'keywords' })
  })

  it('prefers what was picked by hand for the name, however it is written', () => {
    const memory = new Map([['ice cream', { category_id: 'my-stuff', subcategory_id: null }]])
    expect(suggestCategory('Ice-Cream 500g', context({ memory }))).toEqual({ categoryId: 'my-stuff', subcategoryId: null, source: 'memory' })
  })

  it('then the pantry item with the same name', () => {
    const pantryByName = new Map([['bounty', { category_id: 'snacks', subcategory_id: 'snacks:sweet' }]])
    expect(suggestCategory('Bounty', context({ pantryByName }))).toMatchObject({ categoryId: 'snacks', source: 'pantry' })
  })

  it("never makes one up: nothing when there's no match", () => {
    expect(suggestCategory('Stuff for Marco', context())).toBeNull()
  })

  it('skips categories that are not on offer, and sub-categories that do not belong', () => {
    expect(suggestCategory('Shampoo', context())).toBeNull()
    const memory = new Map([['yogurt', { category_id: 'dairy', subcategory_id: 'snacks:sweet' }]])
    expect(suggestCategory('Yogurt', context({ memory }))).toEqual({ categoryId: 'dairy', subcategoryId: null, source: 'memory' })
  })
})

describe('suggestCategoryAsync', () => {
  afterEach(() => ASYNC_SUGGESTERS.splice(0))

  it('asks the slower layers (e.g. a future AI one) only when the quick ones have no answer', async () => {
    const calls = []
    ASYNC_SUGGESTERS.push({ source: 'ai', suggest: async (name) => (calls.push(name), { categoryId: 'snacks', subcategoryId: null }) })
    expect(await suggestCategoryAsync('Ice cream', context())).toMatchObject({ source: 'keywords' })
    expect(await suggestCategoryAsync('Stuff for Marco', context())).toEqual({ categoryId: 'snacks', subcategoryId: null, source: 'ai' })
    expect(calls).toEqual(['Stuff for Marco'])
  })
})

describe('worthRemembering', () => {
  it('remembers a pick the keywords would get wrong or not know', () => {
    expect(worthRemembering('Bounty bar', 'my-stuff', null, new Map())).toBe(true)
    expect(worthRemembering('Stuff for Marco', 'my-stuff', null, new Map())).toBe(true)
  })

  it("doesn't store what the keywords already say", () => {
    expect(worthRemembering('Ice cream', 'frozen', 'frozen:ice-cream', new Map())).toBe(false)
  })

  it('updates a remembered pick only when it changes', () => {
    const memory = new Map([['bounty', { category_id: 'snacks', subcategory_id: null }]])
    expect(worthRemembering('Bounty', 'snacks', null, memory)).toBe(false)
    expect(worthRemembering('Bounty', 'snacks', 'snacks:sweet', memory)).toBe(true)
  })
})
