// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The SHOP list page after the 26/10 follow-up of plan 9G: one button
// "+ Add to SHOP list" instead of the quick-add box and "More options",
// and "Go to card" showing the card already on the list.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false, missing: false, mapRows: [] }) }))

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
}))
const parents = [
  { id: 'fresh', name: 'Fresh', type: 'parent' },
  { id: 'cleaning', name: 'Cleaning', type: 'parent' },
]
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({
    parents,
    pantryParents: parents,
    subsByParent: new Map(parents.map((p) => [p.id, []])),
    shopOrder: parents.map((p) => p.id),
    categoryName: (id) => parents.find((p) => p.id === id)?.name ?? 'Uncategorized',
    addCategory: vi.fn(),
    addSubcategory: vi.fn(),
  }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }),
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

const data = vi.hoisted(() => {
  const soap = { id: 'soap', name: 'Dish soap', unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'cleaning' }
  const chips = { id: 'chips', name: 'Chips & Snacks', is_group: true, unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh' }
  const lays = { id: 'lays', name: 'Lays chips', group_id: 'chips', unit: 'pcs', current_stock: 0, min_stock: 0, category_id: 'fresh' }
  const tuc = { id: 'tuc', name: 'Tuc crackers', group_id: 'chips', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh' }
  chips.variants = [lays, tuc]
  const entry = (id, name, pantryId, extra = {}) => ({ id, name, pantry_item_id: pantryId, quantity: 1, unit: 'pcs', price: 0, completed: false, in_cart: false, created_at: '1', ...extra })
  const entries = [entry('g-soap', 'Dish soap', 'soap', { in_cart: true, category_id: 'cleaning' }), entry('g-lays', 'Lays chips', 'lays', { category_id: 'fresh' })]
  return { pantry: [soap, chips, lays, tuc], entries, addItem: null }
})
vi.mock('../hooks/useGroceryList', () => {
  const byId = new Map(data.pantry.map((p) => [p.id, p]))
  const pantryFor = (g) => byId.get(g.pantry_item_id) ?? null
  return {
    useGroceryList: () => ({
      items: data.entries,
      addItem: data.addItem,
      updatePricing: vi.fn(),
      updatePayer: vi.fn(),
      updateCategory: vi.fn(),
      deleteItem: vi.fn(),
      addVariant: vi.fn(),
      cartItems: data.entries.filter((e) => e.in_cart),
      pantryItems: data.pantry,
      pantryByName: new Map(data.pantry.filter((p) => !p.is_group).map((p) => [p.name.toLowerCase(), p])),
      pantryFor,
      groupOf: (g) => {
        const p = pantryFor(g)
        return p?.group_id ? byId.get(p.group_id) : null
      },
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
    }),
  }
})

const { GroceryPage } = await import('./GroceryPage')

const scrolled = vi.fn()
beforeEach(() => {
  data.addItem = vi.fn(async () => ({ error: null }))
  Element.prototype.scrollIntoView = scrolled
})
afterEach(() => {
  cleanup()
  scrolled.mockClear()
  localStorage.clear()
})

const page = () =>
  render(
    <MemoryRouter>
      <GroceryPage />
    </MemoryRouter>
  )
const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'Add to SHOP list' }))
const typeName = (text) => fireEvent.change(screen.getByLabelText('Item name'), { target: { value: text } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const spotOf = (text) => screen.getByText(text).closest('[data-spot]')

describe('SHOP list: "+ Add to SHOP list"', () => {
  it('no quick-add box and no "More options"; the button opens the form "Add to SHOP list" with "Save" and "Save & add another"', () => {
    page()
    expect(screen.queryByLabelText('Add an item')).toBeNull()
    expect(screen.queryByText(/More options/)).toBeNull()
    expect(screen.queryByLabelText('Item name')).toBeNull()
    openForm()
    expect(screen.getByText('Add to SHOP list', { selector: 'p' })).toBeTruthy()
    expect(screen.getByLabelText('Item name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save & add another' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to SHOP list' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close the form' }))
    expect(screen.queryByLabelText('Item name')).toBeNull()
  })

  it('"Go to card" (in the cart) closes the form without saving, scrolls to the card and outlines it', () => {
    page()
    expect(spotOf('Dish soap')).toBeNull()
    openForm()
    typeName('Dish soap')
    save()
    expect(screen.getByText('Already on your SHOP list: Dish soap — in the cart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to card' }))
    expect(screen.queryByLabelText('Item name')).toBeNull()
    expect(data.addItem).not.toHaveBeenCalled()
    expect(spotOf('Dish soap')).toBeTruthy()
    expect(scrolled).toHaveBeenCalled()
  })

  it('a group variant: "Go to card" outlines the group’s card', () => {
    page()
    openForm()
    typeName('Lays chips')
    save()
    expect(screen.getByText('Already on your SHOP list: Lays chips — to buy')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to card' }))
    const card = screen.getByRole('region', { name: 'Chips & Snacks (group)' })
    expect(card.hasAttribute('data-spot')).toBe(true)
  })

  it('a category filter that hides the card is cleared first', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Fresh' }))
    expect(screen.queryByText('Dish soap')).toBeNull()
    openForm()
    typeName('Dish soap')
    save()
    fireEvent.click(screen.getByRole('button', { name: 'Go to card' }))
    expect(spotOf('Dish soap')).toBeTruthy()
  })

  it('Shop mode keeps its quick-add box; its "Go to card" outlines the Shop-mode card', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Shop' }))
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'Dish soap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to card' }))
    expect(data.addItem).not.toHaveBeenCalled()
    expect(spotOf('Dish soap')).toBeTruthy()
  })
})
