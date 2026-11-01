import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 9M: after Reopen / Undo purchase / the Undo toast, and after "Back
// on the way" / the Arrived Undo, a toast names an item a purchase created
// that was kept, or stock that couldn't be taken out because its unit
// changed — only from supabase/031 on. Run against the small database of
// arrivalDb.fixture.js; reopen_shopping_trip is played here, once as 023
// does it (before 031) and once as 031.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('./arrivalDb.fixture')
const { askUndoPurchase, reopenTrip } = await import('./usePurchase')
const { arriveLinkedOrder, undoArrival, unarriveOrder } = await import('./useOrders')
const { closeDialog, dismissToast, getDialog, getToasts } = await import('../lib/feedback')
const { arrivalNotTakenOutText, keptText, notTakenOutText } = await import('../lib/reopenUnits')

let db
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
  vi.restoreAllMocks()
})
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

const messages = () => getToasts().map((t) => t.message)
const REOPENED = 'Purchase reopened — the items are back in the cart.'
const UNDONE = 'Purchase undone — its expenses are deleted and HOME stock is back as before.'

// A database with reopen_shopping_trip as 023 (`v031` false: a created item
// is deleted, the stock taken out as counted) or as 031 (the ids added to
// the set it returns: created items that got stock from elsewhere; the
// stock converted with the usual pack, or not taken out).
function withReopen({ v031 }) {
  const keep = new Set()
  db = arrivalDb({ units: v031 })
  db.tables.shopping_trip_items = []
  const rpc = db.supabase.rpc
  db.supabase.rpc = (name, args) => {
    if (name !== 'reopen_shopping_trip') return rpc(name, args)
    db.calls.push({ op: 'rpc', name, args, filters: [] })
    const lines = db.tables.shopping_trip_items.filter((l) => l.trip_id === args.trip_id)
    for (const l of lines) {
      const pi = db.row('pantry_items', l.pantry_item_id)
      if (!pi) continue
      if (l.pantry_created && !(v031 && keep.has(pi.id))) {
        db.tables.pantry_items = db.tables.pantry_items.filter((p) => p !== pi)
        continue
      }
      const from = l.stock_unit ?? pi.unit
      const factor = !v031 ? 1 : from === pi.unit ? 1 : pi.packaging_unit === from && pi.quantity_per_pack > 0 ? pi.quantity_per_pack : null
      if (factor != null) pi.current_stock = Math.max(0, pi.current_stock - l.stock_added * factor)
    }
    db.tables.shopping_trip_items = db.tables.shopping_trip_items.filter((l) => l.trip_id !== args.trip_id)
    return Promise.resolve({ data: lines.length, error: null })
  }
  client.supabase = db.supabase
  return keep
}

const addLine = (fields) => db.tables.shopping_trip_items.push({ id: db.id('line'), trip_id: 't1', position: 1, pantry_created: false, stock_added: 1, stock_discarded: 0, stock_unit: null, unit: 'pack', log_ids: [], ...fields })

describe('Reopen / Undo purchase: the notes', () => {
  it('031: a created item kept (stock from another purchase) → "stays in HOME … this purchase\'s 4 pcs were taken out", after the usual toast', async () => {
    const keep = withReopen({ v031: true })
    const plonk = db.add('pantry_items', { name: 'Plonk', unit: 'pcs', current_stock: 12, packaging_unit: 'pack', quantity_per_pack: 4 })
    keep.add(plonk.id)
    addLine({ pantry_item_id: plonk.id, pantry_created: true, stock_unit: 'pack' })
    const { error } = await reopenTrip('t1')
    expect(error).toBeNull()
    expect(messages()).toEqual([REOPENED, keptText('Plonk', '4 pcs')])
    expect(db.row('pantry_items', plonk.id).current_stock).toBe(8)
  })

  it('before 031 (023): the created item is deleted, nothing new is said', async () => {
    withReopen({ v031: false })
    const plonk = db.add('pantry_items', { name: 'Plonk', unit: 'pcs', current_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4 })
    addLine({ pantry_item_id: plonk.id, pantry_created: true, stock_unit: 'pack' })
    await reopenTrip('t1')
    expect(messages()).toEqual([REOPENED])
    expect(db.row('pantry_items', plonk.id)).toBeNull()
  })

  it('an existing item counted in pcs now, no usual size: 031 takes nothing out → "couldn\'t be taken out"; 023 takes 1 out → nothing new (MONEY: "Purchase undone …")', async () => {
    for (const v031 of [true, false]) {
      withReopen({ v031 })
      const gum = db.add('pantry_items', { name: 'Gum', unit: 'pcs', current_stock: 2 })
      addLine({ pantry_item_id: gum.id, stock_unit: 'pack' })
      await reopenTrip('t1', null, 'money')
      expect(messages()).toEqual(v031 ? [UNDONE, notTakenOutText('Gum')] : [UNDONE])
      expect(db.row('pantry_items', gum.id).current_stock).toBe(v031 ? 2 : 1)
      getToasts().forEach((t) => dismissToast(t.id))
    }
  })

  it('the lines can\'t be read first: the purchase is reopened all the same, without notes', async () => {
    withReopen({ v031: true })
    const gum = db.add('pantry_items', { name: 'Gum', unit: 'pcs', current_stock: 2 })
    addLine({ pantry_item_id: gum.id, stock_unit: 'pack' })
    db.failWhen = (call) => call.table === 'shopping_trip_items'
    const { error } = await reopenTrip('t1')
    expect(error).toBeNull()
    expect(db.calls.some((c) => c.name === 'reopen_shopping_trip')).toBe(true)
    expect(messages()).toEqual([REOPENED])
  })

  it('"Undo this purchase?" says a created item stays when it also got stock or an order from elsewhere; "Reopen this purchase?" is unchanged', async () => {
    withReopen({ v031: true })
    const undo = askUndoPurchase({ id: 't1', source: 'money' }, { count: 2, total: 5 })
    await vi.waitFor(() => expect(getDialog()).toBeTruthy())
    expect(getDialog()).toMatchObject({
      title: 'Undo this purchase?',
      message: 'The expenses of its 2 items (€5.00) are deleted, and the stock it added to HOME is taken back (an item it created is removed again, unless it also got stock or an order from elsewhere). Expenses merged into it stay, as single expenses.',
    })
    closeDialog(null)
    expect(await undo).toBeNull()
    const reopen = askUndoPurchase({ id: 't1', source: 'shop' }, { count: 1, total: 3 })
    await vi.waitFor(() => expect(getDialog()).toBeTruthy())
    expect(getDialog()).toMatchObject({ title: 'Reopen this purchase?', message: 'The 1 item (€3.00) go back to the cart, and the stock, history and expenses from this purchase are undone.' })
    closeDialog(null)
    expect(await reopen).toBeNull()
  })
})

describe('"Back on the way" and the Arrived Undo: the notes', () => {
  // +1 pack arrived into Soap (2 pack), then counted in pcs.
  async function arrivedThenConverted(v031, { per }) {
    db = arrivalDb({ units: v031 })
    client.supabase = db.supabase
    const soap = db.add('pantry_items', { name: 'Soap', unit: 'pack', current_stock: 2 })
    const order = db.add('orders', { item_name: 'Soap', price: 5, pantry_item_id: soap.id, quantity: 1, unit: 'pack' })
    const { arrival } = await arriveLinkedOrder({ ...order }, { itemId: soap.id, delta: 1, date: '2026-11-01' })
    getToasts().forEach((t) => dismissToast(t.id))
    Object.assign(db.row('pantry_items', soap.id), per ? { unit: 'pcs', current_stock: 12, packaging_unit: 'pack', quantity_per_pack: per } : { unit: 'pcs' })
    return { soap, order: db.row('orders', order.id), arrival }
  }

  it('031, converted with 1 pack = 4: "Back on the way" takes out 4 pcs, nothing new said', async () => {
    const { soap, order } = await arrivedThenConverted(true, { per: 4 })
    await unarriveOrder({ ...order })
    expect(db.row('pantry_items', soap.id).current_stock).toBe(8)
    expect(messages()).toEqual([])
  })

  it('031, "Keep the numbers as they are": nothing taken out → "this arrival\'s stock couldn\'t be taken out"; before 031 (021): 1 taken out, nothing new said', async () => {
    for (const v031 of [true, false]) {
      const { soap, order } = await arrivedThenConverted(v031, { per: null })
      await unarriveOrder({ ...order })
      expect(db.row('pantry_items', soap.id).current_stock).toBe(v031 ? 3 : 2)
      expect(messages()).toEqual(v031 ? [arrivalNotTakenOutText('Soap')] : [])
      getToasts().forEach((t) => dismissToast(t.id))
    }
  })

  it('the Arrived Undo after a conversion says what really came out ("4 pcs"), or that nothing could', async () => {
    let { soap, arrival } = await arrivedThenConverted(true, { per: 4 })
    await undoArrival(arrival)
    expect(messages()).toEqual(['"Soap" is on the way again — 4 pcs taken out of "Soap"'])
    expect(db.row('pantry_items', soap.id).current_stock).toBe(8)
    getToasts().forEach((t) => dismissToast(t.id))
    ;({ soap, arrival } = await arrivedThenConverted(true, { per: null }))
    await undoArrival(arrival)
    expect(messages()).toEqual(['"Soap" is on the way again', arrivalNotTakenOutText('Soap')])
    expect(db.row('pantry_items', soap.id).current_stock).toBe(3)
  })
})
