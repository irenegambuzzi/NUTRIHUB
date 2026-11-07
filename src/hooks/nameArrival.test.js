import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 9N, K90 + K95: an order linked to a HOME item that arrives under
// another name of it ("Felix" of Cat Wet Food) counts its pack with that
// name's size, and a first-time size is saved on the NAME (save_item_names
// with `was`, after arrive_order), never on the item; arrival_pack_before
// keeps what the name had and what was saved. The Undo on the Arrived toast
// and "Back on the way" put it back, only while the name still has what
// this arrival saved. Run against the in-memory database of
// arrivalDb.fixture.js.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('./arrivalDb.fixture')
const { arriveLinkedOrder, arrivedToast, unarriveOrder } = await import('./useOrders')
const { namedPack } = await import('../lib/itemNames')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

let db
beforeEach(() => {
  db = arrivalDb({ units: true })
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

const TODAY = '2026-11-07'
const item = (id) => db.row('pantry_items', id)
const order = (id) => db.row('orders', id)
const nameOf = (id, name) => item(id).names.find((n) => n.name === name)
const plain = (name, extra = {}) => ({ name, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null, from_item_id: null, origin: null, added_at: '2026-11-01T10:00:00Z', added_by_trip: null, pack_by_trip: null, ...extra })

// Cat Wet Food (pcs, usual box 48), names Felix (no size) and Gourmet (pack
// 6); an order "Felix" 1 pack, linked to it, on the way.
function setup({ name = 'Felix', unit = 'pack', usual = { packaging_unit: 'box', quantity_per_pack: 48 } } = {}) {
  const cat = db.add('pantry_items', { name: 'Cat Wet Food', unit: 'pcs', current_stock: 2, ...usual, names: [plain('Felix'), plain('Gourmet', { packaging_unit: 'pack', quantity_per_pack: 6 })] })
  const o = db.add('orders', { item_name: name, price: 3.2, pantry_item_id: cat.id, quantity: 1, unit })
  return { cat, o }
}

async function arriveWith(cat, o, typed) {
  const pack = namedPack(item(cat.id), o.item_name, o.unit, { quantity: 1, typed: { text: typed, unit: o.unit }, canSave: true })
  const result = await arriveLinkedOrder({ ...order(o.id) }, { itemId: cat.id, delta: pack.value, date: TODAY, pack: { unit: pack.unit, value: pack.value, firstTime: pack.firstTime, onName: true }, packItem: item(cat.id) })
  return { pack, result }
}

describe('Arrived under another name: a first pack size goes on the name (K90)', () => {
  it('"Felix" 1 pack typed 4: +4 pcs; Felix gets pack 4, the item keeps box 48; the order keeps what Felix had and what was saved', async () => {
    const { cat, o } = setup()
    const { pack, result } = await arriveWith(cat, o, '4')
    expect(pack).toMatchObject({ stockUnit: 'pcs', unit: 'pack', value: 4, firstTime: true, onName: true })
    expect(result.error).toBeFalsy()
    expect(item(cat.id)).toMatchObject({ current_stock: 6, packaging_unit: 'box', quantity_per_pack: 48 })
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: 'pack', quantity_per_pack: 4, pack_by_trip: null })
    expect(nameOf(cat.id, 'Gourmet')).toMatchObject({ packaging_unit: 'pack', quantity_per_pack: 6 })
    expect(order(o.id)).toMatchObject({ pack_size: 4, arrival_pack_before: { packaging_unit: null, quantity_per_pack: null, name: 'Felix', saved: { packaging_unit: 'pack', quantity_per_pack: 4 } } })
    const save = db.calls.find((c) => c.op === 'rpc' && c.name === 'save_item_names')
    expect(save.args.payload).toMatchObject({ item_id: cat.id, edit: [{ name: 'Felix', packaging_unit: 'pack', quantity_per_pack: 4 }], was: { names: expect.any(Array) } })
    // After arrive_order, never before it.
    expect(db.calls.findIndex((c) => c.name === 'arrive_order')).toBeLessThan(db.calls.indexOf(save))
  })

  it('a name with a size already ("Gourmet" pack 6, typed 5): +5, nothing saved anywhere', async () => {
    const { cat, o } = setup({ name: 'Gourmet' })
    const { pack } = await arriveWith(cat, o, '5')
    expect(pack.firstTime).toBe(false)
    expect(item(cat.id).current_stock).toBe(7)
    expect(nameOf(cat.id, 'Gourmet')).toMatchObject({ quantity_per_pack: 6 })
    expect(order(o.id)).toMatchObject({ pack_size: 5, arrival_pack_before: null })
    expect(db.calls.some((c) => c.name === 'save_item_names')).toBe(false)
  })

  it('the other phone gave Felix a size meanwhile: nothing written on it, and the order forgets what it would have undone', async () => {
    const { cat, o } = setup()
    const shown = { ...item(cat.id), names: item(cat.id).names.map((n) => ({ ...n })) }
    nameOf(cat.id, 'Felix').packaging_unit = 'pack'
    nameOf(cat.id, 'Felix').quantity_per_pack = 3
    const pack = namedPack(shown, 'Felix', 'pack', { typed: { text: '4', unit: 'pack' } })
    await arriveLinkedOrder({ ...order(o.id) }, { itemId: cat.id, delta: 4, date: TODAY, pack: { unit: 'pack', value: 4, firstTime: pack.firstTime, onName: true }, packItem: shown })
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ quantity_per_pack: 3 })
    expect(order(o.id).arrival_pack_before).toBeNull()
  })

  it('an item with no usual size at all: still the name\'s, never the item\'s', async () => {
    const { cat, o } = setup({ usual: { packaging_unit: null, quantity_per_pack: null } })
    await arriveWith(cat, o, '4')
    expect(item(cat.id)).toMatchObject({ packaging_unit: null, quantity_per_pack: null })
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: 'pack', quantity_per_pack: 4 })
  })
})

describe('Undo and "Back on the way" put the name\'s size back (K95)', () => {
  it('Undo on the Arrived toast: −4 pcs, Felix empty again, the order forgets it', async () => {
    const { cat, o } = setup()
    const { result } = await arriveWith(cat, o, '4')
    arrivedToast('Arrived — added 4 pcs to "Cat Wet Food"', result.arrival)
    await runToastAction(getToasts().at(-1).id)
    expect(item(cat.id).current_stock).toBe(2)
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: null, quantity_per_pack: null })
    expect(order(o.id)).toMatchObject({ status: 'on_the_way', arrival_pack_before: null })
    expect(getToasts().at(-1).message).toBe('"Felix" is on the way again — 4 pcs taken out of "Cat Wet Food"')
  })

  it('"Back on the way" later: the same', async () => {
    const { cat, o } = setup()
    await arriveWith(cat, o, '4')
    const result = await unarriveOrder({ ...order(o.id) })
    expect(result.error).toBeFalsy()
    expect(item(cat.id).current_stock).toBe(2)
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: null, quantity_per_pack: null })
    expect(order(o.id).arrival_pack_before).toBeNull()
  })

  it('changed by hand meanwhile (Felix pack 5 in "Edit item"): left as it is', async () => {
    const { cat, o } = setup()
    const { result } = await arriveWith(cat, o, '4')
    nameOf(cat.id, 'Felix').quantity_per_pack = 5
    arrivedToast('Arrived — added 4 pcs to "Cat Wet Food"', result.arrival)
    await runToastAction(getToasts().at(-1).id)
    expect(item(cat.id).current_stock).toBe(2)
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: 'pack', quantity_per_pack: 5 })
    expect(order(o.id).arrival_pack_before).toBeNull()
  })

  it('"Back on the way" after a change by hand: left as it is too; the item\'s own usual size never moved', async () => {
    const { cat, o } = setup()
    await arriveWith(cat, o, '4')
    nameOf(cat.id, 'Felix').packaging_unit = 'box'
    nameOf(cat.id, 'Felix').quantity_per_pack = 24
    await unarriveOrder({ ...order(o.id) })
    expect(nameOf(cat.id, 'Felix')).toMatchObject({ packaging_unit: 'box', quantity_per_pack: 24 })
    expect(item(cat.id)).toMatchObject({ packaging_unit: 'box', quantity_per_pack: 48 })
  })
})
