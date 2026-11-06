// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

// HOME with other names (plan 9N, stage 2), against the database kept in
// memory: Undo of a delete brings the names back; a rename leaves the SHOP
// entries bought under another name alone; `names` is never in a plain write.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)

const { arrivalDb } = await import('./arrivalDb.fixture')
const { ITEM_FIELDS, pickFields, usePantryItems } = await import('./usePantryItems')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')
const { pantryStore } = await import('../lib/stores')

let db
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
})

const names = [{ name: 'Corn Snack', packaging_unit: 'box', quantity_per_pack: 12, origin: null }, { name: 'Tortilla Chips', origin: { id: 'old', name: 'Tortilla Chips', current_stock: 2 }, from_item_id: 'old' }]
async function hook(fields) {
  const item = db.add('pantry_items', { unit: 'pcs', category_id: 'snacks', ...fields })
  await pantryStore.refresh()
  return { item, result: renderHook(() => usePantryItems()).result }
}
const undoLast = () => runToastAction(getToasts().at(-1).id)

describe('deleting an item with names (3G)', () => {
  it.each([
    ['Chips & Snacks', names, 11],
    ['Dish soap', [{ name: 'Svelto', origin: null }], 0],
  ])('Undo brings "%s" back with every name, a merged one with its origin', async (name, list, stock) => {
    const { item, result } = await hook({ name, names: list, current_stock: stock })
    await result.current.deleteItem(pantryStore.getSnapshot().rows.find((r) => r.id === item.id))
    expect(db.row('pantry_items', item.id)).toBeNull()
    await undoLast()
    expect(db.row('pantry_items', item.id).names).toEqual(list)
    expect(db.row('pantry_items', item.id).current_stock).toBe(stock)
    expect(pantryStore.getSnapshot().rows.find((r) => r.id === item.id).names).toEqual(list)
  })
})

describe('renaming an item', () => {
  const entry = (name, pantry_item_id, extra = {}) => db.add('grocery_items', { name, pantry_item_id, ...extra })

  it('its open entries take the new name, except those under another name', async () => {
    const { item, result } = await hook({ name: 'Chips & Snacks', names, current_stock: 5 })
    const own = entry('Chips & Snacks', item.id)
    const corn = entry('Corn Snack', item.id)
    const bought = entry('Chips & Snacks', item.id, { completed: true })
    await result.current.updateItem(pantryStore.getSnapshot().rows.find((r) => r.id === item.id), { name: 'Snacks' })
    expect(db.row('grocery_items', own.id).name).toBe('Snacks')
    expect(db.row('grocery_items', corn.id).name).toBe('Corn Snack')
    expect(db.row('grocery_items', bought.id).name).toBe('Chips & Snacks')
  })

  it('an item with no names: every open entry, exactly as before', async () => {
    const { item, result } = await hook({ name: 'Milk', names: [], current_stock: 5 })
    const open = entry('Milk', item.id)
    const typed = entry('milk 1L', item.id)
    await result.current.updateItem(pantryStore.getSnapshot().rows.find((r) => r.id === item.id), { name: 'Whole Milk' })
    expect(db.row('grocery_items', open.id).name).toBe('Whole Milk')
    expect(db.row('grocery_items', typed.id).name).toBe('Whole Milk')
  })
})

describe('`names` in a plain write', () => {
  it('is never sent: it is not an item field, and a form value of that name is dropped', () => {
    expect(ITEM_FIELDS).not.toContain('names')
    expect(pickFields({ name: 'Milk', names: names })).toEqual({ name: 'Milk' })
  })
})
