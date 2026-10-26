import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const {
  addedMessage,
  alreadyListedText,
  countedWords,
  exactKey,
  goToLabel,
  inHomeNote,
  matchHomeItems,
  matchKind,
  moreMatchesText,
  sameItemName,
  similarOnListText,
  shopEntryFor,
  typoEqual,
  pickLabel,
} = await import('./similarItems')
const { LIVE_ITEM_NAMES } = await import('../data/liveItemNames.fixture')

let nextId = 1
const item = (name, extra = {}) => ({ id: `p${nextId++}`, name, unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh', ...extra })
const names = (result) => result.similar.map((m) => m.item.name)

describe('names', () => {
  it('the exact key: capitals, accents, punctuation, spaces and plurals ignored; numbers and units kept', () => {
    expect(exactKey('  Dish   Soaps! ')).toBe('dish soap')
    expect(exactKey('Caffè')).toBe('caffe')
    expect(exactKey('Milk 1L')).toBe('milk 1l')
    expect(exactKey('Glasses')).toBe('glasses')
    expect(sameItemName('Cucumbers', 'cucumber')).toBe(true)
    expect(sameItemName('Milk 1L', 'Milk 500ml')).toBe(false)
  })

  it('counted words leave out numbers, units and linking words', () => {
    expect(countedWords('Snack - Bulk Beef Jerky Sweet Chilli 100 g')).toEqual(['snack', 'bulk', 'beef', 'jerky', 'sweet', 'chilli'])
    expect(countedWords('Chicken Slice - Affettato di pollo')).toEqual(['chicken', 'slice', 'affettato', 'pollo'])
    expect(countedWords('Milk 500ml')).toEqual(['milk'])
    expect(countedWords('Pane & Olio 2 pz')).toEqual(['pane', 'olio'])
    expect(countedWords('Kopi yang enak untuk pagi')).toEqual(['kopi', 'enak', 'pagi'])
  })

  it('typo-equal words: short words identical, 5–8 letters one step, 9 or more two', () => {
    expect(typoEqual('pumkin', 'pumpkin')).toBe(true)
    expect(typoEqual('tea', 'pea')).toBe(false)
    expect(typoEqual('rice', 'ice')).toBe(false)
    expect(typoEqual('salt', 'malt')).toBe(false)
    expect(typoEqual('pomodori', 'pomodoro')).toBe(true)
    expect(typoEqual('chicken', 'chinese')).toBe(false)
    expect(typoEqual('mozzarela', 'mozzarella')).toBe(true)
    expect(typoEqual('electrolites', 'electrolytes')).toBe(true)
    expect(typoEqual('elettrolyte', 'electrolytes')).toBe(true)
  })
})

describe('matching classes', () => {
  it('exact', () => {
    expect(matchKind('Cucumber', 'cucumber')).toBe('exact')
    expect(matchKind('Dish Soap', 'Dish soap')).toBe('exact')
  })

  it('pumpkin', () => {
    expect(matchKind('Pumpkin', 'Fresh Pumpkin')).toBe('words')
    expect(matchKind('Pumkin', 'Fresh Pumpkin')).toBe('words')
    expect(matchKind('Fresh Pumkin', 'Fresh Pumpkin')).toBe('typo')
    expect(matchKind('Pumpkin Cubes', 'Fresh Pumpkin')).toBeNull()
    expect(matchKind('Frozen Pumpkin Cubes', 'Fresh Pumpkin')).toBeNull()
  })

  it('short words never match by a typo', () => {
    expect(matchKind('Tea', 'Pea')).toBeNull()
    expect(matchKind('Rice', 'Ice')).toBeNull()
    expect(matchKind('Salt', 'Malt')).toBeNull()
  })

  it('"Milk 1L" and "Milk 500ml" are not exact, but similar (words)', () => {
    expect(matchKind('Milk 1L', 'Milk 500ml')).toBe('words')
  })
})

describe('matchHomeItems', () => {
  it('"Cucumber" is the HOME item "cucumber": used without a question', () => {
    const cucumber = item('cucumber')
    expect(matchHomeItems('Cucumber', [cucumber, item('Fresh Cucumber Salad')])).toEqual({ exact: cucumber, similar: [], more: 0 })
  })

  it('"Pumpkin" and "Pumkin" ask about Fresh Pumpkin; "Pumpkin Cubes" and "Frozen Pumpkin Cubes" don\'t', () => {
    const home = [item('Fresh Pumpkin')]
    expect(names(matchHomeItems('Pumpkin', home))).toEqual(['Fresh Pumpkin'])
    expect(names(matchHomeItems('Pumkin', home))).toEqual(['Fresh Pumpkin'])
    expect(matchHomeItems('Pumpkin Cubes', home)).toEqual({ exact: null, similar: [], more: 0 })
    expect(matchHomeItems('Frozen Pumpkin Cubes', home)).toEqual({ exact: null, similar: [], more: 0 })
  })

  it('"Snack" → only Corn Snack', () => {
    const home = ['Corn Snack', 'Chicken Feet Snack', 'Kinder Buono Snack', 'Kiss Burn Chinese Snack', 'Snack - Bulk Beef Jerky Sweet Chilli 100 g'].map((n) => item(n))
    expect(names(matchHomeItems('Snack', home))).toEqual(['Corn Snack'])
  })

  it('"Chicken" → nothing', () => {
    const home = ['Chicken Feet Snack', 'Frozen Chinese Chicken Sausage', 'Chicken Slice - Affettato di pollo'].map((n) => item(n))
    expect(matchHomeItems('Chicken', home)).toEqual({ exact: null, similar: [], more: 0 })
  })

  it('"Powder" → only Electrolytes Powder; "Gel" → only Hair Gel', () => {
    const powders = ['Electrolytes Powder', 'Instant Tofu Powder', 'Stain Remover Powder'].map((n) => item(n))
    expect(names(matchHomeItems('Powder', powders))).toEqual(['Electrolytes Powder'])
    const gels = ['Hair Gel', 'Toilet Deodorizer Gel'].map((n) => item(n))
    expect(names(matchHomeItems('Gel', gels))).toEqual(['Hair Gel'])
  })

  it('"Patatine" → only Patatine teriyaki', () => {
    const home = ['Chips - Patatine Peperoncino', 'Chips - Patatine sale olive', 'Patatine teriyaki'].map((n) => item(n))
    expect(names(matchHomeItems('Patatine', home))).toEqual(['Patatine teriyaki'])
  })

  it('more than 3 matches → 3: typo before words, Out / Low first, then fewer words, shorter name, A–Z', () => {
    const home = [
      item('Tomato Sauce'),
      item('Tomato Paste', { current_stock: 1, min_stock: 2 }),
      item('Tomatoes'),
      item('Tomato Soup', { current_stock: 0 }),
      item('Tomato Chips'),
      item('Tomatoe'),
    ]
    // "Tomatoe" is a typo of "tomato" (one word each); the rest share the
    // word (half-name rule): the Low and Out ones first, then A–Z.
    expect(matchHomeItems('Tomato', home).exact.name).toBe('Tomatoes')
    const asked = matchHomeItems('Tomato', home.filter((p) => p.name !== 'Tomatoes'))
    expect(asked.similar.map((m) => [m.item.name, m.kind])).toEqual([
      ['Tomatoe', 'typo'],
      ['Tomato Soup', 'words'],
      ['Tomato Paste', 'words'],
    ])
    // Tomato Chips and Tomato Sauce matched too but are not shown.
    expect(asked.more).toBe(2)
    expect(moreMatchesText(asked.more)).toBe('2 more — type more of the name')
  })

  it('a finished 1× item counts as Out; groups and variants are searched; durables never', () => {
    const balloons = item('Party Balloons', { one_time: true, current_stock: 0, category_id: 'misc' })
    const plenty = item('Balloons Red', { current_stock: 10 })
    const chips = item('Chips & Snacks', { is_group: true, current_stock: 3 })
    const variant = item('Lays Chips', { group_id: chips.id })
    const lamp = item('Balloon Lamp', { category_id: 'appliances' })
    expect(names(matchHomeItems('Balloons', [plenty, balloons, lamp]))).toEqual(['Party Balloons', 'Balloons Red'])
    expect(names(matchHomeItems('Chips', [chips, variant]))).toEqual(['Lays Chips', 'Chips & Snacks'])
  })

  it('an exact normal item wins over a group with the same name; the edited item is never compared with itself', () => {
    const group = item('Pasta', { is_group: true })
    const pasta = item('pasta')
    expect(matchHomeItems('Pasta', [group, pasta]).exact).toBe(pasta)
    expect(matchHomeItems('Pasta', [pasta], { exceptId: pasta.id })).toEqual({ exact: null, similar: [], more: 0 })
  })

  it('an empty name matches nothing', () => {
    expect(matchHomeItems('  ', [item('Milk')])).toEqual({ exact: null, similar: [], more: 0 })
  })
})

describe('shopEntryFor', () => {
  const soap = item('Dish soap')
  const entry = (name, extra = {}) => ({ id: `g${nextId++}`, name, quantity: 1, unit: 'pcs', completed: false, in_cart: false, pantry_item_id: null, ...extra })

  it('an entry linked to the item counts; to buy first, then in the cart, then ordered online', () => {
    const cart = entry('Dish soap', { pantry_item_id: soap.id, in_cart: true })
    const ordered = entry('Dish soap', { pantry_item_id: soap.id })
    expect(shopEntryFor({ item: soap, name: soap.name }, [ordered, cart], { orderedIds: new Set([ordered.id]) })).toEqual({ entry: cart, state: 'in-cart' })
    expect(shopEntryFor({ item: soap, name: soap.name }, [ordered], { orderedIds: new Set([ordered.id]) })).toEqual({ entry: ordered, state: 'ordered' })
  })

  it('an entry without a HOME item counts by its name (exact, typo or words); bought ones and other items\' entries never', () => {
    const typed = entry('Fresh Pumpkin')
    expect(shopEntryFor({ name: 'Pumkin' }, [typed])).toEqual({ entry: typed, state: 'to-buy' })
    expect(shopEntryFor({ name: 'Pumkin' }, [typed], { kinds: ['exact'] })).toBeNull()
    expect(shopEntryFor({ name: 'Fresh Pumpkin' }, [entry('Fresh Pumpkin', { completed: true })])).toBeNull()
    expect(shopEntryFor({ name: 'Fresh Pumpkin' }, [entry('Fresh Pumpkin', { pantry_item_id: 'other' })])).toBeNull()
  })
})

describe('texts', () => {
  it('stock, use buttons and the toast', () => {
    const pumpkin = item('Fresh Pumpkin')
    expect(pickLabel(pumpkin)).toBe('Use Fresh Pumpkin · 2 pcs at home')
    expect(pickLabel({ ...pumpkin, current_stock: 0 }, 'in-cart')).toBe('Use Fresh Pumpkin · out of stock · already in the cart')
    expect(pickLabel({ ...pumpkin, one_time: true, current_stock: 0 }, 'ordered')).toBe('Use Fresh Pumpkin · finished 1× item, it comes back · ordered online')
    expect(addedMessage(item('cucumber'))).toBe('Added “cucumber” · in HOME: 2 pcs')
    expect(addedMessage(item('cucumber', { current_stock: 0 }))).toBe('Added “cucumber” · out of stock')
    expect(addedMessage(item('Balloons', { one_time: true, current_stock: 0 }))).toBe('Added “Balloons” · finished 1× item, it comes back')
    expect(inHomeNote(item('Rice', { unit: 'kg', current_stock: 1.5 }))).toBe('In HOME: 1.5 kg')
    expect(goToLabel(item('Balloons', { one_time: true, current_stock: 0 }))).toBe('Go to Balloons (finished 1×)')
    expect(alreadyListedText({ entry: { name: 'Dish soap' }, state: 'in-cart' })).toBe('Already on your SHOP list: Dish soap — in the cart')
  })

  it('MONEY: a similar card on the SHOP list', () => {
    expect(similarOnListText({ name: 'Pumpkin' })).toBe('Similar on your SHOP list: Pumpkin — it stays there.')
  })
})

describe('the 253 HOME names of 25/10', () => {
  it('every name runs through the matcher without errors, and finds itself as exact', () => {
    const home = LIVE_ITEM_NAMES.map((n) => item(n))
    for (const p of home) {
      expect(() => matchHomeItems(p.name, home)).not.toThrow()
      expect(matchKind(p.name, p.name)).toBe('exact')
      for (const word of countedWords(p.name)) expect(() => matchHomeItems(word, home)).not.toThrow()
    }
  })
})
