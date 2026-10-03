import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { confirmationPayload, pantryItemFor, purchaseLine } = await import('./purchase')

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
