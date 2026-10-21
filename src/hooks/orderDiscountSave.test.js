import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { createOrder, editOrder, orderRowFrom } = await import('./useOrders')
const { orderStore } = await import('../lib/stores')
const { expenseDiscountNote, orderDiscount } = await import('../lib/orders')

// A fake database that remembers every write, and answers a write with the
// row that was written (as `.select()` does), a plain read with nothing.
let writes
function fakeDb() {
  writes = []
  client.supabase = {
    from: (table) => {
      let result = []
      const q = {
        upsert: (rows) => ((result = rows), writes.push({ table, op: 'upsert', rows }), q),
        update: (patch) => ((result = [{ id: 'o1', ...patch }]), writes.push({ table, op: 'update', patch }), q),
        select: () => q,
        eq: () => q,
        neq: () => q,
        delete: () => q,
        maybeSingle: () => q,
        then: (resolve) => Promise.resolve({ data: result, error: null }).then(resolve),
      }
      return q
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
}

const sneakers = {
  itemName: 'Test order',
  shopId: '',
  orderDate: '2026-10-21',
  price: 56,
  listPrice: 80,
  discountKind: 'percent',
  discountValue: 30,
  paidBy: 'irene',
  categoryId: null,
  expectedDate: '',
  expectedUntil: '',
  url: '',
}

beforeEach(fakeDb)

describe('an order with a discount is saved with its normal price and discount', () => {
  it('Orders in MONEY (no link): the order row carries list_price, discount_kind and discount_value, the expense the paid price', async () => {
    const { error } = await createOrder(sneakers, { orderId: 'o1', expenseId: 'x1' })
    expect(error).toBeFalsy()
    const order = writes.find((w) => w.table === 'orders' && w.op === 'upsert').rows[0]
    expect(order).toMatchObject({ id: 'o1', price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30, status: 'on_the_way', expense_id: 'x1' })
    expect(writes.find((w) => w.table === 'expenses' && w.op === 'upsert').rows[0]).toMatchObject({ id: 'x1', amount: 56 })
    // …and the card reads it back from the store
    const stored = orderStore.getSnapshot().rows.find((o) => o.id === 'o1')
    expect(orderDiscount(stored)).toMatchObject({ list: 80, paid: 56, label: '€80.00 → €56.00 (−30%)' })
  })

  it('"Order online" on a SHOP card (linked to the entry and the HOME item): same columns, and the entry leaves the cart', async () => {
    const { error } = await createOrder(sneakers, { orderId: 'o2', expenseId: 'x2' }, { pantryItemId: 'p1', groceryItemId: 'g1' })
    expect(error).toBeFalsy()
    const order = writes.find((w) => w.table === 'orders' && w.op === 'upsert').rows[0]
    expect(order).toMatchObject({ price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30, pantry_item_id: 'p1', grocery_item_id: 'g1' })
    expect(writes.find((w) => w.table === 'grocery_items')).toMatchObject({ op: 'update', patch: { in_cart: false } })
    const stored = orderStore.getSnapshot().rows.find((o) => o.id === 'o2')
    expect(stored).toMatchObject({ list_price: 80, discount_kind: 'percent', discount_value: 30 })
  })

  it('a € discount is saved the same way', async () => {
    await createOrder({ ...sneakers, price: 95, listPrice: 120, discountKind: 'amount', discountValue: 25 }, { orderId: 'o3', expenseId: 'x3' })
    expect(writes.find((w) => w.table === 'orders' && w.op === 'upsert').rows[0]).toMatchObject({ price: 95, list_price: 120, discount_kind: 'amount', discount_value: 25 })
  })

  it('an order without a discount sends null for all three, so nothing old is left', async () => {
    await createOrder({ ...sneakers, price: 80, listPrice: null, discountKind: null, discountValue: null }, { orderId: 'o4', expenseId: 'x4' })
    expect(writes.find((w) => w.table === 'orders' && w.op === 'upsert').rows[0]).toMatchObject({ price: 80, list_price: null, discount_kind: null, discount_value: null })
  })

  it('editing an order sends the discount again (or clears it when it is removed)', async () => {
    const order = { id: 'o1', item_name: 'Test order', order_date: '2026-10-21', price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30, paid_by: 'irene', expense_id: 'x1' }
    await editOrder(order, { ...sneakers, discountValue: 25, price: 60 })
    expect(writes.find((w) => w.table === 'orders' && w.op === 'update').patch).toMatchObject({ price: 60, list_price: 80, discount_kind: 'percent', discount_value: 25 })
    writes.length = 0
    await editOrder(order, { ...sneakers, price: 80, listPrice: null, discountKind: null, discountValue: null })
    expect(writes.find((w) => w.table === 'orders' && w.op === 'update').patch).toMatchObject({ price: 80, list_price: null, discount_kind: null, discount_value: null })
  })

  it('a caller that knows nothing of discounts leaves those columns alone', () => {
    const row = orderRowFrom({ itemName: 'x', orderDate: '2026-10-21', price: 5, paidBy: 'irene' })
    expect(row).not.toHaveProperty('list_price')
  })
})

describe('the MONEY row of an order expense', () => {
  const order = { id: 'o1', expense_id: 'x1', price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30 }
  const orderOf = (id) => (id === 'x1' ? order : null)

  it('says "€80.00 → €56.00 (−30%)", read from the order linked to the expense', () => {
    expect(expenseDiscountNote({ id: 'x1', amount: 56 }, orderOf)).toBe('€80.00 → €56.00 (−30%)')
  })

  it('stays the same after Arrived or Cancel / Return with the expense kept (the order keeps its fields)', () => {
    expect(expenseDiscountNote({ id: 'x1', amount: 56 }, () => ({ ...order, status: 'arrived', arrived_date: '2026-10-25' }))).toBe('€80.00 → €56.00 (−30%)')
    expect(expenseDiscountNote({ id: 'x1', amount: 56 }, () => ({ ...order, status: 'returned', expense_outcome: 'kept' }))).toBe('€80.00 → €56.00 (−30%)')
  })

  it('follows an edit of the order (new discount, new price)', () => {
    const edited = { ...order, price: 60, discount_value: 25 }
    expect(expenseDiscountNote({ id: 'x1', amount: 60 }, () => edited)).toBe('€80.00 → €60.00 (−25%)')
  })

  it('nothing for another expense, an order without a discount, or an expense edited to another amount', () => {
    expect(expenseDiscountNote({ id: 'x9', amount: 56 }, orderOf)).toBe('')
    expect(expenseDiscountNote({ id: 'x1', amount: 80 }, () => ({ ...order, list_price: null, discount_kind: null, discount_value: null }))).toBe('')
    expect(expenseDiscountNote({ id: 'x1', amount: 40 }, orderOf)).toBe('')
  })
})
