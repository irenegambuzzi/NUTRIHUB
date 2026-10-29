// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
// Order groups (supabase/028) not loaded here: the order form offers nothing.
vi.mock('../../hooks/useOrderGroups', async (original) => ({ ...(await original()), useOrderGroups: () => ({ ready: false, groups: [], orders: [], byId: new Map() }) }))
vi.mock('../../hooks/useFlow', () => ({ useFlow: () => ({ ready: true }) }))
vi.mock('../../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
const { ExpenseForm } = await import('./ExpenseForm')
const { IncomeForm } = await import('./IncomeForm')
const { OrderForm } = await import('./OrderForm')
const { DECIMAL_MESSAGE } = await import('../../lib/decimal')
const { categoryTree } = await import('../../lib/moneyList')

afterEach(cleanup)

const picker = { categories: [], mainCategories: [], subsOf: () => [], styleFor: () => ({}), addCategory() {}, renameCategory() {}, moveCategory() {}, deleteCategory() {} }
const tree = { mainCategories: [{ id: 'salary', name: 'Salary' }], mainOf: () => null, subsOf: () => [] }

const forms = [
  {
    name: 'an expense',
    label: 'Amount (€)',
    render: (onSubmit, initial) => render(<ExpenseForm {...picker} initial={initial} onSubmit={onSubmit} />),
    value: (call) => call[0].amount,
    initial: { amount: 13.6, category_id: null, description: '', paid_by: 'shared', expense_date: '2026-10-17' },
  },
  {
    name: 'an income',
    label: 'Amount (€)',
    render: (onSubmit, initial) => render(<IncomeForm tree={tree} submitLabel="Add" initial={initial} onSubmit={onSubmit} />),
    value: (call) => call[0].amount,
    initial: { amount: 13.6, income_date: '2026-10-17', category_id: null, received_by: 'shared', source: '' },
  },
  {
    name: 'an order total price',
    label: 'Total price',
    render: (onSubmit, initial) => {
      const view = render(<OrderForm {...picker} initial={initial} onSubmit={onSubmit} />)
      if (!initial) fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Jacket' } })
      return view
    },
    value: (call) => call[0].price,
    initial: { item_name: 'Jacket', price: 13.6, order_date: '2026-10-17', paid_by: 'shared', category_id: null },
  },
]

describe.each(forms)('the money field of $name', (form) => {
  const field = () => screen.getByLabelText(form.label)
  const submit = () => fireEvent.submit(field().closest('form'))

  it('is a text field with the decimal keyboard on phones', () => {
    form.render(vi.fn())
    expect(field().getAttribute('type')).toBe('text')
    expect(field().getAttribute('inputmode')).toBe('decimal')
  })

  it.each(['13,60', '13.60', '13,6', '13.6'])('saves %s as 13.6', async (typed) => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    form.render(onSubmit)
    fireEvent.change(field(), { target: { value: typed } })
    submit()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(form.value(onSubmit.mock.calls[0])).toBe(13.6)
  })

  it.each(['13,6,0', '13.6.0', '1.360,50', '13a', 'abc'])('refuses %s with a short message, and saves nothing', (typed) => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    form.render(onSubmit)
    fireEvent.change(field(), { target: { value: typed } })
    expect(screen.getByRole('alert').textContent).toBe(DECIMAL_MESSAGE)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    submit()
    expect(onSubmit).not.toHaveBeenCalled()
    // What was typed stays as typed.
    expect(field().value).toBe(typed)
  })

  it('shows a saved amount with two decimals, and the same number is saved when nothing changes', () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    form.render(onSubmit, form.initial)
    expect(field().value).toBe('13.60')
    submit()
    expect(form.value(onSubmit.mock.calls[0])).toBe(13.6)
  })
})

describe('round 6C2: edit expense and income pick main | sub, and keep saving one id', () => {
  const money = [
    { id: 'trips', name: 'Trips & Holidays', parent_id: null },
    { id: 'flights', name: 'Flights', parent_id: 'trips' },
    { id: 'bank', name: 'Bank & Fee', parent_id: null },
  ]

  it('an expense in a sub-category opens with both columns filled; changing the main resets the sub', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    const tree = categoryTree(money)
    render(<ExpenseForm {...picker} categories={money} mainCategories={tree.mainCategories} subsOf={tree.subsOf} initial={{ amount: 40, category_id: 'flights', description: 'Ryanair', paid_by: 'shared', expense_date: '2026-10-17' }} onSubmit={onSubmit} />)
    expect(screen.getByLabelText('Budget category').value).toBe('trips')
    expect(screen.getByLabelText('Budget category: sub-category').value).toBe('flights')
    fireEvent.change(screen.getByLabelText('Budget category'), { target: { value: 'bank' } })
    expect(screen.getByLabelText('Budget category: sub-category').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Save|Update|Add/ }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].categoryId).toBe('bank')
  })

  it('income: no "Uncategorized", and a sub is the id saved', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    const incomeTree = categoryTree([
      { id: 'salary', name: 'Salary', parent_id: null },
      { id: 'other', name: 'Other', parent_id: null },
      { id: 'refunds', name: 'Refunds', parent_id: 'other' },
    ])
    render(<IncomeForm tree={incomeTree} submitLabel="Add income" onSubmit={onSubmit} />)
    expect([...screen.getByLabelText('Income category').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Salary', 'Other'])
    fireEvent.change(screen.getByLabelText('Income category'), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText('Income category: sub-category'), { target: { value: 'refunds' } })
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].categoryId).toBe('refunds')
  })
})
