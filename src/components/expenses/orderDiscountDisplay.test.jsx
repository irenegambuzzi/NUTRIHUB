// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { OnTheWay } = await import('../grocery/OnTheWay')
const { OrderCard } = await import('./OrderCard')
const { ExpenseRow } = await import('./EntryRows')
const { ExpenseGroup } = await import('./ExpenseGroup')
const { expenseDiscountNote, ordersByExpense } = await import('../../lib/orders')

afterEach(cleanup)

const order = {
  id: 'o1', item_name: 'Test order', order_date: '2026-10-21', price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30,
  paid_by: 'irene', status: 'on_the_way', expense_id: 'x1', grocery_item_id: 'g1', expected_date: null,
}
const plain = { ...order, price: 80, list_price: null, discount_kind: null, discount_value: null }

describe('SHOP "On the way" card of a discounted order', () => {
  const card = (o) => render(<OnTheWay entries={[{ entry: { id: 'g1', name: 'Test order', category_id: null }, order: o, pantry: null }]} shopById={new Map()} today="2026-10-21" onArrived={() => {}} onCancel={() => {}} />)

  it('shows €56.00 with €80.00 crossed out, and the line "€80.00 → €56.00 (−30%)" on the card itself', () => {
    card(order)
    expect(screen.getByText('€56.00').className).not.toContain('line-through')
    expect(screen.getByText('€80.00').className).toContain('line-through')
    const line = screen.getByText('€80.00 → €56.00 (−30%)')
    expect(line.className).toContain('text-emerald-300')
    expect(line.className).toContain('break-words')
  })

  it('a € discount: "€120.00 → €95.00 (−€25.00)"', () => {
    card({ ...order, price: 95, list_price: 120, discount_kind: 'amount', discount_value: 25 })
    expect(screen.getByText('€120.00 → €95.00 (−€25.00)')).toBeTruthy()
    expect(screen.getByText('€120.00').className).toContain('line-through')
  })

  it('an order without a discount shows only its price', () => {
    card(plain)
    expect(screen.getByText('€80.00')).toBeTruthy()
    expect(screen.queryByText(/→/)).toBeNull()
    expect(document.querySelector('.line-through')).toBeNull()
  })
})

describe('the order card in MONEY', () => {
  const card = (o, open = false) => render(<OrderCard order={o} shop={null} names={() => ({ main: null, sub: null })} today="2026-10-21" open={open} onToggle={() => {}} />)

  it('shows the paid price, the normal price crossed out and the history line without opening it', () => {
    card(order)
    expect(screen.getByText('1 · €56.00')).toBeTruthy()
    expect(screen.getByText('€80.00').className).toContain('line-through')
    expect(screen.getByText('€80.00 → €56.00 (−30%)')).toBeTruthy()
  })

  it('says it once when opened', () => {
    card(order, true)
    expect(screen.getAllByText('€80.00 → €56.00 (−30%)')).toHaveLength(1)
  })

  it('also once arrived', () => {
    card({ ...order, status: 'arrived', arrived_date: '2026-10-25' })
    expect(screen.getByText('€80.00 → €56.00 (−30%)')).toBeTruthy()
  })
})

describe('the MONEY row of the order\'s expense', () => {
  const expense = { id: 'x1', description: 'Test order', amount: 56, expense_date: '2026-10-21', paid_by: 'irene', category_id: null }
  const orders = [order]
  const noteOf = (e) => expenseDiscountNote(e, (id) => ordersByExpense(orders).get(id))
  const names = () => ({ main: null, sub: null })

  it('a single expense row shows "€80.00 → €56.00 (−30%)" in green', () => {
    render(<ExpenseRow expense={expense} names={names} noteOf={noteOf} onEdit={() => {}} onDelete={() => {}} />)
    const note = screen.getByText('€80.00 → €56.00 (−30%)')
    expect(note.className).toContain('text-emerald-300')
    expect(screen.getByText('€56.00')).toBeTruthy()
  })

  it('the day group shows it on the collapsed header (one expense) and on the opened expense', () => {
    const group = { date: '2026-10-21', main: { id: 'm', name: 'Clothing' }, items: [expense], total: 56 }
    render(<ExpenseGroup group={group} color={{ hex: '#fff' }} styleFor={() => ({ hex: '#fff' })} subName={() => null} noteOf={noteOf} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getAllByText('€80.00 → €56.00 (−30%)')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Clothing/ }))
    expect(screen.getAllByText('€80.00 → €56.00 (−30%)')).toHaveLength(2)
  })

  it('no note for an ordinary expense, or once the expense was deleted with the order (no link)', () => {
    render(<ExpenseRow expense={{ ...expense, id: 'x2' }} names={names} noteOf={noteOf} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.queryByText(/→/)).toBeNull()
  })
})
