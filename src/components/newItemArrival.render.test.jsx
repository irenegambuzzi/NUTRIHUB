// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9L K5 on screen: "It arrived!" → "Create a new item" starts the HOME
// editor from the ORDER (its unit and quantity; a package with "Bought in a
// different unit" on and the pack size to type; its normal price), against
// the database kept in memory (hooks/arrivalDb.fixture.js). Everything else
// of 9J is unchanged: the toast's Undo deletes the new item.
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

const { arrivalDb } = await import('../hooks/arrivalDb.fixture')
const { ArrivedDialog } = await import('./expenses/ArrivedDialog')
const { Feedback } = await import('./ui/Feedback')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { pantryStore } = await import('../lib/stores')

let db
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

async function open(o) {
  await pantryStore.refresh()
  render(
    <>
      <ArrivedDialog order={{ ...o }} onClose={vi.fn()} />
      <Feedback />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: /^Create a new item/ }))
}
const click = (name) => fireEvent.click(screen.getByRole('button', { name }))
const unitSelect = () => screen.getByText('Unit (what you count stock in)').parentElement.querySelector('select')
const fieldUnder = (label) => {
  let box = screen.getByText(label, { selector: 'label' }).parentElement
  while (!box.querySelector('input')) box = box.parentElement
  return box.querySelector('input')
}
const made = (name) => db.tables.pantry_items.find((p) => p.name === name)

describe('"It arrived!" → "Create a new item" starts from the order (K5)', () => {
  it('ordered "1 pack" (normal €3.00): pcs, "Bought in a different unit" on, purchase unit pack, "pcs per pack" empty and required; 4 → 4 pcs with usual pack 4 and €3.00 per 1 pack; Undo deletes it', async () => {
    const o = db.add('orders', { item_name: 'Soft drink', price: 2.7, list_price: 3, quantity: 1, unit: 'pack' })
    await open(o)
    expect(screen.getByText('Add an item')).toBeTruthy()
    expect(unitSelect().value).toBe('pcs')
    expect(screen.getByText('Purchase unit').parentElement.querySelector('select').value).toBe('pack')
    expect(fieldUnder('pcs per pack').value).toBe('')
    expect(fieldUnder('Current stock').value).toBe('1')
    expect(document.body.textContent).toContain('in pack ⇄')
    click('Add to inventory')
    expect(await screen.findByText('Quantity per pack must be more than 0.')).toBeTruthy()
    expect(made('Soft drink')).toBeUndefined()
    fireEvent.change(fieldUnder('pcs per pack'), { target: { value: '4' } })
    click('Add to inventory')
    const box = (await screen.findByText('"Soft drink" is now in HOME')).closest('[role="status"]')
    expect(made('Soft drink')).toMatchObject({ unit: 'pcs', current_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 3, price_qty: 1, price_unit: 'pack' })
    expect(db.tables.stock_logs.map((l) => [l.change, l.unit, l.reason])).toEqual([[4, 'pcs', 'purchased']])
    fireEvent.click(within(box).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(made('Soft drink')).toBeUndefined())
  })

  it('ordered "2 btl" (€1.80): counted in btl, stock 2, €1.80 per 2 btl', async () => {
    const o = db.add('orders', { item_name: 'Sparkling water', price: 1.8, quantity: 2, unit: 'btl' })
    await open(o)
    expect(unitSelect().value).toBe('btl')
    expect(fieldUnder('Current stock').value).toBe('2')
    expect(document.body.textContent).not.toContain('in pack ⇄')
    click('Add to inventory')
    await screen.findByText('"Sparkling water" is now in HOME')
    expect(made('Sparkling water')).toMatchObject({ unit: 'btl', current_stock: 2, packaging_unit: null, price: 1.8, price_qty: 2, price_unit: 'btl' })
  })

  it('ordered "1 bag" (€5.00), "pcs per bag" empty: "Quantity per bag must be more than 0." (K24), nothing made; 10 → 10 pcs', async () => {
    const o = db.add('orders', { item_name: 'Rice cakes', price: 5, quantity: 1, unit: 'bag' })
    await open(o)
    click('Add to inventory')
    expect(await screen.findByText('Quantity per bag must be more than 0.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Quantity per pack')
    expect(made('Rice cakes')).toBeUndefined()
    fireEvent.change(fieldUnder('pcs per bag'), { target: { value: '10' } })
    click('Add to inventory')
    await screen.findByText('"Rice cakes" is now in HOME')
    expect(made('Rice cakes')).toMatchObject({ unit: 'pcs', current_stock: 10, packaging_unit: 'bag', quantity_per_pack: 10, price: 5, price_qty: 1, price_unit: 'bag' })
  })
})
