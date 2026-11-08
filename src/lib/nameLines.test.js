import { describe, expect, it } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'
import { cardStock, confirmationPayload, emptyNameLine, expiryOncePerItem, laterNameLine, namePriceTotal, newNameOnce, purchaseLine, purchasePricing } from './purchase'
import { cardTitle, EMPTY_NAME_TEXT, lineNaming, namedPack, nameChips } from './itemNames'
import { emptyRow, homeNote, moneyPurchasePayload, pricedLines, rowLine } from './moneyPurchase'
import { spreadParts } from './sharedParts'
import { cardCount } from './trips'
import { reopenNotes } from './reopenUnits'
import { lineTotal } from './pricing'

// Plan 9N, stage 3: name lines in "Confirm purchase" and MONEY "Add
// expense" — what each line means, what it adds and what it sends. The
// payers come from PAID_BY_OPTIONS (never written out here).
const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')

const element = (name, extra = {}) => ({ name, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null, from_item_id: null, origin: null, added_at: '2026-11-01T10:00:00Z', added_by_trip: null, pack_by_trip: null, ...extra })
const item = (id, name, names = [], extra = {}) => ({ id, name, unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'snacks', names: names.map((n) => (typeof n === 'string' ? element(n) : n)), ...extra })

const chips = item('chips', 'Chips & Snacks', ['Corn Snack', 'Nuvole di drago'], { min_stock: 2 })
const crackers = item('crackers', 'Crackers', ['Tuc'])
const cat = item('cat', 'Cat Wet Food', [element('Felix', { packaging_unit: 'box', quantity_per_pack: 24 }), 'Gourmet'], { category_id: 'pets', packaging_unit: 'box', quantity_per_pack: 48 })
const treats = item('treats', 'Dog Treats', ['Chew Sticks'], { category_id: 'pets', current_stock: 0 })
const yogurt = item('yogurt', 'Yogurt Pots', ['Yogurt Greco'], { category_id: 'dairy', current_stock: 3, expiry_date: '2020-01-01' })
const home = [chips, crackers, cat, treats, yogurt]

const card = (id, name, pantryId, extra = {}) => ({ id, name, pantry_item_id: pantryId, quantity: 1, unit: 'pcs', price: 0, price_qty: 1, price_unit: 'pcs', payer: 'shared', category_id: 'snacks', ...extra })
const draft = (key, name, total, extra = {}) => ({ ...emptyNameLine(key, 'pcs'), name, totalText: total, ...extra })
const totalOf = (i) => lineTotal(i)
const payload = (lines, answers = {}, more = {}) => confirmationPayload({ id: 'trip', date: '2026-11-07', at: 'now', lines, answers, totalOf, expenseCategoryFor: () => 'groceries', ...more })

// The receipt of the household's example: Corn Snack €1.39 (the card), then
// Nuvole di drago €0.99 and a new Patatine paprika €1.49 = €3.87.
function snackPurchase(payer = P1) {
  const entry = card('e1', 'Chips & Snacks', 'chips', { price: 1.39, payer })
  const first = purchaseLine(entry, home, {}, { typedName: 'Corn Snack' })
  const second = laterNameLine(first, draft(1, 'Nuvole di drago', '0,99'), home)
  const third = laterNameLine(first, draft(2, 'Patatine paprika', '1.49'), home)
  return [first, second, third]
}

describe('what the name on a line means (K50, K59, K94)', () => {
  const name = (typed, extra = {}) => lineNaming({ item: chips, cardName: 'Chips & Snacks', name: typed, items: home, ...extra })

  it('the item\'s own name or one of its names is a plain line; the stored spelling is sent', () => {
    expect(name('Chips & Snacks')).toMatchObject({ kind: 'own', name: 'Chips & Snacks', problem: '', note: '' })
    expect(name('corn snacks')).toMatchObject({ kind: 'known', name: 'Corn Snack', changed: true, problem: '', note: '' })
  })

  it('a brand-new name: add_name, with "New name of …"; a merely similar one is the same (no question)', () => {
    expect(name('Patatine paprika')).toMatchObject({ kind: 'new', problem: '', note: 'New name of Chips & Snacks — it will be remembered.' })
    expect(name('Corn Snak')).toMatchObject({ kind: 'new', problem: '' })
  })

  it('K94: a name of ANOTHER item is refused with the stage-2 text', () => {
    expect(name('tuc')).toMatchObject({ kind: 'taken', problem: '"tuc" is already a name of "Crackers" in HOME.' })
    expect(name('Cat Wet Food')).toMatchObject({ kind: 'taken', problem: '"Cat Wet Food" is already a name of "Cat Wet Food" in HOME.' })
  })

  it('an empty name: refused on lines 2…N; on the card\'s own line it stays the card\'s', () => {
    expect(name('  ')).toMatchObject({ kind: 'empty', problem: EMPTY_NAME_TEXT })
    expect(EMPTY_NAME_TEXT).toBe('Type the name of this line.')
    expect(name('', { first: true })).toMatchObject({ kind: 'own', name: 'Chips & Snacks', changed: false })
  })

  it('a card under its own word that is no name of the item is left as it is', () => {
    const odd = lineNaming({ item: chips, cardName: 'Snack mix', name: 'Snack mix', items: home, first: true })
    expect(odd).toMatchObject({ kind: 'card', changed: false, problem: '' })
  })
})

describe('€1.39 + €0.99 + €1.49 = €3.87 on one card', () => {
  it('three lines of the card, each with its own name, quantity and price; one payer (K92); stock +1 each', () => {
    const lines = snackPurchase()
    expect(lines.map((l) => [l.naming.kind, l.add, l.ready])).toEqual([['known', 1, true], ['known', 1, true], ['new', 1, true]])
    const sent = payload(lines).items
    expect(sent.map((l) => [l.grocery_item_id, l.name, l.line_total, l.add, l.payer, l.pantry_item_id, Boolean(l.add_name)])).toEqual([
      ['e1', 'Corn Snack', 1.39, 1, P1, 'chips', false],
      ['e1', 'Nuvole di drago', 0.99, 1, P1, 'chips', false],
      ['e1', 'Patatine paprika', 1.49, 1, P1, 'chips', true],
    ])
    expect(sent.every((l) => l.quantity === 1 && l.unit === 'pcs' && l.price_qty === 1 && l.price_unit === 'pcs')).toBe(true)
    expect(sent.map((l) => l.price)).toEqual([1.39, 0.99, 1.49])
    expect(Math.round(sent.reduce((s, l) => s + l.line_total, 0) * 100) / 100).toBe(3.87)
    expect(cardStock(lines)).toEqual({ total: 3, unit: 'pcs' })
    expect(cardCount(sent.map((l, i) => ({ id: `l${i}`, grocery_item_id: l.grocery_item_id })))).toBe(1)
  })

  it('K92: lines 2…N take line 1\'s payer at the moment of Confirm, never their own', () => {
    expect(payload(snackPurchase(P2)).items.map((l) => l.payer)).toEqual([P2, P2, P2])
  })

  it('coupon −€0.39 → shares 0.14 + 0.10 + 0.15; paid 1.25 + 0.89 + 1.34 = €3.48; the price stays the normal one (J.5)', () => {
    const lines = snackPurchase()
    const pricing = purchasePricing(lines.map((l) => l.item), totalOf, {}, { kind: 'amount', text: '0,39' })
    const sent = payload(lines, {}, { pricing }).items
    expect(sent.map((l) => l.coupon_share)).toEqual([0.14, 0.1, 0.15])
    expect(sent.map((l) => l.line_total)).toEqual([1.25, 0.89, 1.34])
    expect(sent.map((l) => l.list_total)).toEqual([1.39, 0.99, 1.49])
    expect(sent.map((l) => l.price)).toEqual([1.39, 0.99, 1.49])
    expect(pricing.priced.paidTotal).toBe(3.48)
  })

  it('Shared, the first person paid €2.00 of €3.87: 0.72 + 0.51 + 0.77; the second 0.67 + 0.48 + 0.72 = €1.87', () => {
    const lines = snackPurchase('shared')
    const parts = spreadParts([1.39, 0.99, 1.49], { [P1]: 2, [P2]: 1.87 })
    const partsByItem = new Map(lines.map((l, i) => [l.item.id, parts[i]]))
    const sent = payload(lines, {}, { partsByItem }).items
    expect(sent.map((l) => l[`part_${P1}`])).toEqual([0.72, 0.51, 0.77])
    expect(sent.map((l) => l[`part_${P2}`])).toEqual([0.67, 0.48, 0.72])
    expect(sent.map((l) => l.payer)).toEqual(['shared', 'shared', 'shared'])
  })

  it('K51: a new line starts at 1 in the card\'s unit and changes no other line', () => {
    const fresh = emptyNameLine(7, 'box')
    expect(fresh).toMatchObject({ name: '', quantityText: '1', unit: 'box', totalText: '' })
    const [first] = snackPurchase()
    const more = laterNameLine(first, { ...fresh, unit: 'pcs', name: 'Corn Snack' }, home)
    expect(first.item).toMatchObject({ quantity: 1, price: 1.39 })
    expect(more.item).toMatchObject({ quantity: 1, price: 0, cardId: 'e1' })
  })

  it('K94 and an empty name lock the line', () => {
    const [first] = snackPurchase()
    expect(laterNameLine(first, draft(3, 'Tuc', '1'), home)).toMatchObject({ ready: false, naming: { kind: 'taken' } })
    expect(laterNameLine(first, draft(4, '', '1'), home)).toMatchObject({ ready: false, naming: { kind: 'empty' } })
    expect(purchaseLine(card('e2', 'Chips & Snacks', 'chips'), home, {}, { typedName: 'Tuc' }).ready).toBe(false)
  })
})

describe('a card of one line sends what it always sent', () => {
  it('before 032 (no typed name) and after it with the card\'s own name untouched: the same payload, without name keys', () => {
    const entry = card('e3', 'Crackers', 'crackers', { price: 2.1 })
    const before = payload([purchaseLine(entry, home)]).items[0]
    const after = payload([purchaseLine(entry, home, {}, { typedName: 'Crackers' })]).items[0]
    expect(after).toEqual(before)
    expect(['name', 'add_name', 'name_pack', 'quantity'].some((k) => k in before)).toBe(false)
    expect(purchaseLine(entry, home).takesNames).toBe(false)
  })

  it('a changed name on the only line sends it with the line\'s own fields', () => {
    const sent = payload([purchaseLine(card('e4', 'Crackers', 'crackers', { price: 2.1 }), home, {}, { typedName: 'Tuc' })]).items[0]
    expect(sent).toMatchObject({ grocery_item_id: 'e4', name: 'Tuc', quantity: 1, unit: 'pcs', price: 2.1 })
    expect('add_name' in sent).toBe(false)
  })

  it('never on a group row, a variant of one (older app version, K138) or a durable line (K93)', () => {
    const group = item('g', 'Biscuits', [], { is_group: true, variants: [] })
    const variant = item('v', 'Oreo', [], { group_id: 'g' })
    expect(purchaseLine(card('e5', 'Biscuits', 'g'), [group, variant], {}, { typedName: 'Biscuits' }).takesNames).toBe(false)
    expect(purchaseLine(card('e6', 'Oreo', 'v'), [group, variant], {}, { typedName: 'Oreo' }).takesNames).toBe(false)
    expect(purchaseLine(card('e7', 'Kettle', null, { category_id: 'appliances' }), [], {}, { typedName: 'Kettle' }).takesNames).toBe(false)
  })
})

describe('the pack size of a name line (K60)', () => {
  it('a pcs item, bought "1 pack" under a name with no size, typed 4: +4, saved on the name, never on the item', () => {
    const first = purchaseLine(card('t1', 'Dog Treats', 'treats', { price: 3 }), home, {}, { typedName: 'Dog Treats' })
    const line = laterNameLine(first, draft(1, 'Chew Sticks', '2.5', { unit: 'pack' }), home, { pack: { text: '4', unit: 'pack' } })
    expect(line.pack).toMatchObject({ stockUnit: 'pcs', unit: 'pack', value: 4, firstTime: true, onName: true })
    expect(line.add).toBe(4)
    const sent = payload([first, line]).items[1]
    expect(sent).toMatchObject({ add: 4, name: 'Chew Sticks', name_pack: { packaging_unit: 'pack', quantity_per_pack: 4 } })
    expect('packaging_unit' in sent || 'quantity_per_pack' in sent).toBe(false)
    expect(cardStock([first, line])).toEqual({ total: 5, unit: 'pcs' })
  })

  it('a name\'s own size starts the field; a name with none starts with the item\'s, and only a different size is the name\'s', () => {
    expect(namedPack(cat, 'Felix', 'box', { typed: null })).toMatchObject({ text: '24', firstTime: false })
    expect(namedPack(cat, 'Gourmet', 'box', { typed: null })).toMatchObject({ text: '48', value: 48, firstTime: false })
    const other = namedPack(cat, 'Gourmet', 'box', { typed: { text: '40', unit: 'box' } })
    expect(other).toMatchObject({ value: 40, firstTime: true, onName: true, differs: false })
  })

  it('under the item\'s own name it follows the 9H item rule', () => {
    const first = purchaseLine(card('t2', 'Dog Treats', 'treats'), home, {}, { typedName: 'Dog Treats' })
    const line = laterNameLine(first, draft(1, 'Dog Treats', '3', { unit: 'box' }), home, { pack: { text: '12', unit: 'box' } })
    const sent = payload([first, line]).items[1]
    expect(sent).toMatchObject({ add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
    expect('name_pack' in sent).toBe(false)
  })
})

describe('a new HOME item with two names (J.1, D10)', () => {
  it('Biscotti: line 1 "1 pack" counted pcs 10 per pack; Gocciole "1 pack" 12 per pack (empty, required, first time on the name) → 10 + 12 = 22 pcs', () => {
    const entry = card('b1', 'Biscotti', null, { unit: 'pack', price: 2.2, price_unit: 'pack', category_id: 'sweets' })
    const first = purchaseLine(entry, [], { newUnit: { unit: 'pack', stockUnit: 'pcs', text: '10' } }, { unitsReady: true, typedName: 'Biscotti' })
    expect(first.stockUnit).toMatchObject({ stockUnit: 'pcs', blocking: false })
    const empty = laterNameLine(first, draft(1, 'Gocciole', '2.9', { unit: 'pack' }), [])
    expect(empty.pack).toMatchObject({ stockUnit: 'pcs', unit: 'pack', text: '', blocking: true })
    expect(empty.ready).toBe(false)
    const line = laterNameLine(first, draft(1, 'Gocciole', '2.9', { unit: 'pack' }), [], { pack: { text: '12', unit: 'pack' } })
    expect(line).toMatchObject({ add: 12, ready: true, naming: { kind: 'new', note: 'New name of Biscotti — it will be remembered.' } })
    expect(cardStock([first, line])).toEqual({ total: 22, unit: 'pcs' })
    const sent = payload([first, line]).items
    expect(sent[0]).toMatchObject({ grocery_item_id: 'b1', pantry_item_id: null, name: 'Biscotti', add: 1, new_stock_unit: 'pcs', new_pack_size: 10 })
    expect('add_name' in sent[0]).toBe(false)
    expect(sent[1]).toMatchObject({ grocery_item_id: 'b1', pantry_item_id: null, name: 'Gocciole', add: 12, add_name: true, name_pack: { packaging_unit: 'pack', quantity_per_pack: 12 } })
    expect('new_stock_unit' in sent[1]).toBe(false)
  })

  it('until line 1 says how to count it, a later line can\'t tell its stock', () => {
    const entry = card('b2', 'Wafers', null, { unit: 'box', price: 3 })
    const first = purchaseLine(entry, [], {}, { unitsReady: true, typedName: 'Wafers' })
    const line = laterNameLine(first, draft(1, 'Loacker', '3', { unit: 'box' }), [])
    expect(line.add).toBeNull()
    expect(cardStock([first, line])).toBeNull()
  })
})

describe('expired stock is asked once per item (K71, K80)', () => {
  it('two lines of a card and a second card of the same item: only the first line asks, only it sends discard_expired', () => {
    const first = purchaseLine(card('y1', 'Yogurt Pots', 'yogurt', { category_id: 'dairy' }), home, { discard: true }, { typedName: 'Yogurt Pots' })
    const second = laterNameLine(first, draft(1, 'Yogurt Greco', '1'), home)
    const other = purchaseLine(card('y2', 'Yogurt Pots', 'yogurt', { category_id: 'dairy' }), home, {}, { typedName: 'Yogurt Pots' })
    expect(other).toMatchObject({ expired: true, ready: false })
    const lines = expiryOncePerItem([first, second, other])
    expect(lines.map((l) => [l.expired, l.ready])).toEqual([[true, true], [false, true], [false, true]])
    const sent = payload(lines, { y1: { discard: true, expiryDate: '2026-12-01' } }).items
    expect(sent.map((l) => l.discard_expired)).toEqual([true, undefined, undefined])
    expect(sent.map((l) => 'expiry_date' in l)).toEqual([true, false, false])
  })
})

describe('K53: the title of a SHOP card', () => {
  it('the HOME item\'s name, with the card\'s own name under it when it differs', () => {
    expect(cardTitle({ name: 'Corn Snack' }, chips)).toEqual({ title: 'Chips & Snacks', subtitle: 'Corn Snack' })
    expect(cardTitle({ name: 'chips & snacks' }, chips)).toEqual({ title: 'chips & snacks', subtitle: '' })
    expect(cardTitle({ name: 'Napkins' }, null)).toEqual({ title: 'Napkins', subtitle: '' })
    expect(cardTitle({ name: 'Oreo' }, item('v', 'Biscuits', [], { group_id: 'g' }))).toEqual({ title: 'Oreo', subtitle: '' })
  })
})

describe('K56: the name chips of a line', () => {
  it('the item\'s names, last bought first; one already on another line of the card is left out', () => {
    expect(nameChips(chips, ['Nuvole di drago', 'Corn Snack'])).toEqual(['Nuvole di drago', 'Corn Snack', 'Chips & Snacks'])
    expect(nameChips(chips, [])).toEqual(['Chips & Snacks', 'Corn Snack', 'Nuvole di drago'])
    expect(nameChips(chips, ['Corn Snack'], ['corn snacks'])).toEqual(['Chips & Snacks', 'Nuvole di drago'])
    expect(nameChips({ name: 'Biscotti' })).toEqual(['Biscotti'])
  })
})

describe('Reopen / Undo notes: one per item, its lines added up (K96)', () => {
  it('a created item kept because of stock from elsewhere: "this purchase\'s 5 pcs" for lines +1, +4', () => {
    const before = [{ id: 'n', name: 'Noodle Cups', unit: 'pcs', current_stock: 9 }]
    const lines = [
      { id: 'a', position: 1, pantry_item_id: 'n', pantry_created: true, stock_added: 1, stock_unit: 'pcs', unit: 'pcs', log_ids: [] },
      { id: 'b', position: 2, pantry_item_id: 'n', pantry_created: false, stock_added: 4, stock_unit: 'pcs', unit: 'pack', log_ids: [] },
    ]
    expect(reopenNotes({ lines, before, after: [{ ...before[0], current_stock: 4 }] })).toEqual(['"Noodle Cups" stays in HOME — it also got stock or an order from elsewhere; this purchase\'s 5 pcs were taken out.'])
  })

  it('a line a merge moved never counts as having created the item', () => {
    const before = [{ id: 'm', name: 'Meat Snacks', unit: 'pcs', current_stock: 6 }]
    const lines = [{ id: 'c', position: 1, pantry_item_id: 'm', pantry_created: true, merged_from: 'gone', stock_added: 2, stock_unit: 'pcs', unit: 'pcs', log_ids: [] }]
    expect(reopenNotes({ lines, before, after: [{ ...before[0], current_stock: 4 }] })).toEqual([])
  })
})

describe('MONEY "It\'s another name of…" (K54)', () => {
  const tea = item('tea', 'Tea Tin', [], { category_id: 'beverages', current_stock: 1 })
  const row = (extra = {}) => ({ ...emptyRow(1), name: 'Darjeeling Tin', priceText: '4.5', categoryId: 'beverages', ...extra })

  it('offered on a row added to HOME whose name is no item\'s, once 032 is known; never otherwise', () => {
    expect(rowLine(row(), [tea], undefined, { namesReady: true })).toMatchObject({ canAttach: true, attached: null, isNew: true })
    expect(rowLine(row(), [tea])).toMatchObject({ canAttach: false })
    expect(rowLine(row({ addToHome: false }), [tea], undefined, { namesReady: true })).toMatchObject({ canAttach: false })
    expect(rowLine(row({ name: 'Tea Tin' }), [tea], undefined, { namesReady: true })).toMatchObject({ canAttach: false })
  })

  it('chosen: the stock goes to the item, the row keeps its name and sends add_name; the note says so', () => {
    const line = rowLine(row({ attachedTo: 'tea' }), [tea], undefined, { namesReady: true })
    expect(line).toMatchObject({ attached: tea, target: tea, isNew: false, canAttach: false, add: 1 })
    expect(homeNote(line)).toBe('Adds to "Tea Tin" in HOME (+1 pcs) — new name, it will be remembered.')
    const { lines } = pricedLines([line])
    const [sent] = moneyPurchasePayload({ id: 'm1', date: '2026-11-07', at: 'now', paidBy: P1, lines, budgetFor: () => 'groceries' }).items
    expect(sent).toMatchObject({ name: 'Darjeeling Tin', pantry_item_id: 'tea', add: 1, add_name: true, line_total: 4.5 })
    expect('one_time' in sent).toBe(false)
  })

  it('a first size under that new name goes on the name', () => {
    const line = rowLine(row({ attachedTo: 'tea', unit: 'box', unitTouched: true, packSizeText: '6', packUnit: 'box' }), [tea], undefined, { namesReady: true })
    const { lines } = pricedLines([line])
    const [sent] = moneyPurchasePayload({ id: 'm2', date: '2026-11-07', at: 'now', paidBy: P1, lines, budgetFor: () => null }).items
    expect(sent).toMatchObject({ add: 6, add_name: true, name_pack: { packaging_unit: 'box', quantity_per_pack: 6 } })
  })

  it('never a group, a variant or a durable; "Not this item" (no item chosen) makes it a new item again', () => {
    const group = item('g', 'Teas', [], { is_group: true })
    expect(rowLine(row({ attachedTo: 'g' }), [tea, group], undefined, { namesReady: true }).attached).toBeNull()
    expect(rowLine(row({ attachedTo: null }), [tea], undefined, { namesReady: true })).toMatchObject({ isNew: true, attached: null })
  })
})

describe('follow-up 07/11: K98 price of a name, K101 a new name once', () => {
  const TWICE = (name) => `"${name}" is also another line of this purchase — use it only once.`
  const problems = (lines) => newNameOnce(lines).map((l) => [l.item.name, l.naming?.problem ?? '', l.ready])

  it('K98: the total for line 1\'s quantity and unit; null without a price or a conversion', () => {
    expect(namePriceTotal({ price: 1.49, quantity: 1, unit: 'pcs' }, 1, 'pcs')).toBe(1.49)
    expect(namePriceTotal({ price: 1.49, quantity: 1, unit: 'pcs' }, 2, 'pcs')).toBe(2.98)
    expect(namePriceTotal({ price: 1.98, quantity: 2, unit: 'pcs' }, 3, 'pcs')).toBe(2.97)
    expect(namePriceTotal({ price: 8, quantity: 1, unit: 'kg' }, 500, 'gr')).toBe(4)
    expect(namePriceTotal({ price: 2.4, quantity: 1, unit: 'L' }, 250, 'ml')).toBe(0.6)
    expect(namePriceTotal({ price: 5.4, quantity: 1, unit: 'pack' }, 1, 'pcs')).toBeNull()
    expect(namePriceTotal(null, 1, 'pcs')).toBeNull()
  })

  it('K101 (1): a new name equal to a card that makes a new item is refused on the name line, whatever the order; never on that card', () => {
    const fresh = purchaseLine(card('p1', 'Patatine Paprika', null, { price: 1.8 }), home, {}, { typedName: 'Patatine Paprika' })
    const first = purchaseLine(card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), home, {}, { typedName: 'Chips & Snacks' })
    const second = laterNameLine(first, draft(1, 'patatine  paprika', '1'), home)
    expect(problems([fresh, first, second])).toEqual([
      ['Patatine Paprika', '', true],
      ['Chips & Snacks', '', true],
      ['patatine  paprika', TWICE('patatine  paprika'), false],
    ])
    expect(problems([first, second, fresh]).map((p) => p[2])).toEqual([true, false, true])
    // On line 1 too.
    const renamed = purchaseLine(card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), home, {}, { typedName: 'Patatine Paprika' })
    expect(problems([renamed, fresh])[0]).toEqual(['Chips & Snacks', TWICE('Patatine Paprika'), false])
  })

  it('K101 (2): the same new name on two cards — the later line; on one card — no refusal; K94 stays K94', () => {
    const a = purchaseLine(card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), home, {}, { typedName: 'Chips & Snacks' })
    const b = purchaseLine(card('d1', 'Dog Treats', 'treats', { price: 3, category_id: 'pets' }), home, {}, { typedName: 'Dog Treats' })
    const lines = [a, laterNameLine(a, draft(1, 'Lime Chips', '1'), home), laterNameLine(a, draft(2, 'Lime Chips', '1'), home), b, laterNameLine(b, draft(1, 'LIME CHIPS', '1'), home)]
    expect(problems(lines).map((p) => p[1])).toEqual(['', '', '', '', TWICE('LIME CHIPS')])
    const taken = laterNameLine(b, draft(2, 'Tuc', '1'), home)
    expect(newNameOnce([a, b, taken])[2].naming.problem).toBe('"Tuc" is already a name of "Crackers" in HOME.')
    expect(newNameOnce([a, laterNameLine(a, draft(1, 'Lime Chips', '1'), home), b, laterNameLine(b, draft(1, 'Salt Chips', '1'), home)]).every((l) => l.ready)).toBe(true)
  })
})
