// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Round 9H: the pack field on screen — SHOP Confirm purchase, MONEY "Add
// expense", the order form (Order online, creating and editing) and
// Arrived. One field everywhere: "pcs per box", "= 60 pcs", and what
// happens to the item's usual size.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

// Cat Wet Food is usually 1 box = 48 pcs; Tuna has no usual size yet;
// Rice is counted in gr.
const data = vi.hoisted(() => ({
  pantry: [
    { id: 'cat', name: 'Cat Wet Food', unit: 'pcs', current_stock: 10, min_stock: 0, category_id: 'pet', packaging_unit: 'box', quantity_per_pack: 48 },
    { id: 'tuna', name: 'Tuna', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'canned', packaging_unit: null, quantity_per_pack: null },
    { id: 'rice', name: 'Rice', unit: 'gr', current_stock: 500, min_stock: 0, category_id: 'pantry-staples' },
  ],
}))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => data.pantry),
  groceryStore: fake(() => []),
  orderStore: fake(() => []),
  budgetMapStore: fake(() => []),
  inventoryCategoryStore: fake(() => [
    { id: 'pet', name: 'Pet Supplies' },
    { id: 'canned', name: 'Canned' },
    { id: 'pantry-staples', name: 'Pantry Staples' },
    { id: 'appliances', name: 'Durables' },
  ]),
}))
const parents = [
  { id: 'pet', name: 'Pet Supplies', type: 'parent' },
  { id: 'canned', name: 'Canned', type: 'parent' },
  { id: 'pantry-staples', name: 'Pantry Staples', type: 'parent' },
  { id: 'appliances', name: 'Durables', type: 'parent' },
]
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents, pantryParents: parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const confirmPurchase = vi.fn(async () => ({ error: null }))
const recordMoneyPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: (...args) => recordMoneyPurchase(...args), usePurchase: () => ({ confirmPurchase: (...args) => confirmPurchase(...args) }) }))
vi.mock('../hooks/useExpenses', () => ({ addExpenseOnce: vi.fn() }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/usePantryItems', () => ({ usePantryItems: () => ({ items: data.pantry, addItem: vi.fn(), adjustStock: vi.fn(async () => ({ error: null })) }) }))
const arriveLinkedOrder = vi.fn(async () => ({ error: null, added: true }))
vi.mock('../hooks/useOrders', async (original) => ({ ...(await original()), arriveLinkedOrder: (...args) => arriveLinkedOrder(...args) }))

const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { OrderForm } = await import('./expenses/OrderForm')
const { LinkedArrivedDialog } = await import('./expenses/LinkedArrivedDialog')
const { ArrivedDialog } = await import('./expenses/ArrivedDialog')
const { confirmationPayload } = await import('../lib/purchase')

afterEach(() => {
  cleanup()
  confirmPurchase.mockClear()
  recordMoneyPurchase.mockClear()
  arriveLinkedOrder.mockClear()
})

const [cat, tuna] = [0, 1].map((i) => () => data.pantry[i])
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const text = () => document.body.textContent

describe('SHOP Confirm purchase', () => {
  const entry = (fields) => ({ id: fields.name, quantity: 1, unit: 'box', price: 20, price_qty: 1, price_unit: 'box', payer: 'shared', in_cart: true, category_id: 'pet', ...fields })
  const confirm = (cartItems) =>
    render(
      <ConfirmPurchase
        cartItems={cartItems}
        pantryItems={data.pantry}
        categoryName={(id) => id}
        totalOf={(i) => (i.price * i.quantity) / (i.price_qty || 1)}
        updatePricing={async () => ({})}
        updatePayer={async () => ({})}
        toggleCart={async () => ({})}
        onClose={() => {}}
      />
    )
  const sent = () => {
    const args = confirmPurchase.mock.calls[0][0]
    return confirmationPayload({ ...args, expenseCategoryFor: () => 'groceries' }).items
  }

  it('usual "box 48", 1 box typed 30: "pcs per box", "= 30 pcs", "This purchase only"; +30, the usual 48 not sent', async () => {
    confirm([entry({ name: 'Cat Wet Food', pantry_item_id: 'cat' })])
    const field = screen.getByLabelText('pcs per box for Cat Wet Food')
    expect(field.value).toBe('48')
    expect(text()).toContain('= 48 pcs')
    expect(text()).not.toContain('How many')
    type('pcs per box for Cat Wet Food', '30')
    expect(text()).toContain('= 30 pcs')
    expect(text()).toContain('This purchase only — usual: 48 pcs per box.')
    fireEvent.click(screen.getByRole('button', { name: /Confirm purchase · €20\.00/ }))
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ pantry_item_id: 'cat', add: 30, line_total: 20 })
    expect(sent()[0]).not.toHaveProperty('packaging_unit')
  })

  it('2 box × 30 = "= 60 pcs"', () => {
    confirm([entry({ name: 'Cat Wet Food', pantry_item_id: 'cat', quantity: 2 })])
    type('pcs per box for Cat Wet Food', '30')
    expect(text()).toContain('= 60 pcs')
  })

  it('no usual size: empty, "Type how many pcs are in 1 box.", Confirm locked; typed 12 → the first-time text, +12 and box 12 sent', async () => {
    confirm([entry({ name: 'Tuna', pantry_item_id: 'tuna' })])
    expect(screen.getByLabelText('pcs per box for Tuna').value).toBe('')
    expect(text()).toContain('Type how many pcs are in 1 box.')
    expect(screen.getByRole('button', { name: /Confirm purchase/ }).disabled).toBe(true)
    type('pcs per box for Tuna', '12')
    expect(text()).toContain('It will be saved as the usual size for next time.')
    expect(text()).not.toContain('Type how many')
    fireEvent.click(screen.getByRole('button', { name: /Confirm purchase/ }))
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
  })

  it('usual "box", 1 pack typed 5: +5 and nothing saved (no first-time text)', async () => {
    confirm([entry({ name: 'Cat Wet Food', pantry_item_id: 'cat', unit: 'pack', price_unit: 'pack' })])
    type('pcs per pack for Cat Wet Food', '5')
    expect(text()).not.toContain('It will be saved')
    expect(text()).not.toContain('This purchase only')
    fireEvent.click(screen.getByRole('button', { name: /Confirm purchase/ }))
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ add: 5 })
    expect(sent()[0]).not.toHaveProperty('packaging_unit')
  })

  it('pcs, kg and a durable line: no field', () => {
    confirm([
      entry({ name: 'Cat Wet Food', pantry_item_id: 'cat', unit: 'pcs', price_unit: 'pcs' }),
      entry({ name: 'Rice', pantry_item_id: 'rice', unit: 'kg', price_unit: 'kg' }),
      entry({ name: 'Kettle', category_id: 'appliances' }),
    ])
    expect(screen.queryByLabelText(/ per /)).toBeNull()
    expect(text()).not.toContain('Type how many')
  })
})

describe('MONEY Add expense', () => {
  const form = () =>
    render(
      <PurchaseForm
        expenseCategories={[{ id: 'groceries', name: 'Groceries', parent_id: null }]}
        mainCategories={[{ id: 'groceries', name: 'Groceries', parent_id: null }]}
        subsOf={() => []}
        addCategory={vi.fn()}
        renameCategory={vi.fn()}
        moveCategory={vi.fn()}
        deleteCategory={vi.fn()}
        styleFor={() => ({ hex: '#000' })}
        onClose={vi.fn()}
      />
    )
  // The names here have no category suggestion, so Add to HOME is
  // switched on by hand (as for any row without a HOME category).
  const homeOn = () => fireEvent.click(screen.getByLabelText('Add to HOME'))

  it('usual box 48 bought 1 box typed 30: +30, the expense is the €20 typed, "This purchase only"', async () => {
    form()
    type('Name', 'Cat Wet Food')
    type('Price', '20')
    type('Unit', 'box')
    homeOn()
    expect(screen.getByLabelText('pcs per box').value).toBe('48')
    type('pcs per box', '30')
    expect(text()).toContain('= 30 pcs')
    expect(text()).toContain('This purchase only — usual: 48 pcs per box.')
    expect(text()).toContain('Adds to "Cat Wet Food" in HOME (+30 pcs).')
    fireEvent.click(screen.getByRole('button', { name: /€20\.00/ }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    const item = recordMoneyPurchase.mock.calls[0][0].payload.items[0]
    expect(item).toMatchObject({ pantry_item_id: 'cat', add: 30, line_total: 20, quantity: 1, unit: 'box' })
    expect(item).not.toHaveProperty('packaging_unit')
  })

  it('no usual size: Save blocked with "Type how many pcs are in 1 box."; typed 12 → first-time text, +12 and box 12 saved', async () => {
    form()
    type('Name', 'Tuna')
    type('Price', '9')
    type('Unit', 'box')
    homeOn()
    expect(screen.getByLabelText('pcs per box').value).toBe('')
    expect(text()).toContain('Type how many pcs are in 1 box.')
    fireEvent.click(screen.getByRole('button', { name: /€9\.00/ }))
    await waitFor(() => expect(screen.getAllByText(/Type how many pcs are in 1 box\./).length).toBeGreaterThan(1))
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
    type('pcs per box', '12')
    expect(text()).toContain('It will be saved as the usual size for next time.')
    fireEvent.click(screen.getByRole('button', { name: /€9\.00/ }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ pantry_item_id: 'tuna', add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
  })

  it('2 pack × 5 of an item usually bought by the box: "= 10 pcs", nothing saved', async () => {
    form()
    type('Name', 'Cat Wet Food')
    type('Price', '6')
    type('Quantity', '2')
    type('Unit', 'pack')
    homeOn()
    type('pcs per pack', '5')
    expect(text()).toContain('= 10 pcs')
    expect(text()).not.toContain('It will be saved')
    fireEvent.click(screen.getByRole('button', { name: /€6\.00/ }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    const item = recordMoneyPurchase.mock.calls[0][0].payload.items[0]
    expect(item).toMatchObject({ add: 10 })
    expect(item).not.toHaveProperty('packaging_unit')
  })

  it('no field in pcs or kg, nor with Add to HOME off', () => {
    form()
    type('Name', 'Rice')
    homeOn()
    type('Unit', 'kg')
    expect(screen.queryByLabelText(/ per /)).toBeNull()
    type('Name', 'Cat Wet Food')
    type('Unit', 'pcs')
    expect(screen.queryByLabelText(/ per /)).toBeNull()
    type('Unit', 'box')
    expect(screen.getByLabelText('pcs per box')).toBeTruthy()
    homeOn()
    expect(screen.queryByLabelText('pcs per box')).toBeNull()
  })
})

describe('Order online: the order form, creating and editing', () => {
  const picker = { categories: [], mainCategories: [], subsOf: () => [], styleFor: () => ({}), addCategory() {}, renameCategory() {}, moveCategory() {}, deleteCategory() {} }
  const submit = () => fireEvent.submit(screen.getByLabelText('Total price').closest('form'))

  it('creating: may stay empty ("You can fill this in when it arrives."), saved with no pack size; no first-time text', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<OrderForm {...picker} prefill={{ itemName: 'Tuna', quantity: 1, unit: 'box', price: 9 }} units={['box', 'pcs']} packItem={tuna()} onSubmit={onSubmit} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('')
    expect(text()).toContain('You can fill this in when it arrives.')
    expect(text()).not.toContain('Type how many')
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ quantity: 1, unit: 'box', packSize: null, price: 9 })
  })

  it('creating: typed 24 → saved with it; never "saved as the usual size" here', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<OrderForm {...picker} prefill={{ itemName: 'Tuna', quantity: 1, unit: 'box', price: 9 }} units={['box', 'pcs']} packItem={tuna()} onSubmit={onSubmit} />)
    type('pcs per box', '24')
    expect(text()).toContain('= 24 pcs')
    expect(text()).not.toContain('It will be saved')
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ packSize: 24 })
  })

  it('creating for an item with a usual size: starts with it', () => {
    render(<OrderForm {...picker} prefill={{ itemName: 'Cat Wet Food', quantity: 1, unit: 'box', price: 20 }} units={['box', 'pcs']} packItem={cat()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('48')
  })

  it('editing: shows the order’s own 24, changed to 22 is saved; pcs has no field (sent empty)', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    const order = { id: 'o1', item_name: 'Tuna', order_date: '2026-10-28', price: 9, paid_by: 'shared', quantity: 1, unit: 'box', pack_size: 24 }
    render(<OrderForm {...picker} initial={order} units={['box', 'pcs']} packItem={tuna()} onSubmit={onSubmit} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('24')
    type('pcs per box', '22')
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ packSize: 22 })
    fireEvent.change(screen.getByLabelText('Unit ordered'), { target: { value: 'pcs' } })
    expect(screen.queryByLabelText('pcs per box')).toBeNull()
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ unit: 'pcs', packSize: null })
  })

  it('an order not linked to HOME (or durable): no field, nothing sent for it', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<OrderForm {...picker} prefill={{ itemName: 'Sofa', quantity: 1, unit: 'box', price: 300 }} onSubmit={onSubmit} />)
    expect(screen.queryByLabelText(/ per /)).toBeNull()
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('packSize')
  })
})

describe('Arrived', () => {
  const order = (fields) => ({ id: 'o1', item_name: 'Tuna', status: 'on_the_way', pantry_item_id: 'tuna', quantity: 1, unit: 'box', pack_size: null, arrival_pack_before: null, ...fields })
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'Arrived — add to HOME' }))

  it('Order online left empty → Arrived requires it; typed 20 → +20, the first-time text, saved as usual', async () => {
    render(<LinkedArrivedDialog order={order()} item={tuna()} onClose={() => {}} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('')
    expect(text()).toContain('Type how many pcs are in 1 box.')
    expect(screen.getByRole('button', { name: 'Arrived — add to HOME' }).disabled).toBe(true)
    type('pcs per box', '20')
    expect(text()).toContain('= 20 pcs')
    expect(text()).toContain('It will be saved as the usual size for next time.')
    press()
    await waitFor(() => expect(arriveLinkedOrder).toHaveBeenCalledTimes(1))
    expect(arriveLinkedOrder.mock.calls[0][1]).toMatchObject({ itemId: 'tuna', delta: 20, pack: { unit: 'box', value: 20, firstTime: true }, packItem: { id: 'tuna' } })
  })

  it('Order online 24 → Arrived starts with 24, changed to 22 → +22', async () => {
    render(<LinkedArrivedDialog order={order({ pack_size: 24 })} item={tuna()} onClose={() => {}} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('24')
    type('pcs per box', '22')
    press()
    await waitFor(() => expect(arriveLinkedOrder).toHaveBeenCalledTimes(1))
    expect(arriveLinkedOrder.mock.calls[0][1]).toMatchObject({ delta: 22, pack: { value: 22 } })
  })

  it('an old order without a value: the usual-size rule (box 48), editable; nothing saved over the usual size', async () => {
    const old = { id: 'o2', item_name: 'Cat Wet Food', status: 'on_the_way', pantry_item_id: 'cat', quantity: 2, unit: 'box' }
    render(<LinkedArrivedDialog order={old} item={cat()} onClose={() => {}} />)
    expect(screen.getByLabelText('pcs per box').value).toBe('48')
    expect(text()).toContain('= 96 pcs')
    type('pcs per box', '30')
    expect(text()).toContain('This purchase only — usual: 48 pcs per box.')
    press()
    await waitFor(() => expect(arriveLinkedOrder).toHaveBeenCalledTimes(1))
    expect(arriveLinkedOrder.mock.calls[0][1]).toMatchObject({ delta: 60, pack: { value: 30, firstTime: false } })
  })

  it('before 027 (the order has no pack columns): the right stock, no first-time save offered', async () => {
    const before027 = { id: 'o3', item_name: 'Tuna', status: 'on_the_way', pantry_item_id: 'tuna', quantity: 1, unit: 'box' }
    render(<LinkedArrivedDialog order={before027} item={tuna()} onClose={() => {}} />)
    type('pcs per box', '12')
    expect(text()).not.toContain('It will be saved')
    press()
    await waitFor(() => expect(arriveLinkedOrder).toHaveBeenCalledTimes(1))
    expect(arriveLinkedOrder.mock.calls[0][1]).toMatchObject({ delta: 12, pack: { value: 12, firstTime: false } })
  })

  it('ordered in pcs: no field, as before', () => {
    render(<LinkedArrivedDialog order={order({ unit: 'pcs', quantity: 5 })} item={tuna()} onClose={() => {}} />)
    expect(screen.queryByLabelText(/ per /)).toBeNull()
  })

  it('an order not linked to HOME (ArrivedDialog): the purchase unit has the field for this arrival only', async () => {
    render(<ArrivedDialog order={{ id: 'o4', item_name: 'Cat food', status: 'arrived' }} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Add to an existing item'))
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'cat' } })
    expect(screen.getByLabelText('pcs per box').value).toBe('48')
    type('pcs per box', '40')
    expect(text()).toContain('= 40 pcs')
    expect(text()).not.toContain('It will be saved')
  })
})
