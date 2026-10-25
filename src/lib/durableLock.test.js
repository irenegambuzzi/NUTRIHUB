import { describe, expect, it, vi } from 'vitest'

// Round 9F, the durable lock: the keyword lists read the whole name, and
// the MONEY form locks "Add to HOME" for durables. Worked out with the
// real categories (live + 024 + 025, and what 026 does), exactly as the
// forms do it.
vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { guessCategory, singular, createGuesser } = await import('./categoryGuess')
const { budgetAutoFill, budgetKeywordPicks, suggestBudgetCategories, suggestCategory } = await import('./categorySuggest')
const { budgetOf, defaultBudget, emptyRow, homeNote, rowLine } = await import('./moneyPurchase')
const { durableLock, durableLookalike, isChosenOnPurpose, isDurableBudget, isDurableOrder, isPurposeBudget, lockNote } = await import('./durable')
const { LIVE_ITEM_NAMES } = await import('../data/liveItemNames.fixture')
const { HOME_AFTER_026, HOME_BEFORE_026, homeTree } = await import('../data/homeCategories.fixture')
const { LIVE_MONEY_CATEGORIES, MONEY_CATEGORIES_024 } = await import('../data/moneyCategories.fixture')
const { MONEY_CATEGORY_IDS_025, MONEY_CATEGORY_IDS_026, NEW_MONEY_CATEGORY_IDS: N } = await import('../data/budgetKeywords')
const { FAMILY_SUPPORT_CATEGORY_ID, TRIPS_CATEGORY_ID, WORK_CATEGORY_ID } = await import('../data/constants')
const { withoutDurables } = await import('./inventoryBackup')

const HOME_APPLIANCES = '199ec782-505a-4292-984e-08ae1d76469f'
const SHOPPING = '654a80a3-2e6f-4ada-b214-0486d91d869c'
const PETS = 'ecd9a924-7f46-4991-83ce-02825c73ce42'
const FOOTWEAR = '0f7f387b-0c4a-4095-8865-59cfac4c586a'
const ELECTRONICS = '2a05cb39-e90c-4349-9f77-4b1e679d42b4'
const SHOP_ELECTRONICS = '1697124e-22a7-4417-b5b9-0439ccc67e17'
const GROCERIES = '61f92237-3392-4f71-aca8-4dbb1df9b256'
const OTHER = '6d9d08f2-c8a7-4f40-bf88-9e5de1b44449'

// MONEY before 026 (live + 024 + 025) and after it.
const MONEY_025 = [
  { id: MONEY_CATEGORY_IDS_025.accessories, name: 'Accessories', parent_id: SHOPPING },
  { id: MONEY_CATEGORY_IDS_025.homeTextiles, name: 'Home Textiles', parent_id: HOME_APPLIANCES },
  { id: MONEY_CATEGORY_IDS_025.homeDecor, name: 'Home Decor', parent_id: HOME_APPLIANCES },
  { id: MONEY_CATEGORY_IDS_025.petAccessories, name: 'Pet Accessories & Toys', parent_id: PETS },
]
const MONEY_BEFORE_026 = [...LIVE_MONEY_CATEGORIES, ...MONEY_CATEGORIES_024, ...MONEY_025].map((c) => (c.id === FOOTWEAR ? { ...c, name: 'Footwear' } : c))
const MONEY_AFTER_026 = [
  ...MONEY_BEFORE_026.filter((c) => c.id !== SHOP_ELECTRONICS).map((c) => (c.id === ELECTRONICS ? { ...c, name: 'Electronics' } : c)),
  { id: MONEY_CATEGORY_IDS_026.work, name: 'Work', parent_id: null },
  { id: MONEY_CATEGORY_IDS_026.furniture, name: 'Furniture', parent_id: HOME_APPLIANCES },
]
// The mapping rows: 21/10, 024, and the 15 of 026.
const MAP_BEFORE_026 = [
  ['pet', PETS],
  ['health', N.pharmacy],
  ['personal-care', N.beautyPerfume],
  ['toiletries', N.toiletries],
  ['household:car-care', '8b2d4f49-af1d-41af-bd19-9050a7689164'],
].map(([id, expense_category_id]) => ({ id, expense_category_id }))
const MAP_AFTER_026 = [
  ...MAP_BEFORE_026,
  ...[
    ['appliances:kitchen', '4125ed9e-da65-4b76-8e35-cb1239d8093b'],
    ['appliances:kitchenware', 'a364fa44-7513-47ca-aabc-7c5254c0a961'],
    ['appliances:cleaning', '83c6b924-e7cd-4ba6-881d-a1ff1e6385d1'],
    ['appliances:air', '7d226f51-f809-494d-92c0-50d9c12f7812'],
    ['appliances:electronics', ELECTRONICS],
    ['appliances:textiles', MONEY_CATEGORY_IDS_025.homeTextiles],
    ['appliances:decor', MONEY_CATEGORY_IDS_025.homeDecor],
    ['appliances:clothing', '732af8e0-924c-471c-b0e8-ac9286ce074e'],
    ['appliances:footwear', FOOTWEAR],
    ['appliances:accessories', MONEY_CATEGORY_IDS_025.accessories],
    ['appliances:pet', MONEY_CATEGORY_IDS_025.petAccessories],
    ['appliances:glasses', N.glassesLenses],
    ['appliances:furniture', MONEY_CATEGORY_IDS_026.furniture],
    ['misc:gifts', '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c'],
    ['health:contact-lenses', N.glassesLenses],
  ].map(([id, expense_category_id]) => ({ id, expense_category_id })),
]

const AFTER = { home: HOME_AFTER_026, money: MONEY_AFTER_026, mapRows: MAP_AFTER_026 }
const BEFORE = { home: HOME_BEFORE_026, money: MONEY_BEFORE_026, mapRows: MAP_BEFORE_026 }

const homePath = (home, id) => {
  const c = home.find((x) => x.id === id)
  const p = c?.parent_id ? home.find((x) => x.id === c.parent_id) : null
  return c ? (p ? `${p.name} › ${c.name}` : c.name) : '—'
}
const moneyPath = (money, id) => {
  const c = money.find((x) => x.id === id)
  const p = c?.parent_id ? money.find((x) => x.id === c.parent_id) : null
  return c ? (p ? `${p.name} › ${c.name}` : c.name) : '—'
}

// The keyword guess only (no remembered name, no HOME item).
const homeGuess = (name, world = AFTER) => {
  const g = guessCategory(name, homeTree(world.home))
  return g ? homePath(world.home, g.subcategoryId ?? g.categoryId) : '—'
}

// A MONEY "Add expense" row as PurchaseForm fills it in from the name:
// the HOME category (first HOME suggestion), the budget auto-fill (first
// budget chip), then what the row shows.
function moneyRow(name, world = AFTER) {
  const tree = homeTree(world.home)
  const ctx = { expenseCategories: world.money, inventoryCategories: world.home, mapRows: world.mapRows }
  const context = { memory: new Map(), pantryByName: new Map(), ...tree, expenseCategories: world.money, budgetFor: (pick) => defaultBudget(pick, ctx) || null }
  const pick = suggestCategory(name, context)
  const row = { ...emptyRow(1), name, priceText: '1', categoryId: pick?.categoryId ?? '', subcategoryId: pick?.subcategoryId ?? '', autoBudgetId: budgetAutoFill(suggestBudgetCategories(name, context))?.expenseCategoryId ?? '' }
  const line = rowLine(row, [], ctx)
  return {
    home: pick ? homePath(world.home, pick.subcategoryId ?? pick.categoryId) : '—',
    money: moneyPath(world.money, budgetOf(row, ctx)),
    locked: Boolean(line.lock),
    addToHome: line.home,
    note: homeNote(line),
  }
}

describe('the 253 HOME item names of 25/10/2026', () => {
  it('none is guessed durable by the keywords (after 026, and before it)', () => {
    expect(LIVE_ITEM_NAMES).toHaveLength(253)
    for (const world of [AFTER, BEFORE]) {
      const tree = homeTree(world.home)
      const durable = LIVE_ITEM_NAMES.filter((name) => guessCategory(name, tree)?.categoryId === 'appliances')
      expect(durable).toEqual([])
    }
  })

  it('the guesses that changed in round 9F are all improvements', () => {
    expect(
      Object.fromEntries(
        [
          'hair oil',
          'hair water',
          'Hair Gel',
          'eye mask',
          'face serum milk',
          'COFFE Grandaroma macinato MOKA',
          'coffee syrup',
          'Dishwasher Detergent',
          'Oven Detergent',
          'Washing Machine Cleaner',
          '"TOOLS & SUPPLIES" Tulip Top Black guanti nitrile',
          'Electrolytes Powder',
          'Fontana Water Filter',
          'Fontana Water Pump Filter',
          'Cat Dry Food',
          'Cat Wet Food',
        ].map((name) => [name, homeGuess(name)])
      )
    ).toEqual({
      'hair oil': 'Beauty Care › Hair Care',
      'hair water': 'Beauty Care › Hair Care',
      'Hair Gel': 'Beauty Care › Hair Care',
      'eye mask': 'Beauty Care › Skincare',
      'face serum milk': 'Beauty Care › Skincare',
      'COFFE Grandaroma macinato MOKA': 'Beverages › Coffee & Tea',
      'coffee syrup': 'Beverages › Coffee & Tea',
      'Dishwasher Detergent': 'Cleaning Supplies › Dishwashing',
      'Oven Detergent': 'Cleaning Supplies › Surface Cleaners',
      'Washing Machine Cleaner': 'Laundry Supplies › Washing Machine Care',
      '"TOOLS & SUPPLIES" Tulip Top Black guanti nitrile': 'Cleaning Supplies › Sponges & Cloths',
      'Electrolytes Powder': 'Health & Medicine › Vitamins & Supplements',
      'Fontana Water Filter': 'Pet Supplies › Litter & Hygiene',
      'Fontana Water Pump Filter': 'Pet Supplies › Litter & Hygiene',
      'Cat Dry Food': 'Pet Supplies › Pet Food',
      'Cat Wet Food': 'Pet Supplies › Pet Food',
    })
  })
})

describe('HOME keywords: the whole name decides', () => {
  it.each([
    // The 31 lines of the Action purchase (docs/durable-lock.md 5.4, with the 9F changes).
    ['big towel', 'Durables › Home Textiles'],
    ['small towel', 'Durables › Home Textiles'],
    ['toy elf Christmas', 'Durables › Home Decor'],
    ['incense holder', 'Durables › Home Decor'],
    ['bra', 'Durables › Clothing'],
    ['Satin Bonnet', 'Durables › Accessories'],
    ['hair clip', 'Durables › Accessories'],
    ['Headband', 'Durables › Accessories'],
    ['Cat House Christmas Tree', 'Durables › Pet Accessories & Toys'],
    ['cat toy', 'Durables › Pet Accessories & Toys'],
    ['ceramic bowl', 'Durables › Kitchenware & Utensils'],
    ['liquid measuring glass', 'Durables › Kitchenware & Utensils'],
    ['cheesy chili sauce', 'Pantry Staples › Sauces & Condiments'],
    ['Spicy truffle sauce', 'Pantry Staples › Sauces & Condiments'],
    ['cleaning sponges', 'Cleaning Supplies › Sponges & Cloths'],
    ['inox sponges', 'Cleaning Supplies › Sponges & Cloths'],
    ['Dish soap', 'Cleaning Supplies › Dishwashing'],
    ['coffee syrup', 'Beverages › Coffee & Tea'],
    ['Stain Remover Powder', 'Laundry Supplies › Stain Removers'],
    ['Dishwasher Detergent', 'Cleaning Supplies › Dishwashing'],
    ['Oven Detergent', 'Cleaning Supplies › Surface Cleaners'],
    ['Toilet Paper', 'Toiletries › Toilet Paper & Tissues'],
    ['shower gel', 'Toiletries › Soap & Shower Gel'],
    ['perfume', 'Beauty Care › Perfume'],
    ['powder set makeup', 'Beauty Care › Makeup'],
    ['face serum milk', 'Beauty Care › Skincare'],
    ['eye mask', 'Beauty Care › Skincare'],
    ['hair oil', 'Beauty Care › Hair Care'],
    ['hair water', 'Beauty Care › Hair Care'],
    ['Electrolytes Powder', 'Health & Medicine › Vitamins & Supplements'],
    ['Cat wet food', 'Pet Supplies › Pet Food'],
    // The other names of 5.4.
    ['paper towel', 'Household Supplies › Paper Towels & Foil'],
    ['carta asciugatutto', 'Household Supplies › Paper Towels & Foil'],
    ['asciugamano', 'Durables › Home Textiles'],
    ['handuk', 'Durables › Home Textiles'],
    ['sacchetti aspirapolvere', 'Household Supplies › Trash Bags'],
    ['aspirapolvere', 'Durables › Cleaning Appliances'],
    ['vacuum cleaner', 'Durables › Cleaning Appliances'],
    ['cat water fountain', 'Durables › Pet Accessories & Toys'],
    ['fontanella gatto', 'Durables › Pet Accessories & Toys'],
    ['filtro fontanella', 'Pet Supplies › Litter & Hygiene'],
    ['sandali', 'Durables › Footwear'],
    ['ciabatte', 'Durables › Footwear'],
    ['Shoe Deodorizer', 'Durables › Footwear'],
    // Decided on 25/10.
    ['socks', 'Durables › Clothing'],
    ['Calzini', 'Durables › Clothing'],
    ['Kaus kaki', 'Durables › Clothing'],
    ['Knit Cap', 'Durables › Accessories'],
    ['Cappello', 'Durables › Accessories'],
    ['Peluche', 'Durables › Pet Accessories & Toys'],
    ['regalo giocattolo', 'Durables › Gifts & Party'],
    ['Regalo Luca', 'Durables › Gifts & Party'],
    ['Glasses', 'Durables › Glasses'],
    ['Occhiali da vista', 'Durables › Glasses'],
    ['reading glasses', 'Durables › Glasses'],
    ['Sunglasses', 'Durables › Accessories'],
    ['Fashion Glasses', 'Durables › Accessories'],
    ['Occhiali da sole', 'Durables › Accessories'],
    ['Contact Lenses', 'Health & Medicine › Contact Lenses'],
    ['Lens Solution', 'Health & Medicine › Contact Lenses'],
    ['Lenti a contatto', 'Health & Medicine › Contact Lenses'],
    ['Wine Glasses', 'Durables › Kitchenware & Utensils'],
    ['Glass', 'Durables › Kitchenware & Utensils'],
    ['Bicchieri', 'Durables › Kitchenware & Utensils'],
    ['Butter Glass Container', 'Durables › Kitchenware & Utensils'],
    ['Transparent Sliced Food Container', 'Durables › Kitchenware & Utensils'],
    ['Lunch box', 'Durables › Kitchenware & Utensils'],
    ['Placemat', 'Durables › Home Textiles'],
    ['Table Mat', 'Durables › Home Textiles'],
    ['Tovagliette', 'Durables › Home Textiles'],
    ['Glass Cleaner', 'Cleaning Supplies › Surface Cleaners'],
    ['Wood Cleaner Spray', 'Cleaning Supplies › Surface Cleaners'],
    ['Washing Machine Cleaner', 'Laundry Supplies › Washing Machine Care'],
    ['Washing machine cleaner tabs', 'Laundry Supplies › Washing Machine Care'],
    ['Pulisci lavatrice', 'Laundry Supplies › Washing Machine Care'],
    ['Clothing Reviver Blue', 'Laundry Supplies › Color Care'],
    ['Acchiappacolore', 'Laundry Supplies › Color Care'],
    ['Hair Gel', 'Beauty Care › Hair Care'],
    ['Lacca', 'Beauty Care › Hair Care'],
    ['Shampoo', 'Toiletries › Shampoo & Conditioner'],
    ['Hair Conditioner', 'Toiletries › Shampoo & Conditioner'],
    ['Laptop', 'Durables › Electronics'],
    ['charger', 'Durables › Electronics'],
    ['cuffie', 'Durables › Electronics'],
    ['Office Chair', 'Durables › Furniture'],
    ['Work Printer Ink', 'Household Supplies › Stationery'],
    ['Pampers', 'Baby › Diapers'],
    ['diapers', 'Baby › Diapers'],
    ['scopa', 'Durables › Cleaning Appliances'],
    ['Mocio Vileda', 'Durables › Cleaning Appliances'],
    ['prolunga', 'Durables › Electronics'],
    ['Ciabatta elettrica', 'Durables › Electronics'],
    ['chair', 'Durables › Furniture'],
    ['Scrivania', 'Durables › Furniture'],
    ['Desk lamp', 'Durables › Home Decor'],
    ['Christmas tree', 'Durables › Home Decor'],
    ['Vaso per piante', 'Durables › Home Decor'],
    ['Silicone Gun', 'Durables'],
    ['Forbici', 'Durables'],
    ['poke bowl', 'Deli & Cold Cuts › Ready Meals & Dips'],
    // Consumables and food that must stay where they were.
    ['Ciabatta', 'Bakery & Bread › Bread'],
    ['Lampadina LED', 'Household Supplies › Batteries & Bulbs'],
    ['pianta', 'Household Supplies › Plants & Garden'],
    ['Basilico in vaso', 'Fruit & Vegetables › Fresh Herbs'],
    ['Fiori di zucca', 'Fruit & Vegetables › Fresh Vegetables'],
    ['Table salt', 'Pantry Staples › Spices & Seasonings'],
    ['Tea bags', 'Beverages › Coffee & Tea'],
    ['Toy Story yogurt', 'Dairy & Eggs › Yogurt & Desserts'],
    ['Collare antipulci', 'Pet Supplies › Litter & Hygiene'],
    ['Cat litter', 'Pet Supplies › Litter & Hygiene'],
    ['Salvaslip', 'Toiletries › Feminine Care'],
    ['Detergente intimo', 'Toiletries › Feminine Care'],
    ['Torta della nonna', 'Bakery & Bread › Pastries & Cakes'],
  ])('%s → %s', (name, expected) => {
    expect(homeGuess(name)).toBe(expected)
  })

  it('in doubt, no guess: two single words of different kinds, or a word that is both', () => {
    for (const name of ['Bra formaggio', 'Lampada LED', 'Salad bowl']) expect(homeGuess(name), name).toBe('—')
  })

  it('before 026 the new sub-categories fall back to their main: still durable, still consumable', () => {
    expect(homeGuess('bra', BEFORE)).toBe('Home & Appliances')
    expect(homeGuess('Glasses', BEFORE)).toBe('Home & Appliances')
    expect(homeGuess('Regalo Luca', BEFORE)).toBe('Home & Appliances')
    expect(homeGuess('Washing Machine Cleaner', BEFORE)).toBe('Laundry Supplies')
    expect(homeGuess('Contact Lenses', BEFORE)).toBe('Health & Medicine')
    expect(homeGuess('Laptop', BEFORE)).toBe('Home & Appliances › Electronics & Work Equipment')
  })
})

describe('the keyword engine (lib/categoryGuess.js)', () => {
  it('"glasses" stays "glasses" (to see with); a drinking glass is "glass"', () => {
    expect(singular('glasses')).toBe('glasses')
    expect(singular('glass')).toBe('glass')
    expect(singular('sunglasses')).toBe('sunglass')
    expect(singular('towels')).toBe('towel')
  })

  it('a purpose rule beats every score; a rule without a category only hides the words inside it', () => {
    const g = createGuesser([
      ['family', null, 'mamma', { priority: 1 }],
      ['work', null, 'work|office', { priority: 2 }],
      ['food', null, 'gnocchi di patate|torta'],
      ['soft', null, 'microsoft office'],
      [null, null, 'mamma emma'],
    ])
    expect(g.guessCategory('Mamma gnocchi di patate')).toEqual({ categoryId: 'family', subcategoryId: null })
    expect(g.guessCategory('Mamma work')).toEqual({ categoryId: 'family', subcategoryId: null })
    expect(g.guessCategory('Mamma Emma gnocchi di patate')).toEqual({ categoryId: 'food', subcategoryId: null })
    expect(g.guessCategory('Mamma Emma')).toBeNull()
    expect(g.guessCategory('Microsoft Office')).toEqual({ categoryId: 'soft', subcategoryId: null })
    // After a linking word a purpose word doesn't count at all.
    expect(g.guessCategory('Torta della mamma')).toEqual({ categoryId: 'food', subcategoryId: null })
    expect(g.guessCategories('Mamma work torta', null, 3).map((c) => c.categoryId)).toEqual(['family', 'work', 'food'])
  })
})

describe('MONEY keywords: purpose words first (family → work → gift)', () => {
  const pick = (name) => moneyPath(MONEY_AFTER_026, budgetKeywordPicks(name, MONEY_AFTER_026)[0])
  it.each([
    ['Regalo mamma cioccolato', 'Family Support'],
    ['Kereta bayi untuk adik', 'Family Support'],
    ['Laptop kerja untuk adik', 'Family Support'],
    ['Remitly', 'Family Support'],
    ['Soldi per la nonna', 'Family Support'],
    ['Work Laptop', 'Work'],
    ['Working Ear Plug', 'Work'],
    ['Office Chair', 'Work'],
    ['Pranzo ufficio', 'Work'],
    ['Microsoft Office', 'Subscription › Software & Apps'],
    ['Regalo Luca', 'Shopping › Gifts'],
    ['regalo giocattolo', 'Shopping › Gifts'],
    ['charger', 'Home & Appliances › Electronics'],
    ['Cuffie Sony', 'Home & Appliances › Electronics'],
    ['Mediaworld', 'Home & Appliances › Electronics'],
    ['Occhiali da sole', 'Shopping › Accessories'],
    ['Borsa', 'Shopping › Accessories'],
    ['Scarpe', 'Shopping › Footwear'],
    ['Glasses', 'Health › Glasses & Lenses'],
    ['Lens solution', 'Health › Glasses & Lenses'],
  ])('%s → %s', (name, expected) => {
    expect(pick(name)).toBe(expected)
  })

  it.each(['Workout gloves', 'Pampers', 'Diapers', 'Torta della nonna', 'Mamma Emma gnocchi', 'Nonno Nanni stracchino', 'Ufficio postale', 'Pannolini bayi'])('%s is no purpose', (name) => {
    expect([WORK_CATEGORY_ID, FAMILY_SUPPORT_CATEGORY_ID]).not.toContain(budgetKeywordPicks(name, MONEY_AFTER_026)[0])
  })

  it('a missing Work category (026 not run yet) is simply not offered', () => {
    expect(budgetKeywordPicks('Work Printer Ink', MONEY_BEFORE_026)).toEqual([])
  })
})

describe('the MONEY "Add expense" row: HOME chip, budget auto-fill, lock', () => {
  it.each([
    ['Laptop', 'Durables › Electronics', 'Home & Appliances › Electronics', true],
    ['charger', 'Durables › Electronics', 'Home & Appliances › Electronics', true],
    ['cuffie', 'Durables › Electronics', 'Home & Appliances › Electronics', true],
    ['Work Laptop', 'Durables › Electronics', 'Work', true],
    ['Office Chair', 'Durables › Furniture', 'Work', true],
    ['Work Printer Ink', 'Household Supplies › Stationery', 'Work', false],
    ['Working Ear Plug', '—', 'Work', false],
    ['Kereta bayi untuk adik', '—', 'Family Support', true],
    ['Regalo mamma cioccolato', '—', 'Family Support', true],
    ['Laptop kerja untuk adik', 'Durables › Electronics', 'Family Support', true],
    ['Remitly', '—', 'Family Support', true],
    ['Regalo Luca', 'Durables › Gifts & Party', 'Shopping › Gifts', true],
    ['regalo giocattolo', 'Durables › Gifts & Party', 'Shopping › Gifts', true],
    ['Glasses', 'Durables › Glasses', 'Health › Glasses & Lenses', true],
    ['Sunglasses', 'Durables › Accessories', 'Shopping › Accessories', true],
    ['Fashion Glasses', 'Durables › Accessories', 'Shopping › Accessories', true],
    ['Contact Lenses', 'Health & Medicine › Contact Lenses', 'Health › Glasses & Lenses', false],
    ['Lens Solution', 'Health & Medicine › Contact Lenses', 'Health › Glasses & Lenses', false],
    ['socks', 'Durables › Clothing', 'Shopping › Clothing', true],
    ['Knit Cap', 'Durables › Accessories', 'Shopping › Accessories', true],
    ['Wine Glasses', 'Durables › Kitchenware & Utensils', 'Home & Appliances › Kitchenware & Utensils', true],
    ['Glass', 'Durables › Kitchenware & Utensils', 'Home & Appliances › Kitchenware & Utensils', true],
    ['Butter Glass Container', 'Durables › Kitchenware & Utensils', 'Home & Appliances › Kitchenware & Utensils', true],
    ['Transparent Sliced Food Container', 'Durables › Kitchenware & Utensils', 'Home & Appliances › Kitchenware & Utensils', true],
    ['Placemat', 'Durables › Home Textiles', 'Home & Appliances › Home Textiles', true],
    ['Table Mat', 'Durables › Home Textiles', 'Home & Appliances › Home Textiles', true],
    ['Glass Cleaner', 'Cleaning Supplies › Surface Cleaners', 'Groceries', false],
    ['Wood Cleaner Spray', 'Cleaning Supplies › Surface Cleaners', 'Groceries', false],
    ['Washing Machine Cleaner', 'Laundry Supplies › Washing Machine Care', 'Groceries', false],
    ['Clothing Reviver Blue', 'Laundry Supplies › Color Care', 'Groceries', false],
    ['Pampers', 'Baby › Diapers', 'Groceries', false],
    ['scopa', 'Durables › Cleaning Appliances', 'Home & Appliances › Cleaning Appliances', true],
    ['prolunga', 'Durables › Electronics', 'Home & Appliances › Electronics', true],
    ['chair', 'Durables › Furniture', 'Home & Appliances › Furniture', true],
    ['Lampu meja', 'Durables › Home Decor', 'Home & Appliances › Home Decor', true],
    ['Phone Case', 'Durables › Electronics', 'Home & Appliances › Electronics', true],
    ['Christmas tree', 'Durables › Home Decor', 'Home & Appliances › Home Decor', true],
    ['Silicone Gun', 'Durables', 'Home & Appliances', true],
    ['bra', 'Durables › Clothing', 'Shopping › Clothing', true],
    ['cat toy', 'Durables › Pet Accessories & Toys', 'Pets › Pet Accessories & Toys', true],
    ['poke bowl', 'Deli & Cold Cuts › Ready Meals & Dips', 'Groceries', false],
  ])('%s → HOME %s, MONEY %s, locked %s', (name, home, money, locked) => {
    const row = moneyRow(name)
    expect({ home: row.home, money: row.money, locked: row.locked }).toEqual({ home, money, locked })
    if (locked) expect(row.addToHome).toBe(false)
  })

  it('a consumable with a HOME category is added to HOME; Work Printer Ink too (Work is a purpose, not a durable)', () => {
    expect(moneyRow('Work Printer Ink').addToHome).toBe(true)
    expect(moneyRow('Glass Cleaner').addToHome).toBe(true)
    expect(moneyRow('Contact Lenses').addToHome).toBe(true)
  })

  it('the locked note names the HOME sub-category, or the budget category when the lock comes from MONEY', () => {
    expect(moneyRow('Office Chair').note).toBe('Durable item (Furniture) — expense only, never in HOME stock.')
    expect(moneyRow('Regalo mamma cioccolato').note).toBe('Durable item (Family Support) — expense only, never in HOME stock.')
    expect(moneyRow('Silicone Gun').note).toBe('Durable item (Durables) — expense only, never in HOME stock.')
  })

  it('before 026 nothing crashes and the appliances default still books by the same name', () => {
    expect(moneyRow('Laptop', BEFORE)).toMatchObject({ home: 'Home & Appliances › Electronics & Work Equipment', money: 'Home & Appliances › Electronics & Work Equipment', locked: true })
    expect(moneyRow('bra', BEFORE)).toMatchObject({ home: 'Home & Appliances', locked: true })
    expect(moneyRow('Work Printer Ink', BEFORE)).toMatchObject({ home: 'Household Supplies › Stationery', money: 'Groceries', locked: false, addToHome: true })
    expect(moneyRow('Milk', BEFORE)).toMatchObject({ home: 'Dairy & Eggs › Milk & Cream', money: 'Groceries', locked: false, addToHome: true })
  })
})

describe('lib/durable.js', () => {
  const money = MONEY_AFTER_026
  const later = { id: 'new-sub', name: 'Bags', parent_id: SHOPPING }

  it('a durable MONEY main covers its subs, also one made later; a durable sub only itself', () => {
    expect(isDurableBudget(HOME_APPLIANCES, money)).toBe(true)
    expect(isDurableBudget(ELECTRONICS, money)).toBe(true)
    expect(isDurableBudget(later.id, [...money, later])).toBe(true)
    expect(isDurableBudget(MONEY_CATEGORY_IDS_025.petAccessories, money)).toBe(true)
    expect(isDurableBudget(N.souvenirs, money)).toBe(true)
    expect(isDurableBudget(FAMILY_SUPPORT_CATEGORY_ID, money)).toBe(true)
    for (const id of [PETS, N.veterinary, WORK_CATEGORY_ID, N.glassesLenses, GROCERIES, TRIPS_CATEGORY_ID, OTHER, null, '']) expect(isDurableBudget(id, money), String(id)).toBe(false)
  })

  it('purpose budgets: Family Support, Work, Shopping › Gifts; chosen on purpose: Work, Family Support, Trips & Holidays and its subs', () => {
    expect([FAMILY_SUPPORT_CATEGORY_ID, WORK_CATEGORY_ID, '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c'].every((id) => isPurposeBudget(id, money))).toBe(true)
    expect(isPurposeBudget(SHOPPING, money)).toBe(false)
    expect(isChosenOnPurpose(N.flights, money)).toBe(true)
    expect(isChosenOnPurpose(TRIPS_CATEGORY_ID, money)).toBe(true)
    expect(isChosenOnPurpose(WORK_CATEGORY_ID, money)).toBe(true)
    expect(isChosenOnPurpose(GROCERIES, money)).toBe(false)
  })

  it('the lock: HOME durable, or MONEY durable; released only when neither is', () => {
    const ctx = { expenseCategories: money, inventoryCategories: HOME_AFTER_026 }
    expect(durableLock({ categoryId: 'appliances', subcategoryId: 'appliances:footwear', budgetId: GROCERIES }, ctx)).toEqual({ source: 'home', name: 'Footwear' })
    expect(durableLock({ categoryId: 'household', subcategoryId: '', budgetId: FOOTWEAR }, ctx)).toEqual({ source: 'money', name: 'Footwear' })
    expect(durableLock({ categoryId: 'household', subcategoryId: '', budgetId: GROCERIES }, ctx)).toBeNull()
    expect(lockNote({ name: '' })).toBe('Durable item — expense only, never in HOME stock.')
  })

  it('the HOME editor warning: on all categories, with the path', () => {
    const tree = homeTree(HOME_AFTER_026)
    expect(durableLookalike('handuk', tree)).toBe('Durables › Home Textiles')
    expect(durableLookalike('Milk', tree)).toBe('')
    expect(durableLookalike('', tree)).toBe('')
  })

  it('an order is durable by its budget category or by the SHOP entry it came from', () => {
    const groceryItems = [{ id: 'g1', category_id: 'appliances', subcategory_id: 'appliances:footwear' }, { id: 'g2', category_id: 'dairy' }]
    expect(isDurableOrder({ category_id: FOOTWEAR }, { expenseCategories: money })).toBe(true)
    expect(isDurableOrder({ category_id: GROCERIES, grocery_item_id: 'g1' }, { expenseCategories: money, groceryItems })).toBe(true)
    expect(isDurableOrder({ category_id: GROCERIES, grocery_item_id: 'g2' }, { expenseCategories: money, groceryItems })).toBe(false)
    expect(isDurableOrder({ category_id: null }, {})).toBe(false)
  })
})

describe('import (lib/inventoryBackup.js)', () => {
  it('leaves out rows whose category is durable and says how many; the rest is kept as it is', () => {
    const rows = [{ name: 'Milk', category_id: 'dairy' }, { name: 'Towel', category_id: 'appliances', subcategory_id: 'appliances:textiles' }, { name: 'Lamp', category_id: 'appliances' }, { name: 'Note', category_id: null }]
    expect(withoutDurables(rows)).toEqual({ items: [rows[0], rows[3]], skipped: 2 })
  })
})

describe('round 9F follow-up: Zidane\'s answers to the 14 doubt words (25/10)', () => {
  it.each([
    // 2. Phone cases are Electronics; "case" alone no guess.
    ['Phone Case', 'Durables › Electronics'],
    ['Phone cover', 'Durables › Electronics'],
    ['Custodia telefono', 'Durables › Electronics'],
    ['Cover telefono', 'Durables › Electronics'],
    ['Cover HP', 'Durables › Electronics'],
    ['Casing HP', 'Durables › Electronics'],
    // 6. Adapters.
    ['Adapter', 'Durables › Electronics'],
    ['Adaptor', 'Durables › Electronics'],
    ['Adattatore', 'Durables › Electronics'],
    ['Adattatore presa', 'Durables › Electronics'],
    // 7. Bulbs are consumables; lamps (as phrases) are decor.
    ['Lampu LED', 'Household Supplies › Batteries & Bulbs'],
    ['lampadina', 'Household Supplies › Batteries & Bulbs'],
    ['Lampadine', 'Household Supplies › Batteries & Bulbs'],
    ['Bohlam', 'Household Supplies › Batteries & Bulbs'],
    ['LED bulb', 'Household Supplies › Batteries & Bulbs'],
    ['Light bulb', 'Household Supplies › Batteries & Bulbs'],
    ['Lampadina LED', 'Household Supplies › Batteries & Bulbs'],
    ['Lampu meja', 'Durables › Home Decor'],
    ['Lampu tidur', 'Durables › Home Decor'],
    ['Lampu belajar', 'Durables › Home Decor'],
    ['Lampada da tavolo', 'Durables › Home Decor'],
    ['Lampada da terra', 'Durables › Home Decor'],
    ['Table lamp', 'Durables › Home Decor'],
    ['Desk lamp', 'Durables › Home Decor'],
    ['Floor lamp', 'Durables › Home Decor'],
    ['Bedside lamp', 'Durables › Home Decor'],
    // 8. The mop is a tool; what wears out is a refill.
    ['Pel lantai', 'Durables › Cleaning Appliances'],
    ['Spazzolone', 'Durables › Cleaning Appliances'],
    ['Mop', 'Durables › Cleaning Appliances'],
    ['Mocio', 'Durables › Cleaning Appliances'],
    ['Mocio Vileda', 'Durables › Cleaning Appliances'],
    ['Kain pel', 'Cleaning Supplies › Sponges & Cloths'],
    ['Panni Swiffer', 'Cleaning Supplies › Sponges & Cloths'],
    ['Refill', 'Cleaning Supplies › Sponges & Cloths'],
    ['Ricarica', 'Cleaning Supplies › Sponges & Cloths'],
    ['Ricambio mocio', 'Cleaning Supplies › Sponges & Cloths'],
    ['Ricambi', 'Cleaning Supplies › Sponges & Cloths'],
    // 11. Party and gift things: Gifts & Party; food with those words wins.
    ['Palloncini', 'Durables › Gifts & Party'],
    ['Palloncino', 'Durables › Gifts & Party'],
    ['Balloons', 'Durables › Gifts & Party'],
    ['Candeline', 'Durables › Gifts & Party'],
    ['Birthday candles', 'Durables › Gifts & Party'],
    ['Bunga', 'Durables › Gifts & Party'],
    ['Fiori', 'Durables › Gifts & Party'],
    ['Flowers', 'Durables › Gifts & Party'],
    ['Carta regalo', 'Durables › Gifts & Party'],
    ['Gift wrap', 'Durables › Gifts & Party'],
    ['Birthday card', 'Durables › Gifts & Party'],
    ['Biglietto auguri', 'Durables › Gifts & Party'],
    ['Kartu ucapan', 'Durables › Gifts & Party'],
    ['Party', 'Durables › Gifts & Party'],
    ['Festa', 'Durables › Gifts & Party'],
    ['Fiori di zucca', 'Fruit & Vegetables › Fresh Vegetables'],
    ['Bunga lawang', 'Pantry Staples › Spices & Seasonings'],
    ['Party mix', 'Snacks'],
    ['Party pack', 'Snacks'],
    // 5. Pet fountain filters stay consumables.
    ['Fontana Water Filter', 'Pet Supplies › Litter & Hygiene'],
    ['Fontana Water Pump Filter', 'Pet Supplies › Litter & Hygiene'],
    ['Filtro fontanella', 'Pet Supplies › Litter & Hygiene'],
    // 12. Unchanged.
    ['Biberon', 'Baby › Feeding'],
    ['Ciuccio', 'Baby › Feeding'],
    // 10. Office Chair in HOME.
    ['Office Chair', 'Durables › Furniture'],
  ])('%s → %s', (name, expected) => {
    expect(homeGuess(name)).toBe(expected)
  })

  it.each([
    'bag', 'Bag', 'case', 'Case', 'cover', 'Cover', 'lenses', 'Lenti', 'filter', 'Filtro',
    'Water filter', 'Filtro acqua', 'Filtri acqua', 'Brita', 'Filtri Brita',
    'Lampu', 'Lampada', 'Lamp', 'Lampada LED', 'Swiffer', 'Vileda',
    'figurine', 'Sleeping mask', 'Ear plug', 'Tappi orecchie', 'Working Ear Plug',
  ])('%s → no HOME guess', (name) => {
    expect(homeGuess(name)).toBe('—')
  })

  it('a unit word stays in the name when reading it, but a weak word alone still counts', () => {
    expect(homeGuess('Party pack')).toBe('Snacks')
    expect(homeGuess('Party')).toBe('Durables › Gifts & Party')
    expect(homeGuess('Ace')).toBe('Cleaning Supplies › Surface Cleaners')
    expect(homeGuess('Ace pz')).toBe('Cleaning Supplies › Surface Cleaners')
    expect(homeGuess('Iceberg Salad (pack)')).toBe('Fruit & Vegetables › Salad & Leafy Greens')
  })

  it.each([
    ['Office', 'Subscription › Software & Apps'],
    ['Office 365', 'Subscription › Software & Apps'],
    ['Microsoft 365', 'Subscription › Software & Apps'],
    ['Microsoft Office', 'Subscription › Software & Apps'],
    ['Office Chair', 'Work'],
    ['Office desk', 'Work'],
    ['Working Ear Plug', 'Work'],
  ])('MONEY: %s → %s', (name, expected) => {
    expect(moneyPath(MONEY_AFTER_026, budgetKeywordPicks(name, MONEY_AFTER_026)[0])).toBe(expected)
  })

  it('MONEY rows: Office 365 is Software & Apps; Office Chair is Work and HOME Durables › Furniture, locked', () => {
    expect(moneyRow('Office 365')).toMatchObject({ home: '—', money: 'Subscription › Software & Apps', locked: false })
    expect(moneyRow('Office Chair')).toMatchObject({ home: 'Durables › Furniture', money: 'Work', locked: true })
    expect(moneyRow('Adapter')).toMatchObject({ home: 'Durables › Electronics', locked: true })
    expect(moneyRow('Palloncini')).toMatchObject({ home: 'Durables › Gifts & Party', money: 'Shopping › Gifts', locked: true })
    expect(moneyRow('Lampu LED')).toMatchObject({ home: 'Household Supplies › Batteries & Bulbs', locked: false, addToHome: true })
  })

  it('the 253 live names: still none durable', () => {
    const tree = homeTree(HOME_AFTER_026)
    expect(LIVE_ITEM_NAMES.filter((name) => guessCategory(name, tree)?.categoryId === 'appliances')).toEqual([])
  })
})
