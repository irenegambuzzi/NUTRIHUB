import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const {
  changedMeanwhileText,
  hasName,
  isOwnName,
  itemForName,
  mergeCheck,
  missingNamesColumn,
  nameElement,
  nameElements,
  nameTakenBy,
  namesColumnReady,
  otherNames,
  separationCheck,
  takenText,
} = await import('./itemNames')

const item = (id, name, extra = {}) => ({ id, name, unit: 'pcs', current_stock: 0, category_id: 'snacks', ...extra })
const named = (...names) => names.map((name) => (typeof name === 'string' ? { name } : name))

describe('reading the names of an item', () => {
  it('reads the list safely: no list, not a list, or an element without a name', () => {
    expect(nameElements(undefined)).toEqual([])
    expect(nameElements(item('a', 'Tea'))).toEqual([])
    expect(nameElements({ names: 'x' })).toEqual([])
    expect(nameElements({ names: [{ name: 'Green' }, { name: '  ' }, null, {}] })).toEqual([{ name: 'Green' }])
  })

  it('other names: never the own name (a merge may keep one for its row), each once, in the order of the list', () => {
    const tray = item('a', 'Snack Tray', { names: named('Corn Snacks', 'SNACK TRAY', 'corn snack', 'Tortilla') })
    expect(otherNames(tray).map((e) => e.name)).toEqual(['Corn Snacks', 'Tortilla'])
    expect(otherNames(item('b', 'Plain'))).toEqual([])
  })

  it('compares with the exact-name key of the safety net: capitals, accents, punctuation, plurals; numbers stay', () => {
    const milk = item('m', 'Milk 1L', { names: named('Latte Fresco', 'Caffè') })
    expect(isOwnName(milk, ' milk  1L ')).toBe(true)
    expect(isOwnName(milk, 'Milk 500ml')).toBe(false)
    expect(hasName(milk, 'latte-fresco')).toBe(true)
    expect(hasName(milk, 'caffe')).toBe(true)
    expect(hasName(milk, 'Latte')).toBe(false)
    expect(hasName(milk, '')).toBe(false)
    expect(nameElement(milk, 'LATTE FRESCO')).toEqual({ name: 'Latte Fresco' })
    expect(nameElement(milk, 'nothing')).toBeNull()
    expect(nameElement(milk, '   ')).toBeNull()
  })
})

describe('finding the item of a typed name', () => {
  const chips = item('c', 'Chips & Snacks', { names: named('Patatine Rosse', 'Mais Tostato') })
  const cat = item('w', 'Cat Wet Food', { unit: 'pcs', names: named({ name: 'Felix', quantity_per_pack: 24 }) })
  const group = item('g', 'Pasta', { is_group: true, names: named('Penne') })
  const pasta = item('p', 'Pasta', {})
  const items = [chips, cat, group, pasta]

  it('by its own name or by an other name, and says which', () => {
    expect(itemForName('chips & snacks', items)).toEqual({ item: chips, own: true })
    expect(itemForName('patatine rosse', items)).toEqual({ item: chips, own: false })
    expect(itemForName('Felix', items)).toEqual({ item: cat, own: false })
    expect(itemForName('Gourmet', items)).toBeNull()
    expect(itemForName('', items)).toBeNull()
  })

  it('an own name goes before another item\'s other name, a normal item before a group of that name', () => {
    const shadow = item('s', 'Shadow', { names: named('Felix') })
    const owner = item('f', 'Felix', {})
    expect(itemForName('felix', [shadow, owner])).toEqual({ item: owner, own: true })
    expect(itemForName('pasta', items)).toEqual({ item: pasta, own: true })
    expect(itemForName('pasta', [group])).toEqual({ item: group, own: true })
  })

  it('never a group when asked (the purchase\'s name match), never the item itself', () => {
    expect(itemForName('Penne', items)).toEqual({ item: group, own: false })
    expect(itemForName('Penne', items, { groups: false })).toBeNull()
    expect(itemForName('Felix', items, { exceptId: 'w' })).toBeNull()
  })

  it('K59: a word belongs to one item; a similar word is allowed; the same item is no conflict', () => {
    expect(nameTakenBy('MAIS TOSTATO', items)).toBe(chips)
    expect(nameTakenBy('Cat Wet Foods', items)).toBe(cat)
    expect(nameTakenBy('Mais Tostato 200 g', items)).toBeNull()
    expect(nameTakenBy('Mais Tostato', items, ['c'])).toBeNull()
    expect(takenText('Mais Tostato', chips)).toBe('"Mais Tostato" is already a name of "Chips & Snacks" in HOME. Nothing was changed.')
    expect(changedMeanwhileText('Chips & Snacks')).toBe('"Chips & Snacks" changed meanwhile (on the other phone?) — open it again. Nothing was changed.')
  })
})

describe('merge checks', () => {
  const target = item('t', 'Meat Snacks', { current_stock: 1, packaging_unit: 'pack', quantity_per_pack: 3 })
  const check = (sources, extra = {}, items = null) => {
    const into = { ...target, ...extra }
    return mergeCheck({ target: into, sources, items: items ?? [into, ...sources] })
  }

  it('sums the stock over several sources (report H.4: 2 pcs + 1 pack × 3 + 1 = 6 pcs)', () => {
    const jerky = item('j', 'Jerky', { current_stock: 2 })
    const feet = item('f', 'Chicken Feet', { unit: 'pack', current_stock: 1 })
    const out = check([jerky, feet])
    expect(out.problem).toBeNull()
    expect(out.moves.map((m) => [m.source.id, m.factor, m.moved])).toEqual([['j', 1, 2], ['f', 3, 3]])
    expect(out.moved).toBe(5)
    expect(out.stockAfter).toBe(6)
  })

  it('K44: a source at 0 is never refused for its unit; with stock it needs a conversion', () => {
    const empty = item('j', 'Jerky', { unit: 'bag', current_stock: 0 })
    expect(check([empty])).toMatchObject({ problem: null, moved: 0, stockAfter: 1 })
    expect(check([empty]).moves[0].factor).toBeNull()
    const stocked = item('k', 'Kale Chips', { unit: 'bag', current_stock: 1 })
    expect(check([stocked]).problem).toBe('"Kale Chips" is counted in bag, "Meat Snacks" in pcs, and they can\'t be converted — change the unit first. Nothing was changed.')
    const flour = item('t', 'Flour', { unit: 'gr', current_stock: 250, packaging_unit: null, quantity_per_pack: null })
    expect(mergeCheck({ target: flour, sources: [item('k', 'Tipo 00', { unit: 'kg', current_stock: 1.5 })], items: [flour] })).toMatchObject({ problem: null, moved: 1500, stockAfter: 1750 })
    const water = item('t', 'Water', { unit: 'L', current_stock: 1, packaging_unit: null })
    expect(mergeCheck({ target: water, sources: [item('m', 'Fizzy', { unit: 'ml', current_stock: 500 })], items: [water] })).toMatchObject({ problem: null, moved: 0.5, stockAfter: 1.5 })
  })

  it('K46: sources are normal items or the target\'s variants; a group target is fine; a variant target or a group with variants is refused', () => {
    const group = item('g', 'Chips & Snacks', { is_group: true })
    const variant = item('v', 'Corn Snack', { group_id: 'g', current_stock: 2 })
    expect(mergeCheck({ target: group, sources: [variant], items: [group, variant] })).toMatchObject({ problem: null, moved: 2 })
    const normal = item('n', 'Nuts', { current_stock: 1 })
    expect(mergeCheck({ target: variant, sources: [normal], items: [group, variant, normal] }).problem).toBe('"Corn Snack" is a variant — merge into its group, or take it out of the group first. Nothing was changed.')
    expect(mergeCheck({ target: normal, sources: [variant], items: [group, variant, normal] }).problem).toBe('"Corn Snack" is a variant of another group — take it out of that group first. Nothing was changed.')
    expect(mergeCheck({ target: normal, sources: [group], items: [group, variant, normal] }).problem).toBe('"Chips & Snacks" is a group with variants — merge its variants into it first. Nothing was changed.')
    const emptyGroup = item('e', 'Empty', { is_group: true })
    expect(mergeCheck({ target: normal, sources: [emptyGroup], items: [normal, emptyGroup] }).problem).toBeNull()
  })

  it('never a durable', () => {
    const toaster = item('d', 'Toaster', { category_id: 'appliances' })
    expect(check([toaster]).problem).toBe('"Toaster" is a durable, so it can\'t be merged. Nothing was changed.')
    const normal = item('n', 'Nuts', {})
    expect(mergeCheck({ target: toaster, sources: [normal], items: [toaster, normal] }).problem).toBe('"Toaster" is a durable, so it can\'t be merged. Nothing was changed.')
  })

  it('K59: a name of a third item is refused, also a name the source brings along; the target and the sources never count', () => {
    const source = item('s', 'Beef Jerky', { names: named('Bulk Jerky') })
    const third = item('x', 'Other', { names: named('bulk jerky') })
    expect(check([source], {}, [target, source, third]).problem).toBe('"Bulk Jerky" is already a name of "Other" in HOME. Nothing was changed.')
    const twin = item('y', 'beef jerky', {})
    expect(check([source], {}, [target, source, twin]).problem).toBe('"Beef Jerky" is already a name of "beef jerky" in HOME. Nothing was changed.')
    expect(check([source, twin]).problem).toBeNull()
    expect(check([item('z', 'Meat Snacks', {})]).problem).toBeNull()
  })

  it('a text stock is a number; no stock is 0', () => {
    expect(mergeCheck({ target: { ...target, current_stock: '4.5' }, sources: [item('a', 'A', { current_stock: '0.5' }), item('b', 'B', { current_stock: null })], items: [] })).toMatchObject({ moved: 0.5, stockAfter: 5 })
  })
})

describe('separation checks', () => {
  const origin = { id: 'j', unit: 'pack', name: 'Jerky' }
  const parent = item('t', 'Meat Snacks', {
    current_stock: 12,
    names: named(
      { name: 'Jerky', origin, packaging_unit: 'pack', quantity_per_pack: 6 },
      { name: 'Feet', origin: { id: 'f', unit: 'bag', name: 'Feet' } },
      { name: 'Sugar', origin: { id: 's', unit: 'kg', name: 'Sugar' } },
      { name: 'Same', origin: { id: 'a', unit: 'pcs', name: 'Same' } },
      'Plain'
    ),
  })
  const check = (name, stockMoved, items = [parent]) => separationCheck({ item: parent, name, stockMoved, items })

  it('with an origin: counted in the old unit through the name\'s pack size (12 pcs = 2 pack), the same unit as is', () => {
    expect(check('Jerky', 12)).toMatchObject({ problem: null, unit: 'pack', stock: 2, stockLeft: 0, origin })
    expect(check('Same', 5)).toMatchObject({ problem: null, unit: 'pcs', stock: 5, stockLeft: 7 })
  })

  it('K44: no conversion known → counts in the item\'s unit, so no stock is lost', () => {
    expect(check('Feet', 3)).toMatchObject({ problem: null, unit: 'pcs', stock: 3, stockLeft: 9 })
  })

  it('kg ↔ gr: the item in gr, the old unit kg: 1500 gr = 1.5 kg', () => {
    const sugar = item('t', 'Sugar Tin', { unit: 'gr', current_stock: 2000, names: named({ name: 'Cane', origin: { unit: 'kg' } }) })
    expect(separationCheck({ item: sugar, name: 'Cane', stockMoved: 1500, items: [sugar] })).toMatchObject({ unit: 'kg', stock: 1.5, stockLeft: 500 })
  })

  it('without an origin: the item\'s unit; stock 0 is allowed', () => {
    expect(check('Plain', 0)).toMatchObject({ problem: null, origin: null, unit: 'pcs', stock: 0, stockLeft: 12 })
  })

  it('refused: the own name, not a name, below 0, above the stock, not a number, another item has it', () => {
    expect(check('MEAT SNACKS', 1).problem).toBe('"Meat Snacks" is the item\'s own name, so it can\'t be separated. Nothing was changed.')
    expect(check(' Honey ', 1).problem).toBe('"Honey" is not a name of "Meat Snacks". Nothing was changed.')
    const bounds = 'The stock to move must be between 0 and 12 pcs. Nothing was changed.'
    expect(check('Jerky', -1).problem).toBe(bounds)
    expect(check('Jerky', 12.5).problem).toBe(bounds)
    expect(check('Jerky', 'x').problem).toBe(bounds)
    expect(check('Jerky', null).problem).toBe(bounds)
    expect(check('Jerky', '').problem).toBe(bounds)
    expect(check('Jerky', 1, [parent, item('o', 'jerky', {})]).problem).toBe('"Jerky" is already a name of "jerky" in HOME. Nothing was changed.')
  })
})

describe('032 or not', () => {
  it('the column error, and items read with all their columns', () => {
    expect(missingNamesColumn({ code: '42703', message: 'column pantry_items.names does not exist' })).toBe(true)
    expect(missingNamesColumn({ code: 'PGRST204', message: "Could not find the 'names' column of 'pantry_items'" })).toBe(true)
    expect(missingNamesColumn({ code: '42703', message: 'column pantry_items.nickname does not exist' })).toBe(false)
    expect(missingNamesColumn({ code: '500', message: 'names' })).toBe(false)
    expect(missingNamesColumn(null)).toBe(false)
    expect(namesColumnReady([{ id: 'a', names: [] }])).toBe(true)
    expect(namesColumnReady([{ id: 'a' }])).toBe(false)
    expect(namesColumnReady([])).toBe(false)
    expect(namesColumnReady(undefined)).toBe(false)
  })
})
