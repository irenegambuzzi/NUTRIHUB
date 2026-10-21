// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({
  pantry: [
    { id: 'milk', name: 'Milk', unit: 'btl', current_stock: 1, min_stock: 2, category_id: 'dairy' },
    { id: 'chips', name: 'Chips', unit: 'pack', is_group: true, current_stock: 0, category_id: 'snacks' },
    { id: 'lays', name: 'Lays', unit: 'pack', current_stock: 2, group_id: 'chips', category_id: 'snacks' },
    { id: 'tuc', name: 'Tuc', unit: 'pack', current_stock: 0, group_id: 'chips', category_id: 'snacks' },
  ],
  last: null,
  grocery: [{ id: 'g-milk', name: 'Milk', pantry_item_id: 'milk', completed: false, in_cart: false }],
}))
const fake = (rows) => ({ useRows: () => ({ rows, loaded: true }) })
vi.mock('../../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(data.pantry),
  groceryStore: fake(data.grocery),
  orderStore: fake([]),
  budgetMapStore: fake([]),
  inventoryCategoryStore: fake([{ id: 'dairy', name: 'Dairy' }, { id: 'toiletries', name: 'Toiletries' }, { id: 'snacks', name: 'Snacks' }]),
}))
vi.mock('../../hooks/useInventoryCategories', () => {
  const parents = [
    { id: 'dairy', name: 'Dairy', type: 'parent' },
    { id: 'toiletries', name: 'Toiletries', type: 'parent' },
    { id: 'snacks', name: 'Snacks', type: 'parent' },
  ]
  return { useInventoryCategories: () => ({ parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }) }
})
const remember = vi.fn()
const rememberBudget = vi.fn()
// What the suggestion door answers for a few names (lib/categorySuggest.js
// has its own tests): HOME chips, and budget chips for a row not added to HOME.
const homeChip = (categoryId, label) => ({ categoryId, subcategoryId: null, expenseCategoryId: null, source: 'keywords', label })
const HOME_CHIPS = { milk: [homeChip('dairy', 'Dairy')], shampoo: [homeChip('toiletries', 'Toiletries'), homeChip('dairy', 'Dairy')], chips: [homeChip('snacks', 'Snacks')] }
const BUDGET_CHIPS = { gift: [{ categoryId: null, subcategoryId: null, expenseCategoryId: 'dining', source: 'name', label: 'Dining' }] }
vi.mock('../../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({
    suggest: (name) => HOME_CHIPS[name.trim().toLowerCase()]?.[0] ? { ...HOME_CHIPS[name.trim().toLowerCase()][0], subcategoryId: null } : null,
    suggestions: (name) => HOME_CHIPS[name.trim().toLowerCase()] ?? [],
    budgetSuggestions: (name) => BUDGET_CHIPS[name.trim().toLowerCase()] ?? [],
    remember,
    rememberBudget,
  }),
}))
vi.mock('../../hooks/useLastPrice', () => ({ useLastPrice: () => data.last }))
vi.mock('../../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const recordMoneyPurchase = vi.fn()
vi.mock('../../hooks/usePurchase', () => ({ recordMoneyPurchase: (...args) => recordMoneyPurchase(...args) }))
const addExpenseOnce = vi.fn()
vi.mock('../../hooks/useExpenses', () => ({ addExpenseOnce: (...args) => addExpenseOnce(...args) }))

const { PurchaseForm } = await import('./PurchaseForm')

afterEach(() => {
  cleanup()
  recordMoneyPurchase.mockReset()
  addExpenseOnce.mockReset()
  remember.mockReset()
  rememberBudget.mockReset()
  data.last = null
})

const expenseCategories = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'dining', name: 'Dining', parent_id: null },
]
const form = (props = {}) =>
  render(
    <PurchaseForm
      expenseCategories={expenseCategories}
      mainCategories={expenseCategories}
      subsOf={() => []}
      addCategory={vi.fn()}
      renameCategory={vi.fn()}
      moveCategory={vi.fn()}
      deleteCategory={vi.fn()}
      styleFor={() => ({ hex: '#000' })}
      onClose={vi.fn()}
      {...props}
    />
  )
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('MONEY Add expense: the purchase form', () => {
  it('one row that is only an expense is one plain expense, as before', async () => {
    addExpenseOnce.mockResolvedValue({ error: null })
    form()
    type('Name', 'Dinner out')
    type('Price', '13,60')
    type('Budget category', 'dining')
    expect(screen.getByLabelText('Add to HOME').checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add expense · €13.60' }))
    await waitFor(() => expect(addExpenseOnce).toHaveBeenCalledTimes(1))
    expect(addExpenseOnce.mock.calls[0][0]).toMatchObject({ amount: 13.6, description: 'Dinner out', categoryId: 'dining', paidBy: 'shared' })
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
  })

  it('two rows with Add to HOME off are one purchase of two expenses; pressing Save again sends the same id', async () => {
    recordMoneyPurchase.mockResolvedValueOnce({ error: new Error('offline') }).mockResolvedValueOnce({ error: null })
    form()
    type('Name', 'Test bread')
    type('Price', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    type('Name of item 2', 'Shampoo')
    type('Price of item 2', '4')
    // Shampoo has a HOME category: Add to HOME starts on; switched off here.
    expect(screen.getByLabelText('Add to HOME of item 2').checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Add to HOME of item 2'))
    const save = screen.getByRole('button', { name: 'Save purchase · €6.00' })
    fireEvent.click(save)
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    fireEvent.click(save)
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(2))
    const [first, second] = recordMoneyPurchase.mock.calls.map((c) => c[0].payload)
    expect(second.id).toBe(first.id)
    expect(first.items.map((i) => [i.name, i.line_total, i.durable])).toEqual([
      ['Test bread', 2, true],
      ['Shampoo', 4, true],
    ])
  })

  it('Sneakers €80 with −30% shows "€80 → €56 (−30%)" and is saved as a one-line purchase of €56 (nothing goes to HOME)', async () => {
    recordMoneyPurchase.mockResolvedValue({ error: null })
    form()
    type('Name', 'Test sneakers')
    type('Price', '80')
    type('Discount', '30')
    expect(screen.getByText('€80 → €56 (−30%)')).toBeTruthy()
    expect(screen.queryByLabelText('Purchase discount')).toBeNull() // one item: no coupon
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase · €56.00' }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(addExpenseOnce).not.toHaveBeenCalled()
    const [item] = recordMoneyPurchase.mock.calls[0][0].payload.items
    expect(item).toMatchObject({ name: 'Test sneakers', price: 80, line_total: 56, list_total: 80, item_discount_kind: 'percent', item_discount_value: 30, durable: true })
  })

  it('a discount bigger than the price is refused with a message, nothing is sent', async () => {
    form()
    type('Name', 'Test jacket')
    type('Price', '20')
    fireEvent.click(screen.getByRole('button', { name: 'Discount in euros' }))
    type('Discount', '25')
    expect(screen.getByText('The discount (€25) is bigger than the price (€20).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add expense|Save purchase/ }))
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
    expect(addExpenseOnce).not.toHaveBeenCalled()
  })

  it('three rows €120 + €60 + €20 with a Purchase discount of −€50: €90 + €45 + €15 = €150, sent with the coupon', async () => {
    recordMoneyPurchase.mockResolvedValue({ error: null })
    form()
    for (const [n, name, price] of [[null, 'Test one', '120'], [2, 'Test two', '60'], [3, 'Test three', '20']]) {
      if (n) fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
      type(n ? `Name of item ${n}` : 'Name', name)
      type(n ? `Price of item ${n}` : 'Price', price)
    }
    expect(screen.getByLabelText('Purchase discount')).toBeTruthy()
    type('Purchase discount', '50')
    // under each item row, live, in green…
    const preview = (text) => screen.getAllByText(text).find((el) => el.tagName === 'P')
    expect(preview('€120.00 → €90.00 (coupon −€30.00)').className).toContain('text-emerald-300')
    expect(preview('€60.00 → €45.00 (coupon −€15.00)')).toBeTruthy()
    expect(preview('€20.00 → €15.00 (coupon −€5.00)')).toBeTruthy()
    // …wrapping instead of being cut off on a narrow screen…
    expect(preview('€120.00 → €90.00 (coupon −€30.00)').className).toContain('break-words')
    // …and repeated by item name in the Purchase discount box
    const box = within(screen.getByRole('list', { name: 'Each item after the purchase discount' }))
    expect(box.getByText('Test one:')).toBeTruthy()
    expect(box.getByText('€120.00 → €90.00 (coupon −€30.00)')).toBeTruthy()
    expect(box.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase · €150.00' }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    const { payload } = recordMoneyPurchase.mock.calls[0][0]
    expect(payload).toMatchObject({ coupon_kind: 'amount', coupon_value: 50, coupon_total: 50 })
    expect(payload.items.map((i) => [i.list_total, i.line_total, i.coupon_share])).toEqual([[120, 90, 30], [60, 45, 15], [20, 15, 5]])
  })

  it('an item discount and a coupon together: "€80.00 → €56.00 (−30%) · coupon −€x → €y" under that row', () => {
    form()
    type('Name', 'Test sneakers')
    type('Price', '80')
    type('Discount', '30')
    expect(screen.getByText('€80 → €56 (−30%)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    type('Name of item 2', 'Test socks')
    type('Price of item 2', '44')
    type('Purchase discount', '10')
    expect(screen.getByText('€80.00 → €56.00 (−30%) · coupon −€5.60 → €50.40', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('€44.00 → €39.60 (coupon −€4.40)', { selector: 'p' })).toBeTruthy()
  })

  it('a coupon with only one item row shows no coupon preview (the box only exists from two items)', () => {
    form()
    type('Name', 'Test one')
    type('Price', '20')
    expect(screen.queryByLabelText('Purchase discount')).toBeNull()
    expect(screen.queryByText(/coupon/)).toBeNull()
  })

  it('typing a name again fills the NORMAL price, never the discounted one', () => {
    data.last = { price: 6, quantity: 1, unit: 'pcs' }
    form()
    type('Name', 'Nutella')
    expect(screen.getByLabelText('Price').value).toBe('6.00')
  })

  it('an existing HOME item says where the stock goes and that its SHOP entry leaves the list', () => {
    form()
    type('Name', 'Milk')
    expect(screen.getByLabelText('Add to HOME').checked).toBe(true)
    expect(screen.getByText('Adds to "Milk" in HOME (+1 btl).')).toBeTruthy()
    expect(screen.getByText('On your SHOP list — it will leave the list.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    expect(screen.getByText('On your SHOP list — it stays there (Add to HOME is off).')).toBeTruthy()
  })

  it('a group asks for the variant inline (the first at 0 is taken)', () => {
    form()
    type('Name', 'Chips')
    expect(screen.getByLabelText('Variant').value).toBe('tuc')
    expect(screen.getByText('Adds to "Tuc" in HOME (+1 pack).')).toBeTruthy()
  })

  it('a new HOME item has 1× and Min; Min hides while 1× is on', () => {
    form()
    type('Name', 'Shampoo')
    expect(screen.getByText('New in HOME (shown as New Item).')).toBeTruthy()
    expect(screen.getByLabelText('Minimum stock').value).toBe('0')
    fireEvent.click(screen.getByRole('checkbox', { name: /One-time purchase/ }))
    expect(screen.queryByLabelText('Minimum stock')).toBeNull()
  })

  it('says what is missing instead of saving', async () => {
    form()
    type('Name', 'Milk')
    fireEvent.click(screen.getByRole('button', { name: /Add expense|Save purchase/ }))
    expect(await screen.findAllByText('Enter the price (0 if it was free).')).toHaveLength(2)
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
  })

  it('chips under the name: tapping one fills the HOME category and the budget category follows the mapping', () => {
    form()
    type('Name', 'Shampoo')
    // the first chip is what the name already filled in; tap the second
    expect(screen.getByRole('button', { name: 'Toiletries' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Dairy' }))
    expect(screen.getByLabelText('Item category').value).toBe('dairy')
    expect(screen.getByLabelText('Budget category').value).toBe('groceries')
    expect(screen.getByRole('button', { name: 'Dairy' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a pick other than the first chip is remembered for the name (with the chips that were on offer)', async () => {
    recordMoneyPurchase.mockResolvedValue({ error: null })
    form()
    type('Name', 'Shampoo')
    type('Price', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Dairy' }))
    fireEvent.click(screen.getByRole('button', { name: /Add expense|Save purchase/ }))
    await waitFor(() => expect(remember).toHaveBeenCalledTimes(1))
    expect(remember.mock.calls[0].slice(0, 3)).toEqual(['Shampoo', 'dairy', null])
    expect(remember.mock.calls[0][3].chips).toHaveLength(2)
  })

  it('a row with Add to HOME off gets budget chips; the pick is its budget category and is remembered as such', async () => {
    addExpenseOnce.mockResolvedValue({ error: null })
    form()
    type('Name', 'Gift')
    expect(screen.getByLabelText('Add to HOME').checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Dining' }))
    expect(screen.getByLabelText('Budget category').value).toBe('dining')
    type('Price', '10')
    fireEvent.click(screen.getByRole('button', { name: 'Add expense · €10.00' }))
    await waitFor(() => expect(addExpenseOnce).toHaveBeenCalledTimes(1))
    expect(addExpenseOnce.mock.calls[0][0]).toMatchObject({ categoryId: 'dining', description: 'Gift' })
    expect(rememberBudget.mock.calls[0].slice(0, 2)).toEqual(['Gift', 'dining'])
    expect(remember).not.toHaveBeenCalled()
  })

  it('"+ New category" is offered under the name, as an inline row (no popup)', () => {
    form()
    expect(screen.queryByRole('button', { name: /New category/ })).toBeNull()
    type('Name', 'Zzz thing')
    expect(screen.getByRole('button', { name: /New category/ })).toBeTruthy()
  })

  it('an item bought before fills in the last normal price and its unit; typing a price by hand stops it', () => {
    data.last = { price: 2.5, quantity: 500, unit: 'gr', source: 'trip', at: 1 }
    form()
    type('Name', 'Rice')
    expect(screen.getByLabelText('Price').value).toBe('2.50')
    expect(screen.getByLabelText('Quantity').value).toBe('500')
    expect(screen.getByLabelText('Unit').value).toBe('gr')
    type('Price', '3')
    data.last = { price: 9, quantity: 1, unit: 'kg', source: 'trip', at: 2 }
    type('Name', 'Rice 2')
    expect(screen.getByLabelText('Price').value).toBe('3')
  })
})
