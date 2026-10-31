// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Round 9F: what the durable lock looks like on screen — the MONEY row,
// SHOP Confirm purchase and More options, the SHOP durable section, and
// "Arrived" of a durable order.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
// Order groups (supabase/028) not loaded here: the order form offers nothing.
vi.mock('../hooks/useOrderGroups', async (original) => ({ ...(await original()), useOrderGroups: () => ({ ready: false, groups: [], orders: [], byId: new Map() }) }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const SHOPPING = '654a80a3-2e6f-4ada-b214-0486d91d869c'
const data = vi.hoisted(() => ({ groceryList: null, orders: [], grocery: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => []),
  groceryStore: fake(() => data.grocery),
  orderStore: fake(() => data.orders),
  budgetMapStore: fake(() => []),
  shopStore: fake(() => []),
  expenseCategoryStore: fake(() => []),
  categoryMemoryStore: fake(() => []),
  inventoryCategoryStore: fake(() => [
    { id: 'dairy', name: 'Dairy' },
    { id: 'appliances', name: 'Durables' },
    { id: 'appliances:footwear', name: 'Footwear', parent_id: 'appliances' },
  ]),
}))
const parents = [
  { id: 'dairy', name: 'Dairy', type: 'parent' },
  { id: 'appliances', name: 'Durables', type: 'parent' },
]
const subsByParent = new Map([
  ['dairy', []],
  ['appliances', [{ id: 'appliances:footwear', name: 'Footwear', parent_id: 'appliances' }]],
])
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({
    parents,
    pantryParents: parents.filter((p) => p.id !== 'appliances'),
    subsByParent,
    shopOrder: ['dairy', 'appliances'],
    categoryName: (id) => [...parents, ...subsByParent.get('appliances')].find((c) => c.id === id)?.name ?? 'Uncategorized',
    addCategory: vi.fn(),
    addSubcategory: vi.fn(),
  }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: vi.fn(), usePurchase: () => ({ confirmPurchase: vi.fn() }) }))
vi.mock('../hooks/useExpenses', () => ({ addExpenseOnce: vi.fn() }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useGroceryList', () => ({ useGroceryList: () => data.groceryList }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
const markDurableArrived = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/useOrders', () => ({
  useOrders: () => ({ orders: data.orders, ready: true, missing: false }),
  createOrder: vi.fn(),
  editOrder: vi.fn(),
  linkedItemOf: () => null,
  markDurableArrived: (...args) => markDurableArrived(...args),
}))
vi.mock('./expenses/ArrivedDialog', () => ({ ArrivedDialog: () => <p>Arrived dialog: add to HOME?</p> }))
vi.mock('./expenses/LinkedArrivedDialog', () => ({ LinkedArrivedDialog: () => <p>Linked arrived dialog</p> }))

const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { GroceryPage } = await import('../pages/GroceryPage')
const { OrdersSection } = await import('./expenses/OrdersSection')
const { ItemEditor } = await import('./inventory/ItemEditor')

afterEach(() => {
  cleanup()
  markDurableArrived.mockClear()
})

const SUBSCRIPTION = '688bfedf-8e4c-4b59-860f-3a55c33f50d1'
const STREAMING = 'a953640c-9716-4f1f-a989-279c03ddba63'
const CIGARETTES = '75310604-5b9b-431c-9837-b2065747409f'
const expenseCategories = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: SHOPPING, name: 'Shopping', parent_id: null },
  { id: 'footwear', name: 'Footwear', parent_id: SHOPPING },
  { id: SUBSCRIPTION, name: 'Subscription', parent_id: null },
  { id: STREAMING, name: 'Streaming', parent_id: SUBSCRIPTION },
  { id: CIGARETTES, name: 'Cigarettes & Vape', parent_id: null },
]

describe('MONEY Add expense: a durable row', () => {
  const form = () =>
    render(
      <PurchaseForm
        expenseCategories={expenseCategories}
        mainCategories={expenseCategories.filter((c) => !c.parent_id)}
        subsOf={(id) => expenseCategories.filter((c) => c.parent_id === id)}
        addCategory={vi.fn()}
        renameCategory={vi.fn()}
        moveCategory={vi.fn()}
        deleteCategory={vi.fn()}
        styleFor={() => ({ hex: '#000' })}
        onClose={vi.fn()}
      />
    )
  const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

  it('a durable HOME category: Add to HOME off and disabled, with the note, and no 1×', () => {
    form()
    type('Name', 'Sandali')
    type('Price', '20')
    const box = screen.getByLabelText('Add to HOME')
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
    expect(screen.getByText('Durable item (Footwear) — expense only, never in HOME stock.')).toBeTruthy()
    expect(screen.queryByText(/One-time purchase/)).toBeNull()
  })

  it('a durable budget category locks a consumable HOME category; a consumable budget releases it', () => {
    form()
    type('Name', 'Milk')
    type('Price', '2')
    expect(screen.getByLabelText('Add to HOME').disabled).toBe(false)
    expect(screen.getByLabelText('Add to HOME').checked).toBe(true)
    type('Budget category', SHOPPING)
    expect(screen.getByLabelText('Add to HOME').disabled).toBe(true)
    expect(screen.getByText('Durable item (Shopping) — expense only, never in HOME stock.')).toBeTruthy()
    type('Budget category', 'groceries')
    expect(screen.getByLabelText('Add to HOME').disabled).toBe(false)
    expect(screen.getByLabelText('Add to HOME').checked).toBe(true)
  })

  it('a service (decision 14b): Add to HOME off and disabled, with the service note', () => {
    form()
    type('Name', 'Netflix')
    type('Price', '13')
    expect(screen.getByLabelText('Budget category').value).toBe(SUBSCRIPTION) // the main; Streaming is its sub
    expect(screen.getByLabelText('Add to HOME').checked).toBe(false)
    expect(screen.getByLabelText('Add to HOME').disabled).toBe(true)
    expect(screen.getByText('Service (Streaming) — expense only, never in HOME stock.')).toBeTruthy()
  })

  it('decision 14a: the budget from the name stays when Add to HOME is turned on without a HOME category', () => {
    form()
    type('Name', 'Marlboro')
    type('Price', '6')
    const box = screen.getByLabelText('Add to HOME')
    expect(box.checked).toBe(false)
    expect(screen.getByLabelText('Budget category').value).toBe(CIGARETTES)
    fireEvent.click(box)
    expect(screen.getByLabelText('Add to HOME').checked).toBe(true)
    expect(screen.getByLabelText('Budget category').value).toBe(CIGARETTES)
    expect(screen.getByText(/Budget category suggested from the name/)).toBeTruthy()
  })
})

describe('SHOP: Confirm purchase and More options', () => {
  const confirm = (cart, props = {}) =>
    renderToStaticMarkup(
      <ConfirmPurchase
        cartItems={cart}
        pantryItems={[]}
        categoryName={(id) => (id === 'appliances' ? 'Durables' : 'Dairy')}
        totalOf={(i) => i.price}
        updatePricing={async () => ({})}
        updatePayer={async () => ({})}
        toggleCart={async () => ({})}
        onClose={() => {}}
        {...props}
      />
    )
  const entry = (fields) => ({ quantity: 1, unit: 'pcs', price: 2, price_qty: 1, price_unit: 'pcs', in_cart: true, ...fields })

  it('a new name without a category asks if it is a consumable; a durable line is expense only, without the note', () => {
    const html = confirm([entry({ id: 'c1', name: 'Bonne Maman', category_id: null }), entry({ id: 'c2', name: 'Sandali', category_id: 'appliances', subcategory_id: 'appliances:footwear' })])
    expect(html).toContain('Is this a consumable? Durable items don&#x27;t go into HOME stock.')
    expect(html.match(/Is this a consumable/g)).toHaveLength(1)
    expect(html).toContain('Durables · €2.00 / pcs · expense only')
  })

  it('a line whose budget category is durable is expense only too', () => {
    const html = confirm([entry({ id: 'c1', name: 'Milk', category_id: 'dairy' })], { durableBudgetOf: () => true })
    expect(html).toContain('expense only')
    expect(html).not.toContain('new in the pantry')
  })

  it('More options: the note while no category is chosen; no 1× for a durable category', () => {
    const add = (initialName) =>
      renderToStaticMarkup(<AddItemForm parents={parents} subsByParent={subsByParent} categoryName={() => ''} pantryByName={new Map()} onAdd={async () => ({})} initialName={initialName} />)
    const unknown = add('Bonne Maman')
    expect(unknown).toContain('Is this a consumable? Durable items don&#x27;t go into HOME stock.')
    expect(unknown).toContain('One-time purchase')
    const durable = add('sandali')
    expect(durable).not.toContain('Is this a consumable?')
    expect(durable).not.toContain('One-time purchase')
  })
})

describe('SHOP list: the durable section', () => {
  const sandals = { id: 'd1', name: 'Sandali', category_id: 'appliances', subcategory_id: 'appliances:footwear', quantity: 1, unit: 'pcs', price: 20, price_qty: 1, price_unit: 'pcs', in_cart: false, completed: false, created_at: '1' }
  data.groceryList = {
    items: [sandals],
    addItem: vi.fn(),
    updatePricing: vi.fn(),
    updatePayer: vi.fn(),
    updateCategory: vi.fn(),
    deleteItem: vi.fn(),
    addVariant: vi.fn(),
    cartItems: [],
    pantryItems: [],
    pantryByName: new Map(),
    pantryFor: () => null,
    groupOf: () => null,
    reasonOf: () => 'durable',
    totalOf: (i) => i.price,
    costOf: (i) => i.price,
    sortItems: (list) => list,
    groceryItems: [],
    durableItems: [sandals],
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

  it('is titled with the stored name of the Durables tree, and says expense only', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GroceryPage />
      </MemoryRouter>
    )
    expect(html).toMatch(/<svg[^>]*>.*?<\/svg> Durables<\/p>/)
    expect(html).toContain('€20.00 to buy · not in the grocery budget · expense only, never in HOME stock')
    expect(html).not.toContain('logged under Home &amp; Appliances')
  })
})

describe('Orders: Arrived', () => {
  const order = (fields) => ({ order_date: '2026-10-20', expected_date: null, expected_until: null, status: 'on_the_way', paid_by: 'shared', price: 20, expense_id: 'e1', shop_id: null, ...fields })
  const section = () =>
    render(
      <MemoryRouter>
        <OrdersSection person="all" onPerson={() => {}} shopById={new Map()} categories={expenseCategories} mainCategories={[]} subsOf={() => []} namesOf={() => ({})} styleFor={() => ({ hex: '#000' })} />
      </MemoryRouter>
    )

  it('a durable order is marked arrived without any dialog (nothing goes into HOME)', async () => {
    data.orders = [order({ id: 'o1', item_name: 'Sneakers', category_id: 'footwear' })]
    section()
    fireEvent.click(screen.getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(markDurableArrived).toHaveBeenCalledTimes(1))
    expect(markDurableArrived.mock.calls[0][0]).toMatchObject({ id: 'o1' })
    expect(screen.queryByText('Arrived dialog: add to HOME?')).toBeNull()
  })

  it('an order from a SHOP entry in the Durables tree too; any other order still asks', async () => {
    data.grocery = [{ id: 'g1', name: 'Sandali', category_id: 'appliances', subcategory_id: 'appliances:footwear' }]
    data.orders = [order({ id: 'o2', item_name: 'Sandali', category_id: 'groceries', grocery_item_id: 'g1' })]
    section()
    fireEvent.click(screen.getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(markDurableArrived).toHaveBeenCalledTimes(1))
    cleanup()
    data.orders = [order({ id: 'o3', item_name: 'Coffee', category_id: 'groceries' })]
    section()
    fireEvent.click(screen.getByRole('button', { name: 'Arrived' }))
    // Plan 9J: the dialog opens on the order still on the way; the choice
    // made there marks it arrived.
    expect(await screen.findByText('Arrived dialog: add to HOME?')).toBeTruthy()
  })

  it('a service order too (decision 14b), marked as a service', async () => {
    data.orders = [order({ id: 'o4', item_name: 'Netflix', category_id: STREAMING })]
    section()
    fireEvent.click(screen.getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(markDurableArrived).toHaveBeenCalledTimes(1))
    expect(markDurableArrived.mock.calls[0][2]).toBe('service')
  })
})

describe('HOME: the item editor', () => {
  const editor = (name) =>
    renderToStaticMarkup(<ItemEditor parents={parents.filter((p) => p.id !== 'appliances')} allParents={parents} subsByParent={subsByParent} prefill={{ name }} onSave={() => {}} onClose={() => {}} />)

  it('warns when the name looks durable (keywords on all categories); saving stays possible', () => {
    const html = editor('sandali')
    expect(html).toContain('“sandali” looks like a durable item (Durables › Footwear). Durable items don&#x27;t go into HOME stock — record it in MONEY instead.')
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)/)
    expect(editor('Milk')).not.toContain('looks like a durable item')
  })
})
