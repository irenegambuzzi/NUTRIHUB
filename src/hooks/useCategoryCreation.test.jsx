// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
const spies = vi.hoisted(() => ({
  addCategory: vi.fn(async (name) => ({ data: { id: 'new-main', name }, error: null })),
  addSubcategory: vi.fn(async (parentId, name) => ({ data: { id: 'new-sub', name, parent_id: parentId }, error: null })),
  addExpenseCategory: vi.fn(async (name, parentId) => ({ data: { id: 'new-money', name, parent_id: parentId }, error: null })),
  setBudgetMapping: vi.fn(async () => ({ error: null })),
}))
const money = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'pets-money', name: 'Pets', parent_id: null },
]
const home = [
  { id: 'dairy', name: 'Dairy & Eggs', parent_id: null, type: 'parent' },
  { id: 'appliances', name: 'Home & Appliances', parent_id: null, type: 'parent' },
]
vi.mock('./useInventoryCategories', () => ({
  useInventoryCategories: () => ({ categories: home, parents: home, addCategory: spies.addCategory, addSubcategory: spies.addSubcategory }),
}))
vi.mock('./useExpenses', () => ({ useExpenseCategories: () => ({ categories: money, addCategory: spies.addExpenseCategory }) }))
vi.mock('./useBudgetMap', () => ({ setBudgetMapping: spies.setBudgetMapping }))
vi.mock('../lib/stores', () => ({
  inventoryCategoryStore: { useRows: () => ({ rows: home }) },
  budgetMapStore: { useRows: () => ({ rows: [] }) },
}))
const { useCategoryCreation } = await import('./useCategoryCreation')
const setup = () => renderHook(() => useCategoryCreation()).result.current

describe('making a category from SHOP or MONEY', () => {
  it('a HOME category: added, and its budget mapping stored only when it differs from the default', async () => {
    const c = setup()
    const sub = await c.createHome({ name: 'Kefir', parentId: 'dairy', budgetId: 'groceries' })
    expect(spies.addSubcategory).toHaveBeenCalledWith('dairy', 'Kefir')
    expect(sub.pick).toEqual({ categoryId: 'dairy', subcategoryId: 'new-sub', expenseCategoryId: null })
    expect(spies.setBudgetMapping).not.toHaveBeenCalled()

    const main = await c.createHome({ name: 'Pets', parentId: null, budgetId: 'pets-money' })
    expect(spies.addCategory).toHaveBeenCalledWith('Pets')
    expect(main.pick).toEqual({ categoryId: 'new-main', subcategoryId: null, expenseCategoryId: null })
    expect(spies.setBudgetMapping).toHaveBeenCalledWith('new-main', 'pets-money')
  })

  it('a MONEY category (Add to HOME off) is only a budget category: nothing is added to HOME, no mapping', async () => {
    spies.addCategory.mockClear()
    spies.addSubcategory.mockClear()
    spies.setBudgetMapping.mockClear()
    const result = await setup().createMoney({ name: 'Souvenirs', parentId: 'pets-money' })
    expect(spies.addExpenseCategory).toHaveBeenCalledWith('Souvenirs', 'pets-money')
    expect(result.pick).toEqual({ categoryId: null, subcategoryId: null, expenseCategoryId: 'new-money' })
    expect(spies.addCategory).not.toHaveBeenCalled()
    expect(spies.addSubcategory).not.toHaveBeenCalled()
    expect(spies.setBudgetMapping).not.toHaveBeenCalled()
  })

  it('a refused name returns the error and stores nothing; Home & Appliances is not offered for new subs', async () => {
    spies.addSubcategory.mockResolvedValueOnce({ data: null, error: new Error('taken') })
    spies.setBudgetMapping.mockClear()
    const c = setup()
    const result = await c.createHome({ name: 'Dairy', parentId: 'dairy', budgetId: 'pets-money' })
    expect(result.error).toBeTruthy()
    expect(result.pick).toBeUndefined()
    expect(spies.setBudgetMapping).not.toHaveBeenCalled()
    expect(c.homeMains.map((m) => m.id)).toEqual(['dairy'])
  })
})
