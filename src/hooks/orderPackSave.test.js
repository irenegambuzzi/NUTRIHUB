import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const feedback = vi.hoisted(() => ({ toasts: [] }))
vi.mock('../lib/feedback', async (importOriginal) => ({
  ...(await importOriginal()),
  showToast: (toast) => feedback.toasts.push(toast),
  toastSaveError: (error, retry, message) => feedback.toasts.push({ error, message: message ?? String(error?.message) }),
}))
const { arriveLinkedOrder, createOrder, editOrder, unarriveOrder } = await import('./useOrders')

// A fake database (plan 9H): it remembers every write with its filters;
// `answer(call)` decides what comes back ({ data, error }), by default the
// written row. `columns`: whether orders have the 027 columns.
let calls
let columns
let answer
function fakeDb() {
  calls = []
  columns = true
  answer = (call) => {
    if (call.table === 'orders' && !columns && call.patch && ('pack_size' in call.patch || 'arrival_pack_before' in call.patch)) {
      return { data: null, error: { code: 'PGRST204', message: "Could not find the 'pack_size' column of 'orders' in the schema cache" } }
    }
    if (call.op === 'rpc') return { data: call.name === 'arrive_order' ? { added: true, order: { id: 'o1', status: 'arrived' } } : { id: 'o1', status: 'on_the_way' }, error: null }
    if (call.single) return { data: null, error: null }
    if (call.patch) return { data: [{ id: call.table === 'orders' ? 'o1' : 'p1', ...call.patch }], error: null }
    return { data: [], error: null }
  }
  client.supabase = {
    from: (table) => {
      const call = { table, op: 'select', filters: [] }
      const q = {
        upsert: (rows) => ((call.op = 'upsert'), (call.patch = rows[0]), q),
        update: (patch) => ((call.op = 'update'), (call.patch = patch), q),
        delete: () => ((call.op = 'delete'), q),
        select: () => q,
        eq: (col, val) => (call.filters.push(['eq', col, val]), q),
        neq: (col, val) => (call.filters.push(['neq', col, val]), q),
        is: (col, val) => (call.filters.push(['is', col, val]), q),
        maybeSingle: () => ((call.single = true), q),
        // What the stores' reloads use: nothing to filter here.
        order: () => q,
        range: () => q,
        gte: () => q,
        lte: () => q,
        not: () => q,
        in: () => q,
        limit: () => q,
        then: (resolve) => {
          calls.push(call)
          return Promise.resolve(answer(call)).then(resolve)
        },
      }
      return q
    },
    rpc: (name, args) => {
      const call = { op: 'rpc', name, args }
      calls.push(call)
      return Promise.resolve(answer(call))
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  feedback.toasts = []
}
beforeEach(fakeDb)

const writesTo = (table) => calls.filter((c) => c.table === table && (c.op === 'update' || c.op === 'upsert'))
const values = { itemName: 'Cat Wet Food', shopId: '', orderDate: '2026-10-28', price: 20, paidBy: 'shared', categoryId: null, expectedDate: '', expectedUntil: '', url: '', quantity: 1, unit: 'box', packSize: 24 }

describe('saving an order with a pack size', () => {
  it('after 027: the order row carries pack_size', async () => {
    const { error } = await createOrder(values, { orderId: 'o1', expenseId: 'x1' }, { pantryItemId: 'cat', groceryItemId: 'g1' })
    expect(error).toBeFalsy()
    expect(writesTo('orders')[0].patch).toMatchObject({ pack_size: 24, quantity: 1, unit: 'box' })
  })

  it('before 027: saved again without it — no failure, no error toast', async () => {
    columns = false
    const { error } = await createOrder(values, { orderId: 'o2', expenseId: 'x2' }, { pantryItemId: 'cat', groceryItemId: 'g1' })
    expect(error).toBeFalsy()
    const orders = writesTo('orders')
    expect(orders).toHaveLength(2)
    expect(orders[1].patch).not.toHaveProperty('pack_size')
    expect(orders[1].patch).toMatchObject({ item_name: 'Cat Wet Food', quantity: 1, unit: 'box' })
    expect(feedback.toasts).toEqual([])
  })

  it('editing before 027 is never blocked either', async () => {
    columns = false
    const order = { id: 'o1', item_name: 'Cat Wet Food', order_date: '2026-10-28', price: 20, paid_by: 'shared', quantity: 1, unit: 'box' }
    const { error } = await editOrder(order, { ...values, packSize: 22 })
    expect(error).toBeFalsy()
    expect(writesTo('orders').at(-1).patch).not.toHaveProperty('pack_size')
    expect(feedback.toasts).toEqual([])
  })

  it('another error is still an error (not swallowed)', async () => {
    answer = (call) => (call.table === 'orders' && call.op === 'upsert' ? { data: null, error: { code: '42501', message: 'Not allowed' } } : { data: [call.patch ?? {}], error: null })
    const { error } = await createOrder(values, { orderId: 'o3', expenseId: 'x3' })
    expect(error).toBeTruthy()
  })
})

describe('Arrived: the stock, the pack size, and a first-time usual size', () => {
  const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs', packaging_unit: null, quantity_per_pack: null }
  const cat = { id: 'cat', name: 'Cat Wet Food', unit: 'pcs', packaging_unit: 'box', quantity_per_pack: 48 }
  const order = (fields) => ({ id: 'o1', pantry_item_id: 'tuna', status: 'on_the_way', quantity: 1, unit: 'box', pack_size: null, arrival_pack_before: null, ...fields })

  it('no usual size, typed 12: +12 in one step, then the order keeps 12 and what the item had, and the item gets box 12 (only while it has none)', async () => {
    const { error, added } = await arriveLinkedOrder(order(), { itemId: 'tuna', delta: 12, date: '2026-10-28', pack: { unit: 'box', value: 12, firstTime: true }, packItem: tuna })
    expect(error).toBeFalsy()
    expect(added).toBe(true)
    expect(calls.find((c) => c.op === 'rpc')).toMatchObject({ name: 'arrive_order', args: { order_id: 'o1', item_id: 'tuna', add_qty: 12 } })
    expect(writesTo('orders')[0].patch).toEqual({ pack_size: 12, arrival_pack_before: { packaging_unit: null, quantity_per_pack: null, saved: { packaging_unit: 'box', quantity_per_pack: 12 } } })
    const item = writesTo('pantry_items')[0]
    expect(item.patch).toEqual({ packaging_unit: 'box', quantity_per_pack: 12 })
    expect(item.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'tuna'],
        ['is', 'quantity_per_pack', null],
        ['is', 'packaging_unit', null],
      ])
    )
    expect(feedback.toasts).toEqual([])
  })

  it('the item got a usual size meanwhile (nothing saved): the order forgets what it had', async () => {
    answer = (call) => {
      if (call.op === 'rpc') return { data: { added: true, order: { id: 'o1' } }, error: null }
      if (call.table === 'pantry_items' && call.op === 'update') return { data: [], error: null }
      if (call.table === 'pantry_items' && call.single) return { data: { packaging_unit: 'box', quantity_per_pack: 10 }, error: null }
      if (!call.patch) return { data: [], error: null }
      return { data: [{ id: 'o1', ...call.patch }], error: null }
    }
    await arriveLinkedOrder(order(), { itemId: 'tuna', delta: 12, date: '2026-10-28', pack: { unit: 'box', value: 12, firstTime: true }, packItem: tuna })
    expect(writesTo('orders').at(-1).patch).toEqual({ arrival_pack_before: null })
  })

  it('an existing usual size (box 48), 2 box typed 30: +60, only the order keeps 30', async () => {
    await arriveLinkedOrder(order({ pantry_item_id: 'cat', quantity: 2 }), { itemId: 'cat', delta: 60, date: '2026-10-28', pack: { unit: 'box', value: 30, firstTime: false }, packItem: cat })
    expect(calls.find((c) => c.op === 'rpc').args.add_qty).toBe(60)
    expect(writesTo('orders').map((w) => w.patch)).toEqual([{ pack_size: 30 }])
    expect(writesTo('pantry_items')).toEqual([])
  })

  it('before 027 (the order has no such columns): the right stock, nothing else written, no error', async () => {
    const old = { id: 'o1', pantry_item_id: 'tuna', status: 'on_the_way', quantity: 1, unit: 'box' }
    const { error } = await arriveLinkedOrder(old, { itemId: 'tuna', delta: 12, date: '2026-10-28', pack: { unit: 'box', value: 12, firstTime: true }, packItem: tuna })
    expect(error).toBeFalsy()
    expect(calls.find((c) => c.op === 'rpc').args.add_qty).toBe(12)
    expect(writesTo('orders')).toEqual([])
    expect(writesTo('pantry_items')).toEqual([])
    expect(feedback.toasts).toEqual([])
  })

  it('a group: the stock goes to the variant, no usual size is saved', async () => {
    await arriveLinkedOrder(order(), { itemId: 'lays', delta: 6, date: '2026-10-28', pack: { unit: 'box', value: 6, firstTime: true }, packItem: null })
    expect(writesTo('orders').map((w) => w.patch)).toEqual([{ pack_size: 6 }])
    expect(writesTo('pantry_items')).toEqual([])
  })
})

describe('"Put back on the way": exactly what the arrival added, and its first-time usual size undone', () => {
  const arrived = (fields) => ({ id: 'o1', status: 'arrived', pantry_item_id: 'tuna', arrived_item_id: 'tuna', stock_added: 12, quantity: 1, unit: 'box', pack_size: 12, ...fields })

  it('the arrival saved box 12: the item gets back what it had, only while it still has box 12; then the order forgets it', async () => {
    const { error } = await unarriveOrder(arrived({ arrival_pack_before: { packaging_unit: null, quantity_per_pack: null, saved: { packaging_unit: 'box', quantity_per_pack: 12 } } }))
    expect(error).toBeFalsy()
    expect(calls.find((c) => c.op === 'rpc')).toMatchObject({ name: 'unarrive_order', args: { order_id: 'o1' } })
    const item = writesTo('pantry_items')[0]
    expect(item.patch).toEqual({ packaging_unit: null, quantity_per_pack: null })
    expect(item.filters).toEqual([
      ['eq', 'id', 'tuna'],
      ['eq', 'packaging_unit', 'box'],
      ['eq', 'quantity_per_pack', 12],
    ])
    expect(writesTo('orders').at(-1).patch).toEqual({ arrival_pack_before: null })
  })

  it('an item that had "box" without a size gets "box" back', async () => {
    await unarriveOrder(arrived({ arrival_pack_before: { packaging_unit: 'box', quantity_per_pack: null, saved: { packaging_unit: 'box', quantity_per_pack: 12 } } }))
    expect(writesTo('pantry_items')[0].patch).toEqual({ packaging_unit: 'box', quantity_per_pack: null })
  })

  it('the arrival saved nothing: only unarrive_order (exactly stock_added), the item is not touched', async () => {
    await unarriveOrder(arrived({ arrival_pack_before: null }))
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(1)
    expect(writesTo('pantry_items')).toEqual([])
    expect(writesTo('orders')).toEqual([])
  })

  it('before 027 (no column): as before', async () => {
    const old = { id: 'o1', status: 'arrived', pantry_item_id: 'tuna', arrived_item_id: 'tuna', stock_added: 12 }
    const { error } = await unarriveOrder(old)
    expect(error).toBeFalsy()
    expect(writesTo('pantry_items')).toEqual([])
    expect(writesTo('orders')).toEqual([])
  })
})
