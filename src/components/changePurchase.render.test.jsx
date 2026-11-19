// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// Plan 9P, Update round prompt 3: Money → section Expenses → "Expenses (N)"
// → a purchase row → "Change purchase ▾" (K204–K209, K236, K237): the
// inline panel with Store · Date · Paid by, on SHOP / MONEY / merged
// purchases and order-group rows, in the plain list and the "Sort by"
// views. The real panel and the real useChangePurchase.changePurchase /
// undoChange, with supabase.rpc answered here.
// The payers come from PAID_BY_OPTIONS (never written out here).
const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: (...args) => rpcMock(...args) } }))
const SHOPS = vi.hoisted(() => [
  { id: 'lidl', name: 'Lidl', is_online: false },
  { id: 'coop', name: 'Iper Coop', is_online: false },
])
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: true, missing: false, shops: SHOPS, byId: new Map(SHOPS.map((s) => [s.id, s])) }) }))
// "Bought at" / "Store" as a plain select (the real picker is tested on its own).
vi.mock('./expenses/ShopPicker', () => ({
  ShopPicker: ({ value, onChange, label }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {SHOPS.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  ),
}))

const data = vi.hoisted(() => ({ expenses: [], trips: [], orders: [], groups: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }), isStarted: () => false, patchLocal: () => {}, upsertLocal: () => {}, removeLocal: () => {}, refresh: async () => {} })
const notRead = vi.hoisted(() => ({ getSnapshot: () => ({ rows: [], loaded: false }), refresh: () => {} }))
vi.mock('../lib/stores', async (original) => {
  const { emptyStore } = await import('../lib/tableStore')
  notRead.useRows = emptyStore.useRows
  return {
    ...(await original()),
    expensesBefore: () => notRead,
    incomeBefore: () => notRead,
    pantryStore: fake(() => []),
    transferStore: fake(() => []),
    groceryStore: fake(() => []),
    orderStore: fake(() => data.orders),
    orderGroupStore: fake(() => data.groups),
    budgetMapStore: fake(() => []),
    tripStore: fake(() => data.trips),
    tripItemStore: fake(() => []),
    receiptPhotoStore: fake(() => []),
    shopStore: fake(() => SHOPS),
    inventoryCategoryStore: fake(() => []),
    allExpenseStores: () => [],
  }
})
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents: [], pantryParents: [], subsByParent: new Map(), addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const purchase = vi.hoisted(() => ({ setTripShop: vi.fn(async () => ({ error: null })) }))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: vi.fn(), usePurchase: () => ({ confirmPurchase: vi.fn() }), askUndoPurchase: vi.fn(), reopenTrip: vi.fn(), setTripShop: (...a) => purchase.setTripShop(...a) }))
// What the app reads when Date or Paid by is chosen: the purchase from the
// rows here (its photos and cards none).
const reads = vi.hoisted(() => ({ count: 0 }))
vi.mock('../hooks/useChangePurchase', async (original) => {
  const { purchaseState } = await import('../lib/changePurchase')
  return {
    ...(await original()),
    readPurchase: async (tripId) => {
      reads.count += 1
      const trip = data.trips.find((t) => t.id === tripId)
      return trip ? purchaseState({ trip, expenses: data.expenses.filter((e) => e.trip_id === tripId) }) : null
    },
  }
})
const groups = vi.hoisted(() => ({ saveGroupDetails: vi.fn(async () => ({ data: {}, error: null })) }))
vi.mock('../hooks/useOrderGroups', async (original) => ({ ...(await original()), saveGroupDetails: (...a) => groups.saveGroupDetails(...a) }))
const categories = [
  { id: 'going-out', name: 'Going out', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: null },
]
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: vi.fn(),
  useExpenses: () => ({ expenses: data.expenses, loaded: true, categories, updateExpense: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), deleteExpense: vi.fn() }),
}))
vi.mock('../hooks/useIncome', () => ({
  useIncome: () => ({ income: [], loaded: true, missing: false, categories: [], categoriesMissing: false, addIncome: vi.fn(), updateIncome: vi.fn(), deleteIncome: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn() }),
}))
vi.mock('../hooks/useCategoryColors', () => ({ useCategoryColors: () => () => ({ hex: '#888888' }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('./expenses/OrdersSection', () => ({ OrdersSection: () => null }))
vi.mock('./expenses/MoneyCharts', () => ({ MoneyCharts: () => null }))

const { PAID_BY_OPTIONS } = await import('../data/constants')
const { ExpensesPage } = await import('../pages/ExpensesPage')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')
const { setOnlineForTest } = await import('../lib/connection')
const { CHANGED_MEANWHILE, CHANGE_PURCHASE_NOTICE, ORDER_GROUP_GONE } = await import('../lib/changePurchase')

const [P1, P2] = PAID_BY_OPTIONS.filter((o) => o.kind === 'person').map((o) => o.value)
const JOINT = 'joint'
const SHARED = 'shared'
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })

// A SHOP purchase of 15/11/2026 at Lidl, paid by the first person: 3
// expenses in two categories.
const shopTrip = { id: 't1', trip_date: '2026-11-15', paid_by: P1, source: 'shop', shop_id: 'lidl', total: 10.22 }
const shopExpenses = (patch = {}) => [
  { id: 'e1', trip_id: 't1', description: 'TEST milk', amount: 3.11, category_id: 'groceries', expense_date: '2026-11-15', paid_by: P1, shop_id: 'lidl', ...parts(null, null), ...patch.e1 },
  { id: 'e2', trip_id: 't1', description: 'TEST bread', amount: 3.11, category_id: 'groceries', expense_date: '2026-11-15', paid_by: P1, shop_id: 'lidl', ...parts(null, null), ...patch.e2 },
  { id: 'e3', trip_id: 't1', description: 'TEST cinema snack', amount: 4, category_id: 'going-out', expense_date: '2026-11-15', paid_by: P1, shop_id: 'lidl', ...parts(null, null), ...patch.e3 },
]
const ok = { data: { id: 't1' }, error: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 18, 12))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  rpcMock.mockResolvedValue(ok)
  data.trips = [shopTrip]
  data.expenses = shopExpenses()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rpcMock.mockReset()
  purchase.setTripShop.mockClear()
  groups.saveGroupDetails.mockClear()
  reads.count = 0
  data.orders = []
  data.groups = []
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
  setOnlineForTest(true)
})

const section = (title) => screen.getByRole('heading', { name: title }).closest('section')
const ex = () => within(section('Expenses'))
const openList = () => fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
const openRow = (name = /Lidl · 15\/11\/2026/) => fireEvent.click(ex().getByRole('button', { name }))
const changeButton = () => ex().getByRole('button', { name: 'Change purchase' })
const panel = () => within(ex().getByRole('region', { name: 'Change purchase' }))
const choose = (name) => fireEvent.click(panel().getByRole('button', { name }))
const save = () => fireEvent.click(panel().getByRole('button', { name: 'Save for the whole purchase' }))
const typeDate = (text) => {
  const field = panel().getByLabelText('Date')
  fireEvent.change(field, { target: { value: text } })
  fireEvent.blur(field)
}
const toast = (message) => getToasts().find((t) => t.message === message)
// Room for a busy machine (the whole suite runs in parallel).
const waitLong = (check) => vi.waitFor(check, { timeout: 5000 })
const findLong = (scope, text) => scope.findByText(text, {}, { timeout: 5000 })
const settle = () => waitLong(() => expect(rpcMock.mock.calls.length + reads.count).toBeGreaterThan(0))
const openPanel = () => {
  render(<ExpensesPage />)
  openList()
  openRow()
  fireEvent.click(changeButton())
}

describe('Money → a purchase row → "Change purchase ▾" (K204)', () => {
  it('one button in place of "Change the store of the whole purchase"; Reopen stays; the panel opens with no choice, ▾ turns; ▾ again and Cancel close it', () => {
    render(<ExpensesPage />)
    openList()
    openRow()
    expect(ex().queryByText(/Change the store of the whole purchase/)).toBeNull()
    expect(ex().getByText('Reopen purchase')).toBeTruthy()
    const button = changeButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.className).toContain('min-h-9')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.querySelector('svg:last-of-type').getAttribute('class')).toContain('rotate-180')
    const choices = within(panel().getByRole('group', { name: 'What to change' })).getAllByRole('button')
    expect(choices.map((c) => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([
      ['Store', 'false'],
      ['Date', 'false'],
      ['Paid by', 'false'],
    ])
    expect(choices.every((c) => c.className.includes('min-h-9'))).toBe(true)
    expect(panel().queryByRole('button', { name: 'Save for the whole purchase' })).toBeNull()
    fireEvent.click(button)
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
    fireEvent.click(button)
    choose('Date')
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }))
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
  })

  it('one choice at a time: Store ("Bought at" and its line) → Date (the field, Store gone); Save and Cancel are 36 px', async () => {
    openPanel()
    choose('Store')
    expect(panel().getByLabelText('Bought at')).toBeTruthy()
    expect(panel().getByText('Purchase of 15/11/2026: the store changes for all 3 of its expenses, in every budget category.')).toBeTruthy()
    choose('Date')
    expect(panel().queryByLabelText('Bought at')).toBeNull()
    expect(panel().getByLabelText('Date').value).toBe('15/11/2026')
    expect(panel().getByText('All 3 expenses of this purchase move to this day.')).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Date' }).getAttribute('aria-pressed')).toBe('true')
    expect(panel().getByRole('button', { name: 'Store' }).getAttribute('aria-pressed')).toBe('false')
    for (const name of ['Cancel', 'Save for the whole purchase']) expect(panel().getByRole('button', { name }).className).toContain('min-h-9')
    await waitLong(() => expect(reads.count).toBe(1))
  })

  it('Date 15/11 → 13/11: one change_purchase with every expense, the toast with Undo; Undo sends the old values back', async () => {
    openPanel()
    choose('Date')
    typeDate('13/11/2026')
    save()
    await waitLong(() => expect(rpcMock).toHaveBeenCalledTimes(1))
    const [name, { payload }] = rpcMock.mock.calls[0]
    expect(name).toBe('change_purchase')
    expect(payload.trip_id).toBe('t1')
    expect(payload.was.expenses.map((e) => e.expense_date)).toEqual(['2026-11-15', '2026-11-15', '2026-11-15'])
    expect(payload.now.expenses.map((e) => [e.id, e.expense_date, e.paid_by])).toEqual([
      ['e1', '2026-11-13', P1],
      ['e2', '2026-11-13', P1],
      ['e3', '2026-11-13', P1],
    ])
    expect(payload.now.trip).toEqual({ trip_date: '2026-11-13', paid_by: P1 })
    await waitLong(() => expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull())
    const shown = toast('Date changed for 3 expenses of this purchase · 13/11/2026')
    expect(shown.action.label).toBe('Undo')
    await runToastAction(shown.id)
    expect(rpcMock.mock.calls[1][1].payload).toEqual({ trip_id: 't1', was: payload.now, now: payload.was })
  })

  it('K206: tomorrow is refused in the red line ("A purchase can\'t be after today."), nothing sent; today is saved', async () => {
    openPanel()
    choose('Date')
    typeDate('19/11/2026')
    save()
    expect(panel().getByText("A purchase can't be after today.")).toBeTruthy()
    typeDate('18/11/2026')
    save()
    await waitLong(() => expect(rpcMock).toHaveBeenCalledTimes(1))
    expect(rpcMock.mock.calls[0][1].payload.now.trip.trip_date).toBe('2026-11-18')
  })

  it('an invalid date: "Fix the date first (DD/MM/YYYY)."', () => {
    openPanel()
    choose('Date')
    typeDate('31/02/2026')
    save()
    expect(panel().getByText('Fix the date first (DD/MM/YYYY).')).toBeTruthy()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('saving the value it already has sends nothing, closes the panel, no toast (Date, Paid by, Store)', async () => {
    openPanel()
    choose('Date')
    save()
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
    fireEvent.click(changeButton())
    choose('Paid by')
    expect(panel().getByLabelText('Paid by').value).toBe(P1)
    save()
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
    fireEvent.click(changeButton())
    choose('Store')
    expect(panel().getByLabelText('Bought at').value).toBe('lidl')
    save()
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(purchase.setTripShop).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])
  })

  it('Store: today\'s path (setTripShop) for the whole purchase; the panel closes', async () => {
    openPanel()
    choose('Store')
    fireEvent.change(panel().getByLabelText('Bought at'), { target: { value: 'coop' } })
    save()
    await waitLong(() => expect(purchase.setTripShop).toHaveBeenCalledWith('t1', 'coop', { flowReady: true }))
    await waitLong(() => expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull())
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('"Paid by" (K205, K208, K236)', () => {
  it('a mixed purchase: the select offers the three accounts only, starts on "Choose…", "Now: … (3) · … (2)"; without a choice "Choose who paid."; → Joint every expense, parts empty', async () => {
    data.trips = [{ ...shopTrip, paid_by: null }]
    data.expenses = [
      ...shopExpenses({ e2: { paid_by: P2 } }),
      { id: 'e4', trip_id: 't1', description: 'TEST eggs', amount: 2, category_id: 'groceries', expense_date: '2026-11-15', paid_by: P2, shop_id: 'lidl', ...parts(null, null) },
      { id: 'e5', trip_id: 't1', description: 'TEST rice', amount: 1, category_id: 'groceries', expense_date: '2026-11-15', paid_by: P1, shop_id: 'lidl', ...parts(null, null) },
    ]
    openPanel()
    choose('Paid by')
    const select = panel().getByLabelText('Paid by')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose…', label(P1), label(P2), label(JOINT)])
    expect(select.value).toBe('')
    expect(panel().getByText(`Now: ${label(P1)} (3) · ${label(P2)} (2)`)).toBeTruthy()
    expect(panel().getByText('All 5 expenses of this purchase get this payer.')).toBeTruthy()
    save()
    expect(panel().getByText('Choose who paid.')).toBeTruthy()
    fireEvent.change(select, { target: { value: JOINT } })
    save()
    await waitLong(() => expect(rpcMock).toHaveBeenCalledTimes(1))
    const { payload } = rpcMock.mock.calls[0][1]
    expect(payload.now.expenses.map((e) => [e.paid_by, e[`part_${P1}`], e[`part_${P2}`]])).toEqual(Array(5).fill([JOINT, null, null]))
    expect(payload.now.trip.paid_by).toBe(JOINT)
    expect(payload.was.trip.paid_by).toBeNull()
    await waitLong(() => expect(toast(`Paid by changed for 5 expenses of this purchase · ${label(JOINT)}`)).toBeTruthy())
  })

  it('a Shared purchase: "Now: Shared — its parts are cleared when you save.", Shared never offered; one expense: "The 1 expense of this purchase gets this payer."', () => {
    data.trips = [{ ...shopTrip, paid_by: SHARED }]
    data.expenses = [shopExpenses({ e1: { paid_by: SHARED, ...parts(1.5, 1.61) } })[0]]
    openPanel()
    choose('Paid by')
    expect([...panel().getByLabelText('Paid by').options].map((o) => o.value)).toEqual(['', P1, P2, JOINT])
    expect(panel().getByText(`Now: ${label(SHARED)} — its parts are cleared when you save.`)).toBeTruthy()
    expect(panel().getByText('The 1 expense of this purchase gets this payer.')).toBeTruthy()
  })
})

describe('n = every expense of the purchase (K237), and the "Sort by" views', () => {
  it('with a category filter on: the "Sort by" line of the purchase has the ▾ too, and counts all 3', async () => {
    render(<ExpensesPage />)
    openList()
    fireEvent.click(ex().getByRole('button', { name: /^Sort by category/ }))
    fireEvent.click(within(ex().getByRole('region', { name: 'Sort by category' })).getByRole('button', { name: 'Groceries' }))
    // The purchase's line in the card: 2 of its 3 expenses shown.
    fireEvent.click(ex().getByRole('button', { name: /Lidl · 15\/11 · 2 items/ }))
    expect(ex().getByText('of total €10.22')).toBeTruthy()
    fireEvent.click(changeButton())
    choose('Date')
    expect(panel().getByText('All 3 expenses of this purchase move to this day.')).toBeTruthy()
    choose('Store')
    expect(panel().getByText('Purchase of 15/11/2026: the store changes for all 3 of its expenses, in every budget category.')).toBeTruthy()
  })

  it('with a person pill: only that person\'s expense is shown, the panel still counts all 3', () => {
    data.expenses = shopExpenses({ e3: { paid_by: P2 } })
    render(<ExpensesPage />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name: label(P2) }))
    openList()
    openRow()
    fireEvent.click(changeButton())
    choose('Paid by')
    expect(panel().getByText('All 3 expenses of this purchase get this payer.')).toBeTruthy()
    expect(panel().getByText(`Now: ${label(P1)} (2) · ${label(P2)} (1)`)).toBeTruthy()
  })

  it('MONEY and merged purchases get the ▾ too (with Undo purchase / Split beside it)', () => {
    data.trips = [{ ...shopTrip, source: 'money' }]
    render(<ExpensesPage />)
    openList()
    openRow()
    expect(changeButton()).toBeTruthy()
    expect(ex().getByText('Undo purchase')).toBeTruthy()
    cleanup()
    data.trips = [{ ...shopTrip, source: 'merged' }]
    data.expenses = shopExpenses().map((e) => ({ ...e, merged_at: '2026-11-15T10:00:00Z' }))
    render(<ExpensesPage />)
    openList()
    openRow()
    expect(changeButton()).toBeTruthy()
    expect(ex().getByText('Split')).toBeTruthy()
  })
})

describe('before 034, offline, a failed save, the guard (K237)', () => {
  it('before 034: Date and Paid by say the 034 notice in the red line; Store still works', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.change_purchase(payload) in the schema cache' } })
    openPanel()
    choose('Date')
    typeDate('13/11/2026')
    save()
    expect(await findLong(panel(), CHANGE_PURCHASE_NOTICE)).toBeTruthy()
    choose('Paid by')
    fireEvent.change(panel().getByLabelText('Paid by'), { target: { value: JOINT } })
    save()
    expect(await findLong(panel(), CHANGE_PURCHASE_NOTICE)).toBeTruthy()
    choose('Store')
    fireEvent.change(panel().getByLabelText('Bought at'), { target: { value: 'coop' } })
    save()
    await waitLong(() => expect(purchase.setTripShop).toHaveBeenCalledWith('t1', 'coop', { flowReady: true }))
    expect(getToasts().filter((t) => /changed for/.test(t.message))).toEqual([])
  })

  it('offline: "You\'re offline — this needs a connection.", nothing sent or queued, the panel keeps the date', async () => {
    openPanel()
    choose('Date')
    await settle()
    setOnlineForTest(false)
    typeDate('13/11/2026')
    save()
    expect(toast("You're offline — this needs a connection.")).toBeTruthy()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(panel().getByLabelText('Date').value).toBe('13/11/2026')
  })

  it('a failed save: "Couldn\'t save — check your connection." with Retry, which presses Save again; the panel keeps the choice', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Load failed' } })
    openPanel()
    choose('Date')
    typeDate('13/11/2026')
    save()
    await waitLong(() => expect(toast("Couldn't save — check your connection.")).toBeTruthy())
    const failed = toast("Couldn't save — check your connection.")
    expect(failed.action.label).toBe('Retry')
    expect(panel().getByLabelText('Date').value).toBe('13/11/2026')
    await runToastAction(failed.id)
    await waitLong(() => expect(rpcMock).toHaveBeenCalledTimes(2))
    expect(rpcMock.mock.calls[1][1].payload).toEqual(rpcMock.mock.calls[0][1].payload)
    await waitLong(() => expect(toast('Date changed for 3 expenses of this purchase · 13/11/2026')).toBeTruthy())
  })

  it('the guard: another device changed it meanwhile → the guard text in the red line', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'P0001', message: CHANGED_MEANWHILE } })
    openPanel()
    choose('Paid by')
    fireEvent.change(panel().getByLabelText('Paid by'), { target: { value: JOINT } })
    save()
    expect(await findLong(panel(), CHANGED_MEANWHILE)).toBeTruthy()
  })
})

describe('an order-group row (K207): the ▾ saves like the "Order group" sheet', () => {
  const order = (id, patch = {}) => ({ id, item_name: `TEST order ${id}`, status: 'on_the_way', group_id: 'g1', group_share: 0, price: 10, shop_id: 'coop', order_date: '2026-11-10', paid_by: P1, created_at: `2026-11-10T10:00:0${id.slice(-1)}Z`, ...patch })
  beforeEach(() => {
    data.trips = []
    data.groups = [{ id: 'g1', shop_id: 'coop', order_date: '2026-11-10', paid_by: P1, discount_kind: null, discount_value: null, discount_total: 0 }]
    data.orders = [order('o1', { expense_id: 'x1' }), order('o2', { expense_id: 'x2' })]
    data.expenses = ['x1', 'x2'].map((id) => ({ id, description: `TEST order ${id}`, amount: 10, category_id: 'groceries', expense_date: '2026-11-10', paid_by: P1, shop_id: 'coop', ...parts(null, null) }))
  })

  it('its own "Open the order group" stays; Date → "Order date", a day after today is accepted (the sheet does), the amber line, saved with saveGroupDetails', async () => {
    render(<ExpensesPage />)
    openList()
    openRow(/Iper Coop · 10\/11\/2026/)
    expect(ex().getByText('Open the order group')).toBeTruthy()
    fireEvent.click(changeButton())
    choose('Date')
    const field = panel().getByLabelText('Order date')
    fireEvent.change(field, { target: { value: '25/11/2026' } })
    fireEvent.blur(field)
    expect(panel().getByText('Saving changes the store, order date and payer of all 2 orders and of their expenses.')).toBeTruthy()
    save()
    await waitLong(() => expect(groups.saveGroupDetails).toHaveBeenCalledTimes(1))
    const [group, members, { discount, place }] = groups.saveGroupDetails.mock.calls[0]
    expect(group.id).toBe('g1')
    expect(members.map((o) => o.id)).toEqual(['o1', 'o2'])
    expect(discount).toBeNull()
    expect(place).toEqual({ shop_id: 'coop', order_date: '2026-11-25', paid_by: P1 })
    await waitLong(() => expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull())
  })

  it('Paid by offers the accounts (Shared only for a Shared group); "(paid by …)" in the amber line; Store "Store"; the same value sends nothing', async () => {
    render(<ExpensesPage />)
    openList()
    openRow(/Iper Coop · 10\/11\/2026/)
    fireEvent.click(changeButton())
    choose('Paid by')
    expect([...panel().getByLabelText('Paid by').options].map((o) => o.value)).toEqual([P1, P2, JOINT])
    fireEvent.change(panel().getByLabelText('Paid by'), { target: { value: P2 } })
    expect(panel().getByText(`Saving changes the store, order date and payer of all 2 orders and of their expenses (paid by ${label(P2)}).`)).toBeTruthy()
    choose('Store')
    expect(panel().getByLabelText('Store').value).toBe('coop')
    save()
    expect(groups.saveGroupDetails).not.toHaveBeenCalled()
    expect(ex().queryByRole('region', { name: 'Change purchase' })).toBeNull()
    cleanup()
    data.groups = [{ ...data.groups[0], paid_by: SHARED }]
    data.orders = data.orders.map((o) => ({ ...o, paid_by: SHARED }))
    data.expenses = data.expenses.map((e) => ({ ...e, paid_by: SHARED }))
    render(<ExpensesPage />)
    openList()
    openRow(/Iper Coop · 10\/11\/2026/)
    fireEvent.click(changeButton())
    choose('Paid by')
    expect([...panel().getByLabelText('Paid by').options].map((o) => o.value)).toEqual([P1, P2, JOINT, SHARED])
  })

  it('the group is gone while the panel is open (read, but no row of it any more): the grey line says "another device", never "phone"', () => {
    const { rerender } = render(<ExpensesPage />)
    openList()
    openRow(/Iper Coop · 10\/11\/2026/)
    fireEvent.click(changeButton())
    data.groups = []
    rerender(<ExpensesPage />)
    expect(panel().getByText('This order group no longer exists (ungrouped, maybe on another device).')).toBeTruthy()
    expect(panel().getByText(ORDER_GROUP_GONE)).toBeTruthy()
    expect(panel().queryByText(/phone/)).toBeNull()
  })
})
