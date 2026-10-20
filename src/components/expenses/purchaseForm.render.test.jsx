// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({
  pantry: [
    { id: 'milk', name: 'Milk', unit: 'btl', current_stock: 1, min_stock: 2, category_id: 'dairy' },
    { id: 'chips', name: 'Chips', unit: 'pack', is_group: true, current_stock: 0, category_id: 'snacks' },
    { id: 'lays', name: 'Lays', unit: 'pack', current_stock: 2, group_id: 'chips', category_id: 'snacks' },
    { id: 'tuc', name: 'Tuc', unit: 'pack', current_stock: 0, group_id: 'chips', category_id: 'snacks' },
  ],
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
vi.mock('../../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({
    suggest: (name) => ({ milk: 'dairy', shampoo: 'toiletries', chips: 'snacks' })[name.trim().toLowerCase()] ? { categoryId: { milk: 'dairy', shampoo: 'toiletries', chips: 'snacks' }[name.trim().toLowerCase()], subcategoryId: null, source: 'keywords' } : null,
    remember,
  }),
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
})
