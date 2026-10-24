// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const state = vi.hoisted(() => ({ mapRows: [], setBudgetMapping: vi.fn() }))
const money = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'personal', name: 'Personal Care', parent_id: null },
  { id: 'personal:beauty', name: 'Beauty & Perfume', parent_id: 'personal' },
  { id: 'car', name: 'Car / Vehicle', parent_id: null },
  { id: 'health', name: 'Health', parent_id: null },
  { id: 'health:pharmacy', name: 'Pharmacy', parent_id: 'health' },
]
vi.mock('../../hooks/useExpenses', () => ({ useExpenseCategories: () => ({ categories: money }) }))
vi.mock('../../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: state.mapRows }) }))
vi.mock('../../hooks/useBudgetMap', () => ({
  setBudgetMapping: state.setBudgetMapping,
  applyPastPurchases: vi.fn(),
  previewPastPurchases: vi.fn(),
}))
vi.mock('../../lib/stores', () => ({ inventoryCategoryStore: { useRows: () => ({ rows: [] }) } }))
vi.mock('./InventoryCategoryManager', () => ({ InventoryCategoryManager: () => null }))
const { BudgetMappingView } = await import('./BudgetMappingView')

afterEach(() => {
  cleanup()
  state.mapRows = []
  state.setBudgetMapping.mockClear()
})

const beautyCare = { id: 'beauty', name: 'Beauty Care' }
const household = { id: 'household', name: 'Household Supplies' }
const health = { id: 'medicine', name: 'Health & Medicine' }
const parents = [beautyCare, household, health]
const subs = new Map([
  ['beauty', [{ id: 'perfume', name: 'Perfume', parent_id: 'beauty' }]],
  ['household', [{ id: 'carcare', name: 'Car Care', parent_id: 'household' }, { id: 'cleaning', name: 'Cleaning', parent_id: 'household' }]],
  ['medicine', [{ id: 'meds', name: 'Medicines', parent_id: 'medicine' }]],
])
const mapRow = (id, expense_category_id) => ({ id, expense_category_id })

// All the sub-category lists opened.
function show(props = {}) {
  const view = render(<BudgetMappingView parents={parents} subsByParent={subs} {...props} />)
  for (const button of screen.getAllByRole('button', { name: /^Sub-categories/ })) fireEvent.click(button)
  return view
}
const rowOf = (subName) => screen.getByText(subName, { selector: 'span' }).closest('div.space-y-1')
const mainSelect = (subName) => within(rowOf(subName)).getByLabelText(`Budget category for ${subName}`)
const subSelect = (subName) => within(rowOf(subName)).getByLabelText(`Budget category for ${subName}: sub-category`)
const grey = (subName, part) => rowOf(subName).querySelector(`[data-inherited="${part}"]`)

describe('HOME → Categories: a sub-category that follows its main', () => {
  it('shows "Same as <main>" and, in grey, the budget category it really books to; the right select is disabled', () => {
    state.mapRows = [mapRow('beauty', 'personal:beauty')]
    show()
    expect(within(rowOf('Perfume')).getByText('Same as Beauty Care', { selector: 'span' })).toBeTruthy()
    expect(grey('Perfume', 'main').textContent).toBe('Personal Care')
    expect(grey('Perfume', 'sub').textContent).toBe('Beauty & Perfume')
    expect(subSelect('Perfume').disabled).toBe(true)
    // The list itself: "Same as <main>" first, then mains A–Z.
    expect([...mainSelect('Perfume').querySelectorAll('option')].map((o) => o.textContent).slice(0, 3)).toEqual(['Same as Beauty Care', 'Car / Vehicle', 'Groceries'])
  })

  it('shows grey "No sub-category" when it books to a main without a sub, and follows the default when its main has no choice', () => {
    state.mapRows = [mapRow('household', 'groceries')]
    show()
    expect(grey('Cleaning', 'main').textContent).toBe('Groceries')
    expect(grey('Cleaning', 'sub').textContent).toBe('No sub-category')
    expect(subSelect('Cleaning').disabled).toBe(true)
    state.mapRows = []
    cleanup()
    show()
    expect(within(rowOf('Cleaning')).getByText('Same as Household Supplies', { selector: 'span' })).toBeTruthy()
    expect(grey('Cleaning', 'main').textContent).toBe('Groceries')
    expect(grey('Cleaning', 'sub').textContent).toBe('No sub-category')
  })

  it('a sub with its own choice stays white: no grey text, no "Same as" label, an enabled right select', () => {
    state.mapRows = [mapRow('household', 'groceries'), mapRow('carcare', 'car')]
    show()
    expect(grey('Car Care', 'main')).toBeNull()
    expect(grey('Car Care', 'sub')).toBeNull()
    expect(within(rowOf('Car Care')).queryByText('Same as Household Supplies', { selector: 'span' })).toBeNull()
    expect(mainSelect('Car Care').value).toBe('car')
    expect(subSelect('Car Care').disabled).toBe(true) // Car / Vehicle has no subs
    state.mapRows = [mapRow('carcare', 'health:pharmacy')]
    cleanup()
    show()
    expect(mainSelect('Car Care').value).toBe('health')
    expect(subSelect('Car Care').value).toBe('health:pharmacy')
    expect(subSelect('Car Care').disabled).toBe(false)
  })

  it('choosing "Same as <main>" on a row with its own choice removes it, and the row goes back to grey', () => {
    state.mapRows = [mapRow('household', 'groceries'), mapRow('carcare', 'car')]
    const { rerender } = show()
    fireEvent.change(mainSelect('Car Care'), { target: { value: '' } })
    expect(state.setBudgetMapping).toHaveBeenCalledWith('carcare', null)
    state.mapRows = [mapRow('household', 'groceries')]
    rerender(<BudgetMappingView parents={parents} subsByParent={subs} />)
    expect(grey('Car Care', 'main').textContent).toBe('Groceries')
    expect(grey('Car Care', 'sub').textContent).toBe('No sub-category')
    expect(subSelect('Car Care').disabled).toBe(true)
  })

  it('picking a real category on an inherited row saves it for that row only', () => {
    state.mapRows = [mapRow('beauty', 'personal:beauty')]
    show()
    fireEvent.change(mainSelect('Perfume'), { target: { value: 'car' } })
    expect(state.setBudgetMapping).toHaveBeenCalledTimes(1)
    expect(state.setBudgetMapping).toHaveBeenCalledWith('perfume', 'car')
  })

  it('changing the main\'s choice changes every inherited sub row at once', () => {
    state.mapRows = [mapRow('household', 'groceries'), mapRow('carcare', 'car')]
    const { rerender } = show()
    expect(grey('Cleaning', 'main').textContent).toBe('Groceries')
    state.mapRows = [mapRow('household', 'health:pharmacy'), mapRow('carcare', 'car')]
    rerender(<BudgetMappingView parents={parents} subsByParent={subs} />)
    expect(grey('Cleaning', 'main').textContent).toBe('Health')
    expect(grey('Cleaning', 'sub').textContent).toBe('Pharmacy')
    expect(grey('Car Care', 'main')).toBeNull()
  })

  it('after the HOME main is renamed, the label and the first option show the new name', () => {
    state.mapRows = [mapRow('beauty', 'personal:beauty')]
    const { rerender } = show()
    rerender(<BudgetMappingView parents={[{ id: 'beauty', name: 'Self Care' }, household, health]} subsByParent={subs} />)
    expect(within(rowOf('Perfume')).getByText('Same as Self Care', { selector: 'span' })).toBeTruthy()
    expect(within(rowOf('Perfume')).queryByText('Same as Beauty Care', { selector: 'span' })).toBeNull()
    expect(mainSelect('Perfume').querySelector('option').textContent).toBe('Same as Self Care')
  })
})
