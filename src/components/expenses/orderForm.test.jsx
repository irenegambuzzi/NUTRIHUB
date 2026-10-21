// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const flow = vi.hoisted(() => ({ ready: true }))
vi.mock('../../hooks/useFlow', () => ({ useFlow: () => flow }))
vi.mock('../../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
const { OrderForm } = await import('./OrderForm')
const { RestockForm } = await import('../inventory/RestockForm')
const { orderRowFrom } = await import('../../hooks/useOrders')

afterEach(() => {
  cleanup()
  flow.ready = true
})

const picker = { categories: [], mainCategories: [], subsOf: () => [], styleFor: () => ({}), addCategory() {}, renameCategory() {}, moveCategory() {}, deleteCategory() {} }
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const field = (label) => screen.getByLabelText(label)
const submit = () => fireEvent.submit(field('Total price').closest('form'))
const setup = (props = {}) => {
  const onSubmit = vi.fn(async () => ({ error: null }))
  render(<OrderForm {...picker} onSubmit={onSubmit} {...props} />)
  if (!props.initial) type('Item name', 'Cat Wet Food')
  return onSubmit
}

describe('the order form: quantity, unit price and total price', () => {
  it('asks for a quantity of 1 with a simple unit, a unit price and a total price, and says the total is the expense', () => {
    setup()
    expect(field('Quantity ordered').value).toBe('1')
    expect(field('Unit ordered').value).toBe('pcs')
    expect([...field('Unit ordered').options].map((o) => o.value)).toEqual(['pcs', 'box', 'pack', 'bag', 'kg', 'gr', 'L', 'ml'])
    expect(screen.getByText('Unit price (€)')).toBeTruthy()
    expect(screen.getByText('Total price (€)')).toBeTruthy()
    expect(screen.getByText(/it becomes the expense/)).toBeTruthy()
    for (const label of ['Quantity ordered', 'Unit price', 'Total price']) {
      expect(field(label).getAttribute('inputmode')).toBe('decimal')
      expect(field(label).getAttribute('type')).toBe('text')
    }
  })

  it('2 box at 6,65 each: total 13.30, saved as the order price with its quantity and unit', () => {
    const onSubmit = setup()
    type('Quantity ordered', '2')
    fireEvent.change(field('Unit ordered'), { target: { value: 'box' } })
    type('Unit price', '6,65')
    expect(field('Total price').value).toBe('13.30')
    submit()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3, quantity: 2, unit: 'box' })
    expect(orderRowFrom(onSubmit.mock.calls[0][0])).toMatchObject({ price: 13.3, quantity: 2, unit: 'box' })
  })

  it('typing only a total works out the unit price', () => {
    const onSubmit = setup()
    type('Quantity ordered', '2')
    type('Total price', '13.30')
    expect(field('Unit price').value).toBe('6.65')
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3, quantity: 2 })
  })

  it('changing the quantity after a unit price changes the total', () => {
    setup()
    type('Quantity ordered', '2')
    type('Unit price', '6,65')
    type('Quantity ordered', '3')
    expect(field('Total price').value).toBe('19.95')
    type('Quantity ordered', '1,5')
    expect(field('Total price').value).toBe('9.98')
  })

  it('warns when the two prices do not match, saves nothing, and saves the one chosen', () => {
    const onSubmit = setup()
    type('Quantity ordered', '2')
    type('Unit price', '6,65')
    type('Total price', '14')
    expect(screen.getByRole('alert').textContent).toMatch(/2 × €6\.65 is €13\.30, not €14\.00/)
    submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((a) => /don't match/.test(a.textContent)) || /choose which one is right/.test(document.body.textContent)).toBe(true)
    fireEvent.click(screen.getByText(/Total price is right/))
    expect(field('Unit price').value).toBe('7.00')
    expect(screen.queryByText(/Which one is right/)).toBeNull()
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 14, quantity: 2 })
  })

  it('"unit price is right" puts the calculated total back', () => {
    const onSubmit = setup()
    type('Quantity ordered', '2')
    type('Unit price', '6,65')
    type('Total price', '14')
    fireEvent.click(screen.getByText(/Unit price is right/))
    expect(field('Total price').value).toBe('13.30')
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3 })
  })

  it('refuses wrong numbers and no price at all', () => {
    const onSubmit = setup()
    type('Unit price', '6,6,5')
    submit()
    type('Unit price', '')
    submit()
    expect(onSubmit).not.toHaveBeenCalled()
    type('Quantity ordered', '0')
    type('Total price', '5')
    submit()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  describe('editing an existing order', () => {
    const legacy = { id: 'o1', item_name: 'Winter jacket', price: 55, quantity: null, unit: null, order_date: '2026-10-01', paid_by: 'irene', category_id: null, status: 'on_the_way', expense_id: 'e1' }

    it('shows quantity 1 and its price as the total, and saves the same price', () => {
      const onSubmit = setup({ initial: legacy })
      expect(field('Quantity ordered').value).toBe('1')
      expect(field('Total price').value).toBe('55.00')
      expect(field('Unit price').value).toBe('55.00')
      submit()
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 55, quantity: 1 })
    })

    it('keeps its total when only the quantity is set, and a saved quantity is shown as saved', () => {
      const onSubmit = setup({ initial: { ...legacy, price: 13.3, quantity: 2, unit: 'box' } })
      expect(field('Quantity ordered').value).toBe('2')
      expect(field('Unit ordered').value).toBe('box')
      expect(field('Unit price').value).toBe('6.65')
      type('Quantity ordered', '3')
      expect(field('Total price').value).toBe('13.30')
      submit()
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3, quantity: 3, unit: 'box' })
    })

    it('defaults a linked order to its purchase unit', () => {
      setup({ initial: legacy, units: ['box', 'pcs'] })
      expect(field('Unit ordered').value).toBe('box')
    })
  })

  it('starts an order from the SHOP list with its quantity, unit and total', () => {
    const onSubmit = setup({ prefill: { itemName: 'Cat Wet Food', price: 13.3, quantity: 2, unit: 'box' }, units: ['box', 'pcs'] })
    expect(field('Quantity ordered').value).toBe('2')
    expect(field('Unit ordered').value).toBe('box')
    expect(field('Total price').value).toBe('13.30')
    expect(field('Unit price').value).toBe('6.65')
    type('Quantity ordered', '3')
    expect(field('Total price').value).toBe('19.95')
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 19.95, quantity: 3, unit: 'box' })
  })

  it('before the database update asks for the total only and sends no quantity', () => {
    flow.ready = false
    const onSubmit = setup()
    expect(screen.queryByLabelText('Quantity ordered')).toBeNull()
    expect(screen.queryByLabelText('Unit price')).toBeNull()
    type('Total price', '13,30')
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3 })
    expect('quantity' in onSubmit.mock.calls[0][0]).toBe(false)
  })
})

describe('Arrived proposes the ordered quantity', () => {
  const item = { id: 'p1', name: 'Cat Wet Food', unit: 'pcs', packaging_unit: 'box', quantity_per_pack: 12 }
  const quantity = () => screen.getByLabelText('Quantity bought')
  const unit = () => screen.getByLabelText('Unit')

  it('2 box of an item with 12 pcs per box is 24 pcs, still editable', () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<RestockForm item={item} initial={{ quantity: 2, unit: 'box' }} onSubmit={onSubmit} onClose={() => {}} />)
    expect(quantity().value).toBe('2')
    expect(unit().value).toBe('box')
    expect(screen.getByText(/= 24 pcs added to the stock/)).toBeTruthy()
    fireEvent.change(quantity(), { target: { value: '1,5' } })
    expect(screen.getByText(/= 18 pcs added to the stock/)).toBeTruthy()
    fireEvent.submit(quantity().closest('form'))
    expect(onSubmit).toHaveBeenCalledWith({ delta: 18 })
  })

  it('an order in the stock unit adds exactly that', () => {
    render(<RestockForm item={item} initial={{ quantity: 5, unit: 'pcs' }} onSubmit={() => {}} onClose={() => {}} />)
    expect(quantity().value).toBe('5')
    expect(unit().value).toBe('pcs')
  })

  it('does not pass a quantity in a unit it cannot convert off as another one', () => {
    render(<RestockForm item={item} initial={{ quantity: 2, unit: 'bag' }} onSubmit={() => {}} onClose={() => {}} />)
    expect(quantity().value).toBe('1')
  })
})

describe('the order form: a discount of its own', () => {
  it('Sneakers €80 −30%: the order price is €56 (the expense), the normal price €80 and the discount are kept', () => {
    const onSubmit = setup()
    type('Total price', '80')
    type('Discount', '30')
    expect(screen.getByText('€80 → €56 (−30%)')).toBeTruthy()
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 56, listPrice: 80, discountKind: 'percent', discountValue: 30 })
    expect(orderRowFrom(onSubmit.mock.calls[0][0])).toMatchObject({ price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30 })
  })

  it('Jacket €120 −€25 → €95', () => {
    const onSubmit = setup()
    type('Total price', '120')
    fireEvent.click(screen.getByRole('button', { name: 'Discount in euros' }))
    type('Discount', '25')
    expect(screen.getByText('€120 → €95 (−€25)')).toBeTruthy()
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 95, listPrice: 120, discountKind: 'amount', discountValue: 25 })
  })

  it('a discount bigger than the price is refused with a message and nothing is saved', () => {
    const onSubmit = setup()
    type('Total price', '20')
    fireEvent.click(screen.getByRole('button', { name: 'Discount in euros' }))
    type('Discount', '25')
    submit()
    expect(screen.getAllByText('The discount (€25) is bigger than the price (€20).').length).toBeGreaterThan(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('without a discount the order is saved as before, with no list price', () => {
    const onSubmit = setup()
    type('Total price', '13,30')
    submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ price: 13.3, listPrice: null, discountKind: null, discountValue: null })
  })

  it('editing an order with a discount shows the normal price and the discount again', () => {
    setup({ initial: { id: 'o', item_name: 'Sneakers', order_date: '2026-10-20', price: 56, list_price: 80, discount_kind: 'percent', discount_value: 30, paid_by: 'irene', quantity: 1, unit: 'pcs' } })
    expect(field('Total price').value).toBe('80.00')
    expect(field('Discount').value).toBe('30')
    expect(screen.getByText('€80 → €56 (−30%)')).toBeTruthy()
  })
})
