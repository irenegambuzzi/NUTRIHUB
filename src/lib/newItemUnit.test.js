import { describe, expect, it } from 'vitest'
import { COUNT_STOCK_UNITS, STOCK_UNIT_MISSING, arrivalPrefill, asksStockUnit, isPackageUnit, missingStockUnitColumn, newItemKeys, newStockUnit, stockUnitChoices, stockUnitQuestion } from './newItemUnit'
import { PACKAGING_UNITS, UNIT_VALUES } from '../data/constants'
import { confirmationPayload, purchaseLine, twiceProblems } from './purchase'
import { emptyRow, moneyPurchasePayload, pricedLines, rowLine, rowProblem, twiceProblems as moneyTwice } from './moneyPurchase'
import { purchasedPackLabel } from './packSize'

// Plan 9L: a NEW HOME item made by a purchase may be counted at home in
// another unit than the one bought ("1 pack" of soft drinks → 4 pcs).

const ask = (unit, answer = null, quantity = 1, ready = true) => stockUnitQuestion({ unit, quantity, answer, ready })
const chose = (unit, stockUnit, text = '') => ({ unit, stockUnit, text })

describe('which units', () => {
  it('a package is pack, box, case, carton, crate or bag (the shared PACKAGING_UNITS); nothing else', () => {
    expect(PACKAGING_UNITS).toEqual(['pack', 'box', 'case', 'carton', 'crate', 'bag'])
    for (const u of PACKAGING_UNITS) expect(isPackageUnit(u)).toBe(true)
    for (const u of ['pcs', 'btl', 'can', 'jar', 'roll', 'tube', 'sachet', 'gr', 'kg', 'ml', 'L', 'g', 'l']) expect(isPackageUnit(u)).toBe(false)
  })

  it('the count units offered all exist in the app\'s unit list: pcs, btl, can, roll, jar, tube, sachet, tablet, capsule', () => {
    expect(COUNT_STOCK_UNITS).toEqual(['pcs', 'btl', 'can', 'roll', 'jar', 'tube', 'sachet', 'tablet', 'capsule'])
    for (const u of COUNT_STOCK_UNITS) expect(UNIT_VALUES).toContain(u)
    expect(stockUnitChoices('pack')).toEqual(['pack', 'pcs', 'btl', 'can', 'roll', 'jar', 'tube', 'sachet', 'tablet', 'capsule'])
    expect(stockUnitChoices('box')[0]).toBe('box')
    // Never a measure, never another package.
    for (const u of ['gr', 'kg', 'ml', 'L', 'box', 'case']) expect(stockUnitChoices('pack')).not.toContain(u)
  })
})

describe('the question "Count it at home in"', () => {
  it('only for a package unit, never for pcs, btl, can, jar, roll… nor gr / kg / ml / L', () => {
    expect(ask('pack')).not.toBeNull()
    expect(ask('box')).not.toBeNull()
    expect(ask('crate')).not.toBeNull()
    for (const u of ['pcs', 'btl', 'can', 'jar', 'roll', 'gr', 'kg', 'ml', 'L']) {
      expect(ask(u)).toBeNull()
      expect(asksStockUnit(u)).toBe(false)
    }
    expect(asksStockUnit('pack')).toBe(true)
  })

  it('hidden until supabase/030 is known: false or null → none', () => {
    expect(ask('pack', null, 1, false)).toBeNull()
    expect(ask('pack', null, 1, null)).toBeNull()
  })

  it('no default: nothing chosen, "Choose how to count it at home.", blocking', () => {
    expect(ask('pack')).toMatchObject({ unit: 'pack', stockUnit: null, pack: null, problem: STOCK_UNIT_MISSING, blocking: true })
    expect(STOCK_UNIT_MISSING).toBe('Choose how to count it at home.')
    expect(newItemKeys(ask('pack'))).toEqual({})
  })

  it('the purchase unit itself = today\'s result: no pack field, nothing extra sent (beef slices "1 pack")', () => {
    const q = ask('pack', chose('pack', 'pack'))
    expect(q).toMatchObject({ stockUnit: 'pack', pack: null, problem: '', blocking: false })
    expect(newItemKeys(q)).toEqual({})
    expect(newStockUnit(q, 'pack')).toBe('pack')
  })

  it('pcs: the pack field "pcs per pack" is required ("Type how many pcs are in 1 pack."); 4 → "= 4 pcs", saved as the usual size; sends pcs and 4', () => {
    const empty = ask('pack', chose('pack', 'pcs'))
    expect(empty.pack).toMatchObject({ stockUnit: 'pcs', unit: 'pack', value: null, blocking: true })
    expect(empty.problem).toBe('Type how many pcs are in 1 pack.')
    expect(newItemKeys(empty)).toEqual({})
    const soft = ask('pack', chose('pack', 'pcs', '4'))
    expect(soft.pack).toMatchObject({ value: 4, total: 4, firstTime: true, usual: null, differs: false })
    expect(soft.blocking).toBe(false)
    expect(newItemKeys(soft)).toEqual({ new_stock_unit: 'pcs', new_pack_size: 4 })
    expect(newStockUnit(soft, 'pack')).toBe('pcs')
  })

  it('the examples: eggs "1 box" → 10 pcs; tissues "1 pack" → 6 roll; "2 pack" × 4 = 8 pcs; a comma decimal', () => {
    expect(ask('box', chose('box', 'pcs', '10')).pack.total).toBe(10)
    expect(ask('pack', chose('pack', 'roll', '6')).pack).toMatchObject({ stockUnit: 'roll', total: 6 })
    expect(ask('pack', chose('pack', 'pcs', '4'), 2).pack.total).toBe(8)
    expect(ask('pack', chose('pack', 'btl', '1,5')).pack.value).toBe(1.5)
  })

  it('an answer for another purchase unit, or a unit not offered, starts again', () => {
    expect(ask('box', chose('pack', 'pcs', '4')).stockUnit).toBeNull()
    expect(ask('pack', chose('pack', 'gr', '500')).stockUnit).toBeNull()
    expect(ask('pack', chose('pack', 'box', '2')).stockUnit).toBeNull()
  })
})

describe('SHOP Confirm purchase (lib/purchase.js)', () => {
  const pantry = [
    { id: 'cola', name: 'Cola', unit: 'pcs', current_stock: 2, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4 },
    { id: 'balloons', name: 'Balloons', unit: 'pcs', current_stock: 0, one_time: true },
    { id: 'chips', name: 'Chips', unit: 'pack', is_group: true, variants: [] },
    { id: 'paprika', name: 'Chips paprika', unit: 'pack', current_stock: 0, group_id: 'chips' },
  ]
  const entry = (fields) => ({ id: fields.name, quantity: 1, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack', payer: 'shared', category_id: 'beverages', pantry_item_id: null, ...fields })
  const line = (fields, answer = {}, opts = { unitsReady: true }) => purchaseLine(entry(fields), pantry, answer, opts)

  it('a line "new in the pantry" in a package gets it, only once 030 is known; not ready until answered', () => {
    expect(line({ name: 'Soft drink' })).toMatchObject({ pantry: null, ready: false, needsStockUnit: true, asksStockUnit: true })
    expect(line({ name: 'Soft drink' }).stockUnit.problem).toBe('Choose how to count it at home.')
    expect(line({ name: 'Soft drink' }, {}, { unitsReady: null })).toMatchObject({ stockUnit: null, ready: true, asksStockUnit: true })
    expect(line({ name: 'Soft drink' }, {}, { unitsReady: false })).toMatchObject({ stockUnit: null, ready: true })
    expect(line({ name: 'Soft drink' }, { newUnit: chose('pack', 'pcs', '4') })).toMatchObject({ ready: true, add: 1 })
  })

  it('never for: water "1 btl", rice "500 gr", a durable, a restock (the 9H field as today), a group / its variant, a finished 1× item revived by name', () => {
    expect(line({ name: 'Water', unit: 'btl' }).stockUnit).toBeNull()
    expect(line({ name: 'Rice', unit: 'gr', quantity: 500 }).stockUnit).toBeNull()
    expect(line({ name: 'Lamp', category_id: 'appliances' })).toMatchObject({ durable: true, stockUnit: null, asksStockUnit: false })
    expect(line({ name: 'Soft drink' }, {}, { unitsReady: true, durableBudget: true }).stockUnit).toBeNull()
    const cola = line({ name: 'Cola', pantry_item_id: 'cola', quantity: 2 })
    expect(cola).toMatchObject({ stockUnit: null, asksStockUnit: false, add: 8 })
    expect(cola.pack).toMatchObject({ text: '4', usual: 4 })
    expect(line({ name: 'cola ' }).stockUnit).toBeNull()
    expect(line({ name: 'Chips', pantry_item_id: 'chips' }, { newVariantName: 'Salted' }).stockUnit).toBeNull()
    expect(line({ name: 'Chips paprika', pantry_item_id: 'paprika' }).stockUnit).toBeNull()
    expect(line({ name: 'Balloons' })).toMatchObject({ pantry: { id: 'balloons' }, stockUnit: null })
  })

  it('the payload: only a line counted in another unit sends new_stock_unit / new_pack_size, with `add` in the unit bought', () => {
    const lines = [
      line({ name: 'Soft drink' }, { newUnit: chose('pack', 'pcs', '4') }),
      line({ name: 'Beef slices', price: 4.5, price_unit: 'pack' }, { newUnit: chose('pack', 'pack') }),
      line({ name: 'Cola', pantry_item_id: 'cola', quantity: 2 }),
    ]
    const payload = confirmationPayload({ id: 't', date: '2026-11-01', at: 'x', lines, answers: {}, totalOf: (i) => i.price, expenseCategoryFor: () => 'groceries' })
    expect(payload.items.map((i) => [i.add, i.new_stock_unit ?? null, i.new_pack_size ?? null, i.line_total])).toEqual([
      [1, 'pcs', 4, 3],
      [1, null, null, 4.5],
      [8, null, null, 3],
    ])
    const before = confirmationPayload({ id: 't', date: '2026-11-01', at: 'x', lines: [line({ name: 'Soft drink' }, { newUnit: chose('pack', 'pcs', '4') }, { unitsReady: false })], answers: {}, totalOf: (i) => i.price, expenseCategoryFor: () => 'groceries' })
    expect(before.items[0]).not.toHaveProperty('new_stock_unit')
  })
})

describe('MONEY "+ Add expense" (lib/moneyPurchase.js)', () => {
  const pantry = [{ id: 'cola', name: 'Cola', unit: 'pcs', current_stock: 2, packaging_unit: 'pack', quantity_per_pack: 4 }]
  const make = (fields, unitsReady = true) => rowLine({ ...emptyRow(1), name: 'Soft drink', priceText: '3', unit: 'pack', categoryId: 'beverages', ...fields }, pantry, undefined, { unitsReady })

  it('a new row in a package with Add to HOME on: asked, Save blocked until chosen; Min follows the chosen unit', () => {
    const none = make({})
    expect(none).toMatchObject({ isNew: true, asksStockUnit: true, minUnit: 'pack' })
    expect(rowProblem(none)).toBe('Choose how to count it at home.')
    const pcs = make({ newUnit: chose('pack', 'pcs') })
    expect(rowProblem(pcs)).toBe('Type how many pcs are in 1 pack.')
    expect(pcs.minUnit).toBe('pcs')
    const soft = make({ newUnit: chose('pack', 'pcs', '4'), minText: '2' })
    expect(rowProblem(soft)).toBe('')
    expect(make({ newUnit: chose('pack', 'pcs', '4,x') }).stockUnit.pack.text).toBe('4,x')
    expect(rowProblem(make({ newUnit: chose('pack', 'pcs', '4,x') }))).toBe('Fix the numbers in red.')
    const { lines, priced } = pricedLines([soft])
    const item = moneyPurchasePayload({ id: 'm', date: '2026-11-01', at: 'x', paidBy: 'shared', lines, budgetFor: () => 'groceries', priced }).items[0]
    expect(item).toMatchObject({ add: 1, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack', line_total: 3, min_stock: 2, new_stock_unit: 'pcs', new_pack_size: 4, pantry_item_id: null })
  })

  it('never for: Add to HOME off, a locked (durable) row, an existing item (the 9H field), "1 btl", before 030', () => {
    expect(make({ addToHome: false })).toMatchObject({ stockUnit: null, asksStockUnit: false })
    expect(make({ categoryId: 'appliances' })).toMatchObject({ home: false, stockUnit: null, asksStockUnit: false })
    const cola = make({ name: 'Cola', quantityText: '2' })
    expect(cola).toMatchObject({ isNew: false, stockUnit: null, add: 8 })
    expect(make({ unit: 'btl' }).stockUnit).toBeNull()
    expect(make({}, null)).toMatchObject({ stockUnit: null, asksStockUnit: true, minUnit: 'pack' })
    expect(rowProblem(make({}, false))).toBe('')
    const { lines } = pricedLines([make({ newUnit: chose('pack', 'pcs', '4') }, false)])
    expect(moneyPurchasePayload({ id: 'm', date: '2026-11-01', at: 'x', paidBy: 'shared', lines, budgetFor: () => 'groceries' }).items[0]).not.toHaveProperty('new_stock_unit')
  })
})

describe('labels and the arrival editor', () => {
  it('"1 pack · 4 pcs" from the line\'s own stock unit (030), else the HOME item\'s (as before)', () => {
    const line = { quantity: 1, unit: 'pack', stock_added: 4, stock_unit: 'pcs' }
    expect(purchasedPackLabel(line, null)).toBe('1 pack · 4 pcs')
    // The item was later counted in another unit: the line still says what it was.
    expect(purchasedPackLabel(line, { unit: 'btl' })).toBe('1 pack · 4 pcs')
    expect(purchasedPackLabel({ quantity: 2, unit: 'pack', stock_added: 8 }, { unit: 'pcs' })).toBe('2 pack · 4 pcs each · 8 pcs')
    expect(purchasedPackLabel({ quantity: 1, unit: 'pack', stock_added: 1, stock_unit: 'pack' }, { unit: 'pcs' })).toBeNull()
    expect(purchasedPackLabel({ quantity: 1, unit: 'pack', stock_added: 4 }, null)).toBeNull()
  })

  it('"It arrived!" → "Create a new item" starts from the order: "3 pcs", "2 btl" in their unit; "1 pack" with multipack on, the size empty, the stock in packs; the normal price', () => {
    expect(arrivalPrefill({ item_name: 'Lemons', quantity: 3, unit: 'pcs', price: 2.4 })).toEqual({ name: 'Lemons', unit: 'pcs', current_stock: '3', price: '2.40', price_qty: '3', price_unit: 'pcs' })
    expect(arrivalPrefill({ item_name: 'Water', quantity: 2, unit: 'btl', price: 0.9, list_price: 1 })).toMatchObject({ unit: 'btl', current_stock: '2', price: '1.00', price_qty: '2', price_unit: 'btl' })
    expect(arrivalPrefill({ item_name: 'Soft drink', quantity: 1, unit: 'pack', price: 2.7, list_price: 3 })).toEqual({
      name: 'Soft drink',
      unit: 'pcs',
      multipack: true,
      packaging_unit: 'pack',
      quantity_per_pack: '',
      current_stock: '1',
      stockInPacks: true,
      price: '3.00',
      price_qty: '1',
      price_unit: 'pack',
    })
    expect(arrivalPrefill({ item_name: 'Rice', quantity: 1, unit: 'kg', price: 2.5 })).toMatchObject({ unit: 'kg', current_stock: '1' })
    // A unit HOME can't count in: pcs, no price; no quantity: 1; no price: none.
    expect(arrivalPrefill({ item_name: 'Odd', quantity: 2, unit: 'dozen', price: 5 })).toEqual({ name: 'Odd', unit: 'pcs', current_stock: '2' })
    expect(arrivalPrefill({ item_name: 'Gift', quantity: null, unit: null, price: 0 })).toEqual({ name: 'Gift', unit: 'pcs', current_stock: '1' })
  })

  it('030 is found by its column: "does not exist" naming stock_unit → missing; anything else is not', () => {
    expect(missingStockUnitColumn({ code: '42703', message: 'column shopping_trip_items.stock_unit does not exist' })).toBe(true)
    expect(missingStockUnitColumn({ code: 'PGRST204', message: "Could not find the 'stock_unit' column" })).toBe(true)
    expect(missingStockUnitColumn({ code: '42703', message: 'column expenses.part_x does not exist' })).toBe(false)
    expect(missingStockUnitColumn({ code: '08006', message: 'stock_unit' })).toBe(false)
    expect(missingStockUnitColumn(null)).toBe(false)
  })
})

describe('the same new name twice in one purchase', () => {
  const pantry = []
  const entry = (id, fields) => ({ id, name: 'Soft drink', quantity: 1, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack', payer: 'shared', category_id: 'beverages', pantry_item_id: null, ...fields })
  const lines = (a, b, unitsReady = true) => [purchaseLine(entry('1', a.fields), pantry, a.answer ?? {}, { unitsReady }), purchaseLine(entry('2', b.fields), pantry, b.answer ?? {}, { unitsReady })]
  const pcs4 = { answer: { newUnit: chose('pack', 'pcs', '4') } }

  it('both counted in pcs (any pack size), both in packs, or the second in pcs bought as "4 pcs": fine', () => {
    expect(twiceProblems(lines(pcs4, { answer: { newUnit: chose('pack', 'pcs', '6') } }))).toEqual(['', ''])
    expect(twiceProblems(lines({ answer: { newUnit: chose('pack', 'pack') } }, { answer: { newUnit: chose('pack', 'pack') } }))).toEqual(['', ''])
    expect(twiceProblems(lines(pcs4, { fields: { unit: 'pcs', quantity: 4 } }))).toEqual(['', ''])
    // The first in packs, the second in pcs with its size: the item is in packs, the second adds 1 pack.
    expect(twiceProblems(lines({ answer: { newUnit: chose('pack', 'pack') } }, pcs4))).toEqual(['', ''])
  })

  it('the first in pcs, the second kept in packs (or in roll): the second is blocked, named and told what to choose', () => {
    expect(twiceProblems(lines(pcs4, { answer: { newUnit: chose('pack', 'pack') } }))).toEqual(['', '"Soft drink" is in this purchase twice — count it in pcs at home here too.'])
    expect(twiceProblems(lines(pcs4, { fields: { name: ' soft DRINK' }, answer: { newUnit: chose('pack', 'roll', '6') } }))[1]).toBe('"soft DRINK" is in this purchase twice — count it in pcs at home here too.')
  })

  it('before 030 (no question on either line): exactly as today, nothing to say', () => {
    expect(twiceProblems(lines({}, {}, false))).toEqual(['', ''])
    expect(twiceProblems(lines({}, { fields: { unit: 'pcs' } }, null))).toEqual(['', ''])
  })

  it('MONEY rows work the same', () => {
    const row = (key, fields) => rowLine({ ...emptyRow(key), name: 'Soft drink', priceText: '3', unit: 'pack', categoryId: 'beverages', ...fields }, [], undefined, { unitsReady: true })
    expect(moneyTwice([row(1, { newUnit: chose('pack', 'pcs', '4') }), row(2, { newUnit: chose('pack', 'pack') })])).toEqual(['', '"Soft drink" is in this purchase twice — count it in pcs at home here too.'])
    expect(moneyTwice([row(1, { newUnit: chose('pack', 'pcs', '4') }), row(2, { newUnit: chose('pack', 'pcs', '4') })])).toEqual(['', ''])
  })
})
