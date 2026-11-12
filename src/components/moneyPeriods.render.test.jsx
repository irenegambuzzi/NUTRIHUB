// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9O, prompt 3: choosing periods (K159–K161, K160a–d, K173, K175),
// the money colours (K181) and "To" alone (K182).
// The payers come from PAID_BY_OPTIONS (never written out here).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const data = vi.hoisted(() => ({ expenses: [], income: [], since: [], incomeSince: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  // Only November is loaded when Money opens (to see `since` move back).
  currentExpensesSince: () => '2026-11-01',
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
const categories = [
  { id: 'going-out', name: 'Going out', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'smoke', name: 'Cigarettes & Vape', parent_id: null },
]
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: vi.fn(async () => ({ error: null })),
  useExpenses: (since) => {
    data.since.push(since)
    return { expenses: data.expenses, categories, updateExpense: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), deleteExpense: vi.fn() }
  },
}))
const incomeCategories = [
  { id: 'salary', name: 'Salary', parent_id: null },
  { id: 'other', name: 'Other', parent_id: null },
]
vi.mock('../hooks/useIncome', () => ({
  useIncome: (since) => {
    data.incomeSince.push(since)
    return { income: data.income, loaded: true, missing: false, categories: incomeCategories, categoriesMissing: false, addIncome: vi.fn(), updateIncome: vi.fn(), deleteIncome: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn() }
  },
}))
vi.mock('../hooks/useCategoryColors', () => ({ useCategoryColors: () => () => ({ hex: '#888888' }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('./expenses/OrdersSection', () => ({ OrdersSection: () => null }))
// The charts as plain buttons: a TREND bar per bucket ("Oct €135.50").
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => (
    <div role="group" aria-label={`Charts: ${props.emptyText}`}>
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
const { MoneySummary } = await import('./expenses/MoneySummary')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')
const client = await import('../lib/supabaseClient')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const [L1, L2, SHARED] = [label(P1), label(P2), label('shared')]
const parts = (a, b) => ({ [`part_${P1}`]: a, [`part_${P2}`]: b })

// The six October 2026 expenses of the plan (9O): Everyone €135.50.
const october = () => [
  { id: 'e1', description: 'TEST bar', amount: 25.5, category_id: 'going-out', expense_date: '2026-10-02', paid_by: P2, ...parts(null, null) },
  { id: 'e2', description: 'TEST shopping', amount: 48.9, category_id: 'groceries', expense_date: '2026-10-03', paid_by: 'shared', ...parts(20, 28.9) },
  { id: 'e3', description: 'TEST tobacco', amount: 6.2, category_id: 'smoke', expense_date: '2026-10-04', paid_by: P1, ...parts(null, null) },
  { id: 'e4', description: 'TEST cinema', amount: 18, category_id: 'going-out', expense_date: '2026-10-06', paid_by: P1, ...parts(null, null) },
  { id: 'e5', description: 'TEST vape', amount: 5.5, category_id: 'smoke', expense_date: '2026-10-07', paid_by: P2, ...parts(null, null) },
  { id: 'e6', description: 'TEST dinner', amount: 31.4, category_id: 'going-out', expense_date: '2026-10-09', paid_by: 'shared', ...parts(15.7, 15.7) },
]

// The first-date reads (one select per table, oldest first, one row).
const firstDates = (expenseDate, incomeDate = null) => {
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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  today(2026, 11, 12)
  firstDates('2026-10-02')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  data.expenses = []
  data.income = []
  data.since = []
  data.incomeSince = []
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
  delete client.supabase.from
})

const page = () => render(<ExpensesPage />)
const pill = (name) => fireEvent.click(screen.getByRole('button', { name, pressed: false }))
const periodText = (name) => screen.getByRole('button', { name })
const row = () => within(screen.getByRole('region', { name: 'Pick a period' }))
const openRow = (name) => {
  fireEvent.click(periodText(name))
  return row()
}
const options = (select) => Array.from(select.options).map((o) => o.textContent)
const choose = (labelText, value) => fireEvent.change(row().getByLabelText(labelText), { target: { value: String(value) } })
const show = () => fireEvent.click(row().getByRole('button', { name: 'Show' }))
const tap = (name) => fireEvent.click(row().getByRole('button', { name }))
const section = (title) => screen.getByRole('heading', { name: title }).closest('section')
const ex = () => within(section('Expenses'))
const trend = () =>
  ex()
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('data-bar'))
    .map((b) => b.textContent.replace(/ €.*/, ''))
const paidBy = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Paid by' })).getByRole('button', { name }))
const chip = (title) => screen.getByRole('heading', { name: title }).parentElement
const summary = () => screen.getByText('Balance').closest('div').parentElement
// The months of a select (0 = January).
const SEPTEMBER = 8
const OCTOBER = 9
const DECEMBER = 11

describe('Money → the bar under the pills (K160b, K161)', () => {
  it('"‹" / "›" only on Week and Month', () => {
    page()
    const arrows = () => [screen.queryByRole('button', { name: 'Previous period' }), screen.queryByRole('button', { name: 'Next period' })].filter(Boolean).length
    expect(arrows()).toBe(2) // Month
    for (const [name, text] of [
      ['3 Months', 'Sep – Nov 2026'],
      ['6 Months', 'Jun – Nov 2026'],
      ['Year', '2026'],
    ]) {
      pill(name)
      expect(periodText(text)).toBeTruthy()
      expect(arrows()).toBe(0)
    }
    pill('Week')
    expect(arrows()).toBe(2)
    expect(periodText('9 Nov – 15 Nov 2026')).toBeTruthy()
  })

  it('Week: tapping the text goes back to this week (as before), no row', () => {
    page()
    pill('Week')
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    fireEvent.click(periodText('2 Nov – 8 Nov 2026'))
    expect(periodText('9 Nov – 15 Nov 2026')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Pick a period' })).toBeNull()
  })

  it('Month: the row has "Month" (January … November in 2026, no December) and "Year"; nothing changes until "Show"', async () => {
    page()
    const r = openRow('November 2026')
    expect(periodText('November 2026').getAttribute('aria-expanded')).toBe('true')
    expect(options(r.getByLabelText('Month'))).toEqual(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November'])
    expect(options(r.getByLabelText('Year'))).toEqual(['2026'])
    // Already on this month: no "This month".
    expect(r.queryByRole('button', { name: 'This month' })).toBeNull()
    choose('Month', SEPTEMBER)
    expect(periodText('November 2026')).toBeTruthy()
    show()
    expect(periodText('September 2026')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Pick a period' })).toBeNull()
    // The arrows stay; "This month" goes back.
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(periodText('August 2026')).toBeTruthy()
    openRow('August 2026')
    tap('This month')
    expect(periodText('November 2026')).toBeTruthy()
  })

  it('tapping the text again closes the row without a change', () => {
    page()
    openRow('November 2026')
    choose('Month', SEPTEMBER)
    fireEvent.click(periodText('November 2026'))
    expect(screen.queryByRole('region', { name: 'Pick a period' })).toBeNull()
    expect(periodText('November 2026')).toBeTruthy()
  })
})

describe('Money → 3 Months / 6 Months (K160a, K160d)', () => {
  it('3 Months on 12/11/2026: Sep – Nov; September + Ending in → Jul – Sep; + Starting in → Sep – Nov; Q3; Q4 (running)', () => {
    page()
    pill('3 Months')
    expect(periodText('Sep – Nov 2026')).toBeTruthy()
    let r = openRow('Sep – Nov 2026')
    expect(r.getByRole('button', { name: 'Ending in' }).getAttribute('aria-pressed')).toBe('true')
    choose('Month', SEPTEMBER)
    show()
    expect(periodText('Jul – Sep 2026')).toBeTruthy()

    r = openRow('Jul – Sep 2026')
    choose('Month', SEPTEMBER)
    tap('Starting in')
    show()
    expect(periodText('Sep – Nov 2026')).toBeTruthy()

    r = openRow('Sep – Nov 2026')
    expect(r.getAllByRole('button', { name: /^Q\d$/ }).map((b) => [b.textContent, b.disabled])).toEqual([
      ['Q1', false],
      ['Q2', false],
      ['Q3', false],
      ['Q4', false],
    ])
    tap('Q3')
    expect(periodText('Jul – Sep 2026')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Pick a period' })).toBeNull()
    openRow('Jul – Sep 2026')
    expect(row().getByRole('button', { name: 'Q3' }).getAttribute('aria-pressed')).toBe('true')
    tap('Q4')
    expect(periodText('Oct – Dec 2026')).toBeTruthy()
    expect(trend()).toEqual(['Oct', 'Nov'])
    openRow('Oct – Dec 2026')
    tap('This month')
    expect(periodText('Sep – Nov 2026')).toBeTruthy()
  })

  it('"Starting in" with November 2026 (this month) is disabled, with "Use Month for this month only"', () => {
    page()
    pill('3 Months')
    const r = openRow('Sep – Nov 2026')
    expect(r.getByLabelText('Month').value).toBe('10')
    expect(r.getByRole('button', { name: 'Starting in' }).disabled).toBe(true)
    expect(r.getByText('Use Month for this month only')).toBeTruthy()
    choose('Month', OCTOBER)
    expect(r.getByRole('button', { name: 'Starting in' }).disabled).toBe(false)
    expect(r.queryByText('Use Month for this month only')).toBeNull()
  })

  it('October 2026 + Starting in (3 Months) → Oct – Dec 2026, TREND Oct and Nov only; its period chips the same', () => {
    data.expenses = october()
    page()
    pill('3 Months')
    openRow('Sep – Nov 2026')
    choose('Month', OCTOBER)
    tap('Starting in')
    show()
    expect(periodText('Oct – Dec 2026')).toBeTruthy()
    expect(trend()).toEqual(['Oct', 'Nov'])
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(ex().getByRole('button', { name: /^Sort by period/ }))
    const panel = within(ex().getByRole('region', { name: 'Sort by period' }))
    expect(panel.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['Oct 2026', 'Nov 2026'])
  })

  it('6 Months on 12/11/2026: Jun – Nov; H1 → Jan – Jun; H2 → Jul – Dec (running, TREND Jul … Nov)', () => {
    page()
    pill('6 Months')
    expect(periodText('Jun – Nov 2026')).toBeTruthy()
    const r = openRow('Jun – Nov 2026')
    expect(r.getAllByRole('button', { name: /^H\d$/ }).map((b) => b.textContent)).toEqual(['H1', 'H2'])
    tap('H1')
    expect(periodText('Jan – Jun 2026')).toBeTruthy()
    expect(trend()).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
    openRow('Jan – Jun 2026')
    tap('H2')
    expect(periodText('Jul – Dec 2026')).toBeTruthy()
    expect(trend()).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
  })

  it('data from January 2025: December 2025 + Starting in → Dec 2025 – Feb 2026', async () => {
    firstDates('2025-01-15', '2025-02-01')
    page()
    pill('3 Months')
    const r = openRow('Sep – Nov 2026')
    await waitFor(() => expect(options(r.getByLabelText('Year'))).toEqual(['2026', '2025']))
    choose('Year', 2025)
    expect(options(r.getByLabelText('Month'))).toHaveLength(12)
    choose('Month', DECEMBER)
    tap('Starting in')
    show()
    expect(periodText('Dec 2025 – Feb 2026')).toBeTruthy()
    expect(trend()).toEqual(['Dec', 'Jan', 'Feb'])
  })

  it('a quarter or half entirely in the future is disabled (15/01/2027)', async () => {
    today(2027, 1, 15)
    page()
    pill('3 Months')
    const r = openRow('Nov 2026 – Jan 2027')
    await waitFor(() => expect(options(r.getByLabelText('Year'))).toEqual(['2027', '2026']))
    expect(options(r.getByLabelText('Month'))).toEqual(['January'])
    expect(r.getAllByRole('button', { name: /^Q\d$/ }).map((b) => b.disabled)).toEqual([false, true, true, true])
    choose('Year', 2026)
    expect(options(r.getByLabelText('Month'))).toHaveLength(12)
    expect(r.getAllByRole('button', { name: /^Q\d$/ }).map((b) => b.disabled)).toEqual([false, false, false, false])
    pill('6 Months')
    const r6 = openRow('Aug 2026 – Jan 2027')
    expect(r6.getAllByRole('button', { name: /^H\d$/ }).map((b) => b.disabled)).toEqual([false, true])
  })
})

describe('Money → Year (K160c, K160d)', () => {
  const spans = () => {
    const group = row().queryByRole('group', { name: 'Spans' })
    return group ? within(group).getAllByRole('button').map((b) => b.textContent) : []
  }

  it('12/11/2026, first data October 2026: only 2026; TREND Jan … Nov (11 bars)', async () => {
    page()
    pill('Year')
    expect(periodText('2026')).toBeTruthy()
    expect(trend()).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
    const r = openRow('2026')
    await waitFor(() => expect(options(r.getByLabelText('Year'))).toEqual(['2026']))
    expect(spans()).toEqual([])
    expect(r.queryByRole('button', { name: 'This year' })).toBeNull()
  })

  it('15/01/2027: 2027, 2026 and "All" (Oct 2026 – Jan 2027), loaded from October 2026', async () => {
    today(2027, 1, 15)
    page()
    pill('Year')
    expect(periodText('2027')).toBeTruthy()
    const r = openRow('2027')
    await waitFor(() => expect(spans()).toEqual(['All']))
    expect(options(r.getByLabelText('Year'))).toEqual(['2027', '2026'])
    tap('All')
    expect(periodText('Oct 2026 – Jan 2027')).toBeTruthy()
    expect(trend()).toEqual(['Oct', 'Nov', 'Dec', 'Jan'])
    expect(data.since.at(-1)).toBe('2026-10-01')
    expect(data.incomeSince.at(-1)).toBe('2026-10-01')
    openRow('Oct 2026 – Jan 2027')
    expect(row().getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    choose('Year', 2026)
    show()
    expect(periodText('2026')).toBeTruthy()
    expect(trend()).toHaveLength(12)
    openRow('2026')
    tap('This year')
    expect(periodText('2027')).toBeTruthy()
  })

  it('15/11/2027: 2026, 2027, "All" and "Last 12 months" (Dec 2026 – Nov 2027)', async () => {
    today(2027, 11, 15)
    page()
    pill('Year')
    openRow('2027')
    await waitFor(() => expect(spans()).toEqual(['All', 'Last 12 months']))
    tap('Last 12 months')
    expect(periodText('Dec 2026 – Nov 2027')).toBeTruthy()
    expect(trend()).toHaveLength(12)
  })

  it('15/11/2029: 2026 … 2029, "Last 12 months", "3 years" (Dec 2026 – Nov 2029) with 4 year bars and the chips "2026" … "2029"', async () => {
    today(2029, 11, 15)
    data.expenses = october()
    page()
    pill('Year')
    const r = openRow('2029')
    await waitFor(() => expect(spans()).toEqual(['All', 'Last 12 months', '3 years']))
    expect(options(r.getByLabelText('Year'))).toEqual(['2029', '2028', '2027', '2026'])
    tap('3 years')
    expect(periodText('Dec 2026 – Nov 2029')).toBeTruthy()
    expect(trend()).toEqual(['2026', '2027', '2028', '2029'])
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(ex().getByRole('button', { name: /^Sort by period/ }))
    const panel = within(ex().getByRole('region', { name: 'Sort by period' }))
    expect(panel.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(['2026', '2027', '2028', '2029'])
  })

  it('a failed read: only this year and the years of the rows already loaded', async () => {
    client.supabase.from = () => {
      throw new Error('offline')
    }
    today(2027, 1, 15)
    data.expenses = october()
    page()
    pill('Year')
    const r = openRow('2027')
    expect(options(r.getByLabelText('Year'))).toEqual(['2027', '2026'])
    expect(spans()).toEqual(['All'])
  })
})

describe('Money → loading follows the period', () => {
  it('H1 2026 when only November is loaded: loads from 2026-01-01 (expenses and income)', () => {
    page()
    expect(data.since.at(-1)).toBe('2026-11-01')
    pill('6 Months')
    openRow('Jun – Nov 2026')
    tap('H1')
    expect(data.since.at(-1)).toBe('2026-01-01')
    expect(data.incomeSince.at(-1)).toBe('2026-01-01')
  })
})

describe('Money → the person pills and the K4 note in every period', () => {
  const periods = [
    ['Month → October 2026', () => {
      openRow('November 2026')
      choose('Month', OCTOBER)
      show()
    }],
    ['3 Months', () => pill('3 Months')],
    ['6 Months', () => pill('6 Months')],
    ['Year', () => pill('Year')],
    ['Q4 2026', () => {
      pill('3 Months')
      openRow('Sep – Nov 2026')
      tap('Q4')
    }],
  ]

  it.each(periods)('%s: Everyone €135.50, the two persons €59.90 / €75.60, Shared €80.30', (_, choosePeriod) => {
    data.expenses = october()
    page()
    choosePeriod()
    const expected = [
      ['Everyone', '€135.50'],
      [L1, '€59.90'],
      [L2, '€75.60'],
      [SHARED, '€80.30'],
    ]
    for (const [name, total] of expected) {
      paidBy(name)
      expect(within(chip('Expenses')).getByText(total)).toBeTruthy()
      expect(within(summary()).getByText(total)).toBeTruthy()
    }
  })

  it.each(periods)('%s: the K4 note stays the same', (_, choosePeriod) => {
    data.expenses = [...october(), { id: 'e7', description: 'TEST pharmacy', amount: 10, category_id: 'groceries', expense_date: '2026-10-08', paid_by: 'shared', ...parts(null, null) }]
    page()
    paidBy(L1)
    choosePeriod()
    expect(within(summary()).getByText(`1 ${SHARED} expense without parts (€10.00) is not in this total.`)).toBeTruthy()
    expect(within(summary()).getByText('€59.90')).toBeTruthy()
  })
})

describe('Money → the money colours (K181)', () => {
  const IN = 'text-[var(--color-money-in)]'
  const OUT = 'text-[var(--color-money-out)]'
  const ORANGE = 'text-[var(--color-accent)]'

  it('BALANCE +€2344.77 green; INCOME and the Income € chip green; EXPENSES and its chip orange', () => {
    data.expenses = [{ id: 'x1', description: 'TEST month', amount: 2575.4, category_id: 'groceries', expense_date: '2026-11-03', paid_by: 'shared', ...parts(1000, 1575.4) }]
    data.income = [{ id: 'i1', amount: 4920.17, income_date: '2026-11-05', category_id: 'salary', received_by: P1, source: 'TEST salary' }]
    page()
    expect(within(summary()).getByText('+€2344.77').className).toContain(IN)
    expect(within(summary()).getByText('€4920.17').className).toContain(IN)
    expect(within(chip('Income')).getByText('€4920.17').className).toContain(IN)
    expect(within(summary()).getByText('€2575.40').className).toContain(ORANGE)
    expect(within(chip('Expenses')).getByText('€2575.40').className).toContain(ORANGE)
  })

  it('BALANCE −€8.00 red; exactly €0.00 neutral (also when cents add up to it)', () => {
    const balance = (income, expenses, text) => {
      render(<MoneySummary income={income} expenses={expenses} />)
      const el = screen.getByText(text)
      cleanup()
      return el.className
    }
    expect(balance(0, 8, '−€8.00')).toContain(OUT)
    const zero = balance(10, 10, '€0.00')
    expect(zero).toContain('text-[var(--color-text)]')
    expect(zero).not.toContain(IN)
    expect(balance(0.3, 0.1 + 0.2, '€0.00')).toContain('text-[var(--color-text)]')
  })
})

describe('Money → "Sort by period": "To" alone (K182)', () => {
  it('To 06/11 with "From" empty → only the 06/11 rows, "Sort by period · 1", the chip "06/11"', () => {
    data.expenses = [
      { id: 'n1', description: 'TEST fifth', amount: 5, category_id: 'groceries', expense_date: '2026-11-05', paid_by: P1, ...parts(null, null) },
      { id: 'n2', description: 'TEST sixth one', amount: 6.5, category_id: 'groceries', expense_date: '2026-11-06', paid_by: P1, ...parts(null, null) },
      { id: 'n3', description: 'TEST sixth two', amount: 7, category_id: 'going-out', expense_date: '2026-11-06', paid_by: P2, ...parts(null, null) },
      { id: 'n4', description: 'TEST ninth', amount: 9, category_id: 'going-out', expense_date: '2026-11-09', paid_by: P2, ...parts(null, null) },
    ]
    page()
    fireEvent.click(ex().getByRole('button', { name: /^Expenses \(/ }))
    fireEvent.click(ex().getByRole('button', { name: /^Sort by period/ }))
    const panel = within(ex().getByRole('region', { name: 'Sort by period' }))
    fireEvent.change(panel.getByLabelText('To'), { target: { value: '06/11/2026' } })
    expect(ex().getByText('2 · €13.50')).toBeTruthy()
    expect(ex().getByRole('button', { name: 'Expenses (2 of 4)' })).toBeTruthy()
    expect(ex().getByRole('button', { name: /^Sort by period/ }).textContent).toBe('Sort by period · 1')
    expect(ex().getByRole('button', { name: 'Remove filter 06/11' }).textContent).toBe('06/11')
    expect(panel.getByLabelText('From').value).toBe('')
  })
})
