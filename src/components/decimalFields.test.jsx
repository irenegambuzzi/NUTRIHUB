// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({ useCategorySuggestions: () => ({ suggest: () => null, remember: () => {} }) }))
vi.mock('../hooks/usePurchase', () => ({ usePurchase: () => ({ confirmPurchase: vi.fn(async () => ({ error: null })) }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
const { DECIMAL_MESSAGE } = await import('../lib/decimal')
const { BudgetCard } = await import('./grocery/BudgetCard')
const { PriceFields } = await import('./inventory/PriceFields')
const { RestockForm } = await import('./inventory/RestockForm')
const { GroceryItemTile } = await import('./grocery/GroceryItemTile')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { PriceCheck } = await import('./grocery/PriceCheck')
const { lineTotal } = await import('../lib/pricing')

afterEach(cleanup)

const parents = [{ id: 'misc', name: 'Misc' }]
const subsByParent = new Map()
const alert = () => screen.queryByRole('alert')
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const isDecimalText = (el) => el.getAttribute('type') === 'text' && el.getAttribute('inputmode') === 'decimal'

describe('the budget', () => {
  const setup = () => {
    const onSave = vi.fn(async () => ({ error: null }))
    render(<BudgetCard budget={null} listTotal={0} boughtTotal={0} payerTotals={[]} overBudget={false} unpricedCount={0} unknownTotalCount={0} onSave={onSave} />)
    fireEvent.click(screen.getByText('Set a budget'))
    return onSave
  }
  it.each(['120,50', '120.50'])('saves %s as 120.5', (typed) => {
    const onSave = setup()
    expect(isDecimalText(screen.getByLabelText('Budget (€)'))).toBe(true)
    type('Budget (€)', typed)
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith(120.5)
  })
  it('refuses 12,5,0 with a message', () => {
    const onSave = setup()
    type('Budget (€)', '12,5,0')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('price fields (SHOP list entry, new item, item editor)', () => {
  function Harness({ line }) {
    const [value, setValue] = useState({ price: '', price_qty: '1', price_unit: 'kg' })
    return (
      <>
        <PriceFields value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} unitOptions={['kg', 'gr']} line={line} />
        <output data-testid="price">{value.price}</output>
      </>
    )
  }
  it('takes a unit price and a "per" quantity with comma or dot', () => {
    render(<Harness />)
    expect(isDecimalText(screen.getByLabelText('Unit price (€)'))).toBe(true)
    expect(isDecimalText(screen.getByLabelText('Price per quantity'))).toBe(true)
    type('Unit price (€)', '13,60')
    type('Price per quantity', '0,5')
    expect(screen.getByTestId('price').textContent).toBe('13,60')
    expect(alert()).toBeNull()
    type('Price per quantity', '0,5,5')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
  })
  it('turns a typed total into a unit price, and keeps wrong text for Save to refuse', () => {
    render(<Harness line={{ quantity: 2, unit: 'kg' }} />)
    fireEvent.click(screen.getByText('Total price'))
    expect(isDecimalText(screen.getByLabelText('Total price (€)'))).toBe(true)
    type('Total price (€)', '13,60')
    expect(screen.getByTestId('price').textContent).toBe('6.80')
    type('Total price (€)', '13,6,0')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    expect(screen.getByTestId('price').textContent).toBe('13,6,0')
  })
})

describe('adding stock by hand', () => {
  const item = { id: 'i1', name: 'Rice', unit: 'kg', packaging_unit: null, quantity_per_pack: null }
  it.each([
    ['1,5', 1.5],
    ['1.5', 1.5],
  ])('%s adds %s', (typed, delta) => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<RestockForm item={item} onSubmit={onSubmit} onClose={() => {}} />)
    expect(isDecimalText(screen.getByLabelText('Quantity bought'))).toBe(true)
    type('Quantity bought', typed)
    fireEvent.submit(screen.getByLabelText('Quantity bought').closest('form'))
    expect(onSubmit).toHaveBeenCalledWith({ delta })
  })
  it('refuses 1,5,5', () => {
    const onSubmit = vi.fn()
    render(<RestockForm item={item} onSubmit={onSubmit} onClose={() => {}} />)
    type('Quantity bought', '1,5,5')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    fireEvent.submit(screen.getByLabelText('Quantity bought').closest('form'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('editing a SHOP list entry', () => {
  const entry = { id: 'g1', name: 'Cheese', category_id: 'misc', quantity: 1, unit: 'kg', price: 4.2, price_qty: 1, price_unit: 'kg', completed: false, in_cart: false }
  const setup = () => {
    const onUpdatePricing = vi.fn(async () => ({ error: null }))
    render(
      <GroceryItemTile item={entry} reason={null} total={4.2} categoryName={() => 'Misc'} onToggle={() => {}} onDelete={() => {}} onUpdatePricing={onUpdatePricing} onUpdatePayer={() => {}} />
    )
    fireEvent.click(screen.getByTitle('Type the quantity'))
    return onUpdatePricing
  }
  it('shows the saved price with two decimals', () => {
    setup()
    expect(screen.getByLabelText('Unit price (€)').value).toBe('4.20')
  })
  it('saves quantity 0,5 and price 13,60 as 0.5 and 13.6', () => {
    const onUpdatePricing = setup()
    expect(isDecimalText(screen.getByLabelText('Quantity'))).toBe(true)
    type('Quantity', '0,5')
    type('Unit price (€)', '13,60')
    fireEvent.click(screen.getByText('Save'))
    expect(onUpdatePricing.mock.calls[0][1]).toMatchObject({ quantity: 0.5, price: 13.6 })
  })
  it('does not save 13,6,0', () => {
    const onUpdatePricing = setup()
    type('Unit price (€)', '13,6,0')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    fireEvent.click(screen.getByText('Save'))
    expect(onUpdatePricing).not.toHaveBeenCalled()
  })
})

describe('a new SHOP list item', () => {
  const setup = () => {
    const onAdd = vi.fn(async () => ({ error: null }))
    render(<AddItemForm parents={parents} subsByParent={subsByParent} categoryName={() => 'Misc'} pantryByName={new Map()} onAdd={onAdd} onAddCategory={() => {}} onAddSubcategory={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Olive oil' } })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'misc' } })
    return onAdd
  }
  it('saves quantity 1,5 and price 13,60 as 1.5 and 13.6', () => {
    const onAdd = setup()
    expect(isDecimalText(screen.getByLabelText('Quantity'))).toBe(true)
    type('Quantity', '1,5')
    type('Unit price (€)', '13,60')
    fireEvent.submit(screen.getByLabelText('Quantity').closest('form'))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ quantity: 1.5, price: 13.6 })
  })
  it('does not add with a price of 13,6,0 or a quantity of 1,,5', () => {
    const onAdd = setup()
    type('Unit price (€)', '13,6,0')
    fireEvent.submit(screen.getByLabelText('Quantity').closest('form'))
    type('Unit price (€)', '13,60')
    type('Quantity', '1,,5')
    fireEvent.submit(screen.getByLabelText('Quantity').closest('form'))
    expect(onAdd).not.toHaveBeenCalled()
    // And leaving the quantity field does not swap the wrong text for 1.
    fireEvent.blur(screen.getByLabelText('Quantity'))
    expect(screen.getByLabelText('Quantity').value).toBe('1,,5')
  })
})

describe('the item editor (HOME)', () => {
  const item = { id: 'p1', name: 'Rice', category_id: 'misc', unit: 'kg', current_stock: 2, min_stock: 1, price: 3.5, price_qty: 1, price_unit: 'kg', packaging_unit: 'bag', quantity_per_pack: 2.5 }
  const setup = (props = {}) => {
    const onSave = vi.fn(async () => ({ error: null }))
    render(<ItemEditor item={item} parents={parents} subsByParent={subsByParent} onAddCategory={() => {}} onAddSubcategory={() => {}} onSave={onSave} onClose={() => {}} {...props} />)
    return { onSave, form: () => screen.getByText('Current stock').closest('form') }
  }
  it('shows existing numbers as they were saved and saves them unchanged', () => {
    const { onSave, form } = setup()
    expect(screen.getByLabelText('Unit price (€)').value).toBe('3.50')
    fireEvent.submit(form())
    expect(onSave.mock.calls[0][0]).toMatchObject({ current_stock: 2, min_stock: 1, price: 3.5, price_qty: 1 })
  })
  it('saves stock 1,5 and minimum 0,25 and price 13,60 as typed', () => {
    const { onSave, form } = setup()
    const [stock, min] = [screen.getByText('Current stock').closest('div').parentElement.querySelector('input'), screen.getByText(/Minimum stock/).closest('div').querySelector('input')]
    expect(isDecimalText(stock) && isDecimalText(min)).toBe(true)
    fireEvent.change(stock, { target: { value: '1,5' } })
    fireEvent.change(min, { target: { value: '0.25' } })
    type('Unit price (€)', '13,60')
    fireEvent.submit(form())
    expect(onSave.mock.calls[0][0]).toMatchObject({ current_stock: 1.5, min_stock: 0.25, price: 13.6 })
  })
  it('keeps a wrong stock as typed on leaving the field and does not save it', () => {
    const { onSave, form } = setup()
    const stock = screen.getByText('Current stock').closest('div').parentElement.querySelector('input')
    fireEvent.change(stock, { target: { value: '1,5,5' } })
    fireEvent.blur(stock)
    expect(stock.value).toBe('1,5,5')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    fireEvent.submit(form())
    expect(onSave).not.toHaveBeenCalled()
  })
  it('takes the quantity per pack with a comma', () => {
    const { onSave, form } = setup()
    const label = screen.getByText(/per bag/)
    expect(isDecimalText(label.parentElement.querySelector('input'))).toBe(true)
    fireEvent.change(label.parentElement.querySelector('input'), { target: { value: '2,5' } })
    fireEvent.submit(form())
    expect(onSave.mock.calls[0][0]).toMatchObject({ quantity_per_pack: 2.5 })
  })
})

describe('confirming a purchase', () => {
  const cart = [{ id: 'g1', name: 'Cheese', category_id: 'misc', quantity: 2, unit: 'pcs', price: 3, price_qty: 1, price_unit: 'pcs', payer: 'shared', in_cart: true, completed: false }]
  const setup = () => {
    const edits = vi.fn(async () => ({}))
    render(<ConfirmPurchase cartItems={cart} pantryItems={[]} categoryName={() => 'Misc'} totalOf={(i) => lineTotal(i, null)} updatePricing={edits} updatePayer={edits} toggleCart={edits} onClose={() => {}} />)
    return screen.getByRole('button', { name: /Confirm purchase/ })
  }
  it('takes quantity and total with a comma or a dot', () => {
    setup()
    expect(isDecimalText(screen.getByLabelText('Quantity of Cheese'))).toBe(true)
    expect(isDecimalText(screen.getByLabelText('Total for Cheese'))).toBe(true)
    type('Total for Cheese', '13,60')
    expect(alert()).toBeNull()
    expect(screen.getByRole('button', { name: /Confirm purchase/ }).textContent).toContain('13.60')
    type('Total for Cheese', '13.60')
    expect(screen.getByRole('button', { name: /Confirm purchase/ }).textContent).toContain('13.60')
  })
  it('will not confirm while a number is wrong, and keeps what was typed', () => {
    const button = setup()
    expect(button.disabled).toBe(false)
    type('Total for Cheese', '13,6,0')
    expect(alert().textContent).toBe(DECIMAL_MESSAGE)
    expect(button.disabled).toBe(true)
    fireEvent.blur(screen.getByLabelText('Total for Cheese'))
    expect(screen.getByLabelText('Total for Cheese').value).toBe('13,6,0')
    type('Total for Cheese', '13,60')
    expect(button.disabled).toBe(false)
    type('Quantity of Cheese', '2a')
    expect(button.disabled).toBe(true)
  })
})

describe('checking prices on a receipt', () => {
  const lines = [{ id: 'e1', description: 'Cheese', amount: 3 }]
  const setup = () => {
    const onSave = vi.fn(async () => ({ error: null }))
    render(<PriceCheck date="2026-10-17" photos={[]} lines={lines} linkFor={() => ({})} onSave={onSave} onClose={() => {}} />)
    return onSave
  }
  it('saves 13,60 as 13.6, shows two decimals, refuses 13,6,0', () => {
    const onSave = setup()
    const input = screen.getByLabelText('Price of Cheese')
    expect(isDecimalText(input)).toBe(true)
    expect(input.value).toBe('3.00')
    fireEvent.change(input, { target: { value: '13,6,0' } })
    expect(within(input.closest('div').parentElement).getByRole('alert').textContent).toBe(DECIMAL_MESSAGE)
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toBe('13,6,0')
    fireEvent.change(input, { target: { value: '13,60' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith(lines[0], 13.6)
  })
})
