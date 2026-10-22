import { afterEach, describe, expect, it } from 'vitest'
import { ASYNC_SUGGESTERS, budgetAutoFill, differsFromFirst, suggestBudgetCategories, suggestCategories, suggestCategoriesAsync, suggestCategory, suggestCategoryAsync, worthRemembering } from './categorySuggest'
import { LIVE_MONEY_CATEGORIES, MONEY_CATEGORIES_024 } from '../data/moneyCategories.fixture'

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

describe('suggestCategory when categories were deleted, merged or renamed', () => {
  const live = (parentIds, subs = {}) => ({
    parents: parentIds.map((id) => ({ id })),
    subsByParent: new Map(parentIds.map((id) => [id, (subs[id] || []).map((s) => ({ id: s }))])),
  })
  const ctx = (c) => ({ memory: new Map(), pantryByName: new Map(), ...c })

  it('suggests the main category alone when the sub-category is gone', () => {
    expect(suggestCategory('Ice cream', ctx(live(['frozen'], { frozen: ['frozen:meals'] })))).toEqual({ categoryId: 'frozen', subcategoryId: null, source: 'keywords' })
  })

  it('gives no chip at all when the main category is gone', () => {
    expect(suggestCategory('Ice cream', ctx(live(['snacks'])))).toBeNull()
  })

  it('does not throw for a rule pointing to a missing category', () => {
    expect(() => suggestCategory('pizza', ctx(live([])))).not.toThrow()
  })

  it('remembers a hand pick that the filtered keywords would not have suggested', () => {
    const available = live(['frozen'], { frozen: ['frozen:meals'] })
    // The rule says frozen:ice-cream, but that sub is gone: the suggestion was "Frozen Food" alone.
    expect(worthRemembering('Ice cream', 'frozen', null, new Map(), available)).toBe(false)
    expect(worthRemembering('Ice cream', 'frozen', 'frozen:meals', new Map(), available)).toBe(true)
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

describe('suggestCategories (the chips)', () => {
  const named = {
    parents: [
      { id: 'frozen', name: 'Frozen Food' },
      { id: 'dairy', name: 'Dairy & Eggs' },
      { id: 'shopping', name: 'Shopping' },
    ],
    subsByParent: new Map([
      ['frozen', [{ id: 'frozen:meals', name: 'Frozen Meals & Pizza' }]],
      ['dairy', [{ id: 'dairy:yogurt', name: 'Yogurt & Desserts' }]],
      ['shopping', [{ id: 'shopping:gifts', name: 'Gifts' }]],
    ]),
  }
  const ctx = (extra = {}) => ({ memory: new Map(), pantryByName: new Map(), ...named, ...extra })

  it('"pizza" → Frozen Food › Frozen Meals & Pizza, with the same result shape as every answer', () => {
    const [first] = suggestCategories('pizza', ctx())
    expect(first).toEqual({ categoryId: 'frozen', subcategoryId: 'frozen:meals', expenseCategoryId: null, source: 'keywords', label: 'Frozen Food › Frozen Meals & Pizza' })
  })

  it('tries memory first, then the pantry, then the keywords; no duplicates; at most 3', () => {
    const memory = new Map([['pizza', { category_id: 'shopping', subcategory_id: null }]])
    const pantryByName = new Map([['pizza', { category_id: 'dairy', subcategory_id: 'dairy:yogurt' }]])
    const chips = suggestCategories('Pizza', ctx({ memory, pantryByName }))
    expect(chips.map((c) => c.source)).toEqual(['memory', 'pantry', 'keywords'])
    expect(chips.map((c) => c.categoryId)).toEqual(['shopping', 'dairy', 'frozen'])
    expect(suggestCategories('Pizza', ctx({ memory, pantryByName }), { limit: 2 })).toHaveLength(2)
    const same = suggestCategories('pizza', ctx({ memory: new Map([['pizza', { category_id: 'frozen', subcategory_id: 'frozen:meals' }]]) }))
    expect(same.filter((c) => c.categoryId === 'frozen' && c.subcategoryId === 'frozen:meals')).toHaveLength(1)
  })

  it('only offers categories that really exist (a deleted one is skipped, a missing sub falls back to the main)', () => {
    const memory = new Map([['pizza', { category_id: 'gone', subcategory_id: null }]])
    expect(suggestCategories('pizza', ctx({ memory }))[0]).toMatchObject({ categoryId: 'frozen', source: 'keywords' })
    const noSub = { parents: [{ id: 'frozen', name: 'Frozen Food' }], subsByParent: new Map([['frozen', []]]) }
    expect(suggestCategories('pizza', ctx(noSub))[0]).toMatchObject({ categoryId: 'frozen', subcategoryId: null, label: 'Frozen Food' })
  })

  it('shows no guessed chip when nothing matches', () => {
    expect(suggestCategories('Stuff for Marco', ctx())).toEqual([])
    expect(suggestCategories('', ctx())).toEqual([])
  })

  it('a similar name of an existing category is shown as that chip instead of a new one', () => {
    const chips = suggestCategories('Gift', ctx())
    expect(chips).toEqual([expect.objectContaining({ categoryId: 'shopping', subcategoryId: 'shopping:gifts', source: 'name', label: 'Shopping › Gifts' })])
  })

  it('what someone picked for a name comes first next time', () => {
    const memory = new Map([['test kefir', { category_id: 'shopping', subcategory_id: 'shopping:gifts' }]])
    expect(suggestCategories('Test kefir', ctx({ memory }))[0]).toMatchObject({ categoryId: 'shopping', source: 'memory' })
  })

  it('the async door adds nothing before round 8 (no AI suggester)', async () => {
    expect(ASYNC_SUGGESTERS).toEqual([])
    expect(await suggestCategoriesAsync('Stuff for Marco', ctx())).toEqual([])
    expect((await suggestCategoriesAsync('pizza', ctx()))[0].categoryId).toBe('frozen')
  })
})

describe('suggestBudgetCategories (a MONEY row not added to HOME)', () => {
  const expenseCategories = [
    { id: 'groceries', name: 'Groceries', parent_id: null },
    { id: 'shopping', name: 'Shopping', parent_id: null },
    { id: 'gifts', name: 'Gifts', parent_id: 'shopping' },
  ]
  const base = {
    memory: new Map(),
    pantryByName: new Map(),
    parents: [{ id: 'frozen', name: 'Frozen Food' }],
    subsByParent: new Map([['frozen', []]]),
    expenseCategories,
    budgetFor: () => 'groceries',
  }

  it('gives budget categories in the same shape: the remembered one first, then the HOME suggestion through the mapping', () => {
    const memory = new Map([['pizza', { category_id: null, expense_category_id: 'gifts' }]])
    const chips = suggestBudgetCategories('Pizza', { ...base, memory })
    expect(chips).toEqual([
      { categoryId: null, subcategoryId: null, expenseCategoryId: 'gifts', source: 'memory', label: 'Shopping › Gifts' },
      { categoryId: null, subcategoryId: null, expenseCategoryId: 'groceries', source: 'keywords', label: 'Groceries' },
    ])
  })

  it('a similar name matches an existing budget category: "Gift" → Shopping › Gifts', () => {
    expect(suggestBudgetCategories('Gift', base)).toEqual([expect.objectContaining({ expenseCategoryId: 'gifts', source: 'name' })])
  })

  it('only budget categories that exist; none for an unknown name', () => {
    const memory = new Map([['pizza', { expense_category_id: 'deleted' }]])
    expect(suggestBudgetCategories('Pizza', { ...base, memory }).map((c) => c.expenseCategoryId)).toEqual(['groceries'])
    expect(suggestBudgetCategories('Stuff for Marco', base)).toEqual([])
  })
})

describe('learning from a different pick', () => {
  const chips = [{ categoryId: 'a', subcategoryId: null, expenseCategoryId: null }, { categoryId: 'b', subcategoryId: null, expenseCategoryId: null }]

  it('a pick other than the first chip is worth remembering; the first chip is not', () => {
    expect(differsFromFirst({ categoryId: 'b', subcategoryId: null, expenseCategoryId: null }, chips)).toBe(true)
    expect(differsFromFirst({ categoryId: 'a', subcategoryId: null, expenseCategoryId: null }, chips)).toBe(false)
    expect(differsFromFirst({ categoryId: 'a', subcategoryId: 's', expenseCategoryId: null }, chips)).toBe(true)
  })

  it('a pick with no chip on offer is remembered; a budget pick is compared by its budget category', () => {
    expect(differsFromFirst({ categoryId: 'a' }, [])).toBe(true)
    const budget = [{ categoryId: null, subcategoryId: null, expenseCategoryId: 'groceries' }]
    expect(differsFromFirst({ categoryId: null, subcategoryId: null, expenseCategoryId: 'groceries' }, budget)).toBe(false)
    expect(differsFromFirst({ categoryId: null, subcategoryId: null, expenseCategoryId: 'gifts' }, budget)).toBe(true)
  })
})

describe('round 6C: MONEY keywords for a row not added to HOME (by id, so renames never break them)', () => {
  const live = [...LIVE_MONEY_CATEGORIES, ...MONEY_CATEGORIES_024]
  const groceries = live.find((c) => c.name === 'Groceries').id
  const context = (expenseCategories = live) => ({
    memory: new Map(),
    pantryByName: new Map(),
    parents: [{ id: 'household', name: 'Household Supplies' }],
    subsByParent: new Map([['household', [{ id: 'household:batteries', name: 'Batteries & Bulbs' }]]]),
    expenseCategories,
    budgetFor: () => groceries,
  })
  const labels = (name, ctx = context()) => suggestBudgetCategories(name, ctx).map((c) => c.label)
  const first = (name, ctx) => labels(name, ctx)[0]

  it.each([
    ['Benzina', 'Car / Vehicle › Fuel'],
    ['Netflix', 'Subscription › Streaming'],
    ['Veterinario', 'Pets › Veterinary'],
    ['Marca da bollo', 'Bank & Fee › Taxes & Fines'],
    ['Bollo auto', 'Car / Vehicle › Insurance & Tax'],
    ['Bolletta luce', 'Housing & Utilities › Electricity'],
    ['Rent a car Hertz', 'Trips & Holidays › Transport'],
    ['Affitto', 'Housing & Utilities › Rent'],
    ['Sewa mobil', 'Trips & Holidays › Transport'],
    ['Hotel Bali', 'Trips & Holidays › Accommodation'],
    ['Booking.com', 'Trips & Holidays › Accommodation'],
    ['B&B La Rosa', 'Trips & Holidays › Accommodation'],
    ['Agriturismo', 'Trips & Holidays › Accommodation'],
    ['Uber Eats', 'Going out › Takeaway & Delivery'],
    ['Taxi aeroporto', 'Trips & Holidays › Transport'],
    ['Ryanair BLQ–BCN', 'Trips & Holidays › Flights'],
    ['Remitly', 'Family Support'],
    ['Western Union', 'Family Support'],
    ['Wise', 'Family Support'],
    ['Commissione bonifico', 'Bank & Fee'],
    ['Parrucchiere', 'Personal Care › Hairdresser'],
    ['Museo Egizio', 'Entertainment › Cinema & Events'],
  ])('%s → %s', (name, expected) => {
    expect(first(name)).toBe(expected)
  })

  it('weak words count only as the whole name', () => {
    expect(labels('Lampadina luce LED')).not.toContain('Housing & Utilities › Electricity')
    expect(first('Lampadina luce LED')).toBe('Groceries')
    expect(labels('Rent a car Hertz')).not.toContain('Housing & Utilities › Rent')
    expect(labels('Sewa mobil')).not.toContain('Housing & Utilities › Rent')
    expect(labels('Cena agriturismo')).not.toContain('Trips & Holidays › Accommodation')
    expect(labels('Uber Eats')).not.toContain('Trips & Holidays › Transport')
    expect(labels('Protein bar')).not.toContain('Going out › Bar & Coffee')
  })

  it('Remitly, Western Union and Wise are no longer Bank & Fee', () => {
    for (const name of ['Remitly', 'Western Union', 'Wise']) expect(labels(name)).not.toContain('Bank & Fee')
  })

  it('a sub that is missing falls back to its main; a main that is missing is ignored', () => {
    const before024 = LIVE_MONEY_CATEGORIES
    expect(first('Ryanair', context(before024))).toBe('Trips & Holidays')
    expect(labels('Remitly', context(before024))).toEqual([])
    expect(first('Netflix', context(before024))).toBe('Subscription')
    const noTaxes = live.filter((c) => c.name !== 'Taxes & Fines')
    expect(first('Marca da bollo', context(noTaxes))).toBe('Bank & Fee')
  })

  it('chips show the names as they are now: Trips renamed "Travel", Family Support renamed "Family"', () => {
    const renamed = live.map((c) => (c.name === 'Trips & Holidays' ? { ...c, name: 'Travel' } : c.name === 'Family Support' ? { ...c, name: 'Family' } : c))
    expect(first('Ryanair', context(renamed))).toBe('Travel › Flights')
    expect(first('Remitly', context(renamed))).toBe('Family')
  })

  it('what was remembered for the name still comes first', () => {
    const memory = new Map([['benzina', { expense_category_id: groceries }]])
    expect(labels('Benzina', { ...context(), memory })).toEqual(['Groceries', 'Car / Vehicle › Fuel'])
  })

  describe('round 6C2: the first chip fills the budget category in by itself', () => {
    const auto = (name, ctx = context()) => budgetAutoFill(suggestBudgetCategories(name, ctx))?.label ?? null

    it('"Ryanair" → Trips & Holidays › Flights (MONEY keywords)', () => {
      expect(auto('Ryanair')).toBe('Trips & Holidays › Flights')
    })

    it('"Lampadina luce LED" → Groceries (Household Supplies › Batteries & Bulbs through the mapping), not Electricity', () => {
      expect(auto('Lampadina luce LED')).toBe('Groceries')
    })

    it('what was remembered for the name wins', () => {
      const memory = new Map([['benzina', { expense_category_id: groceries }]])
      expect(auto('Benzina', { ...context(), memory })).toBe('Groceries')
    })

    it('nothing without a chip (an empty name too)', () => {
      expect(auto('Stuff for Marco')).toBeNull()
      expect(auto('')).toBeNull()
    })

    it('a chip that only has a similar name is offered, never filled in (like the HOME category)', () => {
      const gifts = [{ id: 'shopping', name: 'Shopping', parent_id: null }, { id: 'gifts', name: 'Gifts', parent_id: 'shopping' }]
      const ctx = { ...context(gifts), parents: [], subsByParent: new Map() }
      expect(suggestBudgetCategories('Gift', ctx)).toEqual([expect.objectContaining({ expenseCategoryId: 'gifts', source: 'name' })])
      expect(auto('Gift', ctx)).toBeNull()
    })
  })
})
