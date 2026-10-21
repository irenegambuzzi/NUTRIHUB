// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
const merge = vi.hoisted(() => ({ mergeExpenses: vi.fn(), addToPurchase: vi.fn() }))
vi.mock('../../hooks/useMerge', () => merge)
const { PurchaseGroup } = await import('./ExpenseGroup')
const { SelectExpenses } = await import('./MergeDialog')

afterEach(() => {
  cleanup()
  merge.mergeExpenses.mockReset()
  merge.addToPurchase.mockReset()
})

const groceries = { id: 'g', name: 'Groceries' }
const pets = { id: 'p', name: 'Pets' }
const mainOf = (id) => ({ g: groceries, 'g:bread': groceries, p: pets })[id] ?? null
const subName = (id) => (id === 'g:bread' ? 'Bakery' : null)
const colors = { g: '#22C55E', 'g:bread': '#22C55E', p: '#F97316' }
const styleFor = (id) => ({ hex: colors[id] ?? '#888888' })
const bread = { id: 'e1', trip_id: 't1', category_id: 'g:bread', amount: 2.5, paid_by: 'irene', expense_date: '2026-10-14', description: 'Bread' }
const cat = { id: 'e2', trip_id: 't1', category_id: 'p', amount: 20, paid_by: 'irene', expense_date: '2026-10-14', description: 'Cat food' }
const trip = { id: 't1', trip_date: '2026-10-14', source: 'money', shop_id: 'conad' }
const row = (props) =>
  render(
    <PurchaseGroup
      group={{ date: '2026-10-14', items: [bread, cat], total: 22.5 }}
      trip={trip}
      shop={{ id: 'conad', name: 'Conad' }}
      mainOf={mainOf}
      subName={subName}
      styleFor={styleFor}
      lineOf={(e) => (e.id === 'e1' ? { quantity: 2, unit: 'pcs' } : null)}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onChangeStore={vi.fn()}
      onUndo={vi.fn()}
      {...props}
    />
  )

describe('a purchase in the MONEY list', () => {
  it('is one row: store · date · total, one dot per main category in the main colour', () => {
    const { container } = row()
    const header = screen.getByRole('button', { name: /Conad · 14\/10\/2026/ })
    expect(header.textContent).toContain('€22.50')
    expect(header.textContent).toContain('2 items · Irene')
    const dots = header.querySelectorAll('[data-dot="main"]')
    expect([...dots].map((d) => d.style.background)).toEqual(['rgb(34, 197, 94)', 'rgb(249, 115, 22)'])
    expect(container.querySelectorAll('[data-purchase]')).toHaveLength(1)
  })

  it('a line saved without a budget category carries the grey "No category" label', () => {
    const loose = { id: 'e3', trip_id: 't1', category_id: null, amount: 1, paid_by: 'irene', expense_date: '2026-10-14', description: 'Mystery' }
    row({ group: { date: '2026-10-14', items: [bread, loose], total: 3.5 } })
    fireEvent.click(screen.getByRole('button', { name: /Conad/ }))
    expect(screen.getAllByText('No category')).toHaveLength(1)
  })

  it('opened: items by main category with subtotals, each with sub-category, quantity and amount', () => {
    const { container } = row()
    fireEvent.click(screen.getByRole('button', { name: /Conad/ }))
    const text = container.textContent
    expect(text.indexOf('Groceries')).toBeLessThan(text.indexOf('Pets'))
    expect(text).toContain('Groceries€2.50')
    expect(text).toContain('Pets€20.00')
    expect(text).toMatch(/Bakery·2 pcs·Irene/)
    const sub = container.querySelector('[data-dot="sub"]')
    expect(sub.className).toContain('w-[5px] h-[5px]')
    expect(screen.getAllByLabelText('Edit expense')).toHaveLength(2)
    expect(screen.getByText(/Change the store of the whole purchase/)).toBeTruthy()
    expect(screen.getByText('Undo purchase')).toBeTruthy()
  })

  it('a purchase with a coupon says "(coupon −€50)" next to its total', () => {
    row({ trip: { ...trip, coupon_kind: 'amount', coupon_value: 50, coupon_total: 50 }, group: { date: '2026-10-14', items: [bread, cat], total: 150 } })
    const header = screen.getByRole('button', { name: /Conad/ })
    expect(header.textContent).toContain('€150.00')
    expect(header.textContent).toContain('(coupon −€50)')
  })

  it('opened, a discounted item shows its history "€6.00 → €3.00 (−50%)" and the coupon share', () => {
    const lines = {
      e1: { quantity: 1, unit: 'pcs', list_total: 6, item_discount_kind: 'percent', item_discount_value: 50, coupon_share: 0 },
      e2: { quantity: 1, unit: 'pcs', list_total: 20, item_discount_kind: null, item_discount_value: null, coupon_share: 5 },
    }
    row({ lineOf: (e) => lines[e.id] })
    fireEvent.click(screen.getByRole('button', { name: /Conad/ }))
    expect(screen.getByText('€6.00 → €3.00 (−50%)')).toBeTruthy()
    expect(screen.getByText('€20.00 → €15.00 (coupon −€5.00)')).toBeTruthy()
  })

  it('with a category filter on, only that part "of total €22.50"', () => {
    row({ group: { date: '2026-10-14', items: [cat], total: 20 }, fullTotal: 22.5 })
    const header = screen.getByRole('button', { name: /Conad/ })
    expect(header.textContent).toContain('€20.00')
    expect(header.textContent).toContain('of total €22.50')
    expect(header.querySelectorAll('[data-dot="main"]')).toHaveLength(1)
  })

  it('shows Reopen for SHOP and Split for merged expenses (never Reopen there)', () => {
    row({ trip: { ...trip, source: 'shop' } })
    fireEvent.click(screen.getByRole('button', { name: /Conad/ }))
    expect(screen.getByText('Reopen purchase')).toBeTruthy()
    cleanup()
    row({ trip: { ...trip, source: 'merged' }, group: { date: '2026-10-14', items: [{ ...bread, merged_at: 'x' }, { ...cat, merged_at: 'x' }], total: 22.5 } })
    fireEvent.click(screen.getByRole('button', { name: /Conad/ }))
    expect(screen.getByText('Split')).toBeTruthy()
    expect(screen.queryByText('Reopen purchase')).toBeNull()
    expect(screen.queryByText('Undo purchase')).toBeNull()
  })
})

describe('Select → Merge into one purchase', () => {
  const names = (id) => ({ main: mainOf(id)?.name ?? null, sub: subName(id) })
  const shopOf = (id) => (id ? { id, name: id } : undefined)
  const single = (id, patch = {}) => ({ id, amount: 3, category_id: 'g', paid_by: 'irene', expense_date: '2026-10-14', shop_id: null, description: id, ...patch })
  const select = (expenses, extra = {}) => render(<SelectExpenses expenses={expenses} orderExpenseIds={new Set(['order'])} names={names} shopOf={shopOf} trips={[]} allExpenses={expenses} onDone={vi.fn()} {...extra} />)

  it('purchase and order expenses have no tick box', () => {
    select([single('a'), single('in-trip', { trip_id: 't1' }), single('order')])
    expect(screen.getByLabelText('Select a')).toBeTruthy()
    expect(screen.queryByLabelText('Select in-trip')).toBeNull()
    expect(screen.queryByLabelText('Select order')).toBeNull()
    expect(screen.getByText(/In a purchase/)).toBeTruthy()
    expect(screen.getByText(/Online order/)).toBeTruthy()
  })

  it('explains why expenses of different days can\'t be merged', () => {
    select([single('a'), single('b', { expense_date: '2026-10-15' })])
    fireEvent.click(screen.getByLabelText('Select a'))
    fireEvent.click(screen.getByLabelText('Select b'))
    expect(screen.getByRole('button', { name: /Merge into one purchase/ }).disabled).toBe(true)
    expect(screen.getByText(/Only expenses of the same day can be merged/)).toBeTruthy()
  })

  it('asks for the store when they have none, then merges with one id', async () => {
    merge.mergeExpenses.mockResolvedValue({ error: null })
    select([single('a', { shop_id: 'conad' }), single('b')])
    fireEvent.click(screen.getByLabelText('Select a'))
    fireEvent.click(screen.getByLabelText('Select b'))
    fireEvent.click(screen.getByRole('button', { name: /Merge into one purchase/ }))
    expect(screen.getByText(/These expenses have different stores/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(await screen.findByText('Choose the store for this purchase.')).toBeTruthy()
    expect(merge.mergeExpenses).not.toHaveBeenCalled()
  })

  it('prefills the store they share and sends it', async () => {
    merge.mergeExpenses.mockResolvedValue({ error: null })
    select([single('a', { shop_id: 'conad' }), single('b', { shop_id: 'conad' })])
    fireEvent.click(screen.getByLabelText('Select a'))
    fireEvent.click(screen.getByLabelText('Select b'))
    fireEvent.click(screen.getByRole('button', { name: /Merge into one purchase/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await vi.waitFor(() => expect(merge.mergeExpenses).toHaveBeenCalledTimes(1))
    expect(merge.mergeExpenses.mock.calls[0][0]).toMatchObject({ expenseIds: ['a', 'b'], shopId: 'conad', total: 6 })
  })

  it('one expense can be added to an existing purchase of that day and payer', async () => {
    merge.addToPurchase.mockResolvedValue({ error: null })
    const inTrip = single('x', { trip_id: 't1' })
    select([single('a')], { trips: [{ id: 't1', trip_date: '2026-10-14', paid_by: 'irene', shop_id: 'conad', total: 9 }], allExpenses: [single('a'), inTrip] })
    fireEvent.click(screen.getByLabelText('Select a'))
    fireEvent.click(screen.getByRole('button', { name: /Merge into one purchase/ }))
    expect(screen.getByText(/conad · 14\/10\/2026 · €9.00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to purchase' }))
    await vi.waitFor(() => expect(merge.addToPurchase).toHaveBeenCalledWith({ tripId: 't1', expenseIds: ['a'], total: 3 }))
  })
})
