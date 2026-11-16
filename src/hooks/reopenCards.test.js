import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 9P (report A2.9 part 1, A.5 b, K200): "Reopen purchase" / the toast
// "Undo" read the purchase's own cards back and show them before saying
// they are back, whatever realtime and the held reloads did on this device;
// the SHOP list sync afterwards judges each item on a fresh read and only
// touches the items of that purchase. Run against the small database of
// arrivalDb.fixture.js, with reopen_shopping_trip played here.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('./arrivalDb.fixture')
const { confirmCart, reopenTrip } = await import('./usePurchase')
const { groceryStore, pantryStore } = await import('../lib/stores')
const { setRefreshGate } = await import('../lib/tableStore')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { purchaseLine } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')

const REOPENED = 'Purchase reopened — the items are back in the cart.'
const flush = () => new Promise((r) => setTimeout(r, 0))
const messages = () => getToasts().map((t) => t.message)

let db
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  setRefreshGate(() => true)
  vi.restoreAllMocks()
})

// A database where purchase 't1' was confirmed: its cards are bought.
// reopen_shopping_trip puts every card of its lines back in the cart and
// takes the stock back, as 032 does (the details are in the PGlite block
// of supabase/migrations.test.js).
function confirmedPurchase(cards) {
  db = arrivalDb()
  client.supabase = db.supabase
  db.tables.shopping_trip_items = []
  for (const { name, item = null, stock = 0 } of cards) {
    const card = db.add('grocery_items', { name, pantry_item_id: item?.id ?? null, completed: true, in_cart: false, trip_id: 't1' })
    db.tables.shopping_trip_items.push({ id: db.id('line'), trip_id: 't1', grocery_item_id: card.id, pantry_item_id: item?.id ?? null, stock_added: stock, log_ids: [] })
  }
  db.functions.reopen_shopping_trip = ({ trip_id }) => {
    const lines = db.tables.shopping_trip_items.filter((l) => l.trip_id === trip_id)
    for (const l of lines) {
      const card = db.row('grocery_items', l.grocery_item_id)
      if (card) Object.assign(card, { completed: false, in_cart: true, trip_id: null })
      const pi = l.pantry_item_id && db.row('pantry_items', l.pantry_item_id)
      if (pi) pi.current_stock = Math.max(0, pi.current_stock - l.stock_added)
    }
    db.tables.shopping_trip_items = db.tables.shopping_trip_items.filter((l) => l.trip_id !== trip_id)
    return lines.length
  }
}

// The device's lists as read just after Confirm (every card bought), then
// reloads held back (an offline change waiting: the gate) and realtime
// silent (the fixture's channel never sends anything).
async function deviceAfterConfirm() {
  setRefreshGate(() => true)
  groceryStore.subscribe(() => {})
  pantryStore.subscribe(() => {})
  await Promise.all([groceryStore.refresh(), pantryStore.refresh()])
  await flush()
  setRefreshGate(() => false)
}
const cartOnDevice = () => groceryStore.getSnapshot().rows.filter((g) => g.in_cart && !g.completed).map((g) => g.name).sort()

const TEN = ['Basil', 'Bread', 'Eggs', 'Ginger', 'Lemon', 'Milk', 'Parsley', 'Salt', 'Short ribs', 'Vesuvio pizza']

describe('Reopen reads its own cards back', () => {
  it('realtime silent + reloads held: after reopenTrip every card of the purchase is in the cart on this device, before the toast', async () => {
    const milk = { id: 'p-milk', name: 'Milk', unit: 'pcs', current_stock: 2, min_stock: 1 }
    confirmedPurchase(TEN.map((name) => (name === 'Milk' ? { name, item: milk, stock: 2 } : { name })))
    db.tables.pantry_items.push({ ...milk, created_at: db.now() })
    await deviceAfterConfirm()
    expect(cartOnDevice()).toEqual([])
    // What the cart holds on this device at the moment the toast appears.
    let atToast = null
    const stop = groceryStore.subscribe(() => {
      if (atToast === null && cartOnDevice().length === TEN.length) atToast = getToasts().length
    })
    const { error } = await reopenTrip('t1')
    stop()
    expect(error).toBeNull()
    expect(cartOnDevice()).toEqual(TEN)
    expect(atToast).toBe(0)
    expect(messages()[0]).toBe(REOPENED)
  })

  it('the "Undo" on the "Purchase confirmed" toast does the same (it is the same reopenTrip)', async () => {
    confirmedPurchase(TEN.slice(0, 3).map((name) => ({ name })))
    await deviceAfterConfirm()
    // The toast of a confirmation: its Undo reopens 't1'.
    db.functions.confirm_shopping_trip = () => ({ id: 't1', total: 0 })
    const bread = { id: db.row('grocery_items', db.tables.grocery_items[1].id).id, name: 'Bread', quantity: 1, unit: 'pcs', price: 0 }
    await confirmCart({ id: 't1', date: '2026-11-07', lines: [purchaseLine(bread, [])], answers: {}, totalOf: (i) => lineTotal(i), photoIds: [] })
    const toast = getToasts().find((t) => t.message.startsWith('Purchase confirmed'))
    await toast.action.onClick()
    await vi.waitFor(() => expect(messages()).toContain(REOPENED))
    expect(cartOnDevice()).toEqual(['Basil', 'Bread', 'Eggs'])
  })

  it('a purchase with no HOME item at all still reopens (no notes), its cards back on this device', async () => {
    confirmedPurchase([{ name: 'Vesuvio pizza' }, { name: 'Short ribs' }])
    await deviceAfterConfirm()
    const { error } = await reopenTrip('t1')
    expect(error).toBeNull()
    expect(db.calls.some((c) => c.name === 'reopen_shopping_trip')).toBe(true)
    expect(cartOnDevice()).toEqual(['Short ribs', 'Vesuvio pizza'])
    expect(messages()).toEqual([REOPENED])
  })

  it('a failed read of the lines changes nothing: no Reopen, the cards stay bought', async () => {
    confirmedPurchase([{ name: 'Basil' }, { name: 'Bread' }])
    await deviceAfterConfirm()
    db.failWhen = (call) => call.table === 'shopping_trip_items'
    const { error } = await reopenTrip('t1')
    expect(error).toBeTruthy()
    expect(db.calls.some((c) => c.name === 'reopen_shopping_trip')).toBe(false)
    expect(db.tables.grocery_items.every((g) => g.completed)).toBe(true)
    expect(cartOnDevice()).toEqual([])
    expect(messages()).toEqual(["Couldn't save — check your connection."])
  })

  it('the cards can\'t be read back: the purchase stays reopened; "Saved, but couldn\'t update the cart" with Retry, which shows them', async () => {
    confirmedPurchase([{ name: 'Basil' }, { name: 'Bread' }])
    await deviceAfterConfirm()
    let failing = true
    db.failWhen = (call) => failing && call.table === 'grocery_items' && call.op === 'select'
    const { error } = await reopenTrip('t1')
    expect(error).toBeNull()
    expect(db.tables.grocery_items.every((g) => g.in_cart && !g.completed)).toBe(true)
    const followUp = getToasts().find((t) => t.message === "Saved, but couldn't update the cart — check your connection.")
    expect(followUp.action.label).toBe('Retry')
    expect(messages()).toContain(REOPENED)
    failing = false
    await followUp.action.onClick()
    expect(cartOnDevice()).toEqual(['Basil', 'Bread'])
  })
})

describe('the SHOP list sync after Reopen and Confirm (A.5 b, K200)', () => {
  it('Reopen syncs only the items of its own lines, each judged on a fresh read', async () => {
    const eggs = { id: 'p-eggs', name: 'Eggs', unit: 'pcs', current_stock: 3, min_stock: 1 }
    // Two other HOME items that need buying and have no entry: not touched.
    const others = [
      { id: 'p-oil', name: 'Oil', unit: 'btl', current_stock: 0, min_stock: 1 },
      { id: 'p-rice', name: 'Rice', unit: 'pack', current_stock: 0, min_stock: 1 },
    ]
    // A MONEY purchase: lines without cards; Eggs got 3.
    confirmedPurchase([])
    db.tables.pantry_items.push(...[eggs, ...others].map((p) => ({ ...p, created_at: db.now(), is_group: false })))
    db.tables.shopping_trip_items.push({ id: db.id('line'), trip_id: 't1', grocery_item_id: null, pantry_item_id: eggs.id, stock_added: 3, log_ids: [] })
    // This device's HOME copy still says Eggs 3 (fine), as read before.
    await deviceAfterConfirm()
    expect(pantryStore.getSnapshot().rows.find((p) => p.id === eggs.id).current_stock).toBe(3)
    await reopenTrip('t1', null, 'money')
    await vi.waitFor(() => expect(db.tables.grocery_items.map((g) => g.name)).toEqual(['Eggs']))
    // Judged on the database (0 of minimum 1): its automatic entry "to buy".
    expect(db.tables.grocery_items[0]).toMatchObject({ pantry_item_id: eggs.id, auto_generated: true, in_cart: false })
    const pantryReads = db.calls.filter((c) => c.table === 'pantry_items' && c.op === 'select' && c.single)
    expect(pantryReads).toHaveLength(1)
  })

  it('after Confirm, each restocked item is judged on a fresh read, not on the copy read before', async () => {
    const rice = { id: 'p-rice', name: 'Rice', unit: 'pack', current_stock: 4, min_stock: 1 }
    db = arrivalDb()
    client.supabase = db.supabase
    db.tables.pantry_items.push({ ...rice, created_at: db.now(), is_group: false })
    await deviceAfterConfirm() // this device's copy: Rice 4 (fine)
    // Meanwhile the database says 0 (e.g. an Undo tapped right away).
    db.row('pantry_items', rice.id).current_stock = 0
    db.functions.confirm_shopping_trip = () => ({ id: 't2', total: 1.5 })
    const card = { id: 'g-rice', name: 'Rice', pantry_item_id: rice.id, quantity: 1, unit: 'pack', price: 1.5, price_qty: 1, price_unit: 'pack' }
    await confirmCart({ id: 't2', date: '2026-11-07', lines: [purchaseLine(card, [rice])], answers: {}, totalOf: (i) => lineTotal(i), photoIds: [] })
    await vi.waitFor(() => expect(db.tables.grocery_items.map((g) => g.name)).toEqual(['Rice']))
    expect(db.tables.grocery_items[0]).toMatchObject({ pantry_item_id: rice.id, auto_generated: true })
  })
})
