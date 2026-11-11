// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// Plan 9O, prompt 2: the two buttons "Sort by category ▾" / "Sort by
// period ▾" inside "Expenses (N)" and "Income (N)" (K154–K158, K175,
// K157a–d), one filter state with the charts, and closing "Expenses (N)"
// while selecting (K178).
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
// The charts as plain buttons: a pie slice ("Slice Going out") and a
// legend entry per category, a TREND bar
// per bucket ("Week 2 €54.90"), a row per store — each taps like the real one.
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => (
    <div role="group" aria-label={`Charts: ${props.emptyText}`}>
      {props.pieData.map((p) => (
        <button key={`slice-${p.key}`} type="button" onClick={() => props.onCategory(p.key)}>
          {`Slice ${p.name}`}
        </button>
      ))}
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

// The six October 2026 expenses of the plan (9O, prompts 1 and 2): #1–#6.
const october = () => [
  { id: 'e1', description: 'TEST bar', amount: 25.5, category_id: 'going-out', expense_date: '2026-10-02', paid_by: P2, ...parts(null, null) },
  { id: 'e2', description: 'TEST shopping', amount: 48.9, category_id: 'groceries', expense_date: '2026-10-03', paid_by: 'shared', ...parts(20, 28.9) },
  { id: 'e3', description: 'TEST tobacco', amount: 6.2, category_id: 'smoke', expense_date: '2026-10-04', paid_by: P1, ...parts(null, null) },
  { id: 'e4', description: 'TEST cinema', amount: 18, category_id: 'going-out', expense_date: '2026-10-06', paid_by: P1, ...parts(null, null) },
  { id: 'e5', description: 'TEST vape', amount: 5.5, category_id: 'smoke', expense_date: '2026-10-07', paid_by: P2, ...parts(null, null) },
  { id: 'e6', description: 'TEST dinner', amount: 31.4, category_id: 'going-out', expense_date: '2026-10-09', paid_by: 'shared', ...parts(15.7, 15.7) },
]
const octoberIncome = () => [
  { id: 'i1', amount: 1200, income_date: '2026-10-05', category_id: 'salary', received_by: P1, source: 'TEST salary one' },
  { id: 'i2', amount: 800, income_date: '2026-10-07', category_id: 'salary', received_by: P2, source: 'TEST salary two' },
  { id: 'i3', amount: 30, income_date: '2026-10-12', category_id: 'other', received_by: P1, source: 'TEST other' },
]

const today = (y, m, d) => vi.setSystemTime(new Date(y, m - 1, d, 12))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  today(2026, 10, 20)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  data.expenses = []
  data.income = []
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
})

const page = () => render(<ExpensesPage />)
const section = (title) => screen.getByRole('heading', { name: title }).closest('section')
const ex = () => within(section('Expenses'))
const inc = () => within(section('Income'))
const bar = (s, name) => s.getByRole('button', { name })
const isOpen = (s, name) => bar(s, name).getAttribute('aria-expanded') === 'true'
const charts = (s) => s.getByRole('group', { name: /^Charts:/ })
const tapChart = (s, name) => fireEvent.click(within(charts(s)).getByRole('button', { name }))
const paidBy = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name }))
// The two buttons: their name carries " · 2" while some are on.
const button = (s, which) => s.getByRole('button', { name: new RegExp(`^Sort by ${which}`) })
const openPanel = (s, which) => {
  if (button(s, which).getAttribute('aria-expanded') !== 'true') fireEvent.click(button(s, which))
  return within(s.getByRole('region', { name: `Sort by ${which}` }))
}
const pick = (s, which, ...names) => {
  const panel = openPanel(s, which)
  for (const name of names) fireEvent.click(panel.getByRole('button', { name }))
}
const chipOn = (s, which, name) => openPanel(s, which).getByRole('button', { name }).getAttribute('aria-pressed') === 'true'
const typeDate = (s, label, text) => fireEvent.change(openPanel(s, 'period').getByLabelText(label), { target: { value: text } })
const cards = (s) => s.queryAllByRole('group').filter((g) => !/^(Charts:|Paid by|Received by|Breakdown|Trend style)/.test(g.getAttribute('aria-label') ?? ''))
const cardTitles = (s) => cards(s).map((c) => c.getAttribute('aria-label'))
const card = (s, name) => cards(s).find((c) => c.getAttribute('aria-label') === name)
// A card's subtotal, as its title row shows it.
const cardTotal = (s, name) => card(s, name).firstChild.lastChild.textContent
const DESCRIPTIONS = { 'TEST bar': 1, 'TEST shopping': 2, 'TEST tobacco': 3, 'TEST cinema': 4, 'TEST vape': 5, 'TEST dinner': 6 }
// The expenses in a card, as #1–#6, in the order shown.
const numbersIn = (el) =>
  Object.keys(DESCRIPTIONS)
    .filter((d) => within(el).queryByText(d))
    .sort((a, b) => (within(el).getByText(a).compareDocumentPosition(within(el).getByText(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((d) => DESCRIPTIONS[d])
const EXPENSES = /^Expenses \(/
const INCOME = /^Income \(/
const BOTH = ['Going out', 'Cigarettes & Vape']

describe('Money → Expenses → "Sort by category" and "Sort by period" (K157)', () => {
  it('the open bar: the two buttons, both panels closed, then the plain list', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    expect(button(ex(), 'category').textContent).toBe('Sort by category')
    expect(button(ex(), 'period').textContent).toBe('Sort by period')
    expect(button(ex(), 'category').getAttribute('aria-expanded')).toBe('false')
    expect(ex().queryByRole('region', { name: 'Sort by category' })).toBeNull()
    expect(cards(ex())).toEqual([])
    // One panel at a time.
    openPanel(ex(), 'category')
    openPanel(ex(), 'period')
    expect(ex().queryByRole('region', { name: 'Sort by category' })).toBeNull()
    expect(button(ex(), 'period').getAttribute('aria-expanded')).toBe('true')
  })

  it('the chips: categories A–Z with spending (no "Uncategorized" without such rows); the five week chips, also at €0.00', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    expect(openPanel(ex(), 'category').getAllByRole('button').map((b) => b.textContent)).toEqual(['Cigarettes & Vape', 'Going out', 'Groceries'])
    expect(openPanel(ex(), 'period').getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual([
      'Week 1 · 1–4 Oct',
      'Week 2 · 5–11 Oct',
      'Week 3 · 12–18 Oct',
      'Week 4 · 19–25 Oct',
      'Week 5 · 26–31 Oct',
    ])
    expect(openPanel(ex(), 'period').getByLabelText('From')).toBeTruthy()
    expect(openPanel(ex(), 'period').getByLabelText('To')).toBeTruthy()
  })

  it('an "Uncategorized" chip only when the period has such rows, last', () => {
    data.expenses = [...october(), { id: 'e9', description: 'TEST loose', amount: 4, category_id: null, expense_date: '2026-10-08', paid_by: P1, ...parts(null, null) }]
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    expect(openPanel(ex(), 'category').getAllByRole('button').map((b) => b.textContent)).toEqual(['Cigarettes & Vape', 'Going out', 'Groceries', 'Uncategorized'])
  })

  it('Week 1 + the two categories → 2 · €31.70; Week 2 + the same → 3 · €54.90', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'category', ...BOTH)
    pick(ex(), 'period', 'Week 1 · 1–4 Oct')
    expect(ex().getByText('2 · €31.70')).toBeTruthy()
    pick(ex(), 'period', 'Week 1 · 1–4 Oct', 'Week 2 · 5–11 Oct')
    expect(ex().getByText('3 · €54.90')).toBeTruthy()
  })

  it('Week 1 + Week 2 + the two categories → 5 · €86.60, "Expenses (5 of 6)"; cards Going out €74.90 (#6 #4 #1), Cigarettes & Vape €11.70 (#5 #3)', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'period', 'Week 1 · 1–4 Oct', 'Week 2 · 5–11 Oct')
    pick(ex(), 'category', ...BOTH)
    expect(ex().getByText('5 · €86.60')).toBeTruthy()
    expect(bar(ex(), 'Expenses (5 of 6)')).toBeTruthy()
    expect(button(ex(), 'category').textContent).toBe('Sort by category · 2')
    expect(button(ex(), 'period').textContent).toBe('Sort by period · 2')
    expect(cardTitles(ex())).toEqual(['Going out', 'Cigarettes & Vape'])
    expect(cardTotal(ex(), 'Going out')).toBe('€74.90')
    expect(numbersIn(card(ex(), 'Going out'))).toEqual([6, 4, 1])
    expect(cardTotal(ex(), 'Cigarettes & Vape')).toBe('€11.70')
    expect(numbersIn(card(ex(), 'Cigarettes & Vape'))).toEqual([5, 3])
    // The total is only in the chips row under the charts (K148).
    expect(ex().getAllByText('5 · €86.60')).toHaveLength(1)
  })

  it('Week 1 + Week 2 only → 6 · €135.50; cards "Week 2 · 5–11 Oct" €54.90 (#6 #5 #4), then "Week 1 · 1–4 Oct" €80.60 (#3 #2 #1)', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'period', 'Week 1 · 1–4 Oct', 'Week 2 · 5–11 Oct')
    expect(ex().getByText('6 · €135.50')).toBeTruthy()
    expect(bar(ex(), 'Expenses (6 of 6)')).toBeTruthy()
    expect(cardTitles(ex())).toEqual(['Week 2 · 5–11 Oct', 'Week 1 · 1–4 Oct'])
    expect(cardTotal(ex(), 'Week 2 · 5–11 Oct')).toBe('€54.90')
    expect(numbersIn(card(ex(), 'Week 2 · 5–11 Oct'))).toEqual([6, 5, 4])
    expect(cardTotal(ex(), 'Week 1 · 1–4 Oct')).toBe('€80.60')
    expect(numbersIn(card(ex(), 'Week 1 · 1–4 Oct'))).toEqual([3, 2, 1])
  })

  it('only categories → one card per category, ordered as the old "By category"', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'category', 'Groceries', 'Going out')
    expect(ex().getByText('4 · €123.80')).toBeTruthy()
    expect(cardTitles(ex())).toEqual(['Going out', 'Groceries'])
  })

  it('From 03/10 To 06/10 + the two categories → 2 · €24.20 (#3 #4), cards Going out €18.00, Cigarettes & Vape €6.20', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    typeDate(ex(), 'From', '03/10/2026')
    typeDate(ex(), 'To', '06/10/2026')
    pick(ex(), 'category', ...BOTH)
    expect(ex().getByText('2 · €24.20')).toBeTruthy()
    expect(cardTitles(ex())).toEqual(['Going out', 'Cigarettes & Vape'])
    expect(cardTotal(ex(), 'Going out')).toBe('€18.00')
    expect(numbersIn(card(ex(), 'Going out'))).toEqual([4])
    expect(cardTotal(ex(), 'Cigarettes & Vape')).toBe('€6.20')
    expect(numbersIn(card(ex(), 'Cigarettes & Vape'))).toEqual([3])
    // The dates count as 1 (K157c) and are a chip under the charts.
    expect(button(ex(), 'period').textContent).toBe('Sort by period · 1')
    expect(ex().getByRole('button', { name: 'Remove filter 03/10 – 06/10' }).textContent).toBe('03/10 – 06/10')
  })

  it('From 03/10 To 06/10 only → 3 · €73.10, the plain list; From 03/10 with "To" empty → 1 · €48.90 (#2), chip "03/10"', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    typeDate(ex(), 'From', '03/10/2026')
    typeDate(ex(), 'To', '06/10/2026')
    expect(ex().getByText('3 · €73.10')).toBeTruthy()
    expect(bar(ex(), 'Expenses (3 of 6)')).toBeTruthy()
    expect(cards(ex())).toEqual([])
    typeDate(ex(), 'To', '')
    expect(ex().getByText('1 · €48.90')).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Remove filter 03/10' })).toBeTruthy()
  })

  it('chips OR dates (K154): a typed date turns the chip off; a chip clears the dates', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'period', 'Week 1 · 1–4 Oct')
    expect(chipOn(ex(), 'period', 'Week 1 · 1–4 Oct')).toBe(true)
    typeDate(ex(), 'From', '03/10/2026')
    expect(chipOn(ex(), 'period', 'Week 1 · 1–4 Oct')).toBe(false)
    expect(ex().getByText('1 · €48.90')).toBeTruthy()
    pick(ex(), 'period', 'Week 2 · 5–11 Oct')
    expect(openPanel(ex(), 'period').getByLabelText('From').value).toBe('')
    expect(ex().queryByRole('button', { name: /^Remove filter 03\/10/ })).toBeNull()
    expect(ex().getByText('3 · €54.90')).toBeTruthy()
  })

  it('a date outside the period: nothing applied, "Choose a date in October 2026."; "From" after "To": nothing applied, the other line', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    typeDate(ex(), 'From', '28/09/2026')
    expect(openPanel(ex(), 'period').getByText('Choose a date in October 2026.')).toBeTruthy()
    expect(bar(ex(), 'Expenses (6)')).toBeTruthy()
    expect(ex().queryByText('Clear filters')).toBeNull()
    expect(button(ex(), 'period').textContent).toBe('Sort by period')

    typeDate(ex(), 'From', '06/10/2026')
    typeDate(ex(), 'To', '03/10/2026')
    expect(openPanel(ex(), 'period').getByText('"From" is after "To".')).toBeTruthy()
    expect(openPanel(ex(), 'period').queryByText('Choose a date in October 2026.')).toBeNull()
    expect(bar(ex(), 'Expenses (6)')).toBeTruthy()
  })

  it('chart taps toggle the same chips without clearing the others (K157b); the bar opens (K147)', () => {
    data.expenses = october()
    page()
    tapChart(ex(), 'Slice Going out')
    expect(isOpen(ex(), EXPENSES)).toBe(true)
    expect(button(ex(), 'category').textContent).toBe('Sort by category · 1')
    expect(chipOn(ex(), 'category', 'Going out')).toBe(true)
    tapChart(ex(), 'Cigarettes & Vape')
    expect(button(ex(), 'category').textContent).toBe('Sort by category · 2')
    expect(chipOn(ex(), 'category', 'Going out')).toBe(true)
    expect(chipOn(ex(), 'category', 'Cigarettes & Vape')).toBe(true)
    tapChart(ex(), 'Week 2 €54.90')
    expect(chipOn(ex(), 'period', 'Week 2 · 5–11 Oct')).toBe(true)
    expect(button(ex(), 'period').textContent).toBe('Sort by period · 1')
    expect(ex().getByText('3 · €54.90')).toBeTruthy()
    // A second tap on the legend lets it go.
    tapChart(ex(), 'Going out')
    expect(button(ex(), 'category').textContent).toBe('Sort by category · 1')
  })

  it('the chips row: every filter is a removable chip (period, category, store); "Clear filters" clears all and keeps the bar', () => {
    data.expenses = october()
    page()
    tapChart(ex(), 'Week 2 €54.90')
    tapChart(ex(), 'Going out')
    tapChart(ex(), 'Store No store')
    expect(ex().getByRole('button', { name: 'Remove filter Week 2 · 5–11 Oct' })).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Remove filter Going out' })).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Remove filter No store' })).toBeTruthy()
    // The store is never a third button (K157d).
    expect(ex().queryByRole('button', { name: /^Sort by store/ })).toBeNull()
    expect(ex().getByText('2 · €49.40')).toBeTruthy()
    fireEvent.click(ex().getByRole('button', { name: 'Remove filter Going out' }))
    expect(chipOn(ex(), 'category', 'Going out')).toBe(false)
    expect(ex().getByText('3 · €54.90')).toBeTruthy()
    fireEvent.click(ex().getByRole('button', { name: 'Clear filters' }))
    expect(bar(ex(), 'Expenses (6)').getAttribute('aria-expanded')).toBe('true')
    expect(button(ex(), 'period').textContent).toBe('Sort by period')
    expect(ex().queryByText('Clear filters')).toBeNull()
  })

  it('a chart tap that turns a filter off with the bar closed leaves it closed (K177)', () => {
    data.expenses = october()
    page()
    tapChart(ex(), 'Going out')
    fireEvent.click(bar(ex(), EXPENSES))
    tapChart(ex(), 'Going out')
    expect(isOpen(ex(), EXPENSES)).toBe(false)
    expect(bar(ex(), 'Expenses (6)')).toBeTruthy()
  })

  it('a new period, period pill or person pill clears every filter', () => {
    data.expenses = october()
    page()
    fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'category', 'Going out')
    typeDate(ex(), 'From', '03/10/2026')
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    expect(bar(ex(), 'Expenses (6)')).toBeTruthy()
    expect(button(ex(), 'category').textContent).toBe('Sort by category')
    expect(openPanel(ex(), 'period').getByLabelText('From').value).toBe('')
    pick(ex(), 'period', 'Week 1 · 1–4 Oct')
    paidBy(L1)
    expect(bar(ex(), 'Expenses (4)')).toBeTruthy()
    pick(ex(), 'category', 'Going out')
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(button(ex(), 'category').textContent).toBe('Sort by category')
  })

  it('3 Months (Sep – Nov 2026): the period chips are the three months; "Oct 2026" → 6 · €135.50', () => {
    today(2026, 11, 11)
    data.expenses = october()
    page()
    fireEvent.click(screen.getByRole('button', { name: '3 Months' }))
    fireEvent.click(bar(ex(), EXPENSES))
    expect(openPanel(ex(), 'period').getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['Sep 2026', 'Oct 2026', 'Nov 2026'])
    pick(ex(), 'period', 'Oct 2026')
    expect(ex().getByText('6 · €135.50')).toBeTruthy()
    expect(cardTitles(ex())).toEqual(['Oct 2026'])
  })

  it('Week (19 – 25 Oct 2026): seven day chips, as the TREND chips', () => {
    data.expenses = october()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    fireEvent.click(bar(ex(), EXPENSES))
    expect(openPanel(ex(), 'period').getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual([
      'Mon 19 Oct',
      'Tue 20 Oct',
      'Wed 21 Oct',
      'Thu 22 Oct',
      'Fri 23 Oct',
      'Sat 24 Oct',
      'Sun 25 Oct',
    ])
  })
})

describe('Money → Expenses → the person pills with Week 1 + Week 2 + the two categories', () => {
  const choose = (categories = BOTH) => {
    if (!isOpen(ex(), EXPENSES)) fireEvent.click(bar(ex(), EXPENSES))
    pick(ex(), 'period', 'Week 1 · 1–4 Oct', 'Week 2 · 5–11 Oct')
    pick(ex(), 'category', ...categories)
  }
  it('the first person → 3 · €39.90; the second → 3 · €46.70 (39.90 + 46.70 = 86.60); Shared → 1 · €31.40', () => {
    data.expenses = october()
    page()
    paidBy(L1)
    choose()
    expect(ex().getByText('3 · €39.90')).toBeTruthy()
    expect(numbersIn(card(ex(), 'Going out'))).toEqual([6, 4])
    expect(numbersIn(card(ex(), 'Cigarettes & Vape'))).toEqual([3])
    paidBy(L2)
    choose()
    expect(ex().getByText('3 · €46.70')).toBeTruthy()
    expect(numbersIn(card(ex(), 'Going out'))).toEqual([6, 1])
    expect(Math.round((39.9 + 46.7) * 100) / 100).toBe(86.6)
    // Shared has no Cigarettes & Vape in October, so it has no chip there.
    paidBy(SHARED)
    expect(openPanel(ex(), 'category').getAllByRole('button').map((b) => b.textContent)).toEqual(['Going out', 'Groceries'])
    choose(['Going out'])
    expect(ex().getByText('1 · €31.40')).toBeTruthy()
  })
})

describe('Money → Income → the same two buttons (K158)', () => {
  it('category Salary → 2 · €2000.00, "Income (2 of 3)"; no store filter', () => {
    data.income = octoberIncome()
    page()
    fireEvent.click(bar(inc(), INCOME))
    expect(openPanel(inc(), 'category').getAllByRole('button').map((b) => b.textContent)).toEqual(['Salary', 'Other'])
    pick(inc(), 'category', 'Salary')
    expect(inc().getByText('2 · €2000.00')).toBeTruthy()
    expect(bar(inc(), 'Income (2 of 3)')).toBeTruthy()
    expect(cardTitles(inc())).toEqual(['Salary'])
    expect(inc().queryByRole('button', { name: /^Store / })).toBeNull()
  })

  it('Week 3 (12–18 Oct) → 1 · €30.00; Week 2 + Salary → 2 · €2000.00; Week 1 + Salary → 0, "Income (0 of 3)", the empty text', () => {
    data.income = octoberIncome()
    page()
    fireEvent.click(bar(inc(), INCOME))
    pick(inc(), 'period', 'Week 3 · 12–18 Oct')
    expect(inc().getByText('1 · €30.00')).toBeTruthy()
    expect(cardTitles(inc())).toEqual(['Week 3 · 12–18 Oct'])
    pick(inc(), 'period', 'Week 3 · 12–18 Oct', 'Week 2 · 5–11 Oct')
    pick(inc(), 'category', 'Salary')
    expect(inc().getByText('2 · €2000.00')).toBeTruthy()
    pick(inc(), 'period', 'Week 2 · 5–11 Oct', 'Week 1 · 1–4 Oct')
    expect(bar(inc(), 'Income (0 of 3)')).toBeTruthy()
    expect(inc().getByText('0 · €0.00')).toBeTruthy()
    expect(inc().getByText('No income entries match these filters.')).toBeTruthy()
  })

  it('a chart tap toggles the chip and opens "Income (N)"', () => {
    data.income = octoberIncome()
    page()
    tapChart(inc(), 'Salary')
    expect(isOpen(inc(), INCOME)).toBe(true)
    expect(button(inc(), 'category').textContent).toBe('Sort by category · 1')
    tapChart(inc(), 'Week 3 €30.00')
    expect(chipOn(inc(), 'period', 'Week 3 · 12–18 Oct')).toBe(true)
    expect(bar(inc(), 'Income (0 of 3)')).toBeTruthy()
  })
})

describe('Money → Expenses → Select (K178)', () => {
  it('while selecting, closing "Expenses (N)" ends Select: the charts are back, the tick list is gone', () => {
    data.expenses = october()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(ex().getByText('Select expenses')).toBeTruthy()
    expect(ex().queryByRole('group', { name: /^Charts:/ })).toBeNull()
    fireEvent.click(bar(ex(), EXPENSES))
    expect(isOpen(ex(), EXPENSES)).toBe(false)
    expect(ex().queryByText('Select expenses')).toBeNull()
    expect(charts(ex())).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Select' })).toBeTruthy()
    // Opening it again shows the list, not the tick list.
    fireEvent.click(bar(ex(), EXPENSES))
    expect(ex().queryByText('Select expenses')).toBeNull()
    expect(button(ex(), 'category')).toBeTruthy()
  })
})
