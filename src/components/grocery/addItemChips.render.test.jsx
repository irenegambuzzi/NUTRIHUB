// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const remember = vi.fn()
const data = vi.hoisted(() => ({ chips: [], last: null }))
vi.mock('../../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => data.chips, remember }),
}))
vi.mock('../../hooks/useLastPrice', () => ({ useLastPrice: () => data.last }))
vi.mock('../../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const { AddItemForm } = await import('./AddItemForm')

afterEach(() => {
  cleanup()
  remember.mockReset()
  data.chips = []
  data.last = null
})

const parents = [{ id: 'dairy', name: 'Dairy' }, { id: 'snacks', name: 'Snacks' }]
const subsByParent = new Map([['dairy', []], ['snacks', []]])
const chip = (categoryId, label) => ({ categoryId, subcategoryId: null, expenseCategoryId: null, source: 'keywords', label })
const form = () => {
  const onAdd = vi.fn(async () => ({ error: null }))
  render(<AddItemForm parents={parents} subsByParent={subsByParent} categoryName={(id) => id} pantryByName={new Map()} onAdd={onAdd} onAddCategory={vi.fn()} onAddSubcategory={vi.fn()} />)
  return onAdd
}

describe('SHOP add form (More options): chips and the last price', () => {
  it('chips under the name fill the category; a pick other than the first is remembered', async () => {
    data.chips = [chip('dairy', 'Dairy'), chip('snacks', 'Snacks')]
    const onAdd = form()
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Test kefir' } })
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    expect(screen.getByLabelText('Item category').value).toBe('snacks')
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Test kefir', categoryId: 'snacks' })
    expect(remember).toHaveBeenCalledWith('Test kefir', 'snacks', null, { chips: data.chips })
  })

  it('an item can be added without a category (grey "No category" on the list)', async () => {
    const onAdd = form()
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Zorblax' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Zorblax', categoryId: null, subcategoryId: null })
    expect(remember).not.toHaveBeenCalled()
  })

  it('an item bought before fills in the last normal price and the unit it was bought in (editable)', () => {
    data.last = { price: 6, quantity: 750, unit: 'gr', source: 'trip', at: 1 }
    form()
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Nutella' } })
    expect(screen.getByLabelText('Unit').value).toBe('gr')
    expect(screen.getByDisplayValue('6.00')).toBeTruthy()
    expect(screen.getByDisplayValue('750')).toBeTruthy()
  })
})
