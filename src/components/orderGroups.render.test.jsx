// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderToStaticMarkup } from 'react-dom/server'

// Order groups (plan 9I) on screen: the tag and the share line on the order
// cards, the "Same order as" offer in the order form (K2), an order of a
// group being edited (K7), the "Order group" sheet, the group's row in
// MONEY Expenses (K9) and "Group orders" — and nothing of it before
// supabase/028.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
const data = vi.hoisted(() => ({ orders: [], groups: [], groupsReady: true, groupOrders: null }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  orderStore: fake(() => data.orders),
  orderGroupStore: fake(() => data.groups),
  pantryStore: fake(() => []),
  groceryStore: fake(() => []),
  budgetMapStore: fake(() => []),
}))
vi.mock('../hooks/useOrderGroups', async (original) => {
  const real = await original()
  return {
    ...real,
    useOrderGroups: () => ({ ready: data.groupsReady, groups: data.groups, orders: data.orders, byId: new Map(data.groups.map((g) => [g.id, g])) }),
    // A test can watch what "Group orders" sends (data.groupOrders).
    groupOrders: (...args) => (data.groupOrders ?? real.groupOrders)(...args),
  }
})
const shops = new Map([
  ['amazon', { id: 'amazon', name: 'Amazon.it', is_online: true }],
  ['zal', { id: 'zal', name: 'Zalando', is_online: true }],
])
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [...shops.values()], byId: shops }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useOrders', async (original) => ({
  ...(await original()),
  useOrders: () => ({ orders: data.orders, loaded: true, missing: false, ready: true }),
}))

const { OrderCard } = await import('./expenses/OrderCard')
const { OnTheWay } = await import('./grocery/OnTheWay')
const { OrderForm } = await import('./expenses/OrderForm')
const { OrderGroupSheet } = await import('./expenses/OrderGroupSheet')
const { OrdersSection } = await import('./expenses/OrdersSection')
const { PurchaseGroup } = await import('./expenses/ExpenseGroup')
const { groupPurchases, purchasePart } = await import('../lib/moneyList')
const { groupDiscountNote, groupLabel, groupMembers } = await import('../lib/orderGroups')
const { expenseDiscountNote } = await import('../lib/orders')

// The 17/10 order at Amazon.it, grouped with −€3.23.
const shares = [0.87, 0.75, 0.62, 0.24, 0.31, 0.14, 0.3]
const list = [30.79, 26.6, 21.99, 8.49, 10.99, 4.99, 9.99]
const names = ['Cat Dry Food', 'Cat Wet Food', 'Hairs all Relief', 'Working Ear Plug', 'Wood Cleaner Spray', 'Silicone Gun', 'Catnip Snack']
const member = (i) => ({
  id: `o${i}`,
  item_name: names[i],
  price: Math.round((list[i] - shares[i]) * 100) / 100,
  group_share: shares[i],
  group_id: 'g1',
  shop_id: 'amazon',
  order_date: '2026-10-17',
  paid_by: 'akbar',
  status: i === 3 ? 'returned' : 'on_the_way',
  expense_id: i === 3 ? null : `x${i}`,
  created_at: `2026-10-17T10:00:0${i}Z`,
})
const GROUP = { id: 'g1', shop_id: 'amazon', order_date: '2026-10-17', paid_by: 'akbar', discount_kind: 'amount', discount_value: 3.23, discount_total: 3.23, created_at: '2026-10-17T11:00:00Z' }
const single = (id, item_name, price, extra = {}) => ({ id, item_name, price, group_share: 0, group_id: null, shop_id: 'amazon', order_date: '2026-10-17', paid_by: 'akbar', status: 'on_the_way', expense_id: `x-${id}`, created_at: '2026-10-17T09:00:00Z', ...extra })

beforeEach(() => {
  data.orders = names.map((_, i) => member(i))
  data.groups = [GROUP]
  data.groupsReady = true
  data.groupOrders = null
})
afterEach(cleanup)

const formProps = { categories: [], mainCategories: [], subsOf: () => [], addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), styleFor: () => ({ hex: '#888' }) }

describe('the order cards', () => {
  it('MONEY Orders: the tag "Order: Amazon.it · 17/10 (7 items)" opens the sheet; the share line and the price before it', () => {
    const onOpen = vi.fn()
    render(
      <OrderCard
        order={member(4)}
        shop={shops.get('amazon')}
        names={() => ({})}
        today="2026-10-18"
        open={false}
        onToggle={() => {}}
        groupTag={{ label: groupLabel(groupMembers('g1', data.orders), (id) => shops.get(id)?.name), onOpen }}
      />
    )
    expect(screen.getByText('€10.99 → €10.68 (order discount −€0.31)')).toBeTruthy()
    expect(screen.getByText('€10.99').className).toContain('line-through')
    fireEvent.click(screen.getByText('Order: Amazon.it · 17/10 (7 items)'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('"Group orders" on: a tick box on the card', () => {
    const onSelect = vi.fn()
    render(<OrderCard order={single('s1', 'Lamp', 20)} names={() => ({})} today="2026-10-18" open={false} onToggle={() => {}} selectable onSelect={onSelect} />)
    fireEvent.click(screen.getByLabelText('Select Lamp'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('an order with its own −30% in a group: "€80.00 → €56.00 (−30%) · order discount −€1.20 → €54.80"', () => {
    const html = renderToStaticMarkup(
      <OrderCard order={{ ...single('s2', 'Sneakers', 54.8, { list_price: 80, discount_kind: 'percent', discount_value: 30 }), group_share: 1.2, group_id: 'g2' }} names={() => ({})} today="2026-10-18" open={false} onToggle={() => {}} />
    )
    expect(html).toContain('€80.00 → €56.00 (−30%) · order discount −€1.20 → €54.80')
  })

  it('SHOP "On the way": the share line too', () => {
    const html = renderToStaticMarkup(<OnTheWay entries={[{ entry: { id: 'e1', name: 'Wood Cleaner Spray' }, order: member(4), pantry: null }]} shopById={shops} today="2026-10-18" onArrived={() => {}} onCancel={() => {}} />)
    expect(html).toContain('€10.99 → €10.68 (order discount −€0.31)')
  })
})

describe('"Same order as" in the order form (K2)', () => {
  const form = (onSubmit = vi.fn(async () => ({ error: null }))) => (
    render(<OrderForm {...formProps} prefill={{ itemName: 'Cat litter', shopId: 'amazon', paidBy: 'akbar' }} onSubmit={onSubmit} />),
    onSubmit
  )
  const today = new Date().toLocaleDateString('en-CA')

  it('no order of the same store, date and payer: no offer', () => {
    data.orders = [single('s1', 'Lamp', 20, { order_date: '2020-01-01' })]
    form()
    expect(screen.queryByText(/Same order as/)).toBeNull()
  })

  it('one single order: offered and ticked; saving sends it; another payer: the offer goes', async () => {
    data.orders = [single('s1', 'Lamp', 20, { order_date: today })]
    const onSubmit = form()
    const box = screen.getByLabelText(/Same order as: Lamp \(Amazon\.it · /)
    expect(box.checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Total price'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Add order/ }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].joinWith).toEqual({ orderId: 's1' })
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'irene' } })
    expect(screen.queryByText(/Same order as/)).toBeNull()
  })

  it('a group with a discount and a single order: two offers, none ticked; ticking the group says the discount is spread again', () => {
    data.orders = [...names.map((_, i) => ({ ...member(i), order_date: today })), single('s1', 'Lamp', 20, { order_date: today })]
    data.groups = [{ ...GROUP, order_date: today }]
    form()
    const boxes = within(screen.getByRole('group', { name: 'Same order' })).getAllByRole('checkbox')
    expect(boxes.map((b) => b.checked)).toEqual([false, false])
    expect(screen.queryByText(/spread again/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Same order as: Cat Dry Food, Cat Wet Food, Hairs all Relief \+4 more \(Amazon\.it · /))
    expect(screen.getByText('The order discount will be spread again over 8 items.')).toBeTruthy()
  })

  it('two groups of the same store, date and payer (two checkouts): two offers, none ticked; saving unticked keeps it separate; ticking one joins only that one', async () => {
    const zal = (id, item_name, price, group_id, i) => single(id, item_name, price, { shop_id: 'zal', order_date: today, paid_by: 'irene', group_id, created_at: `${today}T08:00:0${i}Z` })
    data.orders = [zal('z1', 'Rain Jacket', 46.37, 'gA', 1), zal('z2', 'Wool Scarf', 18.48, 'gA', 2), zal('z3', 'Sneakers', 64.5, 'gB', 3), zal('z4', 'Socks', 12.5, 'gB', 4), zal('z5', 'Belt', 24, 'gB', 5)]
    data.groups = [
      { id: 'gA', shop_id: 'zal', order_date: today, paid_by: 'irene', discount_kind: 'amount', discount_value: 5, discount_total: 5 },
      { id: 'gB', shop_id: 'zal', order_date: today, paid_by: 'irene', discount_kind: null, discount_value: null, discount_total: 0 },
    ]
    const onSubmit = vi.fn(async () => ({ error: 'stay open' }))
    render(<OrderForm {...formProps} prefill={{ itemName: 'Beanie', shopId: 'zal', paidBy: 'irene' }} onSubmit={onSubmit} />)
    const offer = screen.getByRole('group', { name: 'Same order' })
    expect(within(offer).getAllByRole('checkbox').map((b) => b.checked)).toEqual([false, false])
    expect(within(offer).getByText(/Tick one if it was part of the same order — otherwise it stays a separate order\./)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Total price'), { target: { value: '15,99' } })
    fireEvent.click(screen.getByRole('button', { name: /Add order/ }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].joinWith).toBeUndefined()
    fireEvent.click(screen.getByLabelText(/Same order as: Sneakers, Socks, Belt \(Zalando · /))
    expect(within(offer).getAllByRole('checkbox').map((b) => b.checked)).toEqual([false, true])
    expect(screen.queryByText(/spread again/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add order/ }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1][0].joinWith).toEqual({ groupId: 'gB' })
  })

  it('a group and a single order on another store and day: two offers, none ticked', () => {
    data.orders = [
      single('z1', 'Rain Jacket', 46.37, { shop_id: 'zal', order_date: today, paid_by: 'irene', group_id: 'gA', created_at: '2026-10-22T08:00:01Z' }),
      single('z2', 'Wool Scarf', 18.48, { shop_id: 'zal', order_date: today, paid_by: 'irene', group_id: 'gA', created_at: '2026-10-22T08:00:02Z' }),
      single('z6', 'Gloves', 22.4, { shop_id: 'zal', order_date: today, paid_by: 'irene', created_at: '2026-10-22T08:00:06Z' }),
    ]
    data.groups = [{ id: 'gA', shop_id: 'zal', order_date: today, paid_by: 'irene', discount_kind: 'amount', discount_value: 5, discount_total: 5 }]
    render(<OrderForm {...formProps} prefill={{ itemName: 'Beanie', shopId: 'zal', paidBy: 'irene' }} onSubmit={vi.fn()} />)
    const boxes = within(screen.getByRole('group', { name: 'Same order' })).getAllByRole('checkbox')
    expect(boxes.map((b) => b.checked)).toEqual([false, false])
    expect(screen.getByLabelText(/Same order as: Rain Jacket, Wool Scarf \(Zalando · /)).toBeTruthy()
    expect(screen.getByLabelText(/Same order as: Gloves \(Zalando · /)).toBeTruthy()
  })

  it('before 028: no offer', () => {
    data.groupsReady = false
    data.orders = [single('s1', 'Lamp', 20, { order_date: today })]
    form()
    expect(screen.queryByText(/Same order as/)).toBeNull()
  })
})

describe('"Edit order" of an order of a group (K7)', () => {
  it('store, date and payer are locked, with the note; the price is the one before the order discount', () => {
    render(<OrderForm {...formProps} initial={member(4)} group={{ count: 7, discounted: true }} submitLabel="Save" onSubmit={vi.fn()} />)
    expect(screen.getByText('Store, date and payer are set on the order group.')).toBeTruthy()
    expect(screen.queryByLabelText('Paid by')).toBeNull()
    expect(screen.queryByLabelText('Order date')).toBeNull()
    expect(screen.getByLabelText('Total price').value).toBe('10.99')
    fireEvent.change(screen.getByLabelText('Total price'), { target: { value: '12' } })
    expect(screen.getByText(/The order discount will be spread again over 7 items\./)).toBeTruthy()
  })
})

describe('the "Order group" sheet', () => {
  it('lists every order (the returned one too) with base, share and paid; typing the discount shows each line live', () => {
    data.groups = [{ ...GROUP, discount_kind: null, discount_value: null, discount_total: 0 }]
    data.orders = names.map((_, i) => ({ ...member(i), price: list[i], group_share: 0 }))
    render(<OrderGroupSheet groupId="g1" shopById={shops} onClose={() => {}} />)
    const items = within(screen.getByRole('list', { name: 'Orders of the group' })).getAllByRole('listitem')
    expect(items).toHaveLength(7)
    expect(items[3].textContent).toContain('Returned')
    expect(screen.getAllByText('Take out of the group')).toHaveLength(7)
    fireEvent.change(screen.getByLabelText('Order discount'), { target: { value: '3.23' } })
    expect(screen.getByText('€10.99 → €10.68 (order discount −€0.31)')).toBeTruthy()
    expect(screen.getByText('€9.99 → €9.69 (order discount −€0.30)')).toBeTruthy()
    expect(screen.getByText((_, el) => el.tagName === 'P' && el.textContent.startsWith('Paid €')).textContent).toBe('Paid €110.61 (order discount −€3.23)')
    expect(screen.getByRole('button', { name: /Ungroup/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save/ })).toBeTruthy()
  })

  it('a percent above 100 is refused where it is typed', () => {
    render(<OrderGroupSheet groupId="g1" shopById={shops} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Order discount in percent'))
    fireEvent.change(screen.getByLabelText('Order discount'), { target: { value: '150' } })
    expect(screen.getByRole('alert').textContent).toBe("A discount can't be more than 100%.")
  })
})

describe('MONEY Expenses: the group\'s expenses as one row (K9)', () => {
  const PETS = { id: 'pets', name: 'Pets' }
  const HOME = { id: 'home', name: 'Home & Appliances' }
  const cat = (i) => (['Cat Dry Food', 'Cat Wet Food', 'Hairs all Relief', 'Catnip Snack'].includes(names[i]) ? 'pets' : 'home')
  const expenses = () => data.orders.filter((o) => o.expense_id).map((o, n) => ({ id: o.expense_id, amount: o.price, description: o.item_name, expense_date: '2026-10-17', category_id: cat(Number(o.id.slice(1))), paid_by: 'akbar', shop_id: 'amazon', created_at: `t${n}` }))
  const row = (items, all) => {
    const orderOf = (id) => data.orders.find((o) => o.expense_id === id)
    const [g] = groupPurchases(items, { mainOf: (id) => (id === 'pets' ? PETS : HOME), orderGroupOf: (e) => orderOf(e.id)?.group_id ?? null })
    return render(
      <PurchaseGroup
        group={g}
        trip={null}
        shop={shops.get('amazon')}
        fullTotal={purchasePart(g.items, all).fullTotal}
        mainOf={(id) => (id === 'pets' ? PETS : HOME)}
        subName={() => null}
        styleFor={() => ({ hex: '#888' })}
        onEdit={() => {}}
        onDelete={() => {}}
        note={groupDiscountNote(groupMembers('g1', data.orders))}
        noteOf={(e) => expenseDiscountNote(e, orderOf)}
        extra={<button type="button">Open the order group</button>}
      />
    )
  }

  it('after the return of Working Ear Plug (expense deleted): 6 items · €102.36 (order discount −€3.23); opened by category with each line', () => {
    const all = expenses()
    const { container } = row(all, all)
    expect(container.querySelector('[data-order-group]')).toBeTruthy()
    expect(screen.getByText(/Amazon\.it · 17\/10\/2026/)).toBeTruthy()
    expect(screen.getByText(/6 items/)).toBeTruthy()
    expect(screen.getByText('€102.36')).toBeTruthy()
    expect(screen.getByText('(order discount −€3.23)')).toBeTruthy()
    expect(container.querySelectorAll('[data-dot="main"]')).toHaveLength(2)
    fireEvent.click(screen.getByText(/Amazon\.it · 17\/10\/2026/))
    expect(screen.getByText('€10.99 → €10.68 (order discount −€0.31)')).toBeTruthy()
    expect(screen.getByText('€86.83')).toBeTruthy()
    expect(screen.getByText('Open the order group')).toBeTruthy()
  })

  it('with the Pets filter on: only the Pets part, "of total €102.36"', () => {
    const all = expenses()
    row(all.filter((e) => e.category_id === 'pets'), all)
    expect(screen.getByText('€86.83')).toBeTruthy()
    expect(screen.getByText('of total €102.36')).toBeTruthy()
  })
})

describe('"Group orders" in MONEY Orders', () => {
  const section = (person = 'all') =>
    render(
      <MemoryRouter>
        <OrdersSection person={person} onPerson={() => {}} shopById={shops} {...formProps} namesOf={() => ({})} />
      </MemoryRouter>
    )

  it('the button is next to "Add order"; ticking says why not, or "Group as one order"; History opens', () => {
    data.orders = [single('s1', 'Lamp', 20), single('s2', 'Bulb', 3, { status: 'arrived', arrived_date: '2026-10-20' }), single('s3', 'Jacket', 50, { shop_id: 'zal' })]
    data.groups = []
    section()
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    expect(screen.getByRole('button', { name: /History \(1\)/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByLabelText('Select Lamp'))
    expect(screen.queryByRole('button', { name: /Group as one order/ })).toBeNull()
    fireEvent.click(screen.getByLabelText('Select Jacket'))
    expect(screen.getByText('Only orders of the same store can be one order — these are from Amazon.it and Zalando.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select Jacket'))
    fireEvent.click(screen.getByLabelText('Select Bulb'))
    expect(screen.getByRole('button', { name: /Group as one order/ })).toBeTruthy()
  })

  it('an order that matches a group: "Add to Amazon.it · 17/10 (7 items)", with the note that the discount is spread again', () => {
    data.orders = [...names.map((_, i) => member(i)), single('s1', 'Lamp', 20)]
    section()
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    fireEvent.click(screen.getByLabelText('Select Lamp'))
    expect(screen.getByRole('button', { name: /Add to Amazon\.it · 17\/10 \(7 items\)/ })).toBeTruthy()
    expect(screen.getByText('The order discount will be spread again over 8 items.')).toBeTruthy()
    expect(screen.getAllByText('Order: Amazon.it · 17/10 (7 items)').length).toBeGreaterThan(0)
  })

  it('two single orders that match a group: "Group as one order" AND "Add to …", each doing only its own thing', async () => {
    data.orders = [...names.map((_, i) => member(i)), single('s1', 'Lamp', 20), single('s2', 'Bulb', 3.4)]
    data.groupOrders = vi.fn(async () => ({ error: null }))
    section()
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    fireEvent.click(screen.getByLabelText('Select Lamp'))
    expect(screen.queryByRole('button', { name: /Group as one order/ })).toBeNull()
    fireEvent.click(screen.getByLabelText('Select Bulb'))
    expect(screen.getByRole('button', { name: /Group as one order/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add to Amazon\.it · 17\/10 \(7 items\)/ })).toBeTruthy()
    expect(screen.getByText('The order discount will be spread again over 9 items.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Group as one order/ }))
    await vi.waitFor(() => expect(data.groupOrders).toHaveBeenCalledTimes(1))
    const sent = data.groupOrders.mock.calls[0][0]
    expect(sent.target).toBeNull()
    expect(sent.singles.map((o) => o.item_name)).toEqual(['Lamp', 'Bulb'])
    // The new group's sheet opens at once.
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Order group' })).toBeTruthy())
  })

  it('"Add to …" sends only that group: the ticked orders join it, no new group', async () => {
    data.orders = [...names.map((_, i) => member(i)), single('s1', 'Lamp', 20), single('s2', 'Bulb', 3.4)]
    data.groupOrders = vi.fn(async () => ({ error: null }))
    section()
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    fireEvent.click(screen.getByLabelText('Select Lamp'))
    fireEvent.click(screen.getByLabelText('Select Bulb'))
    fireEvent.click(screen.getByRole('button', { name: /Add to Amazon\.it · 17\/10 \(7 items\)/ }))
    await vi.waitFor(() => expect(data.groupOrders).toHaveBeenCalledTimes(1))
    const sent = data.groupOrders.mock.calls[0][0]
    expect(sent.target.groupId).toBe('g1')
    expect(sent.target.members).toHaveLength(7)
    expect(sent.singles.map((o) => o.item_name)).toEqual(['Lamp', 'Bulb'])
    expect(screen.queryByRole('dialog', { name: 'Order group' })).toBeNull()
  })

  it('two groups of the same store, date and payer (two checkouts at Zalando on 22/10): one "Add to …" for each, and "Group as one order"', () => {
    const zal = (id, item_name, price, group_id, i, group_share = 0) => single(id, item_name, price, { shop_id: 'zal', order_date: '2026-10-22', paid_by: 'irene', group_id, group_share, created_at: `2026-10-22T08:00:0${i}Z` })
    data.orders = [zal('z1', 'Rain Jacket', 46.37, 'gA', 1, 3.58), zal('z2', 'Wool Scarf', 18.48, 'gA', 2, 1.42), zal('z3', 'Sneakers', 64.5, 'gB', 3), zal('z4', 'Socks', 12.5, 'gB', 4), zal('z5', 'Belt', 24, 'gB', 5), zal('z6', 'Beanie', 15.99, null, 6), zal('z7', 'Gloves', 22.4, null, 7)]
    data.groups = [
      { id: 'gA', shop_id: 'zal', order_date: '2026-10-22', paid_by: 'irene', discount_kind: 'amount', discount_value: 5, discount_total: 5 },
      { id: 'gB', shop_id: 'zal', order_date: '2026-10-22', paid_by: 'irene', discount_kind: null, discount_value: null, discount_total: 0 },
    ]
    section()
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    fireEvent.click(screen.getByLabelText('Select Gloves'))
    expect(screen.queryByRole('button', { name: /Group as one order/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Add to / }).map((b) => b.textContent.trim())).toEqual(['Add to Zalando · 22/10 (2 items)', 'Add to Zalando · 22/10 (3 items)'])
    fireEvent.click(screen.getByLabelText('Select Beanie'))
    expect(screen.getByRole('button', { name: /Group as one order/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Add to / })).toHaveLength(2)
    // Only checkout A has a discount: only its button says it is spread again.
    expect(screen.getAllByText(/spread again/).map((p) => p.textContent)).toEqual(['The order discount will be spread again over 4 items.'])
  })

  it('"Paid by" not on Everyone: a hint that some orders may be hidden', () => {
    data.orders = [single('s1', 'Lamp', 20)]
    section('irene')
    fireEvent.click(screen.getByRole('button', { name: /Group orders/ }))
    expect(screen.getByText('"Paid by" shows only Irene: some orders may be hidden. Choose Everyone to see them all.')).toBeTruthy()
  })

  it('before 028: no "Group orders", no tag', () => {
    data.groupsReady = false
    data.orders = [single('s1', 'Lamp', 20)]
    section()
    expect(screen.queryByRole('button', { name: /Group orders/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Add order/ })).toBeTruthy()
  })
})
