// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9O, prompt 1: the Money page's closed bars "Totals per category
// (N)", "Expenses (N)" and "Income (N)" (K146–K152), the Month TREND weeks
// (K153 / K162) and Income's "Shared" pill (K174).
// The payers come from PAID_BY_OPTIONS (never written out here).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({ expenses: [], income: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => []),
  groceryStore: fake(() => []),
  orderStore: fake(() => []),
  budgetMapStore: fake(() => []),
  tripStore: fake(() => []),
  tripItemStore: fake(() => []),
  shopStore: fake(() => []),
  inventoryCategoryStore: fake(() => []),
}))
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
const addExpenseOnce = vi.fn(async () => ({ error: null }))
const categories = [
  { id: 'going-out', name: 'Going out', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'smoke', name: 'Cigarettes & Vape', parent_id: null },
]
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: (...args) => addExpenseOnce(...args),
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
// per bucket ("Week 2 €54.90"), a row per store — each taps like the real one.
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => (
    <div role="group" aria-label={`Charts: ${props.emptyText}`}>
      {props.pieData.map((p) => (
        <button key={p.key} type="button" onClick={() => props.onCategory(p.key)}>
          {p.name}
        </button>
      ))}
      {props.barData.map((b) => (
        <button key={b.key} type="button" onClick={() => props.onBucket(b.key)}>
          {`${b.label} €${b.amount.toFixed(2)}`}
        </button>
      ))}
      {props.stores?.totals.map((s) => (
        <button key={s.key} type="button" onClick={() => props.stores.onSelect(s.key)}>
          {`Store ${s.name}`}
        </button>
      ))}
    </div>
  ),
}))

const { PAID_BY_OPTIONS } = await import('../data/constants')
const { ExpensesPage } = await import('../pages/ExpensesPage')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const [L1, L2, SHARED] = [label(P1), label(P2), label('shared')]
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })

// The six October 2026 expenses of the plan (9O, prompt 1).
const october = () => [
  { id: 'e1', description: 'TEST bar', amount: 25.5, category_id: 'going-out', expense_date: '2026-10-02', paid_by: P2, ...parts(null, null) },
  { id: 'e2', description: 'TEST shopping', amount: 48.9, category_id: 'groceries', expense_date: '2026-10-03', paid_by: 'shared', ...parts(20, 28.9) },
  { id: 'e3', description: 'TEST tobacco', amount: 6.2, category_id: 'smoke', expense_date: '2026-10-04', paid_by: P1, ...parts(null, null) },
  { id: 'e4', description: 'TEST cinema', amount: 18, category_id: 'going-out', expense_date: '2026-10-06', paid_by: P1, ...parts(null, null) },
  { id: 'e5', description: 'TEST vape', amount: 5.5, category_id: 'smoke', expense_date: '2026-10-07', paid_by: P2, ...parts(null, null) },
  { id: 'e6', description: 'TEST dinner', amount: 31.4, category_id: 'going-out', expense_date: '2026-10-09', paid_by: 'shared', ...parts(15.7, 15.7) },
]
const octoberIncome = () => [
  { id: 'i1', amount: 1200, income_date: '2026-10-05', category_id: 'salary', received_by: P1, source: 'TEST salary' },
  { id: 'i2', amount: 800, income_date: '2026-10-07', category_id: 'salary', received_by: P2, source: 'TEST salary' },
]

const today = (y, m, d) => vi.setSystemTime(new Date(y, m - 1, d, 12))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  today(2026, 10, 20)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  addExpenseOnce.mockClear()
  data.expenses = []
  data.income = []
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
})

const page = () => render(<ExpensesPage />)
const bar = (name) => screen.getByRole('button', { name })
const EXPENSES = /^Expenses \(/
const TOTALS = /^Totals per category \(/
const INCOME = /^Income \(/
const isOpen = (name) => bar(name).getAttribute('aria-expanded') === 'true'
const expenseCharts = () => screen.getByRole('group', { name: 'Charts: No expenses in this period.' })
const incomeCharts = () => screen.getByRole('group', { name: 'Charts: No income entries in this period.' })
const paidBy = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name }))
const receivedBy = () => screen.getByRole('group', { name: 'Received by' })
const summary = () => screen.getByText('Balance').closest('div').parentElement
const chip = (title) => screen.getByRole('heading', { name: title }).parentElement
const listed = () => ['TEST bar', 'TEST shopping', 'TEST tobacco', 'TEST cinema', 'TEST vape', 'TEST dinner'].filter((d) => screen.queryByText(d))
// Every expense row of the plain list, opened (one group per day + category).
const openRows = () => {
  for (const name of ['Going out', 'Groceries', 'Cigarettes & Vape']) {
    for (const p of screen.queryAllByText(name, { selector: 'p' })) {
      const button = p.closest('button')
      if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
    }
  }
}

describe('Money → the closed bars (K146)', () => {
  it('Everyone: "Expenses (6)", "Totals per category (3)" with €135.50, the € chip €135.50; all closed', () => {
    data.expenses = october()
    page()
    expect(bar('Expenses (6)')).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('Totals per category (3)', { exact: false })).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('€135.50')).toBeTruthy()
    expect(within(chip('Expenses')).getByText('€135.50')).toBeTruthy()
    expect(within(summary()).getByText('€135.50')).toBeTruthy()
    expect([isOpen(EXPENSES), isOpen(TOTALS), isOpen(INCOME)]).toEqual([false, false, false])
    // Closed: no list, no totals rows, no "Sort by" buttons.
    expect(listed()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Sort by category' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Totals per category' })).toBeNull()
  })

  it('opened: "Totals per category" holds the rows, "Expenses" holds the two "Sort by" buttons and the list', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(TOTALS))
    const totals = screen.getByRole('region', { name: 'Totals per category' })
    expect(within(totals).getByText('€74.90')).toBeTruthy()
    expect(within(totals).getByText('€48.90')).toBeTruthy()
    expect(within(totals).getByText('€11.70')).toBeTruthy()
    fireEvent.click(bar(EXPENSES))
    expect(screen.getByRole('button', { name: 'Sort by category' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sort by period' })).toBeTruthy()
    openRows()
    expect(listed()).toHaveLength(6)
    // Tapping again closes it.
    fireEvent.click(bar(EXPENSES))
    expect(listed()).toEqual([])
  })

  it('a chart tap with the bar closed: the filter applies and the bar opens (K147); chips under the charts (K148); Totals and the top card stay', () => {
    data.expenses = october()
    page()
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Going out' }))
    expect(isOpen(EXPENSES)).toBe(true)
    expect(bar('Expenses (3 of 6)')).toBeTruthy()
    expect(screen.getByText('3 · €74.90')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove filter Going out' })).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('Totals per category (3)', { exact: false })).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('€135.50')).toBeTruthy()
    expect(within(summary()).getByText('€135.50')).toBeTruthy()
    expect(within(chip('Expenses')).getByText('€135.50')).toBeTruthy()
    openRows()
    expect(listed()).toEqual(['TEST bar', 'TEST cinema', 'TEST dinner'])
    // The chips row sits right under the charts, before both bars.
    const chips = screen.getByText('3 · €74.90')
    expect(expenseCharts().compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chips.compareDocumentPosition(bar(TOTALS)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // "Clear filters" never closes a bar.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(bar('Expenses (6)').getAttribute('aria-expanded')).toBe('true')
  })

  it('a store row tap opens the bar too; a tap that lets a filter go opens nothing', () => {
    data.expenses = october()
    page()
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Store No store' }))
    expect(isOpen(EXPENSES)).toBe(true)
    // Closed by hand, then the same store tapped again (the filter goes).
    fireEvent.click(bar(EXPENSES))
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Store No store' }))
    expect(isOpen(EXPENSES)).toBe(false)
    expect(bar('Expenses (6)')).toBeTruthy()
  })

  it('the pills: each person and Shared (A1) — counts, chips, Totals per category', () => {
    data.expenses = october()
    page()
    paidBy(L1)
    // Own e3 e4 + the parts of e2 and e6.
    expect(bar('Expenses (4)')).toBeTruthy()
    expect(within(chip('Expenses')).getByText('€59.90')).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('Totals per category (3)', { exact: false })).toBeTruthy()
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Going out' }))
    expect(bar('Expenses (2 of 4)')).toBeTruthy()
    expect(screen.getByText('2 · €33.70')).toBeTruthy()

    paidBy(L2)
    expect(bar('Expenses (4)')).toBeTruthy()
    expect(within(chip('Expenses')).getByText('€75.60')).toBeTruthy()
    expect(Math.round((59.9 + 75.6) * 100) / 100).toBe(135.5)

    paidBy(SHARED)
    expect(bar('Expenses (2)')).toBeTruthy()
    expect(within(chip('Expenses')).getByText('€80.30')).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('Totals per category (2)', { exact: false })).toBeTruthy()
  })

  it('a month with no expenses: "(0)" bars that still open, to today\'s empty texts', () => {
    data.expenses = october()
    today(2026, 9, 20)
    page()
    expect(bar('Expenses (0)')).toBeTruthy()
    expect(within(bar(TOTALS)).getByText('Totals per category (0)', { exact: false })).toBeTruthy()
    fireEvent.click(bar(TOTALS))
    expect(within(screen.getByRole('region', { name: 'Totals per category' })).getByText('No expenses in this period.')).toBeTruthy()
    fireEvent.click(bar('Expenses (0)'))
    expect(screen.getByText('No expenses match this filter.')).toBeTruthy()
    expect(bar('Income (0)')).toBeTruthy()
    fireEvent.click(bar('Income (0)'))
    expect(screen.getByText('No income entries match this filter.')).toBeTruthy()
  })

  it('the K4 note and the top card don\'t follow the chart filters', () => {
    data.expenses = [...october(), { id: 'e7', description: 'TEST pharmacy', amount: 10, category_id: 'groceries', expense_date: '2026-10-08', paid_by: 'shared', ...parts(null, null) }]
    page()
    paidBy(L1)
    const note = `1 ${SHARED} expense without parts (€10.00) is not in this total.`
    expect(within(summary()).getByText(note)).toBeTruthy()
    expect(within(summary()).getByText('€59.90')).toBeTruthy()
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Going out' }))
    expect(bar('Expenses (2 of 4)')).toBeTruthy()
    expect(within(summary()).getByText(note)).toBeTruthy()
    expect(within(summary()).getByText('€59.90')).toBeTruthy()
  })
})

describe('Money → the Month TREND weeks (K153 / K162)', () => {
  it('October 2026: Week 1 €80.60, Week 2 €54.90, Weeks 3–5 €0.00; Week 2 → "Week 2 · 5–11 Oct", "Expenses (3 of 6)"', () => {
    data.expenses = october()
    page()
    const weeks = within(expenseCharts()).getAllByRole('button', { name: /^Week / }).map((b) => b.textContent)
    expect(weeks).toEqual(['Week 1 €80.60', 'Week 2 €54.90', 'Week 3 €0.00', 'Week 4 €0.00', 'Week 5 €0.00'])
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Week 2 €54.90' }))
    expect(screen.getByRole('button', { name: 'Remove filter Week 2 · 5–11 Oct' }).textContent).toBe('Week 2 · 5–11 Oct')
    expect(bar('Expenses (3 of 6)')).toBeTruthy()
    expect(isOpen(EXPENSES)).toBe(true)
    expect(screen.getByText('3 · €54.90')).toBeTruthy()
    openRows()
    expect(listed()).toEqual(['TEST cinema', 'TEST vape', 'TEST dinner'])
  })

  it('November 2026: six weeks; 01/11 in Week 1 ("Week 1 · 1 Nov"), 30/11 in Week 6 ("Week 6 · 30 Nov")', () => {
    today(2026, 11, 11)
    data.expenses = [
      { id: 'n1', description: 'TEST first', amount: 7, category_id: 'groceries', expense_date: '2026-11-01', paid_by: P1, ...parts(null, null) },
      { id: 'n30', description: 'TEST last', amount: 12, category_id: 'groceries', expense_date: '2026-11-30', paid_by: P1, ...parts(null, null) },
    ]
    page()
    const weeks = within(expenseCharts()).getAllByRole('button', { name: /^Week / }).map((b) => b.textContent)
    expect(weeks).toEqual(['Week 1 €7.00', 'Week 2 €0.00', 'Week 3 €0.00', 'Week 4 €0.00', 'Week 5 €0.00', 'Week 6 €12.00'])
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Week 6 €12.00' }))
    expect(screen.getByRole('button', { name: 'Remove filter Week 6 · 30 Nov' })).toBeTruthy()
    expect(screen.getByText('1 · €12.00')).toBeTruthy()
    // A second tap lets Week 6 go (prompt 2, K157b: taps add, they don't replace).
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Week 6 €12.00' }))
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Week 1 €7.00' }))
    expect(screen.getByRole('button', { name: 'Remove filter Week 1 · 1 Nov' })).toBeTruthy()
    expect(screen.getByText('1 · €7.00')).toBeTruthy()
    expect(bar('Expenses (1 of 2)')).toBeTruthy()
  })
})

describe('Money → section Income: "Income (N)" and the "Shared" pill (K174)', () => {
  it('no Shared income: "Income (2)", €2000.00, no "Shared" pill; a Shared income makes it appear', () => {
    data.income = octoberIncome()
    const { rerender } = page()
    expect(bar('Income (2)')).toBeTruthy()
    expect(within(chip('Income')).getByText('€2000.00')).toBeTruthy()
    expect(within(receivedBy()).queryByRole('button', { name: SHARED })).toBeNull()
    expect(within(receivedBy()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Everyone', L1, L2])
    // The "Paid by" pills keep "Shared".
    expect(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name: SHARED })).toBeTruthy()

    data.income = [...octoberIncome(), { id: 'i3', amount: 50, income_date: '2026-10-15', category_id: 'other', received_by: 'shared', source: 'TEST shared' }]
    rerender(<ExpensesPage />)
    expect(within(receivedBy()).getByRole('button', { name: SHARED })).toBeTruthy()
    expect(bar('Income (3)')).toBeTruthy()
    expect(within(chip('Income')).getByText('€2050.00')).toBeTruthy()
    // The list is inside the bar; a chart tap opens it.
    expect(screen.queryByText('TEST shared')).toBeNull()
    fireEvent.click(within(incomeCharts()).getByRole('button', { name: 'Other' }))
    expect(isOpen(INCOME)).toBe(true)
    expect(bar('Income (1 of 3)')).toBeTruthy()
    expect(screen.getByText('TEST shared')).toBeTruthy()
  })

  it('"Shared" chosen, then a month without Shared income: the pill goes and "Everyone" is chosen (and remembered)', () => {
    data.income = [...octoberIncome(), { id: 'i3', amount: 50, income_date: '2026-10-15', category_id: 'other', received_by: 'shared', source: 'TEST shared' }]
    page()
    fireEvent.click(within(receivedBy()).getByRole('button', { name: SHARED }))
    expect(bar('Income (1)')).toBeTruthy()
    expect(localStorage.getItem('money.incomePerson')).toBe('shared')
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(within(receivedBy()).queryByRole('button', { name: SHARED })).toBeNull()
    expect(within(receivedBy()).getByRole('button', { name: 'Everyone' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('money.incomePerson')).toBe('all')
  })

  it('"Shared" remembered on the phone, no Shared income in the period: "Everyone"', () => {
    localStorage.setItem('money.incomePerson', 'shared')
    data.income = octoberIncome()
    page()
    expect(within(receivedBy()).getByRole('button', { name: 'Everyone' }).getAttribute('aria-pressed')).toBe('true')
    expect(bar('Income (2)')).toBeTruthy()
    expect(localStorage.getItem('money.incomePerson')).toBe('all')
  })
})

describe('Money → how the bars open and close (K149–K151)', () => {
  it('open bars stay open through "‹" / "›", another period pill and another person pill', () => {
    data.expenses = october()
    data.income = octoberIncome()
    page()
    for (const name of [EXPENSES, TOTALS, INCOME]) fireEvent.click(bar(name))
    const allOpen = () => [isOpen(EXPENSES), isOpen(TOTALS), isOpen(INCOME)]
    expect(allOpen()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(allOpen()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    expect(allOpen()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(allOpen()).toEqual([true, true, true])
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    paidBy(L2)
    fireEvent.click(within(receivedBy()).getByRole('button', { name: L1 }))
    expect(allOpen()).toEqual([true, true, true])
  })

  it('leaving Money and coming back: every bar closed again', () => {
    data.expenses = october()
    data.income = octoberIncome()
    const { unmount } = page()
    for (const name of [EXPENSES, TOTALS, INCOME]) fireEvent.click(bar(name))
    unmount()
    page()
    expect([isOpen(EXPENSES), isOpen(TOTALS), isOpen(INCOME)]).toEqual([false, false, false])
  })

  it('"Select" opens "Expenses (N)" and hides the charts; "Totals per category" stays as it was; leaving clears the filters', () => {
    data.expenses = october()
    page()
    // A category from the chart and a period chip from "Sort by period" first.
    fireEvent.click(within(expenseCharts()).getByRole('button', { name: 'Going out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sort by period' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Sort by period' })).getByRole('button', { name: 'Week 2 · 5–11 Oct' }))
    expect(bar('Expenses (2 of 6)')).toBeTruthy()
    fireEvent.click(bar(EXPENSES))
    expect(isOpen(EXPENSES)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(isOpen(EXPENSES)).toBe(true)
    expect(bar('Expenses (6)')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Charts: No expenses in this period.' })).toBeNull()
    expect(screen.queryByText('Clear filters')).toBeNull()
    expect(screen.getByText('Select expenses')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Sort by/ })).toBeNull()
    expect(listed()).toHaveLength(6)
    expect(isOpen(TOTALS)).toBe(false)
    // The tick list is inside "Expenses (N)", after "Totals per category".
    expect(bar(TOTALS).compareDocumentPosition(screen.getByText('Select expenses')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop selecting' }))
    expect(expenseCharts()).toBeTruthy()
    expect(screen.queryByText('Clear filters')).toBeNull()
    expect(bar('Expenses (6)')).toBeTruthy()
    expect(isOpen(EXPENSES)).toBe(true)
    expect(screen.getByRole('button', { name: 'Sort by category' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sort by period' })).toBeTruthy()
  })

  it('"Select" with "Totals per category" open: it stays open', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(TOTALS))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(isOpen(TOTALS)).toBe(true)
    expect(screen.getByRole('region', { name: 'Totals per category' })).toBeTruthy()
  })

  it('after "Add expense" saves, a closed bar stays closed and an open one open (K150)', async () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(TOTALS))
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TEST coffee' } })
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '12' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Paid by' }), { target: { value: P1 } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add expense · €12.00' })))
    await waitFor(() => expect(addExpenseOnce).toHaveBeenCalledTimes(1))
    expect(isOpen(EXPENSES)).toBe(false)
    expect(isOpen(TOTALS)).toBe(true)
  })
})
