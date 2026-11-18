// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Round 9K: "Shared" with each person's part on screen — Money "Add
// expense" (one expense and a purchase with a coupon), "Edit expense",
// SHOP "Confirm purchase" (lines paid by each person and Shared lines),
// the personal pills of Money (A1), and everything before 029.
// The payers come from PAID_BY_OPTIONS (never written out here). The
// 27/10 numbers (€268.58 = €100.00 + €168.58) are tried both ways round.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({
  pantry: [
    { id: 'oil', name: 'Olive oil', unit: 'btl', current_stock: 1, min_stock: 0, category_id: 'pantry-staples' },
    { id: 'yogurt', name: 'Yogurt', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'dairy' },
    { id: 'coffee', name: 'Coffee', unit: 'pack', current_stock: 0, min_stock: 1, category_id: 'beverages' },
  ],
  expenses: [],
  trips: [],
}))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
const notRead = vi.hoisted(() => ({ getSnapshot: () => ({ rows: [], loaded: false }), refresh: () => {} }))
vi.mock('../lib/stores', async (original) => {
  const { emptyStore } = await import('../lib/tableStore')
  notRead.useRows = emptyStore.useRows
  return {
    ...(await original()),
    // The leftover's rows (plan 9O prompt 4) never read here: the top card
    // stays as before (no leftover line, no "Available" bar).
    expensesBefore: () => notRead,
    incomeBefore: () => notRead,
    pantryStore: fake(() => data.pantry),
    transferStore: fake(() => []),
    groceryStore: fake(() => []),
    orderStore: fake(() => []),
    budgetMapStore: fake(() => []),
    tripStore: fake(() => data.trips),
    tripItemStore: fake(() => []),
    shopStore: fake(() => []),
    inventoryCategoryStore: fake(() => [{ id: 'pantry-staples', name: 'Pantry Staples' }]),
  }
})
const parents = [{ id: 'pantry-staples', name: 'Pantry Staples', type: 'parent' }]
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
vi.mock('../hooks/usePurchase', () => ({
  recordMoneyPurchase: (...args) => recordMoneyPurchase(...args),
  usePurchase: () => ({ confirmPurchase: (...args) => confirmPurchase(...args) }),
  askUndoPurchase: vi.fn(),
  reopenTrip: vi.fn(),
}))
const addExpenseOnce = vi.fn(async () => ({ error: null }))
const updateExpense = vi.fn(async () => ({ error: null }))
const categories = [
  { id: 'housing', name: 'Housing & Utilities', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'pets', name: 'Pets', parent_id: null },
]
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: (...args) => addExpenseOnce(...args),
  useExpenses: () => ({ expenses: data.expenses, categories, updateExpense: (...args) => updateExpense(...args), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), deleteExpense: vi.fn() }),
}))
vi.mock('../hooks/useIncome', () => ({
  useIncome: () => ({ income: [], missing: false, categories: [], categoriesMissing: false, addIncome: vi.fn(), updateIncome: vi.fn(), deleteIncome: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn() }),
}))
vi.mock('../hooks/useCategoryColors', () => ({ useCategoryColors: () => () => ({ hex: '#888888' }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('./expenses/OrdersSection', () => ({ OrdersSection: () => null }))
vi.mock('./expenses/IncomeSection', () => ({ IncomeSection: () => null }))
// The charts get what the list gets: kept to check "By category" and "Trend".
const charts = vi.hoisted(() => ({ last: null }))
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => {
    charts.last = props
    return null
  },
}))

const { PAID_BY_OPTIONS } = await import('../data/constants')
const { getPeriodRange, localDateString } = await import('../lib/expensePeriods')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { ExpenseForm } = await import('./expenses/ExpenseForm')
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { ExpensesPage } = await import('../pages/ExpensesPage')
const { confirmationPayload } = await import('../lib/purchase')
const { setOnlineForTest } = await import('../lib/connection')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')
const client = await import('../lib/supabaseClient')

const PEOPLE = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const [P1, P2] = PEOPLE
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const [L1, L2] = [label(P1), label(P2)]
const SHARED = label('shared')
const both = [
  [P1, P2],
  [P2, P1],
]
const field = (code) => screen.getByLabelText(`${label(code)} paid (€)`)
const typeIn = (el, value) => fireEvent.change(el, { target: { value } })
const type = (text, value) => typeIn(screen.getByLabelText(text), value)
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })
const round = (n) => Math.round(n * 100) / 100

afterEach(() => {
  cleanup()
  confirmPurchase.mockClear()
  recordMoneyPurchase.mockClear()
  addExpenseOnce.mockClear()
  updateExpense.mockClear()
  data.expenses = []
  data.trips = []
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  setOnlineForTest(true)
  forgetPartsForTest()
  delete client.supabase.from
})

const purchaseForm = (partsReady = true, checkParts) =>
  render(
    <PurchaseForm
      expenseCategories={categories}
      mainCategories={categories}
      subsOf={() => []}
      addCategory={vi.fn()}
      renameCategory={vi.fn()}
      moveCategory={vi.fn()}
      deleteCategory={vi.fn()}
      styleFor={() => ({ hex: '#000' })}
      onClose={vi.fn()}
      partsReady={partsReady}
      checkParts={checkParts}
    />
  )

// Plan 9P K216 / K217: "Shared" is not used for new data. "+ Add expense"
// offers the accounts only, starts on "Choose…", and never shows the parts
// fields (the parts stay for the Shared expenses that already exist: "Edit
// expense" below, and the personal pills).
describe('Money → Expenses → "+ Add expense": no Shared for new data (K216, K217)', () => {
  it.each([true, false])('partsReady %s: "Paid by" offers the accounts only, no parts fields; saving waits for a payer', async (ready) => {
    purchaseForm(ready)
    type('Name', 'TEST condo fees')
    type('Price', '268,58')
    const select = screen.getByLabelText('Paid by')
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.value)).toEqual(['', ...PAID_BY_OPTIONS.filter((o) => o.kind !== 'split').map((o) => o.value)])
    expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Split equally' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add expense · €268.58' }))
    expect(addExpenseOnce).not.toHaveBeenCalled()
    expect(screen.getByText('Choose who paid.')).toBeTruthy()
    type('Paid by', P2)
    fireEvent.click(screen.getByRole('button', { name: 'Add expense · €268.58' }))
    await waitFor(() => expect(addExpenseOnce).toHaveBeenCalledTimes(1))
    expect(addExpenseOnce.mock.calls[0][0]).toMatchObject({ amount: 268.58, paidBy: P2 })
    expect('parts' in addExpenseOnce.mock.calls[0][0]).toBe(false)
  })
})

describe('Money → "+ Add expense": a purchase of several rows with a coupon', () => {
  const fill = () => {
    purchaseForm()
    type('Name', 'Cat litter')
    type('Price', '10')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    type('Name of item 2', 'Sun cream')
    type('Price of item 2', '12')
    type('Discount of item 2', '30')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    type('Name of item 3', 'Dinner')
    type('Price of item 3', '20')
    type('Purchase discount', '5')
  }

  it('paid by one person: no fields and no parts on any line', async () => {
    fill()
    type('Paid by', P1)
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase · €33.40' }))
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items.some((i) => `part_${P1}` in i)).toBe(false)
  })
})

describe('Money → Expenses → a row → pencil "Edit expense"', () => {
  const edit = (initial, partsReady = true) => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    render(<ExpenseForm initial={initial} submitLabel="Save" categories={categories} mainCategories={categories} subsOf={() => []} onSubmit={onSubmit} onCancel={vi.fn()} partsReady={partsReady} />)
    return onSubmit
  }
  const base = { id: 'e1', amount: 268.58, description: 'SPESE CONDOMINIO', category_id: 'housing', expense_date: '2026-10-27', paid_by: 'shared', ...parts(null, null) }
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  it('an old Shared expense without parts: the fields are empty, it may be saved for another change without parts', async () => {
    const onSubmit = edit(base)
    expect(field(P1).value).toBe('')
    typeIn(screen.getByPlaceholderText('e.g. Cigarettes, dinner out…'), 'Spese condominio ottobre')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ description: 'Spese condominio ottobre', paidBy: 'shared', parts: null })
  })

  it.each(both)('…once a part is typed they must add up: %s 100 → the other 168.58, saved', async (p100, p168) => {
    const onSubmit = edit(base)
    typeIn(field(p100), '100')
    typeIn(field(p168), '160')
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('The parts add up to €260.00, not €268.58.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Put the difference on ${label(p100)}` }))
    expect(field(p100).value).toBe('108.58')
    typeIn(field(p100), '100')
    typeIn(field(p168), '168,58')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].parts).toEqual({ [p100]: 100, [p168]: 168.58 })
  })

  it('a Shared expense with parts: they show; a new amount must be split again (the one-tap fix works)', async () => {
    const onSubmit = edit({ ...base, ...parts(100, 168.58) })
    expect([field(P1).value, field(P2).value]).toEqual(['100.00', '168.58'])
    type('Amount (€)', '260')
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('The parts add up to €268.58, not €260.00.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Put the difference on ${L2}` }))
    expect(field(P2).value).toBe('160.00')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 260, parts: { [P1]: 100, [P2]: 160 } })
  })

  it('the amount was changed elsewhere (K9): the amber note, and Save waits until the parts fit', async () => {
    const onSubmit = edit({ ...base, amount: 260, ...parts(100, 168.58) })
    expect(screen.getByText('Parts were for €268.58 — the expense is now €260.00. Edit to check.')).toBeTruthy()
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: `Put the difference on ${L2}` }))
    expect(screen.queryByText(/Parts were for/)).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].parts).toEqual({ [P1]: 100, [P2]: 160 })
  })

  it('Shared → a person: the fields go and the parts are emptied', async () => {
    const onSubmit = edit({ ...base, ...parts(100, 168.58) })
    type('Paid by', P1)
    expect(screen.queryByLabelText(`${L1} paid (€)`)).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ paidBy: P1, parts: null })
  })

  // Plan 9P K216: only a Shared expense keeps "Shared" on offer; a person's
  // or a Joint expense can't become Shared.
  it('a Shared expense offers the accounts + Shared; a person\'s or a Joint expense offers no Shared', () => {
    const accounts = PAID_BY_OPTIONS.filter((o) => o.kind !== 'split').map((o) => o.value)
    edit(base)
    expect([...screen.getByLabelText('Paid by').options].map((o) => o.value)).toEqual([...accounts, 'shared'])
    cleanup()
    for (const payer of [P2, 'joint']) {
      edit({ ...base, paid_by: payer, amount: 54.2, description: 'TEST pharmacy' })
      const select = screen.getByLabelText('Paid by')
      expect(select.value).toBe(payer)
      expect([...select.options].map((o) => o.value)).toEqual(accounts)
      expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
      cleanup()
    }
  })

  it('before 029: no fields, and nothing about parts is sent', async () => {
    const { [`part_${P1}`]: _a, [`part_${P2}`]: _b, ...old } = base
    const onSubmit = edit(old, false)
    expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect('parts' in onSubmit.mock.calls[0][0]).toBe(false)
  })
})

describe('Shop → "Confirm purchase": lines paid by each person and Shared lines', () => {
  const cart = () => [
    { id: 'oil', name: 'Olive oil', category_id: 'pantry-staples', quantity: 1, unit: 'btl', price: 8.99, price_qty: 1, price_unit: 'btl', payer: 'shared', in_cart: true },
    { id: 'yogurt', name: 'Yogurt', category_id: 'dairy', quantity: 4, unit: 'pcs', price: 3.6, price_qty: 4, price_unit: 'pcs', payer: P1, in_cart: true },
    { id: 'coffee', name: 'Coffee', category_id: 'beverages', quantity: 2, unit: 'pack', price: 10.8, price_qty: 2, price_unit: 'pack', payer: 'shared', in_cart: true },
    { id: 'bulb', name: 'Bulb', category_id: 'appliances', quantity: 1, unit: 'pcs', price: 4.2, price_qty: 1, price_unit: 'pcs', payer: P2, in_cart: true },
  ]
  const screenFor = (partsReady = true, items = cart()) =>
    render(
      <ConfirmPurchase
        cartItems={items}
        pantryItems={data.pantry}
        categoryName={(id) => id}
        totalOf={(i) => round((i.price * i.quantity) / (i.price_qty || 1))}
        updatePricing={async () => ({})}
        updatePayer={async () => ({})}
        toggleCart={async () => ({})}
        onClose={() => {}}
        partsReady={partsReady}
      />
    )
  const confirmButton = () => screen.getByRole('button', { name: /^Confirm purchase · / })

  // Plan 9P K225: a card on "Shared" is "not chosen yet" — no parts box any
  // more; Confirm waits until every card has one of the three accounts.
  it.each([true, false])('partsReady %s: the 2 cards on Shared are "not chosen": nothing lit on them, no box, Confirm waits with the line', (ready) => {
    screenFor(ready)
    expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
    expect(screen.queryByText(/What each one paid/)).toBeNull()
    for (const name of ['Olive oil', 'Coffee']) {
      const pills = screen.getByRole('group', { name: `Paid by for ${name}` })
      expect(within(pills).getAllByRole('button').some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false)
      expect(within(pills).queryByRole('button', { name: SHARED })).toBeNull()
    }
    expect(screen.getByText('Choose who paid for 2 items: tap a name under "Paid by (everything)" or on each card.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
  })

  it('a tap on a card\'s pill chooses it; the last one chosen frees Confirm; nothing is split', async () => {
    screenFor()
    fireEvent.click(within(screen.getByRole('group', { name: 'Paid by for Olive oil' })).getByRole('button', { name: L1 }))
    expect(screen.getByText('Choose who paid for 1 item: tap a name under "Paid by (everything)" or on each card.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('group', { name: 'Paid by for Coffee' })).getByRole('button', { name: 'Joint' }))
    expect(screen.queryByText(/^Choose who paid/)).toBeNull()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const args = confirmPurchase.mock.calls[0][0]
    expect(args.partsByItem).toBeNull()
    const items = confirmationPayload({ ...args, expenseCategoryFor: () => 'groceries' }).items
    expect(Object.fromEntries(items.map((i) => [i.grocery_item_id, i.payer]))).toEqual({ oil: P1, yogurt: P1, coffee: 'joint', bulb: P2 })
  })

  it('"Paid by (everything)" → a person: every card takes it, nothing lit before; Confirm sends it on every line', async () => {
    screenFor()
    const everything = screen.getByRole('group', { name: 'Paid by (everything)' })
    expect(within(everything).getAllByRole('button').map((b) => b.textContent)).toEqual(PAID_BY_OPTIONS.filter((o) => o.kind !== 'split').map((o) => o.label))
    expect(within(everything).getAllByRole('button').some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false)
    fireEvent.click(within(everything).getByRole('button', { name: L2 }))
    expect(within(everything).getByRole('button', { name: L2 }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(confirmButton())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(confirmPurchase.mock.calls[0][0].partsByItem).toBeNull()
    expect(confirmPurchase.mock.calls[0][0].paidBy).toBe(P2)
  })
})

describe('Money → section Expenses → the personal pills (A1)', () => {
  // Dates in the month on screen.
  const day = (n) => {
    const d = getPeriodRange('month', new Date()).start
    return localDateString(new Date(d.getFullYear(), d.getMonth(), n))
  }
  const withColumns = (rows) => rows.map((e) => ({ ...parts(null, null), ...e }))
  const month = (p100, p168, { bill = {} } = {}) =>
    withColumns([
      { id: 'bill', amount: 268.58, description: 'SPESE CONDOMINIO', category_id: 'housing', expense_date: day(27), paid_by: 'shared', [`part_${p100}`]: 100, [`part_${p168}`]: 168.58, ...bill },
      { id: 'bread', amount: 12.5, description: 'Bread', category_id: 'groceries', expense_date: day(20), paid_by: p100 },
      { id: 'catfood', amount: 7, description: 'Cat food', category_id: 'pets', expense_date: day(21), paid_by: p168 },
      { id: 'old', amount: 31.42, description: 'Pharmacy', category_id: 'groceries', expense_date: day(5), paid_by: 'shared' },
      { id: 'litter', amount: 8.7, description: 'Cat litter', category_id: 'pets', expense_date: day(12), paid_by: 'shared', trip_id: 'trip1', [`part_${p100}`]: 5.21, [`part_${p168}`]: 3.49 },
      { id: 'dinner', amount: 17.39, description: 'Dinner', category_id: 'groceries', expense_date: day(12), paid_by: 'shared', trip_id: 'trip1', [`part_${p100}`]: 10.41, [`part_${p168}`]: 6.98 },
    ])
  const page = () => render(<ExpensesPage />)
  // The list and "Totals per category" are closed bars (plan 9O): opened first.
  const openBar = (name) => fireEvent.click(screen.getByRole('button', { name }))
  const openList = () => openBar(/^Expenses \(/)
  const pill = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name }))
  const summary = () => screen.getByText('Balance').closest('div').parentElement
  const chip = () => screen.getByRole('heading', { name: 'Expenses' }).parentElement
  const groupOf = (title) => screen.getByText(title, { selector: 'p' }).closest('button')

  it.each(both)('the pill of the one who paid €100.00 (%s here): own expenses whole + each part; totals, chip, charts, Totals per category follow; the K4 note', (p100, p168) => {
    data.expenses = month(p100, p168)
    data.trips = [{ id: 'trip1', trip_date: day(12), source: 'money', shop_id: null }]
    page()
    openList()
    openBar(/^Totals per category \(/)
    // Everyone: whole amounts, no note.
    expect(within(summary()).getByText('€345.59')).toBeTruthy()
    expect(within(chip()).getByText('€345.59')).toBeTruthy()
    expect(screen.queryByText(/without parts/)).toBeNull()

    pill(label(p100))
    // 100 + 12.50 + 5.21 + 10.41 = 128.12
    expect(within(summary()).getByText(`· ${label(p100)}`)).toBeTruthy()
    expect(within(summary()).getByText('€128.12')).toBeTruthy()
    expect(within(chip()).getByText('€128.12')).toBeTruthy()
    expect(within(summary()).getByText(`1 ${SHARED} expense without parts (€31.42) is not in this total.`)).toBeTruthy()
    // The bill's row: €100.00 "of €268.58"; opened, the parts line.
    const bill = groupOf('Housing & Utilities')
    expect(within(bill).getByText('€100.00')).toBeTruthy()
    expect(within(bill).getByText('of €268.58')).toBeTruthy()
    fireEvent.click(bill)
    const card = bill.parentElement
    expect(within(card).getAllByText('€100.00').length).toBeGreaterThan(1)
    expect(within(card).getAllByText('of €268.58').length).toBeGreaterThan(1)
    const line = `${L1} €${p100 === P1 ? '100.00' : '168.58'} · ${L2} €${p100 === P1 ? '168.58' : '100.00'}`
    expect(within(card).getByText(line)).toBeTruthy()
    // The purchase: its parts' sum "of total €26.09".
    const purchase = screen.getByText(/^Purchase · /).closest('button')
    expect(within(purchase).getByText('€15.62')).toBeTruthy()
    expect(within(purchase).getByText('of total €26.09')).toBeTruthy()
    // Totals per category and the "By category" chart.
    const totals = screen.getByRole('region', { name: 'Totals per category' })
    expect(within(totals).getByText('€100.00')).toBeTruthy()
    expect(charts.last.pieData.find((p) => p.name === 'Housing & Utilities').value).toBe(100)

    pill(label(p168))
    // 168.58 + 7 + 3.49 + 6.98 = 186.05; together with the other: everything but the €31.42 without parts.
    expect(within(summary()).getByText('€186.05')).toBeTruthy()
    expect(round(128.12 + 186.05 + 31.42)).toBe(345.59)
    expect(within(groupOf('Housing & Utilities')).getByText('of €268.58')).toBeTruthy()

    pill(SHARED)
    expect(within(summary()).getByText('€326.09')).toBeTruthy()
    expect(screen.queryByText(/without parts/)).toBeNull()
    expect(screen.queryByText('of €268.58')).toBeNull()
  })

  it('Edit from a personal view opens the expense itself (the whole €268.58)', () => {
    data.expenses = month(P1, P2)
    page()
    openList()
    pill(L2)
    const bill = groupOf('Housing & Utilities')
    fireEvent.click(bill)
    fireEvent.click(within(bill.parentElement).getByRole('button', { name: 'Edit expense' }))
    expect(screen.getByLabelText('Amount (€)').value).toBe('268.58')
    expect([field(P1).value, field(P2).value]).toEqual(['100.00', '168.58'])
  })

  it('K9: an amount changed elsewhere shows the parts scaled, with the amber note', () => {
    data.expenses = month(P1, P2, { bill: { amount: 260 } })
    page()
    openList()
    pill(L1)
    const bill = groupOf('Housing & Utilities')
    expect(within(bill).getByText('€96.81')).toBeTruthy()
    expect(within(bill).getByText('of €260.00')).toBeTruthy()
    fireEvent.click(bill)
    expect(within(bill.parentElement).getByText('Parts were for €268.58 — the expense is now €260.00. Edit to check.')).toBeTruthy()
    expect(within(bill.parentElement).getByText(`${L1} €96.81 · ${L2} €163.19`)).toBeTruthy()
  })

  it('"+ Add expense" never shows the fields, also once 029 has run (plan 9P K216: no Shared for new data)', () => {
    data.expenses = month(P1, P2)
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
    expect([...screen.getByRole('combobox', { name: 'Paid by' }).options].map((o) => o.value)).not.toContain('shared')
  })

  it('before 029 (no part columns): a person sees only their own expenses, no note, no fields — exactly as before', () => {
    data.expenses = month(P1, P2).map(({ [`part_${P1}`]: _a, [`part_${P2}`]: _b, ...e }) => e)
    page()
    openList()
    pill(L1)
    expect(within(summary()).getByText('€12.50')).toBeTruthy()
    expect(screen.queryByText(/without parts/)).toBeNull()
    expect(screen.getByText('Groceries', { selector: 'p' })).toBeTruthy()
    expect(screen.queryByText('Housing & Utilities', { selector: 'p' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.queryByRole('group', { name: 'What each one paid' })).toBeNull()
  })

  // Follow-up 01/11 (K14): a Shared expense whose part is €0 for a person.
  const zeroMonth = () =>
    withColumns([
      { id: 'vet', amount: 84.3, description: 'Vet visit', category_id: 'pets', expense_date: day(9), paid_by: 'shared', ...parts(0, 84.3) },
      { id: 'detergent', amount: 6.49, description: 'Detergent', category_id: 'groceries', expense_date: day(14), paid_by: 'shared', trip_id: 'trip-ld', ...parts(0, 6.49) },
      { id: 'rice', amount: 2.35, description: 'Rice', category_id: 'groceries', expense_date: day(14), paid_by: 'shared', trip_id: 'trip-ld', ...parts(0, 2.35) },
      { id: 'apples', amount: 2.99, description: 'Apples', category_id: 'groceries', expense_date: day(18), paid_by: 'shared', trip_id: 'trip-co', ...parts(1.2, 1.79) },
      { id: 'soap', amount: 3.1, description: 'Soap', category_id: 'groceries', expense_date: day(18), paid_by: 'shared', trip_id: 'trip-co', ...parts(0, 3.1) },
      { id: 'fuel', amount: 46.1, description: 'Fuel', category_id: 'housing', expense_date: day(3), paid_by: P1 },
      { id: 'bread', amount: 3.4, description: 'Bread', category_id: 'groceries', expense_date: day(22), paid_by: P2 },
    ])
  const zeroTrips = () => [
    { id: 'trip-ld', trip_date: day(14), source: 'money', shop_id: null },
    { id: 'trip-co', trip_date: day(18), source: 'money', shop_id: null },
  ]

  it('K14: a part of €0 is not listed in that person\'s pill (a plain expense, a purchase line, a purchase with every line €0); totals unchanged; Everyone and Shared unchanged', () => {
    data.expenses = zeroMonth()
    data.trips = zeroTrips()
    page()
    openList()
    expect(within(summary()).getByText('€148.73')).toBeTruthy()
    expect(screen.getAllByText(/^Purchase · /)).toHaveLength(2)

    pill(L1)
    // 46.10 + 1.20: the €0 parts add nothing and show nothing.
    expect(within(summary()).getByText('€47.30')).toBeTruthy()
    expect(within(chip()).getByText('€47.30')).toBeTruthy()
    expect(screen.queryByText('Pets', { selector: 'p' })).toBeNull()
    expect(screen.queryByText('of €84.30')).toBeNull()
    // Only the purchase with a line of theirs, still "of total €6.09".
    const purchases = screen.getAllByText(/^Purchase · /)
    expect(purchases).toHaveLength(1)
    const purchase = purchases[0].closest('button')
    expect(within(purchase).getByText('€1.20')).toBeTruthy()
    expect(within(purchase).getByText('of total €6.09')).toBeTruthy()
    fireEvent.click(purchase)
    expect(within(purchase.parentElement).getByText('Apples')).toBeTruthy()
    expect(within(purchase.parentElement).queryByText('Soap')).toBeNull()

    pill(L2)
    // 84.30 + 6.49 + 2.35 + 1.79 + 3.10 + 3.40; with the other pill, Everyone.
    expect(within(summary()).getByText('€101.43')).toBeTruthy()
    expect(round(47.3 + 101.43)).toBe(148.73)
    expect(screen.getByText('Pets', { selector: 'p' })).toBeTruthy()
    expect(screen.getAllByText(/^Purchase · /)).toHaveLength(2)

    pill(SHARED)
    expect(within(summary()).getByText('€99.23')).toBeTruthy()
    expect(screen.getAllByText(/^Purchase · /)).toHaveLength(2)
  })

  it.each(both)('K20: "Select" in the pill of %s lists only that person\'s own expenses; Everyone and Shared list as before', (own, other) => {
    data.expenses = month(own, other)
    data.trips = [{ id: 'trip1', trip_date: day(12), source: 'money', shop_id: null }]
    const listed = () => ['SPESE CONDOMINIO', 'Bread', 'Cat food', 'Pharmacy', 'Cat litter', 'Dinner'].filter((d) => screen.queryByText(d))
    page()
    pill(label(own))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByText('Select expenses')).toBeTruthy()
    expect(listed()).toEqual(['Bread'])
    pill(label(other))
    expect(listed()).toEqual(['Cat food'])
    pill('Everyone')
    expect(listed()).toEqual(['SPESE CONDOMINIO', 'Bread', 'Cat food', 'Pharmacy', 'Cat litter', 'Dinner'])
    pill(SHARED)
    expect(listed()).toEqual(['SPESE CONDOMINIO', 'Pharmacy', 'Cat litter', 'Dinner'])
  })
})

describe('follow-up 01/11: not known yet whether 029 has run (K18)', () => {
  const found = (answer) => vi.fn(async () => answer)
  const box = () => screen.queryByRole('group', { name: 'What each one paid' })

  // "+ Add expense" offers no Shared (plan 9P K216), so it never needs to
  // check for 029.
  it('Money "+ Add expense": an account chosen → no check at all, saved without parts', async () => {
    const notAsked = found(true)
    purchaseForm(null, notAsked)
    type('Name', 'TEST cover')
    type('Price', '9')
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: P2 } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expense · €9.00' }))
    await waitFor(() => expect(addExpenseOnce).toHaveBeenCalledTimes(1))
    expect(notAsked).not.toHaveBeenCalled()
    expect('parts' in addExpenseOnce.mock.calls[0][0]).toBe(false)
    expect(box()).toBeNull()
  })

  it('"Edit expense": an expense read with the part columns tells by itself; otherwise Save checks first', async () => {
    const tells = found(true)
    const onSubmit = vi.fn(async () => ({ error: null }))
    const bill = { id: 'g1', amount: 61.2, description: 'Gas bill', category_id: 'housing', expense_date: '2026-10-29', paid_by: 'shared' }
    render(<ExpenseForm initial={{ ...bill, ...parts(null, null) }} submitLabel="Save" categories={categories} mainCategories={categories} subsOf={() => []} onSubmit={onSubmit} onCancel={vi.fn()} partsReady={null} checkParts={tells} />)
    expect(box()).toBeTruthy()
    cleanup()
    const asks = found(true)
    render(<ExpenseForm initial={bill} submitLabel="Save" categories={categories} mainCategories={categories} subsOf={() => []} onSubmit={onSubmit} onCancel={vi.fn()} partsReady={null} checkParts={asks} />)
    expect(box()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(box()).toBeTruthy())
    expect(asks).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    cleanup()
    setOnlineForTest(false)
    render(<ExpenseForm initial={bill} submitLabel="Save" categories={categories} mainCategories={categories} subsOf={() => []} onSubmit={onSubmit} onCancel={vi.fn()} partsReady={null} checkParts={found(null)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe("You're offline — this needs a connection."))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  describe('Shop → "Confirm purchase"', () => {
    const cart = () => [
      { id: 'milk', name: 'Milk', category_id: 'dairy', quantity: 2, unit: 'pcs', price: 1.35, price_qty: 1, price_unit: 'pcs', payer: 'shared', in_cart: true },
      { id: 'batteries', name: 'Batteries', category_id: 'appliances', quantity: 1, unit: 'pcs', price: 5.99, price_qty: 1, price_unit: 'pcs', payer: P2, in_cart: true },
    ]
    const confirmScreen = (checkParts, items = cart()) =>
      render(
        <ConfirmPurchase
          cartItems={items}
          pantryItems={data.pantry}
          categoryName={(id) => id}
          totalOf={(i) => round((i.price * i.quantity) / (i.price_qty || 1))}
          updatePricing={async () => ({})}
          updatePayer={async () => ({})}
          toggleCart={async () => ({})}
          onClose={() => {}}
          checkParts={checkParts}
        />
      )
    const confirmButton = () => screen.getByRole('button', { name: /^Confirm purchase · / })

    // No card is Shared any more (plan 9P K225), so Confirm never checks
    // for 029; a card on "Shared" waits for a payer instead.
    it('every card with an account: confirmed with no check; a card on Shared: Confirm waits, nothing checked', async () => {
      const notAsked = found(true)
      confirmScreen(notAsked, cart().map((i) => ({ ...i, payer: P1 })))
      fireEvent.click(confirmButton())
      await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
      expect(notAsked).not.toHaveBeenCalled()
      expect(confirmPurchase.mock.calls[0][0].partsByItem).toBeNull()
      cleanup()
      const waits = found(true)
      confirmScreen(waits)
      expect(confirmButton().disabled).toBe(true)
      fireEvent.click(confirmButton())
      expect(waits).not.toHaveBeenCalled()
      expect(box()).toBeNull()
      expect(confirmPurchase).toHaveBeenCalledTimes(1)
    })
  })
})

describe('follow-up 01/11: parts with more than 2 decimals (K21)', () => {
  it('"Edit expense" of a Shared expense: 100,555 fills 168.02 and saves cents that add up; 100,555 + 168,025 is refused (€268.59)', async () => {
    const onSubmit = vi.fn(async () => ({ error: null }))
    const bill = { id: 'e1', amount: 268.58, description: 'TEST roof repair', category_id: 'housing', expense_date: '2026-10-27', paid_by: 'shared', ...parts(null, null) }
    render(<ExpenseForm initial={bill} submitLabel="Save" categories={categories} mainCategories={categories} subsOf={() => []} onSubmit={onSubmit} onCancel={vi.fn()} partsReady />)
    typeIn(field(P1), '100,555')
    expect(field(P2).value).toBe('168.02')
    typeIn(field(P2), '168,025')
    expect(screen.getAllByText('The parts add up to €268.59, not €268.58.').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    typeIn(field(P2), '168,02')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].parts).toEqual({ [P1]: 100.56, [P2]: 168.02 })
  })
})
