import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 9J: every Arrived is one arrive_order step (also "It arrived!" for
// an order not linked to HOME), the Undo on its toast puts back exactly
// what was there, and "Back on the way" works on every arrived order. Run
// against a small database kept in memory (arrivalDb.fixture.js) that does
// what supabase/021 does, so the test sees stock, history rows, order
// columns and SHOP entries as the database would.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('./arrivalDb.fixture')
const { arriveLinkedOrder, arrivedToast, discardUnusedItem, markDurableArrived, undoArrival } = await import('./useOrders')
const { askBackOnTheWay, NO_STOCK_RECORDED } = await import('./orderActions')
const { closeDialog, dismissToast, getDialog, getToasts, runToastAction } = await import('../lib/feedback')
const { setOnlineForTest } = await import('../lib/connection')
const { newVariantFields } = await import('../lib/groups')

let db
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
  setOnlineForTest(true)
  vi.restoreAllMocks()
})

const TODAY = '2026-10-30'
const item = (id) => db.row('pantry_items', id)
const order = (id) => db.row('orders', id)
const logsOf = (id) => db.tables.stock_logs.filter((l) => l.item_id === id)
const entriesOf = (id) => db.tables.grocery_items.filter((g) => g.pantry_item_id === id)
const messages = () => getToasts().map((t) => t.message)
// The order as the phone has it when Arrived is pressed (a copy).
const asShown = (id) => ({ ...order(id) })
// What the database has besides the arrival, to check nothing else moved.
const others = () => ({ expenses: structuredClone(db.tables.expenses), groups: structuredClone(db.tables.order_groups) })

// Answers the question asked by `promise` (confirm or cancel), giving it
// and the result.
async function answer(promise, confirm = true) {
  await vi.waitFor(() => expect(getDialog()).toBeTruthy())
  const dialog = getDialog()
  closeDialog(confirm ? {} : null)
  return { dialog, result: await promise }
}

describe('Arrived of a linked order, then Undo on the toast', () => {
  it('"Arrived — add to HOME" (L1): ordered 1 box of 24, arrived 22 → +22; Undo: stock, history row, order, SHOP entry and the pack size 24 back', async () => {
    const cat = db.add('pantry_items', { name: 'Cat Wet Food', unit: 'pcs', current_stock: 2, min_stock: 6, packaging_unit: 'box', quantity_per_pack: 24 })
    const entry = db.add('grocery_items', { name: 'Cat Wet Food', pantry_item_id: cat.id, auto_generated: true })
    const o = db.add('orders', { item_name: 'Cat Wet Food', price: 18.9, pantry_item_id: cat.id, grocery_item_id: entry.id, quantity: 1, unit: 'box', pack_size: 24 })
    const before = others()
    const { error, added, arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: cat.id, delta: 22, date: TODAY, pack: { unit: 'box', value: 22, firstTime: false }, packItem: item(cat.id) })
    expect(error).toBeFalsy()
    expect(added).toBe(true)
    expect(item(cat.id).current_stock).toBe(24)
    expect(logsOf(cat.id)).toMatchObject([{ change: 22, new_stock: 24, reason: 'purchased' }])
    expect(order(o.id)).toMatchObject({ status: 'arrived', arrived_date: TODAY, stock_added: 22, arrived_item_id: cat.id, arrived_log_id: logsOf(cat.id)[0].id, pack_size: 22 })
    expect(db.row('grocery_items', entry.id)).toMatchObject({ completed: true, in_cart: false })

    arrivedToast('Arrived — added 22 pcs to "Cat Wet Food"', arrival)
    const toast = getToasts().at(-1)
    expect(toast.action.label).toBe('Undo')
    await runToastAction(toast.id)
    expect(item(cat.id).current_stock).toBe(2)
    expect(logsOf(cat.id)).toEqual([])
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_date: null, stock_added: 0, arrived_item_id: null, arrived_log_id: null, pack_size: 24, price: 18.9 })
    expect(db.row('grocery_items', entry.id)).toMatchObject({ completed: false, in_cart: false })
    expect(messages()).toContain('"Cat Wet Food" is on the way again — 22 pcs taken out of "Cat Wet Food"')
    expect(others()).toEqual(before)
    expect(db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['arrive_order', 'unarrive_order'])
  })

  it('a first-time usual size (Tuna, 1 box typed 12) is undone too, and the order has no pack size again', async () => {
    const tuna = db.add('pantry_items', { name: 'Tuna in Olive Oil', unit: 'pcs', current_stock: 1, min_stock: 2 })
    const o = db.add('orders', { item_name: 'Tuna in Olive Oil', price: 14.4, pantry_item_id: tuna.id, quantity: 1, unit: 'box' })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: tuna.id, delta: 12, date: TODAY, pack: { unit: 'box', value: 12, firstTime: true }, packItem: item(tuna.id) })
    expect(item(tuna.id)).toMatchObject({ current_stock: 13, packaging_unit: 'box', quantity_per_pack: 12 })
    expect(order(o.id).arrival_pack_before).toEqual({ packaging_unit: null, quantity_per_pack: null, saved: { packaging_unit: 'box', quantity_per_pack: 12 } })
    await undoArrival(arrival)
    expect(item(tuna.id)).toMatchObject({ current_stock: 1, packaging_unit: null, quantity_per_pack: null })
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', pack_size: null, arrival_pack_before: null })
  })

  it('"Arrived, but don\'t add anything to HOME" (L2): Undo puts the order and its SHOP entry back on the way, HOME untouched', async () => {
    const soap = db.add('pantry_items', { name: 'Dish Soap', unit: 'btl', current_stock: 1, min_stock: 1 })
    const entry = db.add('grocery_items', { name: 'Dish Soap', pantry_item_id: soap.id })
    const o = db.add('orders', { item_name: 'Dish Soap', price: 3.2, pantry_item_id: soap.id, grocery_item_id: entry.id })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    expect(order(o.id)).toMatchObject({ status: 'arrived', stock_added: 0, arrived_log_id: null })
    await undoArrival(arrival)
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_date: null })
    expect(db.row('grocery_items', entry.id).completed).toBe(false)
    expect(item(soap.id).current_stock).toBe(1)
    expect(messages()).toContain('"Dish Soap" is on the way again')
  })

  it('a new variant made by a linked arrival is deleted again by Undo (K4), and its group is judged again', async () => {
    const chips = db.add('pantry_items', { name: 'Chips & Snacks', unit: 'pcs', is_group: true, min_stock: 2 })
    db.add('pantry_items', { name: 'Paprika Crisps', unit: 'pcs', group_id: chips.id, current_stock: 1 })
    const o = db.add('orders', { item_name: 'Chips & Snacks', price: 6, pantry_item_id: chips.id, quantity: 4, unit: 'pcs' })
    const variant = { id: 'variant-chili', fields: newVariantFields(item(chips.id), 'Chili Crisps') }
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, newVariant: variant, delta: 4, date: TODAY })
    expect(item('variant-chili')).toMatchObject({ name: 'Chili Crisps', group_id: chips.id, current_stock: 4 })
    await undoArrival(arrival)
    expect(item('variant-chili')).toBeNull()
    expect(db.tables.stock_logs).toEqual([])
    expect(messages()).toContain('"Chips & Snacks" is on the way again — 4 pcs taken out, and the new variant "Chili Crisps" deleted from HOME')
  })
})

describe('"It arrived!" (an order not linked to HOME): one arrive_order step, then Undo', () => {
  it('"Add to an existing item": +5000 gr as "Bought", the order stays unlinked; the SHOP list follows, and Undo puts all of it back', async () => {
    const rice = db.add('pantry_items', { name: 'Basmati Rice', unit: 'gr', current_stock: 200, min_stock: 500 })
    const auto = db.add('grocery_items', { name: 'Basmati Rice', pantry_item_id: rice.id, auto_generated: true })
    const o = db.add('orders', { item_name: 'Basmati rice 5 kg', price: 21.5 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: rice.id, delta: 5000, date: TODAY })
    expect(item(rice.id).current_stock).toBe(5200)
    expect(logsOf(rice.id)).toMatchObject([{ change: 5000, reason: 'purchased' }])
    expect(order(o.id)).toMatchObject({ status: 'arrived', pantry_item_id: null, arrived_item_id: rice.id, stock_added: 5000 })
    // Enough rice now: the automatic "to buy" entry left the list.
    expect(db.row('grocery_items', auto.id)).toBeNull()
    await undoArrival(arrival)
    expect(item(rice.id).current_stock).toBe(200)
    expect(logsOf(rice.id)).toEqual([])
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_item_id: null, stock_added: 0, pantry_item_id: null })
    expect(entriesOf(rice.id)).toMatchObject([{ auto_generated: true, completed: false }])
    expect(messages()).toContain('"Basmati rice 5 kg" is on the way again — 5000 gr taken out of "Basmati Rice"')
  })

  it('"Add to a variant of an item group", an existing variant: +3, Undo −3', async () => {
    const pasta = db.add('pantry_items', { name: 'Pasta', unit: 'pack', is_group: true, min_stock: 2 })
    const penne = db.add('pantry_items', { name: 'Penne Rigate', unit: 'pack', group_id: pasta.id, current_stock: 2 })
    const o = db.add('orders', { item_name: 'Penne x3', price: 4.47 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: penne.id, delta: 3, date: TODAY })
    expect(item(penne.id).current_stock).toBe(5)
    await undoArrival(arrival)
    expect(item(penne.id).current_stock).toBe(2)
    expect(logsOf(penne.id)).toEqual([])
  })

  it('a new variant: made with stock 0, then +6; used on the other phone meanwhile → Undo takes the 6 out but keeps it (K4)', async () => {
    const tea = db.add('pantry_items', { name: 'Tea', unit: 'box', is_group: true, min_stock: 1 })
    const o = db.add('orders', { item_name: 'Green tea', price: 9.6 })
    const fields = newVariantFields(item(tea.id), 'Green Tea Sencha')
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, newVariant: { id: 'variant-sencha', fields }, delta: 6, date: TODAY })
    expect(item('variant-sencha').current_stock).toBe(6)
    expect(logsOf('variant-sencha').map((l) => l.reason)).toEqual(['purchased'])
    // The other phone uses 1 box.
    await db.supabase.rpc('increment_stock', { item_id: 'variant-sencha', delta: -1 })
    db.add('stock_logs', { item_id: 'variant-sencha', change: -1, reason: 'used' })
    await undoArrival(arrival)
    expect(item('variant-sencha').current_stock).toBe(0)
    expect(logsOf('variant-sencha').map((l) => l.reason)).toEqual(['used'])
    expect(messages()).toContain('"Green tea" is on the way again — 6 box taken out of "Green Tea Sencha" (kept in HOME: it changed meanwhile)')
  })

  it('"Create a new item" with 2 pcs: one "Bought" row (no "Added"), not linked; Undo deletes the item, its history and its SHOP entries (K3)', async () => {
    const o = db.add('orders', { item_name: 'Hairball Paste', price: 7.99 })
    const newItem = { id: 'new-paste', fields: { name: 'Hairball Paste', unit: 'pcs', min_stock: 1, category_id: 'pets' } }
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { newItem, delta: 2, date: TODAY })
    expect(item('new-paste')).toMatchObject({ name: 'Hairball Paste', current_stock: 2 })
    expect(logsOf('new-paste').map((l) => l.reason)).toEqual(['purchased'])
    expect(order(o.id)).toMatchObject({ pantry_item_id: null, arrived_item_id: 'new-paste', stock_added: 2 })
    expect(db.calls.some((c) => c.table === 'pantry_items' && c.op === 'insert')).toBe(false)
    await undoArrival(arrival)
    expect(item('new-paste')).toBeNull()
    expect(db.tables.stock_logs).toEqual([])
    expect(db.tables.grocery_items).toEqual([])
    expect(order(o.id).status).toBe('on_the_way')
    expect(messages()).toContain('"Hairball Paste" is on the way again — 2 pcs taken out, and the new item "Hairball Paste" deleted from HOME')
  })

  it('"Create a new item" with "Current stock" 0 (K6): arrives with nothing added; the toast Undo still deletes the untouched item and its "to buy" entry', async () => {
    const o = db.add('orders', { item_name: 'Lint Roller', price: 5.5 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { newItem: { id: 'new-roller', fields: { name: 'Lint Roller', unit: 'pcs', min_stock: 1 } }, delta: 0, date: TODAY })
    expect(order(o.id)).toMatchObject({ status: 'arrived', stock_added: 0, arrived_item_id: null })
    expect(item('new-roller').current_stock).toBe(0)
    expect(entriesOf('new-roller')).toMatchObject([{ auto_generated: true }])
    await undoArrival(arrival)
    expect(item('new-roller')).toBeNull()
    expect(db.tables.grocery_items).toEqual([])
    expect(messages()).toContain('"Lint Roller" is on the way again — the new item "Lint Roller" deleted from HOME')
  })

  it('"Don\'t add to HOME": arrive_order with nothing; Undo puts the order back on the way', async () => {
    const o = db.add('orders', { item_name: 'Phone Case', price: 12 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    expect(db.calls.find((c) => c.op === 'rpc')).toMatchObject({ name: 'arrive_order', args: { item_id: null, add_qty: 0 } })
    expect(order(o.id)).toMatchObject({ status: 'arrived', arrived_date: TODAY })
    await undoArrival(arrival)
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_date: null })
  })

  it('the other phone arrived it first while "It arrived!" was open: nothing added, the new item deleted again, no Undo', async () => {
    const o = db.add('orders', { item_name: 'Dog Chew Sticks', price: 11 })
    await db.supabase.rpc('arrive_order', { order_id: o.id, item_id: null, add_qty: 0, arrived_on: TODAY })
    const { error, added, arrival } = await arriveLinkedOrder({ ...asShown(o.id), status: 'on_the_way' }, { newItem: { id: 'new-chews', fields: { name: 'Dog Chew Sticks', unit: 'pcs' } }, delta: 10, date: TODAY })
    expect(error).toBeFalsy()
    expect(added).toBe(false)
    expect(arrival).toBeNull()
    expect(item('new-chews')).toBeNull()
  })

  it('the second step fails: the new item waits at 0; pressing again (name changed) uses the same id — one item; closing instead deletes it', async () => {
    const o = db.add('orders', { item_name: 'Laundry Pods', price: 13.9 })
    let fail = true
    db.failWhen = (call) => call.name === 'arrive_order' && fail
    const first = await arriveLinkedOrder(asShown(o.id), { newItem: { id: 'new-pods', fields: { name: 'Laundry pods', unit: 'pcs' } }, delta: 30, date: TODAY })
    expect(first.error).toBeTruthy()
    expect(item('new-pods')).toMatchObject({ name: 'Laundry pods', current_stock: 0 })
    fail = false
    const again = await arriveLinkedOrder(asShown(o.id), { newItem: { id: 'new-pods', fields: { name: 'Laundry Pods Lavender', unit: 'pcs' } }, delta: 30, date: TODAY })
    expect(again.added).toBe(true)
    expect(db.tables.pantry_items.map((p) => [p.name, p.current_stock])).toEqual([['Laundry Pods Lavender', 30]])

    // Another order, the same failure, then the dialog is closed.
    const o2 = db.add('orders', { item_name: 'Sponges', price: 2.5 })
    fail = true
    await arriveLinkedOrder(asShown(o2.id), { newItem: { id: 'new-sponges', fields: { name: 'Sponges', unit: 'pcs' } }, delta: 6, date: TODAY })
    expect(item('new-sponges')).toBeTruthy()
    await discardUnusedItem('new-sponges')
    expect(item('new-sponges')).toBeNull()
    expect(order(o2.id).status).toBe('on_the_way')
  })
})

describe('durable and service orders: the toast has Undo too', () => {
  it('durable (a vacuum ordered from SHOP → Durables): Undo puts the order and its SHOP entry back on the way', async () => {
    const entry = db.add('grocery_items', { name: 'Cordless Vacuum', category_id: 'appliances' })
    const o = db.add('orders', { item_name: 'Cordless Vacuum', price: 149, grocery_item_id: entry.id })
    await markDurableArrived(asShown(o.id), TODAY)
    expect(order(o.id).status).toBe('arrived')
    const toast = getToasts().at(-1)
    expect(toast).toMatchObject({ message: '“Cordless Vacuum” arrived — durable, nothing added to HOME.', action: { label: 'Undo' } })
    await runToastAction(toast.id)
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_date: null })
    expect(db.row('grocery_items', entry.id).completed).toBe(false)
    expect(db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['unarrive_order'])
  })

  it('service: the same, with its own text', async () => {
    const o = db.add('orders', { item_name: 'Music streaming, 1 month', price: 10.99 })
    await markDurableArrived(asShown(o.id), TODAY, 'service')
    const toast = getToasts().at(-1)
    expect(toast).toMatchObject({ message: '“Music streaming, 1 month” arrived — service, nothing added to HOME.', action: { label: 'Undo' } })
    await runToastAction(toast.id)
    expect(order(o.id).status).toBe('on_the_way')
  })
})

describe('the Undo guard against the other phone (K5)', () => {
  it('put back and arrived again on the other phone: our Undo changes nothing and says so', async () => {
    const oil = db.add('pantry_items', { name: 'Olive Oil', unit: 'btl', current_stock: 1 })
    const o = db.add('orders', { item_name: 'Olive Oil', price: 24, pantry_item_id: oil.id, quantity: 3, unit: 'btl' })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: oil.id, delta: 3, date: TODAY })
    await db.supabase.rpc('unarrive_order', { order_id: o.id })
    await db.supabase.rpc('arrive_order', { order_id: o.id, item_id: oil.id, add_qty: 2, arrived_on: TODAY })
    const theirs = { ...order(o.id) }
    await undoArrival(arrival)
    expect(order(o.id)).toEqual(theirs)
    expect(item(oil.id).current_stock).toBe(3)
    expect(messages()).toContain('"Olive Oil" changed meanwhile (on the other phone?) — nothing was undone.')
    expect(db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['arrive_order', 'unarrive_order', 'arrive_order'])
  })

  it('only put back on the other phone (no stock either way): nothing undone', async () => {
    const o = db.add('orders', { item_name: 'Desk Lamp', price: 35 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    await db.supabase.rpc('unarrive_order', { order_id: o.id })
    await undoArrival(arrival)
    expect(messages()).toContain('"Desk Lamp" changed meanwhile (on the other phone?) — nothing was undone.')
  })

  it('offline: Undo is refused, nothing changes', async () => {
    const o = db.add('orders', { item_name: 'Bird Seed', price: 8 })
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    setOnlineForTest(false)
    const { error } = await undoArrival(arrival)
    expect(error).toMatchObject({ offline: true })
    expect(order(o.id).status).toBe('arrived')
    expect(messages()).toContain("You're offline — this needs a connection.")
  })
})

describe('an order of an order group (plan 9I)', () => {
  it('Arrived and Undo never touch its price, group, share or expense', async () => {
    const litter = db.add('pantry_items', { name: 'Cat Litter', unit: 'bag', current_stock: 0, min_stock: 1 })
    const expense = { id: 'exp-litter', amount: 8.25, description: 'Cat Litter' }
    db.tables.expenses.push(expense)
    db.tables.order_groups.push({ id: 'grp-zooplus', discount_total: 0.5 })
    const o = db.add('orders', { item_name: 'Cat Litter', price: 8.25, group_id: 'grp-zooplus', group_share: 0.24, expense_id: expense.id, pantry_item_id: litter.id })
    const before = others()
    const { arrival } = await arriveLinkedOrder(asShown(o.id), { itemId: litter.id, delta: 2, date: TODAY })
    await undoArrival(arrival)
    expect(order(o.id)).toMatchObject({ price: 8.25, group_id: 'grp-zooplus', group_share: 0.24, expense_id: 'exp-litter', status: 'on_the_way' })
    expect(others()).toEqual(before)
    expect(db.calls.some((c) => c.table === 'expenses' && c.op !== 'select')).toBe(false)
    expect(db.calls.some((c) => c.name === 'save_order_group')).toBe(false)
  })
})

describe('"Back on the way" (Money → Orders → History)', () => {
  it('stock recorded, a new item made by that arrival and untouched: named in the question, then deleted with the stock', async () => {
    const o = db.add('orders', { item_name: 'Catnip Snack', price: 4.2 })
    await arriveLinkedOrder(asShown(o.id), { newItem: { id: 'new-catnip', fields: { name: 'Catnip Snack', unit: 'pcs', min_stock: 1 } }, delta: 2, date: TODAY })
    db.later(3 * 24 * 3600 * 1000)
    const { dialog, result } = await answer(askBackOnTheWay(asShown(o.id), { unit: 'pcs' }))
    expect(dialog).toMatchObject({ title: 'Put "Catnip Snack" back on the way?', confirmLabel: 'Put back on the way' })
    expect(dialog.message).toBe('Its arrival added 2 pcs to HOME and created "Catnip Snack": both are taken out again, so they aren\'t counted twice when it really arrives.')
    expect(result.error).toBeFalsy()
    expect(item('new-catnip')).toBeNull()
    expect(db.tables.stock_logs).toEqual([])
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('the new item was used meanwhile: the question does not name it, the stock is taken out exactly, the item stays', async () => {
    const o = db.add('orders', { item_name: 'Remedy Balls for cat', price: 6.3 })
    await arriveLinkedOrder(asShown(o.id), { newItem: { id: 'new-balls', fields: { name: 'Remedy Balls', unit: 'pcs', min_stock: 1 } }, delta: 3, date: TODAY })
    await db.supabase.rpc('increment_stock', { item_id: 'new-balls', delta: -1 })
    db.add('stock_logs', { item_id: 'new-balls', change: -1, reason: 'used' })
    const { dialog } = await answer(askBackOnTheWay(asShown(o.id), { unit: 'pcs' }))
    expect(dialog.message).toBe('Its arrival added 3 pcs to HOME. That stock is taken out again, so it isn\'t counted twice when it really arrives.')
    expect(item('new-balls').current_stock).toBe(0)
    expect(logsOf('new-balls').map((l) => l.reason)).toEqual(['used'])
  })

  it('an item that existed long before the arrival is never deleted (only its stock comes out)', async () => {
    const towels = db.add('pantry_items', { name: 'Paper Towels', unit: 'roll', current_stock: 0, min_stock: 2 })
    db.later(5 * 24 * 3600 * 1000)
    const o = db.add('orders', { item_name: 'Paper Towels 8 rolls', price: 7 })
    await arriveLinkedOrder(asShown(o.id), { itemId: towels.id, delta: 8, date: TODAY })
    const { dialog } = await answer(askBackOnTheWay(asShown(o.id), { unit: 'roll' }))
    expect(dialog.message).toMatch(/^Its arrival added 8 roll to HOME\. That stock/)
    expect(item(towels.id).current_stock).toBe(0)
  })

  it('no stock recorded, not durable ("Don\'t add to HOME"): asked first (K17), then unarrive_order — the SHOP entry is on the way again', async () => {
    const entry = db.add('grocery_items', { name: 'Shoe Insoles' })
    const o = db.add('orders', { item_name: 'Shoe Insoles', price: 9, grocery_item_id: entry.id })
    await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    const { dialog } = await answer(askBackOnTheWay(asShown(o.id)))
    expect(dialog).toMatchObject({ title: 'Put "Shoe Insoles" back on the way?', message: NO_STOCK_RECORDED, confirmLabel: 'Put back on the way' })
    expect(NO_STOCK_RECORDED).toBe('No stock was recorded for this order\'s arrival. If something was added to HOME when it arrived, it stays in HOME — when it arrives again, choose "Don\'t add to HOME".')
    expect(order(o.id).status).toBe('on_the_way')
    expect(db.row('grocery_items', entry.id).completed).toBe(false)
    expect(db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['arrive_order', 'unarrive_order'])
  })

  it('Cancel on that question: nothing changes', async () => {
    const o = db.add('orders', { item_name: 'Yoga Mat', price: 19 })
    await arriveLinkedOrder(asShown(o.id), { itemId: null, delta: 0, date: TODAY })
    const { result } = await answer(askBackOnTheWay(asShown(o.id)), false)
    expect(result).toBeNull()
    expect(order(o.id).status).toBe('arrived')
  })

  it('an old arrival with nothing recorded (before 9J): asked (K17), then unarrive_order; what went into HOME by hand stays', async () => {
    const snack = db.add('pantry_items', { name: 'Hairs all Relief', unit: 'pcs', current_stock: 2 })
    db.add('stock_logs', { item_id: snack.id, change: 2, reason: 'added' })
    const o = db.add('orders', { item_name: 'Hairs all Relief', price: 5, status: 'arrived', arrived_date: '2026-10-18' })
    const { dialog } = await answer(askBackOnTheWay(asShown(o.id)))
    expect(dialog.message).toBe(NO_STOCK_RECORDED)
    expect(order(o.id).status).toBe('on_the_way')
    expect(item(snack.id).current_stock).toBe(2)
    expect(logsOf(snack.id)).toHaveLength(1)
  })

  it('durable or service: no question, straight back on the way with unarrive_order', async () => {
    const entry = db.add('grocery_items', { name: 'Kettle', category_id: 'appliances' })
    const o = db.add('orders', { item_name: 'Kettle', price: 29, grocery_item_id: entry.id })
    await markDurableArrived(asShown(o.id), TODAY)
    const result = await askBackOnTheWay(asShown(o.id), { durable: true })
    expect(result.error).toBeFalsy()
    expect(getDialog()).toBeNull()
    expect(order(o.id).status).toBe('on_the_way')
    expect(db.row('grocery_items', entry.id).completed).toBe(false)
  })

  it('a cancelled order keeps the old path: only the order changes, no unarrive_order', async () => {
    const o = db.add('orders', { item_name: 'Rain Jacket', price: 49, status: 'cancelled', arrived_date: '2026-10-25', expense_id: 'exp-jacket', expense_outcome: 'kept' })
    const result = await askBackOnTheWay(asShown(o.id))
    expect(result.error).toBeFalsy()
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrived_date: null, expense_outcome: null })
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })
})
