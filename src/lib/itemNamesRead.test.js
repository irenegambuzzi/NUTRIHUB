import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { addOtherNames, alsoLine, anyNameIncludes, boughtAsOtherName, canHaveNames, draftProblems, nameDrafts, namesChange, newNameDraft, packItemFor, takenNote } = await import('./itemNames')
const { arrivalPickLabel, goToLabel, matchHomeItems, pickLabel } = await import('./similarItems')
const { emptyRow, homeItemFor, moneyPurchasePayload, pricedLines, rowLine, similarAsk } = await import('./moneyPurchase')
const { pantryItemFor, purchaseLine } = await import('./purchase')
const { buildSuggestions, matchSuggestions } = await import('./nameSuggestions')
const { lastPriceFor } = await import('./lastPrice')
const { searchRank } = await import('./pantryFilters')
const { matchesGrocerySearch, variantHint } = await import('./grocerySearch')

// Stage 2 of round 6D (plan 9N): every place that reads a name also reads
// the item's other names. Pure, so it works offline exactly like online.
const element = (name, extra = {}) => ({ name, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null, from_item_id: null, origin: null, added_at: '2026-11-01T10:00:00Z', ...extra })
const item = (id, name, names = [], extra = {}) => ({ id, name, unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'snacks', names: names.map((n) => (typeof n === 'string' ? element(n) : n)), ...extra })

const chips = item('chips', 'Chips & Snacks', ['Corn Snack', 'Nuvole di drago', 'Patatine teriyaki'], { current_stock: 11 })
const cat = item('cat', 'Cat Wet Food', [element('Felix', { packaging_unit: 'box', quantity_per_pack: 24 }), 'Gourmet'], { current_stock: 12, packaging_unit: 'box', quantity_per_pack: 48 })
const soap = item('soap', 'Dish soap', ['Svelto'])
const milk = item('milk', 'Milk')
const home = [chips, cat, soap, milk]

describe('safety net: an exact other name is that item, no question', () => {
  it.each([
    ['Corn Snack', chips],
    ['corn snacks', chips],
    ['Felix', cat],
    ['SVELTO', soap],
  ])('%s', (typed, found) => {
    const match = matchHomeItems(typed, home)
    expect(match.exact).toBe(found)
    expect(match.exactVia).toBeTruthy()
    expect(match.similar).toEqual([])
  })

  it("an item's own name goes first, also before another item's other name", () => {
    const corn = item('corn', 'Corn Snack')
    const match = matchHomeItems('Corn Snack', [chips, corn])
    expect(match.exact).toBe(corn)
    expect(match.exactVia).toBeUndefined()
  })

  it('an item with no names matches exactly as before, with no `via` at all', () => {
    expect(matchHomeItems('Milk', home)).toEqual({ exact: milk, similar: [], more: 0 })
    expect(matchHomeItems('Milk', [{ ...milk, names: undefined }]).exact.id).toBe('milk')
  })

  it('never a durable, whatever its names say', () => {
    const lamp = item('lamp', 'Lamp', ['Lumen'], { category_id: 'appliances' })
    expect(matchHomeItems('Lumen', [lamp])).toEqual({ exact: null, similar: [], more: 0 })
  })
})

describe('safety net: a similar other name asks, with the name on the button', () => {
  it('a typo of another name: "Use Chips & Snacks (Nuvole di drago) · 11 pcs at home"', () => {
    const { exact, similar } = matchHomeItems('Nuvole di dragho', home)
    expect(exact).toBeNull()
    expect(similar).toEqual([{ item: chips, kind: 'typo', via: 'Nuvole di drago' }])
    expect(pickLabel(chips, null, 'Nuvole di drago')).toBe('Use Chips & Snacks (Nuvole di drago) · 11 pcs at home')
    expect(pickLabel(chips, 'in-cart', 'Corn Snack')).toBe('Use Chips & Snacks (Corn Snack) · 11 pcs at home · already in the cart')
  })

  it('half of a name; the other buttons name the item the same way', () => {
    const { similar } = matchHomeItems('Teriyaki', home)
    expect(similar.map((m) => [m.item.id, m.via])).toEqual([['chips', 'Patatine teriyaki']])
    expect(arrivalPickLabel(chips, 'Patatine teriyaki')).toBe('Add it to Chips & Snacks (Patatine teriyaki) · 11 pcs at home')
    expect(goToLabel(chips, 'Patatine teriyaki')).toBe('Go to Chips & Snacks (Patatine teriyaki)')
  })

  it("the item's own name wins when it matches as well: no name on the button", () => {
    const pumpkin = item('p', 'Fresh Pumpkin', ['Pumpkin Cubes'])
    expect(matchHomeItems('Fresh Pumkin', [pumpkin]).similar).toEqual([{ item: pumpkin, kind: 'typo' }])
    expect(pickLabel(pumpkin)).toBe('Use Fresh Pumpkin · 2 pcs at home')
  })

  it('a MONEY row asks the same; an exact name asks nothing', () => {
    const ask = (name) => similarAsk(rowLine({ ...emptyRow(1), name, categoryId: 'snacks' }, home), home)
    expect(ask('Nuvole di dragho').similar[0].via).toBe('Nuvole di drago')
    expect(ask('Corn Snack')).toBeNull()
  })
})

describe('homeItemFor and pantryItemFor: an other name finds its item', () => {
  it('MONEY', () => {
    expect(homeItemFor('Nuvole di drago', home)).toBe(chips)
    expect(homeItemFor('gourmet', home)).toBe(cat)
    expect(homeItemFor('Unknown thing', home)).toBeNull()
  })

  it("MONEY: an item's own name goes first, a plural too", () => {
    const corn = item('corn', 'Corn Snack')
    expect(homeItemFor('Corn Snack', [chips, corn])).toBe(corn)
    expect(homeItemFor('Corn Snacks', [chips, corn])).toBe(corn)
  })

  it('SHOP Confirm: the link first, then the own name, then an other name', () => {
    expect(pantryItemFor({ name: 'Corn Snack', pantry_item_id: 'soap' }, home)).toBe(soap)
    expect(pantryItemFor({ name: 'Svelto', pantry_item_id: null }, home)).toBe(soap)
    const corn = item('corn', 'Corn Snack')
    expect(pantryItemFor({ name: 'corn snack', pantry_item_id: null }, [chips, corn])).toBe(corn)
    expect(pantryItemFor({ name: 'Nothing', pantry_item_id: null }, home)).toBeNull()
  })

  it('a name never matches a group, as before', () => {
    const group = item('g', 'Crisps', ['Lays'], { is_group: true })
    expect(pantryItemFor({ name: 'Lays', pantry_item_id: null }, [group])).toBeNull()
    expect(pantryItemFor({ name: 'Crisps', pantry_item_id: null }, [group])).toBeNull()
    expect(homeItemFor('Crisps', [group])).toBe(group)
  })

  it('the payload of a MONEY row keeps the name typed and sends the item', () => {
    const line = rowLine({ ...emptyRow(1), name: 'Corn Snack', priceText: '1.39', categoryId: 'snacks' }, home)
    expect(line.target).toBe(chips)
    const { lines } = pricedLines([line])
    const [sent] = moneyPurchasePayload({ id: 't', date: '2026-11-06', at: 'now', paidBy: 'shared', lines, budgetFor: () => null }).items
    expect(sent).toMatchObject({ name: 'Corn Snack', pantry_item_id: 'chips', add: 1, line_total: 1.39 })
  })
})

describe('the pack size of a line bought under another name (K60)', () => {
  it('starts with the name\'s own size for that unit; the usual text speaks of the name', () => {
    const line = rowLine({ ...emptyRow(1), name: 'Felix', priceText: '20', unit: 'box', unitTouched: true, categoryId: 'pet' }, home)
    expect(line.pack).toMatchObject({ text: '24', usual: 24, firstTime: false })
    expect(line.add).toBe(24)
  })

  it('without a size of its own: the item\'s, as today', () => {
    const line = rowLine({ ...emptyRow(1), name: 'Gourmet', priceText: '20', unit: 'box', unitTouched: true, categoryId: 'pet' }, home)
    expect(line.pack).toMatchObject({ text: '48', usual: 48 })
    expect(line.add).toBe(48)
  })

  it('a first-time size is never saved on the item from another name', () => {
    const wipes = item('w', 'Wipes', ['Nivea Wipes'])
    const row = { ...emptyRow(1), name: 'Nivea Wipes', priceText: '3', unit: 'pack', unitTouched: true, packSizeText: '20', packUnit: 'pack', categoryId: 'personal-care' }
    const line = rowLine(row, [wipes])
    expect(line.pack.firstTime).toBe(false)
    const { lines } = pricedLines([line])
    const [sent] = moneyPurchasePayload({ id: 't', date: '2026-11-06', at: 'now', paidBy: 'shared', lines, budgetFor: () => null }).items
    expect(sent.add).toBe(20)
    expect(sent.quantity_per_pack).toBeUndefined()
  })

  it("under the item's own name it is saved as always, in SHOP and in MONEY", () => {
    const wipes = item('w', 'Wipes', ['Nivea Wipes'])
    expect(rowLine({ ...emptyRow(1), name: 'Wipes', priceText: '3', unit: 'pack', unitTouched: true, packSizeText: '20', packUnit: 'pack', categoryId: 'personal-care' }, [wipes]).pack.firstTime).toBe(true)
    const entry = { id: 'e', name: 'Wipes', pantry_item_id: 'w', quantity: 1, unit: 'pack' }
    expect(purchaseLine(entry, [wipes], { pack: { text: '20', unit: 'pack' } }).pack.firstTime).toBe(true)
    expect(purchaseLine({ ...entry, name: 'Nivea Wipes' }, [wipes], { pack: { text: '20', unit: 'pack' } }).pack.firstTime).toBe(false)
  })

  it('Confirm purchase: 2 box of Felix at 24 = 48 pcs', () => {
    const line = purchaseLine({ id: 'e', name: 'Felix', pantry_item_id: 'cat', quantity: 2, unit: 'box' }, home)
    expect(line.add).toBe(48)
    expect(packItemFor(cat, 'Cat Wet Food', 'box')).toBe(cat)
    expect(boughtAsOtherName(cat, 'Cat Wet Food')).toBe(false)
    expect(boughtAsOtherName(cat, 'felix')).toBe(true)
  })
})

describe('name suggestions', () => {
  it('each other name is a suggestion "Corn Snack · Chips & Snacks", with the item to link', () => {
    const list = buildSuggestions(home, [])
    const [corn] = matchSuggestions(list, 'corn')
    expect(corn).toMatchObject({ name: 'Corn Snack', itemName: 'Chips & Snacks', pantryItemId: 'chips', unit: 'pcs', price: 0 })
  })

  it("its price is the name's, never the item's (K55)", () => {
    const priced = item('p', 'Pasta', [element('Barilla', { price: 1.2, price_qty: 500, price_unit: 'gr' }), 'De Cecco'], { price: 9 })
    const list = buildSuggestions([priced], [])
    expect(list.find((s) => s.name === 'Barilla')).toMatchObject({ price: 1.2, priceQty: 500, priceUnit: 'gr' })
    expect(list.find((s) => s.name === 'De Cecco')).toMatchObject({ price: 0, priceQty: null })
  })

  it("an item's own name wins over another item's other name, and over a SHOP card", () => {
    const corn = item('corn', 'Corn Snack')
    const list = buildSuggestions([chips, corn], [{ name: 'Corn Snack', unit: 'pcs', created_at: '1', pantry_item_id: null }])
    expect(list.filter((s) => s.name === 'Corn Snack')).toHaveLength(1)
    expect(list.find((s) => s.name === 'Corn Snack').itemName).toBeUndefined()
  })

  it('items with no names give exactly the list of before', () => {
    expect(buildSuggestions([milk, { ...soap, names: undefined }], []).map((s) => s.name)).toEqual(['Milk', 'Dish soap'])
  })
})

describe('last price by name: report section F (K55)', () => {
  const at = (day) => `2026-11-0${day}T10:00:00Z`
  const barilla = element('Barilla', { price: 1.2, price_qty: 500, price_unit: 'gr', added_at: at(3) })
  const pasta = item('pasta', 'Pasta', [barilla, 'De Cecco'], { price: 2, price_qty: 1, price_unit: 'kg', unit: 'kg', updated_at: at(5) })

  it("source 3: the name's stored price; source 4 is left out, the name is not the item's", () => {
    expect(lastPriceFor('Barilla', { pantryItems: [pasta] })).toMatchObject({ price: 1.2, quantity: 500, unit: 'gr', source: 'name' })
    expect(lastPriceFor('De Cecco', { pantryItems: [pasta] })).toBeNull()
  })

  it("source 4: the item itself, only for the item's own name", () => {
    expect(lastPriceFor('Pasta', { pantryItems: [pasta] })).toMatchObject({ price: 2, quantity: 1, unit: 'kg', source: 'pantry' })
  })

  it('a newer purchase line or order wins over the stored price, an older one does not', () => {
    const line = (day) => ({ name: 'Barilla', line_total: 1.4, quantity: 1, unit: 'pack', created_at: at(day) })
    expect(lastPriceFor('Barilla', { pantryItems: [pasta], tripLines: [line(4)] })).toMatchObject({ price: 1.4, source: 'trip' })
    expect(lastPriceFor('Barilla', { pantryItems: [pasta], tripLines: [line(2)] })).toMatchObject({ price: 1.2, source: 'name' })
    const order = { item_name: 'Barilla', price: 9, quantity: 6, unit: 'pack', status: 'arrived', created_at: at(4) }
    expect(lastPriceFor('barilla', { pantryItems: [pasta], orders: [order] })).toMatchObject({ price: 9, source: 'order' })
  })

  it('a price without a unit counts per the item\'s unit', () => {
    const tea = item('t', 'Tea', [element('Lipton', { price: 3 })], { unit: 'box' })
    expect(lastPriceFor('Lipton', { pantryItems: [tea] })).toMatchObject({ price: 3, quantity: 1, unit: 'box' })
  })
})

describe('searching', () => {
  const noCategory = () => null

  it('HOME: another name is found, under the own name and the other fields', () => {
    expect(searchRank(chips, 'corn', noCategory)).toBe(3)
    expect(searchRank(chips, 'chips', noCategory)).toBe(1)
    expect(searchRank(soap, 'svelt', noCategory)).toBe(3)
    expect(searchRank(milk, 'corn', noCategory)).toBe(-1)
    expect(anyNameIncludes(chips, 'nuvole')).toBe(true)
    expect(anyNameIncludes(chips, 'chips')).toBe(true)
    expect(anyNameIncludes(milk, 'nuvole')).toBe(false)
  })

  it('SHOP: found by another name, with "In it: …"', () => {
    const entry = { name: 'Dish soap', category_id: null }
    expect(matchesGrocerySearch(entry, 'svelt', noCategory, ['Svelto'])).toBe(true)
    expect(variantHint(entry, 'svelt', ['Svelto'])).toBe('In it: Svelto')
    expect(variantHint(entry, 'dish', ['Svelto'])).toBeNull()
  })
})

describe('the grey line of a tile (K57)', () => {
  it.each([
    [['Corn Snack'], 'also: Corn Snack', 0],
    [['Corn Snack', 'Nuvole di drago'], 'also: Corn Snack, Nuvole di drago', 0],
    [['Corn Snack', 'Nuvole di drago', 'Tortilla'], 'also: Corn Snack, Nuvole di drago…', 1],
    [['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10'], 'also: A1, B2…', 8],
  ])('%j', (names, text, more) => {
    expect(alsoLine(item('x', 'X', names))).toEqual({ text, more })
  })

  it('no line without names, and never its own name', () => {
    expect(alsoLine(milk)).toBeNull()
    expect(alsoLine({ ...milk, names: undefined })).toBeNull()
    expect(alsoLine(item('x', 'Corn Snack', ['corn snack']))).toBeNull()
  })
})

describe('who has names, and the lookup Map', () => {
  it('a normal item, never a group, a variant or a durable', () => {
    expect(canHaveNames(milk)).toBe(true)
    expect(canHaveNames(item('g', 'G', [], { is_group: true }))).toBe(false)
    expect(canHaveNames(item('v', 'V', [], { group_id: 'g' }))).toBe(false)
    expect(canHaveNames(item('d', 'D', [], { category_id: 'appliances' }))).toBe(false)
    expect(canHaveNames(null)).toBe(false)
  })

  it("own names stay first in a Map of names", () => {
    const corn = item('corn', 'Corn Snack')
    const map = addOtherNames(new Map([['corn snack', corn]]), [chips])
    expect(map.get('corn snack')).toBe(corn)
    expect(map.get('nuvole di drago')).toBe(chips)
  })
})

describe('"Other names": what Save sends', () => {
  const merged = element('Tortilla', { origin: { id: 'old' }, from_item_id: 'old' })
  const snacks = item('s', 'Snacks', [element('Corn Snack', { packaging_unit: 'box', quantity_per_pack: 12 }), 'Nuvole', merged])

  it('a draft per name; a merged one is marked', () => {
    expect(nameDrafts(snacks).map((d) => [d.name, d.unit, d.size, d.merged])).toEqual([
      ['Corn Snack', 'box', '12', false],
      ['Nuvole', '', '', false],
      ['Tortilla', '', '', true],
    ])
  })

  it('nothing changed: null, also for a pack unit kept without a size', () => {
    expect(namesChange(snacks, nameDrafts(snacks), 'pack')).toBeNull()
    const half = item('h', 'H', [element('Half', { packaging_unit: 'box' })])
    expect(namesChange(half, nameDrafts(half), 'pack')).toBeNull()
    expect(namesChange(milk, [...nameDrafts(milk), newNameDraft('n')], 'pack')).toBeNull()
  })

  it('adds, removes and edits with `was` as read', () => {
    const drafts = nameDrafts(snacks).filter((d) => d.name !== 'Nuvole').map((d) => (d.name === 'Corn Snack' ? { ...d, size: '10' } : d))
    drafts.push({ ...newNameDraft('n'), name: ' Popcorn ', size: '6' })
    expect(namesChange(snacks, drafts, 'pack')).toEqual({
      item_id: 's',
      add: [{ name: 'Popcorn', packaging_unit: 'pack', quantity_per_pack: 6, price: null, price_qty: null, price_unit: null }],
      remove: ['Nuvole'],
      edit: [{ name: 'Corn Snack', packaging_unit: 'box', quantity_per_pack: 10 }],
      was: { names: snacks.names },
    })
  })

  it('emptying a pack size sends empty fields', () => {
    const drafts = nameDrafts(snacks).map((d) => (d.name === 'Corn Snack' ? { ...d, size: '' } : d))
    expect(namesChange(snacks, drafts, 'pack').edit).toEqual([{ name: 'Corn Snack', packaging_unit: null, quantity_per_pack: null }])
  })

  it('K59: a word of another item stops, by its name or its other name, with the note', () => {
    const drafts = [{ ...newNameDraft('a'), name: 'Milk' }, { ...newNameDraft('b'), name: 'svelto' }, { ...newNameDraft('c'), name: 'Rice Cakes' }]
    const problems = draftProblems(drafts, { item: chips, ownName: 'Chips & Snacks', items: home })
    expect(problems.get('a')).toBe('"Milk" is already a name of "Milk" in HOME.')
    expect(problems.get('b')).toBe('"svelto" is already a name of "Dish soap" in HOME.')
    expect(problems.has('c')).toBe(false)
  })

  it('a name twice on the list, or the own name, stops too; a bad pack size says so', () => {
    const drafts = [...nameDrafts(chips), { ...newNameDraft('a'), name: 'corn snacks' }, { ...newNameDraft('b'), name: 'Chips & Snacks' }, { ...newNameDraft('c'), name: 'Good', size: '0' }, { ...newNameDraft('d'), name: 'Better', size: '1,2,3' }]
    const problems = draftProblems(drafts, { item: chips, ownName: 'Chips & Snacks', items: home })
    expect(problems.get('a')).toBe(takenNote('corn snacks', { name: 'Chips & Snacks' }))
    expect(problems.get('b')).toBe(takenNote('Chips & Snacks', { name: 'Chips & Snacks' }))
    expect(problems.get('c')).toBe('Quantity per pack must be more than 0.')
    expect(problems.get('d')).toBeTruthy()
  })
})
