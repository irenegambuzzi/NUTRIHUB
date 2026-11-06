// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// "It arrived!" with other names (plan 9N, stage 2): "Which item?" also finds
// them, and K58: the word behind "Add it to …" or "Create new" is kept once
// the arrival is saved, against the database kept in memory.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const parents = vi.hoisted(() => [{ id: 'beverages', name: 'Beverages', type: 'parent' }])
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents, pantryParents: parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => ({ categoryId: 'beverages', subcategoryId: null }), suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false, missing: false, mapRows: [] }) }))
const kept = vi.hoisted(() => [])
vi.mock('../hooks/itemNameActions', () => ({ keepTypedName: (word, id) => kept.push([word, id]) }))

const { arrivalDb } = await import('../hooks/arrivalDb.fixture')
const { ArrivedDialog } = await import('./expenses/ArrivedDialog')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { pantryStore } = await import('../lib/stores')

let db
beforeEach(() => {
  kept.length = 0
  db = arrivalDb()
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

const juice = () => db.add('pantry_items', { name: 'Fruit Juice', unit: 'pcs', current_stock: 3, min_stock: 0, category_id: 'beverages', names: [{ name: 'Yoga Pesca', origin: null }] })
const milk = () => db.add('pantry_items', { name: 'Oat Milk', unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'beverages', names: [] })

async function open(o) {
  await pantryStore.refresh()
  render(<ArrivedDialog order={{ ...o }} onClose={vi.fn()} />)
}
const click = (name) => fireEvent.click(screen.getByRole('button', { name }))
const nameField = () => screen.getByPlaceholderText(/e\.g\. Rice/)

describe('"It arrived!"', () => {
  it('"Which item?" also finds an item by another name', async () => {
    juice()
    milk()
    await open(db.add('orders', { item_name: 'Yoga', price: 2, quantity: 1, unit: 'pcs' }))
    click(/^Add to an existing item/)
    fireEvent.change(screen.getByPlaceholderText('Search your items…'), { target: { value: 'yoga' } })
    const select = screen.getByLabelText('Item')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose an item… (1)', 'Fruit Juice (3 pcs)'])
    expect(kept).toEqual([])
  })

  it('"Create a new item" with a similar other name: "Add it to …", the arrival goes there, then the word is kept', async () => {
    const item = juice()
    await open(db.add('orders', { item_name: 'Yoga Pescha', price: 2, quantity: 1, unit: 'pcs' }))
    click(/^Create a new item/)
    click('Add to inventory')
    click('Add it to Fruit Juice (Yoga Pesca) · 3 pcs at home')
    expect(kept).toEqual([])
    const form = screen.getByRole('dialog')
    click(within(form).getByRole('button', { name: /^Add/ }).textContent)
    await waitFor(() => expect(kept).toEqual([['Yoga Pescha', item.id]]))
    expect(db.tables.pantry_items.find((p) => p.id === item.id).current_stock).toBe(4)
  })

  it('"Add it to …", then Back and another item by hand: nothing is kept', async () => {
    juice()
    const other = milk()
    await open(db.add('orders', { item_name: 'Yoga Pescha', price: 2, quantity: 1, unit: 'pcs' }))
    click(/^Create a new item/)
    click('Add to inventory')
    click('Add it to Fruit Juice (Yoga Pesca) · 3 pcs at home')
    click('Back')
    click(/^Add to an existing item/)
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: other.id } })
    click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Add/ }).textContent)
    await waitFor(() => expect(db.tables.pantry_items.find((p) => p.id === other.id).current_stock).toBe(2))
    expect(kept).toEqual([])
  })

  it('"Create new", then another name: the item is made here, so the first word goes with it', async () => {
    juice()
    await open(db.add('orders', { item_name: 'Yoga Pescha', price: 2, quantity: 1, unit: 'pcs' }))
    click(/^Create a new item/)
    click('Add to inventory')
    click('Create new “Yoga Pescha”')
    fireEvent.change(nameField(), { target: { value: 'Peach Nectar' } })
    click('Add to inventory')
    await waitFor(() => expect(db.tables.pantry_items.find((p) => p.name === 'Peach Nectar')).toBeTruthy())
    const made = db.tables.pantry_items.find((p) => p.name === 'Peach Nectar')
    await waitFor(() => expect(kept).toEqual([['Yoga Pescha', made.id]]))
  })

  it('"Create new" with the name as it was: nothing to keep', async () => {
    juice()
    await open(db.add('orders', { item_name: 'Yoga Pescha', price: 2, quantity: 1, unit: 'pcs' }))
    click(/^Create a new item/)
    click('Add to inventory')
    click('Create new “Yoga Pescha”')
    click('Add to inventory')
    await waitFor(() => expect(db.tables.pantry_items.find((p) => p.name === 'Yoga Pescha')).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve))
    expect(kept).toEqual([])
  })
})
