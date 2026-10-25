import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { confirmationPayload, pantryItemFor, purchaseLine, purchasePricing } = await import('./purchase')

const pantry = [
  { id: 'p-rice', name: 'Rice', unit: 'gr', current_stock: 100, min_stock: 0 },
  { id: 'p-milk', name: 'Milk', unit: 'btl', current_stock: 2, min_stock: 0, expiry_date: '2020-01-01' },
  { id: 'p-wine', name: 'wine', unit: 'pcs', current_stock: 1, min_stock: 0 },
]
const item = (fields) => ({ id: fields.name, quantity: 1, unit: 'pcs', payer: 'shared', category_id: 'misc', ...fields })

describe('purchaseLine', () => {
  it('finds the pantry item by link, then by name', () => {
    expect(pantryItemFor(item({ name: 'Falanghina', pantry_item_id: 'p-wine' }), pantry).id).toBe('p-wine')
    expect(pantryItemFor(item({ name: ' wine ' }), pantry).id).toBe('p-wine')
    expect(pantryItemFor(item({ name: 'Avocado' }), pantry)).toBeNull()
  })

  it('is ready when units convert and nothing has expired', () => {
    const line = purchaseLine(item({ name: 'Rice', quantity: 1, unit: 'kg' }), pantry)
    expect(line).toMatchObject({ add: 1000, ready: true, needsPackSize: false, expired: false })
  })

  it('asks for the pack size until it is given', () => {
    const rice = item({ name: 'Rice', quantity: 2, unit: 'pack' })
    expect(purchaseLine(rice, pantry)).toMatchObject({ needsPackSize: true, ready: false })
    expect(purchaseLine(rice, pantry, { packSize: 500 })).toMatchObject({ add: 1000, ready: true })
  })

  it('asks what to do with expired stock until it is answered', () => {
    const milk = item({ name: 'Milk', quantity: 3, unit: 'btl' })
    expect(purchaseLine(milk, pantry)).toMatchObject({ expired: true, expiredStock: 2, needsExpiryChoice: true, ready: false })
    expect(purchaseLine(milk, pantry, { discard: false })).toMatchObject({ ready: true })
  })

  it('adds a new pantry item for things not in the pantry, and no stock for appliances', () => {
    expect(purchaseLine(item({ name: 'Avocado', quantity: 2 }), pantry)).toMatchObject({ pantry: null, add: 2, ready: true })
    expect(purchaseLine(item({ name: 'Kettle', category_id: 'appliances' }), pantry)).toMatchObject({ durable: true, pantry: null, add: 0 })
  })

  it('round 9F: every Durables sub, and a durable budget category, is an expense only — even for an item in HOME', () => {
    for (const sub of ['appliances:clothing', 'appliances:footwear', 'appliances:accessories', 'appliances:pet', 'appliances:glasses', 'appliances:furniture', 'misc:gifts']) {
      expect(purchaseLine(item({ name: 'Thing', category_id: 'appliances', subcategory_id: sub }), pantry), sub).toMatchObject({ durable: true, pantry: null, target: null, add: 0 })
    }
    expect(purchaseLine(item({ name: 'wine', category_id: 'beverages' }), pantry, {}, { durableBudget: true })).toMatchObject({ durable: true, pantry: null, add: 0, ready: true })
    expect(purchaseLine(item({ name: 'wine', category_id: 'beverages' }), pantry, {}, { durableBudget: false })).toMatchObject({ durable: false, add: 1 })
  })
})

describe('confirmationPayload', () => {
  it('describes the whole cart for confirm_shopping_trip', () => {
    const cart = [
      item({ name: 'Milk', quantity: 3, unit: 'btl', payer: 'irene' }),
      item({ name: 'Rice', quantity: 2, unit: 'pack' }),
      item({ name: 'Kettle', category_id: 'appliances' }),
      item({ name: 'Avocado', quantity: 2 }),
    ]
    const answers = { Milk: { discard: true, expiryDate: '2026-10-20' }, Rice: { packSize: 500 } }
    const lines = cart.map((i) => purchaseLine(i, pantry, answers[i.id]))
    const payload = confirmationPayload({
      id: 'trip-1',
      date: '2026-10-03',
      at: '2026-10-03T10:00:00Z',
      lines,
      answers,
      totalOf: (i) => ({ Milk: 3.6, Rice: 4, Kettle: 25, Avocado: null })[i.id],
      expenseCategoryFor: (i) => (i.category_id === 'appliances' ? 'cat-home' : 'cat-groceries'),
      photoIds: ['photo-1'],
    })
    expect(payload).toMatchObject({ id: 'trip-1', trip_date: '2026-10-03', photo_ids: ['photo-1'] })
    expect(payload.items).toEqual([
      { grocery_item_id: 'Milk', line_total: 3.6, payer: 'irene', expense_category_id: 'cat-groceries', durable: false, pantry_item_id: 'p-milk', add: 3, discard_expired: true, expiry_date: '2026-10-20' },
      { grocery_item_id: 'Rice', line_total: 4, payer: 'shared', expense_category_id: 'cat-groceries', durable: false, pantry_item_id: 'p-rice', add: 1000, packaging_unit: 'pack', quantity_per_pack: 500 },
      { grocery_item_id: 'Kettle', line_total: 25, payer: 'shared', expense_category_id: 'cat-home', durable: true, pantry_item_id: null, add: 0 },
      { grocery_item_id: 'Avocado', line_total: 0, payer: 'shared', expense_category_id: 'cat-groceries', durable: false, pantry_item_id: null, add: 2 },
    ])
  })
})

describe('edits on the confirm screen', async () => {
  const { editPatch, editedItem } = await import('./purchase')
  const milk = { id: 'm', name: 'Milk', quantity: 1, unit: 'btl', price: 1, price_qty: 1, price_unit: 'btl', payer: 'shared' }

  it('a typed total becomes the price for exactly that quantity and unit', () => {
    expect(editedItem(milk, { total: 2 })).toMatchObject({ price: 2, price_qty: 1, price_unit: 'btl' })
    expect(editedItem(milk, { quantity: 3, total: 4.5 })).toMatchObject({ quantity: 3, price: 4.5, price_qty: 3, price_unit: 'btl' })
    expect(editedItem(milk, { unit: 'pack', total: 2 })).toMatchObject({ unit: 'pack', price: 2, price_qty: 1, price_unit: 'pack' })
  })

  it('a new quantity keeps the unit price', () => {
    expect(editedItem(milk, { quantity: 3 })).toMatchObject({ quantity: 3, price: 1, price_qty: 1 })
  })

  it('saves only what changed', () => {
    expect(editPatch(milk, undefined)).toEqual({})
    expect(editPatch(milk, { total: 2, payer: 'akbar' })).toEqual({ price: 2, payer: 'akbar' })
    expect(editPatch(milk, { quantity: 2, total: 2 })).toEqual({ quantity: 2, price: 2, price_qty: 2 })
  })

  it('the payload uses the edited price, quantity, unit and payer everywhere', () => {
    const rice = { id: 'r', name: 'Rice', quantity: 1, unit: 'pack', price: 1, price_qty: 1, price_unit: 'pack', payer: 'shared' }
    const edited = editedItem(rice, { quantity: 1, unit: 'kg', total: 2, payer: 'akbar' })
    const line = purchaseLine(edited, pantry)
    const payload = confirmationPayload({
      id: 't',
      date: '2026-10-05',
      lines: [line],
      answers: {},
      totalOf: (i) => (i.price * i.quantity) / i.price_qty,
      expenseCategoryFor: () => 'cat',
    })
    // 1 kg of rice counted in gr: 1000 gr added, €2 expense, paid by Akbar.
    expect(payload.items[0]).toMatchObject({ line_total: 2, payer: 'akbar', add: 1000 })
    expect(payload.trip_date).toBe('2026-10-05')
  })
})

describe('discounts on the confirm screen', () => {
  const cart = [item({ name: 'Nutella' }), item({ name: 'Chips' }), item({ name: 'Rice' })]
  const normal = { Nutella: 6, Chips: 4, Rice: 2 }
  const totalOf = (i) => normal[i.id]
  const payloadFor = (pricing) =>
    confirmationPayload({ id: 't', date: '2026-10-21', lines: cart.map((i) => purchaseLine(i, pantry)), answers: {}, totalOf, expenseCategoryFor: () => 'cat', pricing })

  it('Nutella €6.00 −50%: the expense is €3.00 and the line keeps the normal price €6.00', () => {
    const pricing = purchasePricing([cart[0]], totalOf, { Nutella: { kind: 'percent', text: '50' } })
    const payload = confirmationPayload({ id: 't', date: 'd', lines: [purchaseLine(cart[0], pantry)], answers: {}, totalOf, expenseCategoryFor: () => 'cat', pricing })
    expect(payload.items[0]).toMatchObject({ line_total: 3, list_total: 6, item_discount_kind: 'percent', item_discount_value: 50 })
    expect(payload.items[0].coupon_share).toBeUndefined()
    expect(payload.coupon_kind).toBeUndefined()
  })

  it('a coupon is spread over the lines after their own discounts; the trip carries the coupon', () => {
    const pricing = purchasePricing(cart, totalOf, { Nutella: { kind: 'percent', text: '50' } }, { kind: 'amount', text: '1' })
    // after item discounts: 3 + 4 + 2 = 9; coupon €1 → 0.33, 0.44, 0.23
    const payload = payloadFor(pricing)
    expect(payload).toMatchObject({ coupon_kind: 'amount', coupon_value: 1, coupon_total: 1 })
    expect(payload.items.map((i) => [i.list_total, i.line_total, i.coupon_share])).toEqual([
      [6, 2.67, 0.33],
      [4, 3.56, 0.44],
      [2, 1.77, 0.23],
    ])
    expect(payload.items.reduce((s, i) => Math.round((s + i.line_total) * 100) / 100, 0)).toBe(8)
  })

  it('a coupon needs two items or more', () => {
    const pricing = purchasePricing([cart[0]], totalOf, {}, { kind: 'amount', text: '1' })
    expect(pricing.priced.couponTotal).toBe(0)
  })

  it('a line whose total is unknown has no expense amount and takes no part', () => {
    const unknown = (i) => (i.id === 'Chips' ? null : normal[i.id])
    const pricing = purchasePricing(cart, unknown, {}, { kind: 'amount', text: '1' })
    const payload = confirmationPayload({ id: 't', date: 'd', lines: cart.map((i) => purchaseLine(i, pantry)), answers: {}, totalOf: unknown, expenseCategoryFor: () => 'cat', pricing })
    expect(payload.items[1].line_total).toBe(0)
    expect(payload.items[1].list_total).toBeUndefined()
    expect(payload.items[0].coupon_share + payload.items[2].coupon_share).toBe(1)
  })

  it('a refused discount is reported so Confirm can wait', () => {
    expect(purchasePricing(cart, totalOf, { Rice: { kind: 'amount', text: '5' } }).priced.problem).toBe('The discount (€5) is bigger than the price (€2).')
  })

  it('without pricing the payload is exactly as before', () => {
    expect(payloadFor(null).items[0]).toEqual({ grocery_item_id: 'Nutella', line_total: 6, payer: 'shared', expense_category_id: 'cat', durable: false, pantry_item_id: null, add: 1 })
  })
})
