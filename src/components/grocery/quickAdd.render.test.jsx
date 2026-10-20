// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const remember = vi.fn()
const chipsFor = vi.hoisted(() => ({ value: [] }))
vi.mock('../../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => chipsFor.value, remember }),
}))
vi.mock('../../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const { QuickAdd } = await import('./QuickAdd')

afterEach(() => {
  cleanup()
  remember.mockReset()
  chipsFor.value = []
  localStorage.clear()
})

const parents = [{ id: 'dairy' }, { id: 'snacks' }]
const subsByParent = new Map([['dairy', [{ id: 'dairy:yogurt' }]], ['snacks', []]])
const chip = (categoryId, subcategoryId, label) => ({ categoryId, subcategoryId, expenseCategoryId: null, source: 'keywords', label })

function setup() {
  const addItem = vi.fn(async () => ({ error: null }))
  render(
    <QuickAdd items={[]} pantryItems={[]} parents={parents} subsByParent={subsByParent} categoryName={(id) => id} addItem={addItem} updatePricing={vi.fn()} totalFor={() => 0} onMoreOptions={vi.fn()} />
  )
  return addItem
}
const typeAndAdd = (text) => {
  fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: text } })
}

describe('SHOP quick add', () => {
  it('an unknown word is added right away without a category — no popup, no guessed chip', async () => {
    const addItem = setup()
    typeAndAdd('Zorblax')
    expect(screen.queryByRole('button', { pressed: true })).toBeNull()
    expect(screen.getByRole('button', { name: /New category/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Zorblax', categoryId: null, subcategoryId: null })
  })

  it('a tapped chip gives the category; a pick other than the first chip is remembered with the chips on offer', async () => {
    chipsFor.value = [chip('dairy', 'dairy:yogurt', 'Dairy › Yogurt'), chip('snacks', null, 'Snacks')]
    const addItem = setup()
    typeAndAdd('Test kefir')
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Test kefir', categoryId: 'snacks', subcategoryId: null })
    expect(remember).toHaveBeenCalledWith('Test kefir', 'snacks', null, { chips: chipsFor.value })
  })
})
