// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9J on screen: "It arrived!" and the linked "… arrived?" dialog
// with the real <Feedback /> (toasts with Undo), against the database kept
// in memory (hooks/arrivalDb.fixture.js). × or a tap outside does nothing
// (K2); every choice arrives in one step and its toast has Undo (K1, K11);
// "Create a new item" has the similar-name safety net, whose buttons send
// the arrival to the existing item (K12).
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const parents = vi.hoisted(() => [
  { id: 'pet', name: 'Pet Supplies', type: 'parent' },
  { id: 'frozen', name: 'Frozen', type: 'parent' },
  { id: 'appliances', name: 'Durables', type: 'parent' },
])
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents, pantryParents: parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
// Every new name gets a category, so "Add to inventory" goes straight to
// the name check.
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => ({ categoryId: 'pet', subcategoryId: null }), suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false, missing: false, mapRows: [] }) }))

const { arrivalDb } = await import('../hooks/arrivalDb.fixture')
const { ArrivedDialog } = await import('./expenses/ArrivedDialog')
const { LinkedArrivedDialog } = await import('./expenses/LinkedArrivedDialog')
const { Feedback } = await import('./ui/Feedback')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { pantryStore } = await import('../lib/stores')

let db
beforeEach(async () => {
  db = arrivalDb()
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

const order = (id) => db.row('orders', id)
const item = (id) => db.row('pantry_items', id)
const rpcs = () => db.calls.filter((c) => c.op === 'rpc')

// Opens "It arrived!" for `o` (with the toasts), once HOME has loaded.
async function open(o, Dialog = ArrivedDialog, extra = {}) {
  await pantryStore.refresh()
  const onClose = vi.fn()
  render(
    <>
      <Dialog order={{ ...o }} onClose={onClose} {...extra} />
      <Feedback />
    </>
  )
  return onClose
}
const click = (name) => fireEvent.click(screen.getByRole('button', { name }))
const toast = (text) => screen.findByText(text)
const undoOn = async (text) => {
  const box = (await toast(text)).closest('[role="status"]')
  fireEvent.click(within(box).getByRole('button', { name: 'Undo' }))
}

describe('"It arrived!" (an order not linked to HOME)', () => {
  it('is not marked arrived when it opens; × closes it and nothing happens (K2)', async () => {
    const o = db.add('orders', { item_name: 'Dog Bed', price: 39 })
    const onClose = await open(o)
    expect(screen.getByText('It arrived!')).toBeTruthy()
    expect(document.body.textContent).toContain('Add "Dog Bed" to HOME? Choose below — that marks it as arrived.')
    click('Close')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(rpcs()).toEqual([])
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('a tap outside does nothing either', async () => {
    const o = db.add('orders', { item_name: 'Scratching Post', price: 25 })
    const onClose = await open(o)
    fireEvent.click(document.querySelector('[data-unsaved]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('"Don\'t add to HOME": marked arrived, toast with Undo; Undo → "… is on the way again"', async () => {
    const o = db.add('orders', { item_name: 'Phone Case', price: 12 })
    await open(o)
    click("Don't add to HOME")
    await undoOn('"Phone Case" marked as arrived — nothing added to HOME')
    expect(await toast('"Phone Case" is on the way again')).toBeTruthy()
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('"Add to an existing item" → the item → "Add to stock": one step, the toast "Added … to …" has Undo', async () => {
    const towels = db.add('pantry_items', { name: 'Paper Towels', unit: 'roll', current_stock: 1, min_stock: 2 })
    const o = db.add('orders', { item_name: 'Paper towels 8 rolls', price: 7 })
    await open(o)
    click(/^Add to an existing item/)
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: towels.id } })
    fireEvent.change(screen.getByLabelText('Quantity bought'), { target: { value: '8' } })
    click('Add to stock')
    await undoOn('Added 8 roll to "Paper Towels"')
    await waitFor(() => expect(item(towels.id).current_stock).toBe(1))
    expect(rpcs().map((r) => [r.name, r.args.item_id ?? null, r.args.add_qty ?? null])).toEqual([
      ['arrive_order', towels.id, 8],
      ['unarrive_order', null, null],
    ])
  })

  it('"Create a new item": title "Add an item", saved with "Add to inventory" → made at 0, then +2 by the arrival; "is now in HOME" with Undo', async () => {
    const o = db.add('orders', { item_name: 'Catnip Snack', price: 4.2 })
    await open(o)
    click(/^Create a new item/)
    expect(screen.getByText('Add an item')).toBeTruthy()
    fireEvent.change(document.querySelector('input[value="1"]'), { target: { value: '2' } })
    click('Add to inventory')
    expect(await toast('"Catnip Snack" is now in HOME')).toBeTruthy()
    const made = db.tables.pantry_items.find((p) => p.name === 'Catnip Snack')
    expect(made.current_stock).toBe(2)
    expect(db.tables.stock_logs.map((l) => l.reason)).toEqual(['purchased'])
    expect(order(o.id)).toMatchObject({ status: 'arrived', arrived_item_id: made.id, pantry_item_id: null })
    await undoOn('"Catnip Snack" is now in HOME')
    await waitFor(() => expect(item(made.id)).toBeNull())
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('the other phone arrived it first: "already marked as arrived", no Undo', async () => {
    const o = db.add('orders', { item_name: 'Bird Seed', price: 8 })
    const shown = { ...o }
    await db.supabase.rpc('arrive_order', { order_id: o.id, item_id: null, add_qty: 0, arrived_on: '2026-10-30' })
    await open(shown)
    click("Don't add to HOME")
    const text = await toast('"Bird Seed" was already marked as arrived (on the other phone?) — nothing was added again.')
    expect(within(text.closest('[role="status"]')).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('the second step fails: the editor stays open with what was typed; closed afterwards, the empty new item is deleted', async () => {
    const o = db.add('orders', { item_name: 'Laundry Pods', price: 13.9 })
    db.failWhen = (call) => call.name === 'arrive_order'
    const onClose = await open(o)
    click(/^Create a new item/)
    click('Add to inventory')
    expect(await screen.findByText("Couldn't save — check your connection.")).toBeTruthy()
    expect(screen.getByText('Add an item')).toBeTruthy()
    expect(screen.getByDisplayValue('Laundry Pods')).toBeTruthy()
    expect(db.tables.pantry_items.map((p) => [p.name, p.current_stock])).toEqual([['Laundry Pods', 0]])
    // The editor's ×, then the dialog's ×.
    fireEvent.click(screen.getByText('Add an item').parentElement.querySelector('button'))
    click('Close')
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(db.tables.pantry_items).toEqual([]))
    expect(order(o.id).status).toBe('on_the_way')
  })
})

describe('"Create a new item" with the similar-name safety net (K12)', () => {
  it('the same name as a HOME item: "… is already in HOME" + "Add it to …", which adds the arrival to that item', async () => {
    const cat = db.add('pantry_items', { name: 'Cat Wet Food', unit: 'pcs', current_stock: 2, min_stock: 6, category_id: 'pet' })
    const o = db.add('orders', { item_name: 'cat wet food', price: 18.9 })
    await open(o)
    click(/^Create a new item/)
    click('Add to inventory')
    expect(await screen.findByText('“Cat Wet Food” is already in HOME')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Create new/ })).toBeNull()
    click('Add it to Cat Wet Food · 2 pcs at home')
    expect(screen.getByText('Which item?')).toBeTruthy()
    expect(screen.getByLabelText('Item').value).toBe(cat.id)
    fireEvent.change(screen.getByLabelText('Quantity bought'), { target: { value: '12' } })
    click('Add to stock')
    await undoOn('Added 12 pcs to "Cat Wet Food"')
    expect(rpcs()[0]).toMatchObject({ name: 'arrive_order', args: { item_id: cat.id, add_qty: 12 } })
    expect(db.tables.pantry_items).toHaveLength(1)
  })

  it('a similar name: "Similar item in HOME:", "Add it to …" and "Create new “…”" with the hint; the next press creates it as typed', async () => {
    db.add('pantry_items', { name: 'Frozen Pumpkin', unit: 'gr', current_stock: 0, min_stock: 250, category_id: 'frozen' })
    const o = db.add('orders', { item_name: 'Frozen Pumkin', price: 3.5 })
    await open(o)
    click(/^Create a new item/)
    click('Add to inventory')
    expect(await screen.findByText('Similar item in HOME:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add it to Frozen Pumpkin · out of stock' })).toBeTruthy()
    click('Create new “Frozen Pumkin”')
    expect(screen.getByText('Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.')).toBeTruthy()
    click('Add to inventory')
    expect(await toast('"Frozen Pumkin" is now in HOME')).toBeTruthy()
    expect(db.tables.pantry_items.map((p) => p.name).sort()).toEqual(['Frozen Pumkin', 'Frozen Pumpkin'])
  })

  it('a variant of a group: its button opens "Add to a variant of an item group" with that variant chosen', async () => {
    const crisps = db.add('pantry_items', { name: 'Crisps', unit: 'pcs', is_group: true, min_stock: 2, category_id: 'pet' })
    db.add('pantry_items', { name: 'Paprika Crisps', unit: 'pcs', group_id: crisps.id, current_stock: 1, category_id: 'pet' })
    const salt = db.add('pantry_items', { name: 'Sea Salt Crisps', unit: 'pcs', group_id: crisps.id, current_stock: 0, category_id: 'pet' })
    const o = db.add('orders', { item_name: 'Sea salt crisp', price: 2.2 })
    await open(o)
    click(/^Create a new item/)
    click('Add to inventory')
    fireEvent.click(await screen.findByRole('button', { name: 'Add it to Sea Salt Crisps · out of stock' }))
    expect(screen.getByLabelText('Item group').value).toBe(crisps.id)
    expect(screen.getByLabelText('Which variant').value).toBe(salt.id)
    click('Add to stock')
    await toast('Added 1 pcs to "Sea Salt Crisps"')
    expect(item(salt.id).current_stock).toBe(1)
  })

  it('a durable HOME item is never offered', async () => {
    db.add('pantry_items', { name: 'Hair Dryer', unit: 'pcs', current_stock: 1, category_id: 'appliances' })
    const o = db.add('orders', { item_name: 'Hair Dryer', price: 30 })
    await open(o)
    click(/^Create a new item/)
    click('Add to inventory')
    expect(await toast('"Hair Dryer" is now in HOME')).toBeTruthy()
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })
})

describe('the linked dialog ("… arrived?")', () => {
  it('"Arrived — add to HOME": the toast has Undo, which takes the stock out again; × alone does nothing', async () => {
    const litter = db.add('pantry_items', { name: 'Cat Litter', unit: 'bag', current_stock: 0, min_stock: 1 })
    const o = db.add('orders', { item_name: 'Cat Litter', price: 8.25, pantry_item_id: litter.id, quantity: 2, unit: 'bag' })
    const onClose = await open(o, LinkedArrivedDialog, { item: item(litter.id) })
    click('Arrived — add to HOME')
    await undoOn('Arrived — added 2 bag to "Cat Litter"')
    expect(await toast('"Cat Litter" is on the way again — 2 bag taken out of "Cat Litter"')).toBeTruthy()
    expect(item(litter.id).current_stock).toBe(0)
    cleanup()
    onClose.mockClear()
    const again = await open(order(o.id), LinkedArrivedDialog, { item: item(litter.id) })
    click('Close')
    expect(again).toHaveBeenCalledTimes(1)
    expect(order(o.id).status).toBe('on_the_way')
  })

  it('"Arrived, but don\'t add anything to HOME": toast with Undo', async () => {
    const litter = db.add('pantry_items', { name: 'Cat Litter', unit: 'bag', current_stock: 3 })
    const o = db.add('orders', { item_name: 'Cat Litter', price: 8.25, pantry_item_id: litter.id })
    await open(o, LinkedArrivedDialog, { item: item(litter.id) })
    click("Arrived, but don't add anything to HOME")
    await undoOn('"Cat Litter" marked as arrived — nothing added to HOME')
    await toast('"Cat Litter" is on the way again')
    expect(order(o.id).status).toBe('on_the_way')
  })
})
