import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const {
  PACK_FIRST_TIME_TEXT,
  PACK_LATER_TEXT,
  firstTimePatch,
  hasPackField,
  orderPackLabel,
  packAmountLabel,
  packField,
  packLabel,
  packMissingText,
  packStartText,
  packTextFor,
  packTotalText,
  packUsualText,
  purchasedPackLabel,
  savesUsualSize,
  usualPackSize,
} = await import('./packSize')
const { confirmationPayload, purchaseLine } = await import('./purchase')
const { emptyRow, moneyPurchasePayload, pricedLines, rowLine, rowProblem } = await import('./moneyPurchase')
const { missingPackColumn, packColumnsReady, withoutPackColumns } = await import('./orders')
const { orderRowFrom } = await import('../hooks/useOrders')

// Items in pcs: one with the usual size "box 48", one with none, one with
// a packaging unit but no size yet; rice counted in gr; milk in btl.
const cat = { id: 'cat', name: 'Cat Wet Food', unit: 'pcs', current_stock: 10, packaging_unit: 'box', quantity_per_pack: 48 }
const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs', current_stock: 2, packaging_unit: null, quantity_per_pack: null }
const pasta = { id: 'pasta', name: 'Pasta', unit: 'pcs', current_stock: 1, packaging_unit: 'box', quantity_per_pack: null }
const rice = { id: 'rice', name: 'Rice', unit: 'gr', current_stock: 100 }
const field = (item, unit, text, options) => packField({ item, unit, text, ...options })

describe('which lines get the pack field', () => {
  it('a package that is not the stock unit: box, pack, conf… of an item in pcs or gr', () => {
    expect(hasPackField(cat, 'box')).toBe(true)
    expect(hasPackField(cat, 'pack')).toBe(true)
    expect(hasPackField(tuna, 'case')).toBe(true)
    expect(hasPackField(rice, 'pack')).toBe(true)
  })

  it('never the same unit, a measure that converts, or a line without a HOME item', () => {
    expect(hasPackField(cat, 'pcs')).toBe(false)
    expect(hasPackField(cat, 'pc')).toBe(false)
    expect(hasPackField(rice, 'kg')).toBe(false)
    expect(hasPackField(rice, 'gr')).toBe(false)
    expect(hasPackField({ unit: 'ml' }, 'L')).toBe(false)
    expect(hasPackField(null, 'box')).toBe(false)
    expect(field(cat, 'pcs', '')).toBeNull()
  })
})

describe('the usual size and the first-time rule', () => {
  it('the usual size counts only for its own unit', () => {
    expect(usualPackSize(cat, 'box')).toBe(48)
    expect(usualPackSize(cat, 'pack')).toBeNull()
    expect(usualPackSize(pasta, 'box')).toBeNull()
    expect(packStartText(cat, 'box')).toBe('48')
    expect(packStartText(cat, 'pack')).toBe('')
    expect(packStartText(tuna, 'box')).toBe('')
  })

  it('saved only while the item has none: no unit and no size, or this unit without a size', () => {
    expect(savesUsualSize(tuna, 'box')).toBe(true)
    expect(savesUsualSize(pasta, 'box')).toBe(true)
    // Never over an existing usual size, never on another packaging unit,
    // never a measure.
    expect(savesUsualSize(cat, 'box')).toBe(false)
    expect(savesUsualSize(cat, 'pack')).toBe(false)
    expect(savesUsualSize(pasta, 'pack')).toBe(false)
    expect(savesUsualSize({ ...tuna, quantity_per_pack: 6 }, 'box')).toBe(false)
    expect(savesUsualSize({ unit: 'pcs' }, 'kg')).toBe(false)
  })

  it('the first-time patch is what a purchase line sends; nothing otherwise', () => {
    expect(firstTimePatch(field(tuna, 'box', '12'))).toEqual({ packaging_unit: 'box', quantity_per_pack: 12 })
    expect(firstTimePatch(field(pasta, 'box', '6'))).toEqual({ packaging_unit: 'box', quantity_per_pack: 6 })
    expect(firstTimePatch(field(cat, 'box', '30'))).toEqual({})
    expect(firstTimePatch(field(cat, 'pack', '5'))).toEqual({})
    expect(firstTimePatch(field(tuna, 'box', '12', { canSave: false }))).toEqual({})
    expect(firstTimePatch(null)).toEqual({})
  })
})

describe('the field', () => {
  it('usual box 48, 1 box typed 30: +30, "This purchase only", nothing saved', () => {
    const pack = field(cat, 'box', '30', { quantity: 1 })
    expect(pack).toMatchObject({ value: 30, usual: 48, total: 30, differs: true, firstTime: false, blocking: false })
    expect(packLabel(pack)).toBe('pcs per box')
    expect(packTotalText(pack)).toBe('= 30 pcs')
    expect(packUsualText(pack)).toBe('This purchase only — usual: 48 pcs per box.')
  })

  it('2 box × 30 = 60; the usual size typed again is not "this purchase only"', () => {
    expect(packTotalText(field(cat, 'box', '30', { quantity: 2 }))).toBe('= 60 pcs')
    expect(field(cat, 'box', '48', { quantity: 1 })).toMatchObject({ total: 48, differs: false })
  })

  it('empty and required: blocks, with "Type how many pcs are in 1 box."; at Order online it may stay empty', () => {
    const pack = field(tuna, 'box', '', { quantity: 1 })
    expect(pack).toMatchObject({ value: null, empty: true, blocking: true, firstTime: false, total: null })
    expect(packMissingText(pack)).toBe('Type how many pcs are in 1 box.')
    expect(field(tuna, 'box', '', { required: false })).toMatchObject({ empty: true, blocking: false })
    expect(field(tuna, 'box', '0')).toMatchObject({ value: null, blocking: true })
    expect(PACK_LATER_TEXT).toBe('You can fill this in when it arrives.')
  })

  it('no usual size, 1 box typed 12: the first time, said before saving', () => {
    expect(field(tuna, 'box', '12')).toMatchObject({ value: 12, firstTime: true, differs: false })
    expect(PACK_FIRST_TIME_TEXT).toBe('It will be saved as the usual size for next time.')
  })

  it('any positive number, with a comma or a dot', () => {
    expect(field(rice, 'pack', '1,5', { quantity: 2 })).toMatchObject({ value: 1.5, total: 3, stockUnit: 'gr' })
    expect(field(rice, 'pack', '0.25', { quantity: 3 })).toMatchObject({ total: 0.75 })
    expect(field(rice, 'pack', 'abc')).toMatchObject({ value: null, blocking: true })
  })

  it('what was typed counts for its own unit; another unit starts again', () => {
    expect(packTextFor({ text: '30', unit: 'box' }, 'box', '48')).toBe('30')
    expect(packTextFor({ text: '', unit: 'box' }, 'box', '48')).toBe('')
    expect(packTextFor({ text: '30', unit: 'box' }, 'pack', '')).toBe('')
    expect(packTextFor(null, 'box', '48')).toBe('48')
  })
})

describe('history labels', () => {
  it('"1 box · 30 pcs" and "2 box · 30 pcs each · 60 pcs"', () => {
    expect(packAmountLabel(1, 'box', 30, 'pcs')).toBe('1 box · 30 pcs')
    expect(packAmountLabel(2, 'box', 30, 'pcs')).toBe('2 box · 30 pcs each · 60 pcs')
    expect(packAmountLabel(2, 'pack', 5, 'pcs')).toBe('2 pack · 5 pcs each · 10 pcs')
  })

  it('a purchase line: from what really went into HOME; old or other lines show as before (null)', () => {
    expect(purchasedPackLabel({ quantity: 1, unit: 'box', stock_added: 30 }, cat)).toBe('1 box · 30 pcs')
    expect(purchasedPackLabel({ quantity: 2, unit: 'box', stock_added: 60 }, cat)).toBe('2 box · 30 pcs each · 60 pcs')
    expect(purchasedPackLabel({ quantity: 2, unit: 'pcs', stock_added: 2 }, cat)).toBeNull()
    expect(purchasedPackLabel({ quantity: 1, unit: 'kg', stock_added: 1000 }, rice)).toBeNull()
    expect(purchasedPackLabel({ quantity: null, unit: null, stock_added: 30 }, cat)).toBeNull()
    expect(purchasedPackLabel({ quantity: 1, unit: 'box', stock_added: 0 }, cat)).toBeNull()
    expect(purchasedPackLabel({ quantity: 1, unit: 'box', stock_added: 30 }, null)).toBeNull()
  })

  it('an order with a pack size: "1 box · 24 pcs"; without one, or an old order: null', () => {
    expect(orderPackLabel({ quantity: 1, unit: 'box', pack_size: 24 }, 'pcs')).toBe('1 box · 24 pcs')
    expect(orderPackLabel({ quantity: 3, unit: 'box', pack_size: 24 }, 'pcs')).toBe('3 box · 24 pcs each · 72 pcs')
    expect(orderPackLabel({ quantity: 1, unit: 'box', pack_size: null }, 'pcs')).toBeNull()
    expect(orderPackLabel({ quantity: 1, unit: 'box' }, 'pcs')).toBeNull()
    expect(orderPackLabel({ quantity: 1, unit: 'box', pack_size: 24 }, null)).toBeNull()
  })
})

describe('Confirm purchase (lib/purchase.js)', () => {
  const entry = (fields) => ({ id: 'e1', name: 'Cat Wet Food', pantry_item_id: 'cat', quantity: 1, unit: 'box', payer: 'shared', category_id: 'pet', ...fields })
  const payload = (line, answers = {}) => confirmationPayload({ id: 't', date: '2026-10-28', lines: [line], answers, totalOf: () => 20, expenseCategoryFor: () => 'cat-groceries' })

  it('usual box 48: starts at 48 (+48); typed 30 → +30, the expense is the typed price, the usual 48 is not sent', () => {
    expect(purchaseLine(entry(), [cat])).toMatchObject({ add: 48, ready: true, pack: { text: '48', usual: 48 } })
    const line = purchaseLine(entry(), [cat], { pack: { text: '30', unit: 'box' } })
    expect(line).toMatchObject({ add: 30, ready: true, pack: { differs: true, firstTime: false } })
    expect(payload(line).items[0]).toEqual({ grocery_item_id: 'e1', line_total: 20, payer: 'shared', expense_category_id: 'cat-groceries', durable: false, pantry_item_id: 'cat', add: 30 })
  })

  it('2 box × 30 = +60', () => {
    expect(purchaseLine(entry({ quantity: 2 }), [cat], { pack: { text: '30', unit: 'box' } }).add).toBe(60)
  })

  it('no usual size: empty and required; typed 12 → +12 and saved as the usual size; next time it starts at 12', () => {
    const tunaEntry = entry({ name: 'Tuna', pantry_item_id: 'tuna' })
    expect(purchaseLine(tunaEntry, [tuna])).toMatchObject({ needsPackSize: true, ready: false, add: null, pack: { blocking: true } })
    const line = purchaseLine(tunaEntry, [tuna], { pack: { text: '12', unit: 'box' } })
    expect(line).toMatchObject({ add: 12, ready: true, pack: { firstTime: true } })
    expect(payload(line).items[0]).toMatchObject({ add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
    const saved = { ...tuna, packaging_unit: 'box', quantity_per_pack: 12 }
    expect(purchaseLine(tunaEntry, [saved])).toMatchObject({ add: 12, pack: { text: '12', usual: 12, firstTime: false } })
  })

  it('usual "box", 1 pack typed 5 → +5, nothing saved', () => {
    const line = purchaseLine(entry({ unit: 'pack' }), [cat], { pack: { text: '5', unit: 'pack' } })
    expect(line).toMatchObject({ add: 5, pack: { usual: null, firstTime: false } })
    expect(payload(line).items[0]).not.toHaveProperty('packaging_unit')
  })

  it('pcs, kg and the same unit get no field; a durable line neither', () => {
    expect(purchaseLine(entry({ unit: 'pcs', quantity: 3 }), [cat])).toMatchObject({ pack: null, add: 3 })
    expect(purchaseLine(entry({ name: 'Rice', pantry_item_id: 'rice', unit: 'kg' }), [rice])).toMatchObject({ pack: null, add: 1000 })
    expect(purchaseLine(entry({ category_id: 'appliances' }), [cat])).toMatchObject({ durable: true, pack: null })
  })

  it("an old group-level entry counts with the group's size, but never saves one on the variant", () => {
    const group = { id: 'g', name: 'Chips', unit: 'pcs', is_group: true, packaging_unit: null, quantity_per_pack: null, variants: [{ id: 'v', name: 'Lays', unit: 'pcs', current_stock: 0, group_id: 'g' }] }
    const variant = group.variants[0]
    const line = purchaseLine(entry({ name: 'Chips', pantry_item_id: 'g' }), [group, variant], { pack: { text: '6', unit: 'box' } })
    expect(line).toMatchObject({ add: 6, target: { id: 'v' }, pack: { firstTime: false } })
    expect(payload(line).items[0]).not.toHaveProperty('packaging_unit')
  })
})

describe('MONEY "Add expense" (lib/moneyPurchase.js)', () => {
  const row = (fields) => ({ ...emptyRow(1), name: 'Cat Wet Food', priceText: '20', unit: 'box', unitTouched: true, categoryId: 'pet', ...fields })
  const payloadOf = (line) => moneyPurchasePayload({ id: 'm', date: '2026-10-28', paidBy: 'shared', lines: pricedLines([line]).lines, budgetFor: () => 'b' }).items[0]

  it('usual box 48 bought 1 box typed 30: +30, the expense is the €20 typed, the usual 48 is kept', () => {
    expect(rowLine(row(), [cat])).toMatchObject({ add: 48, pack: { text: '48' } })
    const line = rowLine(row({ packSizeText: '30', packUnit: 'box' }), [cat])
    expect(line).toMatchObject({ add: 30, pack: { differs: true } })
    const item = payloadOf(line)
    expect(item).toMatchObject({ add: 30, line_total: 20, price: 20, quantity: 1, unit: 'box' })
    expect(item).not.toHaveProperty('packaging_unit')
  })

  it('no usual size: Save is blocked with "Type how many pcs are in 1 box."; typed 12 → +12 and saved', () => {
    const empty = rowLine(row({ name: 'Tuna' }), [tuna])
    expect(rowProblem(empty)).toBe('Type how many pcs are in 1 box.')
    const line = rowLine(row({ name: 'Tuna', packSizeText: '12', packUnit: 'box' }), [tuna])
    expect(rowProblem(line)).toBe('')
    expect(payloadOf(line)).toMatchObject({ add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
  })

  it('a size typed for another unit starts again: typed 30 for box, then the unit is pack', () => {
    expect(rowLine(row({ unit: 'pack', packSizeText: '30', packUnit: 'box' }), [cat])).toMatchObject({ add: null, pack: { text: '', blocking: true } })
  })

  it('2 pack × 5 = +10 on an item usually bought by the box; nothing saved', () => {
    const line = rowLine(row({ unit: 'pack', quantityText: '2', packSizeText: '5', packUnit: 'pack' }), [cat])
    expect(line.add).toBe(10)
    expect(payloadOf(line)).not.toHaveProperty('packaging_unit')
  })

  it('no field with Add to HOME off, nor for a new item (it takes the line unit as its stock unit)', () => {
    expect(rowLine(row({ addToHome: false }), [cat]).pack).toBeNull()
    expect(rowLine(row({ name: 'Brand new thing' }), [cat])).toMatchObject({ isNew: true, pack: null, add: 1 })
  })
})

describe('orders before and after supabase/027', () => {
  it('the form sends pack_size only when it has the field (null = empty)', () => {
    const values = { itemName: 'Cat Wet Food', orderDate: '2026-10-28', price: 20, paidBy: 'shared', quantity: 1, unit: 'box' }
    expect(orderRowFrom({ ...values, packSize: 24 })).toMatchObject({ pack_size: 24 })
    expect(orderRowFrom({ ...values, packSize: null })).toMatchObject({ pack_size: null })
    expect(orderRowFrom(values)).not.toHaveProperty('pack_size')
  })

  it('a missing column is recognised, and the row can be written without the two columns', () => {
    expect(missingPackColumn({ code: 'PGRST204', message: "Could not find the 'pack_size' column of 'orders' in the schema cache" })).toBe(true)
    expect(missingPackColumn({ code: '42703', message: 'column "arrival_pack_before" does not exist' })).toBe(true)
    expect(missingPackColumn({ code: 'PGRST204', message: "Could not find the 'unit' column" })).toBe(false)
    expect(missingPackColumn({ code: '23505', message: 'pack_size' })).toBe(false)
    expect(withoutPackColumns({ id: 'o', pack_size: 3, arrival_pack_before: null, unit: 'box' })).toEqual({ id: 'o', unit: 'box' })
  })

  it('an order read from the database tells whether 027 has been run', () => {
    expect(packColumnsReady({ id: 'o', pack_size: null, arrival_pack_before: null })).toBe(true)
    expect(packColumnsReady({ id: 'o' })).toBe(false)
    expect(packColumnsReady(null)).toBe(false)
  })
})
