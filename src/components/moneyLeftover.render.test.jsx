// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// Plan 9O, prompt 4: the leftover from earlier months (K164–K172), the
// filter total next to the "Sort by" buttons (K186–K188), the income list
// colour (K191) and later months with data in a running period (K192).
// The payers come from PAID_BY_OPTIONS (never written out here).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({ expenses: [], income: [] }))
// The leftover's two stores (every row before a day, read with only what
// the leftover needs): live like the real ones — `changed()` tells them
// the rows changed; `failed` = a read that didn't work.
const live = vi.hoisted(() => ({ version: 0, failed: false, listeners: new Set(), cache: new Map(), reads: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (l) => {
    live.listeners.add(l)
    return () => live.listeners.delete(l)
  }
  const before = (kind, day) => {
    live.reads.push(`${kind} < ${day}`)
    const snap = () => {
      const key = `${kind}|${day}|${live.version}|${live.failed}`
      if (!live.cache.has(key)) {
        const rows = kind === 'expenses' ? data.expenses.filter((e) => e.expense_date < day) : data.income.filter((i) => i.income_date < day)
        live.cache.set(key, live.failed ? { rows: [], loaded: false } : { rows, loaded: true })
      }
      return live.cache.get(key)
    }
    return { useRows: () => useSyncExternalStore(subscribe, snap, snap), getSnapshot: snap, refresh: () => {} }
  }
  return {
    ...(await original()),
    expensesBefore: (key) => before('expenses', key.split('|')[0]),
    incomeBefore: (day) => before('income', day),
    pantryStore: fake(() => []),
    groceryStore: fake(() => []),
    orderStore: fake(() => []),
    budgetMapStore: fake(() => []),
    tripStore: fake(() => []),
    tripItemStore: fake(() => []),
    shopStore: fake(() => []),
    inventoryCategoryStore: fake(() => []),
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
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: vi.fn(), usePurchase: () => ({ confirmPurchase: vi.fn() }), askUndoPurchase: vi.fn(), reopenTrip: vi.fn() }))
const categories = [
  { id: 'going-out', name: 'Going out', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'smoke', name: 'Cigarettes & Vape', parent_id: null },
]
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: vi.fn(async () => ({ error: null })),
  useExpenses: () => ({ expenses: data.expenses, categories, updateExpense: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), deleteExpense: vi.fn() }),
}))
const incomeCategories = [
  { id: 'salary', name: 'Salary', parent_id: null },
  { id: 'other', name: 'Other', parent_id: null },
]
vi.mock('../hooks/useIncome', () => ({
  useIncome: () => ({ income: data.income, loaded: true, missing: false, categories: incomeCategories, categoriesMissing: false, addIncome: vi.fn(), updateIncome: vi.fn(), deleteIncome: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn() }),
}))
vi.mock('../hooks/useCategoryColors', () => ({ useCategoryColors: () => () => ({ hex: '#888888' }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('./expenses/OrdersSection', () => ({ OrdersSection: () => null }))
// The charts as plain buttons: a legend entry per category, a TREND bar
// per bucket ("Week 2 €54.90").
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => (
    <div role="group" aria-label={`Charts: ${props.emptyText}`}>
      {props.pieData.map((p) => (
        <button key={p.key} type="button" onClick={() => props.onCategory(p.key)}>
          {p.name}
        </button>
      ))}
      {props.barData.map((b) => (
        <button key={b.key} type="button" data-bar="" onClick={() => props.onBucket(b.key)}>
          {`${b.label} €${b.amount.toFixed(2)}`}
        </button>
      ))}
    </div>
  ),
}))

const { PAID_BY_OPTIONS } = await import('../data/constants')
const { ExpensesPage } = await import('../pages/ExpensesPage')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')
const { setOnlineForTest } = await import('../lib/connection')
const client = await import('../lib/supabaseClient')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const [L1, L2, SHARED] = [label(P1), label(P2), label('shared')]
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })
const spent = (id, amount, date, paidBy, partsOf = parts(null, null)) => ({ id, description: `TEST ${id}`, amount, category_id: 'groceries', expense_date: date, paid_by: paidBy, ...partsOf })
const earned = (id, amount, date, receivedBy, category = 'salary') => ({ id, amount, income_date: date, category_id: category, received_by: receivedBy, source: `TEST ${id}` })

// The fixture of the prompt (first data October 2026).
// October: household +€1400.00; first person 1200 − (300 + 40) = +€860.00;
// second person 800 − (200 + 60) = +€540.00.
// November: household +€500.00; first person +€500.00; second €0.00.
const OCTOBER = {
  expenses: [spent('x1', 300, '2026-10-10', P1), spent('x2', 200, '2026-10-11', P2), spent('x3', 100, '2026-10-12', 'shared', parts(40, 60))],
  income: [earned('i1', 1200, '2026-10-05', P1), earned('i2', 800, '2026-10-05', P2)],
}
const NOVEMBER = {
  expenses: [spent('x4', 1000, '2026-11-10', P1), spent('x5', 1400, '2026-11-11', P2)],
  income: [earned('i3', 1500, '2026-11-05', P1), earned('i4', 1400, '2026-11-05', P2)],
}
const load = (...months) => {
  data.expenses = months.flatMap((m) => m.expenses)
  data.income = months.flatMap((m) => m.income)
}

// The first-date reads of the period pickers (one select per table).
const firstDates = (expenseDate, incomeDate = expenseDate) => {
  client.supabase.from = (table) => ({
    select: (column) => ({
      order: () => ({
        limit: async () => {
          const date = table === 'expenses' ? expenseDate : incomeDate
          return { data: date ? [{ [column]: date }] : [], error: null }
        },
      }),
    }),
  })
}

const today = (y, m, d) => vi.setSystemTime(new Date(y, m - 1, d, 12))
const changed = () =>
  act(() => {
    live.version += 1
    live.listeners.forEach((l) => l())
  })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  today(2026, 11, 15)
  firstDates('2026-10-05')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  data.expenses = []
  data.income = []
  live.version = 0
  live.failed = false
  live.cache.clear()
  live.reads = []
  setOnlineForTest(true)
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
  delete client.supabase.from
})

const page = () => render(<ExpensesPage />)
const pill = (name) => fireEvent.click(screen.getByRole('button', { name, pressed: false }))
const paidBy = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name }))
const receivedBy = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Received by' })).getByRole('button', { name }))
const card = () => screen.getByText('Balance').closest('div').parentElement
const inCard = () => within(card())
// A tile's value ("+€1900.00") by its label.
const tile = (name) => inCard().getByText(name).closest('div').children[1]
const leftoverLine = () => inCard().queryByText(/^Leftover from/)
const breakdown = () => leftoverLine()?.nextElementSibling ?? null
const periodResult = () => inCard().queryByText(/^This (month|range)/)
const availableText = () => inCard().queryByText(/^Available /)
const meter = () => inCard().queryByRole('progressbar')
const GREEN = 'var(--color-money-in)'
const RED = 'var(--color-money-out)'

describe('Money → top card: the leftover (K164–K172)', () => {
  it('Month October 2026 (Everyone): no leftover line, BALANCE +€1400.00, no "This month"; "Available €2000.00 · spent 30%"', () => {
    load(OCTOBER, NOVEMBER)
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(screen.getByRole('button', { name: 'October 2026' })).toBeTruthy()
    expect(leftoverLine()).toBeNull()
    expect(tile('Income').textContent).toBe('€2000.00')
    expect(tile('Expenses').textContent).toBe('€600.00')
    expect(tile('Balance').textContent).toBe('+€1400.00')
    expect(periodResult()).toBeNull()
    expect(availableText().textContent).toBe('Available €2000.00 · spent 30%')
    expect(meter().getAttribute('aria-valuenow')).toBe('30')
  })

  it('Month November 2026 (Everyone): the line, the breakdown, INCOME €2900.00, EXPENSES €2400.00, BALANCE +€1900.00, "This month +€500.00", "Available €4300.00 · spent 56%"', () => {
    load(OCTOBER, NOVEMBER)
    page()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1400.00')
    expect(within(leftoverLine()).getByText('+€1400.00').className).toContain(GREEN)
    expect(breakdown().textContent).toBe(`${L1} +€860.00 · ${L2} +€540.00`)
    expect(tile('Income').textContent).toBe('€2900.00')
    expect(tile('Expenses').textContent).toBe('€2400.00')
    expect(tile('Balance').textContent).toBe('+€1900.00')
    expect(tile('Balance').className).toContain(GREEN)
    expect(periodResult().textContent).toBe('This month +€500.00')
    expect(within(periodResult()).getByText('+€500.00').className).toContain(GREEN)
    expect(availableText().textContent).toBe('Available €4300.00 · spent 56%')
    expect(availableText().className).not.toContain(RED)
    // The line is above the tiles, the bar under them.
    expect(leftoverLine().compareDocumentPosition(inCard().getByText('Income')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tile('Balance').compareDocumentPosition(availableText()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Only the rows before 1 November are read for it.
    expect(live.reads).toContain('expenses < 2026-11-01')
    expect(live.reads).toContain('income < 2026-11-01')
  })

  it('Month December 2026 (today 15/12/2026): "Leftover from November 2026 · +€1900.00"; the breakdown; BALANCE +€1900.00; "This month €0.00" neutral', () => {
    today(2026, 12, 15)
    load(OCTOBER, NOVEMBER)
    page()
    expect(leftoverLine().textContent).toBe('Leftover from November 2026 · +€1900.00')
    expect(breakdown().textContent).toBe(`${L1} +€1360.00 · ${L2} +€540.00`)
    expect(tile('Balance').textContent).toBe('+€1900.00')
    expect(periodResult().textContent).toBe('This month €0.00')
    const zero = within(periodResult()).getByText('€0.00')
    expect(zero.className).not.toContain(GREEN)
    expect(zero.className).not.toContain(RED)
    expect(availableText().textContent).toBe('Available €1900.00 · spent 0%')
  })

  it('both pills on the first person, November: that person\'s line, no breakdown; BALANCE +€1360.00, "This month +€500.00"', () => {
    load(OCTOBER, NOVEMBER)
    page()
    receivedBy(L1)
    paidBy(L1)
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€860.00')
    expect(breakdown()).toBeNull()
    expect(tile('Income').textContent).toBe('€1500.00')
    expect(tile('Expenses').textContent).toBe('€1000.00')
    expect(tile('Balance').textContent).toBe('+€1360.00')
    expect(periodResult().textContent).toBe('This month +€500.00')
    // 860 + 1500 = 2360; 1000 ÷ 2360 = 42.4 %.
    expect(availableText().textContent).toBe('Available €2360.00 · spent 42%')
  })

  it('Income on the first person + Expenses on the second, November: no line, BALANCE +€100.00 (as today), no "This month", no bar', () => {
    load(OCTOBER, NOVEMBER)
    page()
    receivedBy(L1)
    paidBy(L2)
    expect(leftoverLine()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€100.00')
    expect(periodResult()).toBeNull()
    expect(availableText()).toBeNull()
    expect(meter()).toBeNull()
  })

  it('a "Shared" pill on either side: no line, no bar', () => {
    load(OCTOBER, NOVEMBER, { expenses: [], income: [earned('i5', 10, '2026-11-06', 'shared', 'other')] })
    page()
    paidBy(SHARED)
    expect(leftoverLine()).toBeNull()
    expect(availableText()).toBeNull()
    paidBy('Everyone')
    expect(leftoverLine()).not.toBeNull()
    receivedBy(SHARED)
    expect(leftoverLine()).toBeNull()
    expect(availableText()).toBeNull()
  })

  it('the Week pill: no line, no bar, and nothing is read for it', () => {
    load(OCTOBER, NOVEMBER)
    page()
    live.reads = []
    pill('Week')
    expect(screen.getByRole('button', { name: '9 Nov – 15 Nov 2026' })).toBeTruthy()
    expect(leftoverLine()).toBeNull()
    expect(availableText()).toBeNull()
    expect(live.reads).toEqual([])
  })

  it('3 Months Sep – Nov 2026 (today 15/11/2026): no line (starts before the first data); BALANCE +€1900.00', () => {
    load(OCTOBER, NOVEMBER)
    page()
    pill('3 Months')
    expect(screen.getByRole('button', { name: 'Sep – Nov 2026' })).toBeTruthy()
    expect(leftoverLine()).toBeNull()
    expect(periodResult()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€1900.00')
  })

  it('3 Months Nov 2026 – Jan 2027 (today 15/01/2027): "Leftover from October 2026 · +€1400.00"; BALANCE +€1900.00; "This range +€500.00"', () => {
    today(2027, 1, 15)
    load(OCTOBER, NOVEMBER)
    page()
    pill('3 Months')
    expect(screen.getByRole('button', { name: 'Nov 2026 – Jan 2027' })).toBeTruthy()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1400.00')
    expect(tile('Balance').textContent).toBe('+€1900.00')
    expect(periodResult().textContent).toBe('This range +€500.00')
  })

  it('Year 2026: no line; Year 2027 (today 15/01/2027): "Leftover from December 2026 · +€1900.00"', async () => {
    today(2027, 1, 15)
    load(OCTOBER, NOVEMBER)
    page()
    pill('Year')
    expect(screen.getByRole('button', { name: '2027' })).toBeTruthy()
    expect(leftoverLine().textContent).toBe('Leftover from December 2026 · +€1900.00')
    expect(periodResult().textContent).toBe('This range €0.00')
    fireEvent.click(screen.getByRole('button', { name: '2027' }))
    const row = within(screen.getByRole('region', { name: 'Pick a period' }))
    await vi.waitFor(() => expect(Array.from(row.getByLabelText('Year').options).map((o) => o.textContent)).toEqual(['2027', '2026']))
    fireEvent.change(row.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.click(row.getByRole('button', { name: 'Show' }))
    expect(screen.getByRole('button', { name: '2026' })).toBeTruthy()
    expect(leftoverLine()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€1900.00')
  })

  it('K164: deleting the second person\'s October €200.00 → "+€1600.00", breakdown +€860.00 / +€740.00, BALANCE +€2100.00 at once', () => {
    load(OCTOBER, NOVEMBER)
    page()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1400.00')
    data.expenses = data.expenses.filter((e) => e.id !== 'x2')
    changed()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1600.00')
    expect(breakdown().textContent).toBe(`${L1} +€860.00 · ${L2} +€740.00`)
    expect(tile('Balance').textContent).toBe('+€2100.00')
  })

  it('K166: October income €100.00, expenses €300.00 → November has no line; BALANCE = November\'s own result', () => {
    load({ expenses: [spent('x1', 300, '2026-10-10', P1)], income: [earned('i1', 100, '2026-10-05', P1)] }, NOVEMBER)
    page()
    expect(leftoverLine()).toBeNull()
    expect(periodResult()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€500.00')
  })

  it('K172: spent more than available → the bar full and the text red (October: €100.00 in, €300.00 out)', () => {
    load({ expenses: [spent('x1', 300, '2026-10-10', P1)], income: [earned('i1', 100, '2026-10-05', P1)] }, NOVEMBER)
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(tile('Balance').textContent).toBe('−€200.00')
    expect(tile('Balance').className).toContain(RED)
    expect(availableText().textContent).toBe('Available €100.00 · spent 300%')
    expect(availableText().className).toContain(RED)
    expect(meter().getAttribute('aria-valuenow')).toBe('100')
    expect(meter().firstChild.style.width).toBe('100%')
  })

  it('K198: €100.40 spent of €100.00 → "spent 100%" in red, the bar full; €100.00 of €100.00 → not red', () => {
    for (const [out, red] of [
      [100.4, true],
      [100, false],
    ]) {
      load({ expenses: [spent('x1', out, '2026-10-10', P1)], income: [earned('i1', 100, '2026-10-05', P1)] }, NOVEMBER)
      page()
      fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
      expect(availableText().textContent).toBe('Available €100.00 · spent 100%')
      expect(availableText().className.includes(RED)).toBe(red)
      expect(meter().firstChild.style.width).toBe('100%')
      cleanup()
    }
  })

  it('K168a: a person\'s minus in the breakdown, in red; both pills on that person → no line', () => {
    load({ expenses: [spent('x1', 100, '2026-10-10', P1), spent('x2', 50, '2026-10-11', P2)], income: [earned('i1', 1000, '2026-10-05', P1)] }, NOVEMBER)
    page()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€850.00')
    expect(breakdown().textContent).toBe(`${L1} +€900.00 · ${L2} −€50.00`)
    expect(within(breakdown()).getByText('−€50.00').className).toContain(RED)
    expect(within(breakdown()).getByText('+€900.00').className).toContain(GREEN)
    receivedBy(L2)
    paidBy(L2)
    expect(leftoverLine()).toBeNull()
    expect(tile('Balance').textContent).toBe('€0.00')
  })

  it('offline: no line and no bar (the top card as today); back online: the line', () => {
    load(OCTOBER, NOVEMBER)
    setOnlineForTest(false)
    page()
    expect(leftoverLine()).toBeNull()
    expect(availableText()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€500.00')
    act(() => setOnlineForTest(true))
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1400.00')
  })

  it('the earlier months can\'t be read: no line and no bar, the top card as today', () => {
    load(OCTOBER, NOVEMBER)
    live.failed = true
    page()
    expect(leftoverLine()).toBeNull()
    expect(periodResult()).toBeNull()
    expect(availableText()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€500.00')
  })
})

// The October fixture of prompt 1 (#1–#6) and the income of prompt 2.
const october = () => [
  { id: 'e1', description: 'TEST bar', amount: 25.5, category_id: 'going-out', expense_date: '2026-10-02', paid_by: P2, ...parts(null, null) },
  { id: 'e2', description: 'TEST shopping', amount: 48.9, category_id: 'groceries', expense_date: '2026-10-03', paid_by: 'shared', ...parts(20, 28.9) },
  { id: 'e3', description: 'TEST tobacco', amount: 6.2, category_id: 'smoke', expense_date: '2026-10-04', paid_by: P1, ...parts(null, null) },
  { id: 'e4', description: 'TEST cinema', amount: 18, category_id: 'going-out', expense_date: '2026-10-06', paid_by: P1, ...parts(null, null) },
  { id: 'e5', description: 'TEST vape', amount: 5.5, category_id: 'smoke', expense_date: '2026-10-07', paid_by: P2, ...parts(null, null) },
  { id: 'e6', description: 'TEST dinner', amount: 31.4, category_id: 'going-out', expense_date: '2026-10-09', paid_by: 'shared', ...parts(15.7, 15.7) },
]
const octoberIncome = () => [
  earned('i1', 1200, '2026-10-05', P1),
  earned('i2', 800, '2026-10-07', P2),
  earned('i3', 30, '2026-10-12', P1, 'other'),
]
const section = (title) => screen.getByRole('heading', { name: title }).closest('section')
const ex = () => within(section('Expenses'))
const inc = () => within(section('Income'))
const tapChart = (s, name) => fireEvent.click(within(s.getByRole('group', { name: /^Charts:/ })).getByRole('button', { name }))
const sortButton = (s, which) => s.getByRole('button', { name: new RegExp(`^Sort by ${which}`) })
const pick = (s, which, name) => {
  if (sortButton(s, which).getAttribute('aria-expanded') !== 'true') fireEvent.click(sortButton(s, which))
  fireEvent.click(within(s.getByRole('region', { name: `Sort by ${which}` })).getByRole('button', { name }))
}
const totalOf = (s) => s.queryByText(/^\d+ (expenses?|entry|entries) · €/)

describe('Money → the filter total next to the "Sort by" buttons (K186–K188)', () => {
  beforeEach(() => today(2026, 10, 20))

  it('"Going out" on → "3 expenses · €74.90" on the row of the two buttons, at the right, orange; no total in the chips row', () => {
    data.expenses = october()
    page()
    expect(totalOf(ex())).toBeNull()
    tapChart(ex(), 'Going out')
    const total = totalOf(ex())
    expect(total.textContent).toBe('3 expenses · €74.90')
    // Same row as the two buttons, after them, pushed right; wraps on its own.
    const rowEl = total.parentElement
    expect(rowEl.contains(sortButton(ex(), 'category'))).toBe(true)
    expect(rowEl.contains(sortButton(ex(), 'period'))).toBe(true)
    expect(rowEl.className).toContain('flex-wrap')
    expect(total.className).toContain('ml-auto')
    // The look of the € chip next to the title, in orange.
    expect(total.className).toContain('rounded-full')
    expect(total.className).toContain('border')
    expect(total.className).toContain('text-xs')
    expect(total.className).toContain('var(--color-accent)')
    // The chips row keeps the chips and "Clear filters" only.
    const chips = ex().getByRole('button', { name: 'Clear filters' }).parentElement
    expect(within(chips).queryByText(/· €/)).toBeNull()
    expect(within(chips).getByRole('button', { name: 'Remove filter Going out' })).toBeTruthy()
  })

  it('Week 1 + "Cigarettes & Vape" → "1 expense · €6.20"; no filter → no total', () => {
    data.expenses = october()
    page()
    tapChart(ex(), 'Week 1 €80.60')
    pick(ex(), 'category', 'Cigarettes & Vape')
    expect(totalOf(ex()).textContent).toBe('1 expense · €6.20')
    fireEvent.click(ex().getByRole('button', { name: 'Clear filters' }))
    expect(totalOf(ex())).toBeNull()
  })

  it('Income: "Salary" → "2 entries · €2000.00" in green; Week 3 → "1 entry · €30.00"', () => {
    data.income = octoberIncome()
    page()
    tapChart(inc(), 'Salary')
    expect(totalOf(inc()).textContent).toBe('2 entries · €2000.00')
    expect(totalOf(inc()).className).toContain(GREEN)
    fireEvent.click(inc().getByRole('button', { name: 'Clear filters' }))
    expect(totalOf(inc())).toBeNull()
    tapChart(inc(), 'Week 3 €30.00')
    expect(totalOf(inc()).textContent).toBe('1 entry · €30.00')
  })
})

describe('Money → Income list colour (K191)', () => {
  beforeEach(() => today(2026, 10, 20))

  it('the amounts in "Income (N)" use the strong green token, in the plain list and in the cards', () => {
    data.income = octoberIncome()
    page()
    fireEvent.click(inc().getByRole('button', { name: /^Income \(/ }))
    expect(inc().getByText('+€1200.00').className).toContain(GREEN)
    expect(inc().getByText('+€1200.00').className).not.toContain('#7FDB92')
    pick(inc(), 'category', 'Salary')
    expect(inc().getByText('+€800.00').className).toContain(GREEN)
  })
})

describe('Money → a later month with data in a running period (K192)', () => {
  const trend = (s) =>
    s
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-bar'))
      .map((b) => b.textContent.replace(/ €.*/, ''))
  const q4 = () => {
    pill('3 Months')
    fireEvent.click(screen.getByRole('button', { name: 'Sep – Nov 2026' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Pick a period' })).getByRole('button', { name: 'Q4' }))
  }

  it('12/11/2026, Q4 2026, an expense dated 20/12/2026 €9.00 → Expenses TREND Oct, Nov, Dec and a "Dec 2026" chip; Income still Oct, Nov', () => {
    today(2026, 11, 12)
    data.expenses = [...october(), spent('x9', 9, '2026-12-20', P1)]
    data.income = octoberIncome()
    page()
    q4()
    expect(screen.getByRole('button', { name: 'Oct – Dec 2026' })).toBeTruthy()
    expect(trend(ex())).toEqual(['Oct', 'Nov', 'Dec'])
    expect(ex().getByRole('button', { name: 'Dec €9.00' })).toBeTruthy()
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(sortButton(ex(), 'period'))
    expect(within(ex().getByRole('region', { name: 'Sort by period' })).getByRole('button', { name: 'Dec 2026' })).toBeTruthy()
    expect(trend(inc())).toEqual(['Oct', 'Nov'])
  })

  it('K195: 15/08/2026, H2 2026, an expense dated 10/12/2026 → Expenses TREND Jul … Dec (Sep €0.00), chips "Sep 2026" … "Dec 2026"; Income Jul, Aug', () => {
    today(2026, 8, 15)
    firstDates('2026-07-02')
    data.expenses = [spent('x1', 20, '2026-07-02', P1), spent('x2', 30, '2026-08-03', P2), spent('x9', 9, '2026-12-10', P1)]
    data.income = [earned('i1', 1000, '2026-07-05', P1), earned('i2', 900, '2026-08-05', P2)]
    page()
    pill('6 Months')
    fireEvent.click(screen.getByRole('button', { name: 'Mar – Aug 2026' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Pick a period' })).getByRole('button', { name: 'H2' }))
    expect(screen.getByRole('button', { name: 'Jul – Dec 2026' })).toBeTruthy()
    expect(trend(ex())).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(ex().getByRole('button', { name: 'Sep €0.00' })).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Dec €9.00' })).toBeTruthy()
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(sortButton(ex(), 'period'))
    const chips = within(ex().getByRole('region', { name: 'Sort by period' }))
    for (const name of ['Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026']) expect(chips.getByRole('button', { name })).toBeTruthy()
    expect(trend(inc())).toEqual(['Jul', 'Aug'])
  })

  it('without such an entry: no December bar (as built)', () => {
    today(2026, 11, 12)
    data.expenses = october()
    data.income = octoberIncome()
    page()
    q4()
    expect(trend(ex())).toEqual(['Oct', 'Nov'])
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(sortButton(ex(), 'period'))
    expect(within(ex().getByRole('region', { name: 'Sort by period' })).getByRole('button', { name: 'Nov 2026' })).toBeTruthy()
    expect(within(ex().getByRole('region', { name: 'Sort by period' })).queryByRole('button', { name: 'Dec 2026' })).toBeNull()
  })
})
