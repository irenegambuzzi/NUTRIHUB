// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Stage 2 of round 6D (plan 9N) on the two pages: HOME saves the names first
// and searches them, SHOP finds an entry by another name of its item.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false, missing: false, mapRows: [] }) }))
vi.mock('../lib/feedback', async (original) => ({ ...(await original()), showToast: vi.fn() }))
const fake = (rows) => ({ useRows: () => ({ rows, loaded: true }), getSnapshot: () => ({ rows, loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake([]),
  groceryStore: fake([]),
  orderStore: fake([]),
  budgetMapStore: fake([]),
  shopStore: fake([]),
  expenseCategoryStore: fake([]),
  categoryMemoryStore: fake([]),
  inventoryCategoryStore: fake([]),
  restockLogStore: fake([]),
  stockLogStore: fake([]),
}))
const parents = [{ id: 'fresh', name: 'Fresh', type: 'parent' }]
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents, pantryParents: parents, categories: parents, byId: new Map(), subsByParent: new Map([['fresh', []]]), shopOrder: ['fresh'], categoryName: () => 'Fresh', addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => ({ categoryId: 'fresh', subcategoryId: null }), suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: vi.fn(), usePurchase: () => ({ confirmPurchase: vi.fn() }) }))
vi.mock('../hooks/useShopOrder', async () => {
  const { positionsFrom } = await import('../lib/shopMode')
  return { useShopOrder: () => ({ positions: positionsFrom([]), savePositions: vi.fn() }) }
})
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../components/inventory/BudgetMappingView', () => ({ BudgetMappingView: () => null }))
vi.mock('../components/inventory/DataView', () => ({ DataView: () => null }))
vi.mock('../components/ui/WhereToRecord', () => ({ WhereToRecord: () => null }))

const data = vi.hoisted(() => ({ items: [], updateItem: null, addItem: null, entries: [], saveNames: null, kept: [] }))
vi.mock('../hooks/usePantryItems', () => ({
  usePantryItems: () => ({ items: data.items, addItem: data.addItem, updateItem: data.updateItem, adjustStock: vi.fn(), discardExpired: vi.fn(), deleteItem: vi.fn(), importItems: vi.fn() }),
  useStockLogs: () => [],
  deleteStockLogs: vi.fn(),
}))
vi.mock('../hooks/useGroceryItems', () => ({ useGroceryItems: () => ({ items: [], addItem: vi.fn() }) }))
vi.mock('../hooks/useNewItemIds', () => ({ useNewItemIds: () => new Set() }))
vi.mock('../hooks/itemNameActions', () => ({
  saveItemNames: (payload) => data.saveNames(payload),
  keepTypedName: (word, id) => data.kept.push([word, id]),
  keepFirstWord: vi.fn(),
}))
vi.mock('../hooks/useGroceryList', () => {
  const useGroceryList = () => {
    const byId = new Map(data.items.map((p) => [p.id, p]))
    return {
      items: data.entries,
      addItem: vi.fn(),
      updatePricing: vi.fn(),
      updatePayer: vi.fn(),
      updateCategory: vi.fn(),
      deleteItem: vi.fn(),
      addVariant: vi.fn(),
      cartItems: [],
      pantryItems: data.items,
      pantryByName: new Map(),
      pantryFor: (g) => byId.get(g.pantry_item_id) ?? null,
      groupOf: () => null,
      reasonOf: () => 'out',
      totalOf: () => 0,
      costOf: () => 0,
      sortItems: (list) => list,
      groceryItems: data.entries,
      durableItems: [],
      listTotal: 0,
      boughtTotal: 0,
      payerTotals: [],
      unpricedCount: 0,
      unknownTotalCount: 0,
      groceryBudget: null,
      saveGroceryBudget: vi.fn(),
      budgetActive: false,
      overBudget: false,
      budgetPlan: null,
      checkOff: vi.fn(),
      onTheWay: [],
      openOrderOf: () => null,
    }
  }
  return { useGroceryList, PRIORITY: [] }
})

const { PantryPage } = await import('./PantryPage')
const { GroceryPage } = await import('./GroceryPage')
const { forgetNamesForTest } = await import('../hooks/useItemNamesReady')

const element = (name) => ({ name, packaging_unit: null, quantity_per_pack: null, origin: null })
const chips = { id: 'chips', name: 'Chips & Snacks', unit: 'pcs', current_stock: 11, min_stock: 0, category_id: 'fresh', created_at: '2', names: [element('Corn Snack'), element('Nuvole di drago')] }
const milk = { id: 'milk', name: 'Milk', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh', created_at: '1', names: [] }

const order = []
beforeEach(() => {
  forgetNamesForTest()
  order.length = 0
  data.kept.length = 0
  data.items = [chips, milk]
  data.entries = []
  data.saveNames = vi.fn(async () => (order.push('names'), { data: chips, error: null }))
  data.updateItem = vi.fn(async () => (order.push('fields'), { data: chips }))
  data.addItem = vi.fn(async (fields) => ({ data: { ...fields, id: 'new' } }))
})
afterEach(cleanup)

const home = () =>
  render(
    <MemoryRouter>
      <PantryPage />
    </MemoryRouter>
  )
const openChips = () => fireEvent.click(screen.getAllByTitle('Edit')[0])
const press = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
const addName = (value) => {
  fireEvent.click(screen.getByRole('button', { name: '+ Add a name' }))
  fireEvent.change(screen.getByLabelText('New name'), { target: { value } })
}

describe('HOME page', () => {
  it('the tile shows the line; search finds the item by another name', () => {
    home()
    expect(screen.getByText('also: Corn Snack, Nuvole di drago')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search all items…'), { target: { value: 'nuvole' } })
    expect(screen.getByText('Chips & Snacks')).toBeTruthy()
    expect(screen.queryByText('Milk')).toBeNull()
  })

  it('rows read without `names` (before 032): no line, no section, nothing new', async () => {
    data.items = [{ ...milk, names: undefined }].map(({ names: _names, ...row }) => row)
    home()
    fireEvent.click(screen.getAllByTitle('Edit')[0])
    expect(screen.queryByText('Other names')).toBeNull()
    press()
    await waitFor(() => expect(data.updateItem).toHaveBeenCalledTimes(1))
    expect(data.saveNames).not.toHaveBeenCalled()
    expect(data.updateItem.mock.calls[0][2]).toEqual({ converted: false })
  })

  it('"Save changes" with new names: first the names, then the fields', async () => {
    home()
    openChips()
    addName('Popcorn')
    press()
    await waitFor(() => expect(order).toEqual(['names', 'fields']))
    expect(data.saveNames.mock.calls[0][0]).toMatchObject({ item_id: 'chips', was: { names: chips.names } })
    expect(data.updateItem.mock.calls[0][2]).toEqual({ converted: false })
  })

  it('no change to the names: save_item_names is not called', async () => {
    home()
    openChips()
    press()
    await waitFor(() => expect(data.updateItem).toHaveBeenCalledTimes(1))
    expect(data.saveNames).not.toHaveBeenCalled()
  })

  it('a refusal stops there: nothing else is saved and the editor stays open', async () => {
    data.saveNames = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'changed meanwhile' } }))
    home()
    openChips()
    addName('Popcorn')
    press()
    await waitFor(() => expect(data.saveNames).toHaveBeenCalledTimes(1))
    expect(data.updateItem).not.toHaveBeenCalled()
    expect(screen.getByText('Edit item')).toBeTruthy()
  })

  it('a new item after "Create new" and another name: the first word goes to it', async () => {
    home()
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const name = () => screen.getByPlaceholderText(/e\.g\. Rice/)
    fireEvent.change(name(), { target: { value: 'Milks Oat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create new “Milks Oat”' }))
    fireEvent.change(name(), { target: { value: 'Oat Drink' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    await waitFor(() => expect(data.addItem).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(data.kept).toEqual([['Milks Oat', 'new']]))
  })
})

describe('SHOP search', () => {
  const entry = { id: 'g1', name: 'Dish soap', pantry_item_id: 'soap', quantity: 1, unit: 'pcs', price: 0, completed: false, in_cart: false, created_at: '1', category_id: 'fresh' }
  const soap = { id: 'soap', name: 'Dish soap', unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'fresh', names: [element('Svelto')] }
  const shop = () =>
    render(
      <MemoryRouter>
        <GroceryPage />
      </MemoryRouter>
    )

  it('finds the entry by another name of its item, with "In it: {names}"', () => {
    data.items = [soap]
    data.entries = [entry]
    shop()
    fireEvent.change(screen.getByPlaceholderText('Search the list and the cart…'), { target: { value: 'svelt' } })
    expect(screen.getByText('In it: Svelto')).toBeTruthy()
  })

  it('an entry of an item without names: not found by that word, no hint', () => {
    data.items = [{ ...soap, names: [] }]
    data.entries = [entry]
    shop()
    fireEvent.change(screen.getByPlaceholderText('Search the list and the cart…'), { target: { value: 'svelt' } })
    expect(screen.queryByText(/^In it:/)).toBeNull()
    expect(screen.getByText('Nothing matches "svelt" — not on the list and not in the cart.')).toBeTruthy()
  })
})
