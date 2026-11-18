// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9P, Update round prompt 2: the 4th payer "Joint", the top card with
// transfers and the starting balance (K221–K224), the pills (K216, K222)
// and the Transfers section (K228–K231). Made-up rows with the numbers of
// section 5 (lib/jointNovember.fixture.js); the payers come from
// PAID_BY_OPTIONS (never written out here).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

// `beforeLoaded`: whether the rows before the period are read (false = not
// read yet / a failed read).
const data = vi.hoisted(() => ({ expenses: [], income: [], beforeLoaded: true }))
// The transfers table: rows, read or not, missing (before 033); live.
const tr = vi.hoisted(() => ({ state: { rows: [], loaded: true }, listeners: new Set() }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => {
  const { useSyncExternalStore } = await import('react')
  const before = (kind, day) => {
    const rows = kind === 'expenses' ? data.expenses.filter((e) => e.expense_date < day) : data.income.filter((i) => i.income_date < day)
    const snap = data.beforeLoaded ? { rows, loaded: true } : { rows: [], loaded: false }
    return { useRows: () => snap, getSnapshot: () => snap, refresh: () => {} }
  }
  const emit = () => tr.listeners.forEach((l) => l())
  const subscribe = (l) => {
    tr.listeners.add(l)
    return () => tr.listeners.delete(l)
  }
  const put = (rows) => {
    const ids = new Set(rows.map((r) => r.id))
    tr.state = { ...tr.state, rows: [...tr.state.rows.filter((r) => !ids.has(r.id)), ...rows] }
    emit()
  }
  return {
    ...(await original()),
    expensesBefore: (key) => before('expenses', key.split('|')[0]),
    incomeBefore: (day) => before('income', day),
    transferStore: {
      useRows: () => useSyncExternalStore(subscribe, () => tr.state),
      getSnapshot: () => tr.state,
      refresh: () => {},
      upsertLocal: put,
      removeLocal: (ids) => {
        tr.state = { ...tr.state, rows: tr.state.rows.filter((r) => !ids.includes(r.id)) }
        emit()
      },
    },
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
const categories = [{ id: 'groceries', name: 'Groceries', parent_id: null }]
const addExpenseOnce = vi.hoisted(() => ({ fn: null }))
vi.mock('../hooks/useExpenses', () => ({
  addExpenseOnce: (...args) => addExpenseOnce.fn(...args),
  useExpenses: () => ({ expenses: data.expenses, loaded: true, categories, updateExpense: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn(), deleteExpense: vi.fn() }),
}))
const incomeCategories = [{ id: 'salary', name: 'Salary', parent_id: null }]
const addIncome = vi.hoisted(() => ({ fn: null }))
vi.mock('../hooks/useIncome', () => ({
  useIncome: () => ({ income: data.income, loaded: true, missing: false, categories: incomeCategories, categoriesMissing: false, addIncome: (...a) => addIncome.fn(...a), updateIncome: vi.fn(), deleteIncome: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveCategory: vi.fn(), deleteCategory: vi.fn() }),
}))
vi.mock('../hooks/useCategoryColors', () => ({ useCategoryColors: () => () => ({ hex: '#888888' }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: true, missing: false, mapRows: [] }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('./expenses/OrdersSection', () => ({ OrdersSection: () => null }))
vi.mock('./expenses/MoneyCharts', () => ({
  MoneyCharts: (props) => (
    <div role="group" aria-label={`Charts: ${props.emptyText}`}>
      {props.barData.map((b) => (
        <span key={b.key} data-bar="">
          {b.amount.toFixed(2)}
        </span>
      ))}
    </div>
  ),
}))

const { ExpensesPage } = await import('../pages/ExpensesPage')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')
const { forgetPartsForTest } = await import('../hooks/useExpenseParts')
const { setOnlineForTest } = await import('../lib/connection')
const client = await import('../lib/supabaseClient')
const { JOINT, JOINT_600, NOVEMBER, OCTOBER, P1, P2, label } = await import('../lib/jointNovember.fixture')
const [L1, L2] = [label(P1), label(P2)]
const SHARED = label('shared')

// The database behind the app: the first dates (period pickers) and the
// transfers table (upsert / update / delete, each `.select()`ed).
const db = { calls: [], fail: null }
function fakeDatabase() {
  client.supabase.from = (table) => {
    if (table !== 'transfers') {
      return { select: (column) => ({ order: () => ({ limit: async () => ({ data: [{ [column]: '2026-10-05' }], error: null }) }) }) }
    }
    const st = { op: null, rows: null, values: null, id: null }
    const answer = async () => {
      db.calls.push({ ...st })
      if (db.fail) return { data: null, error: db.fail }
      if (st.op === 'upsert') return { data: st.rows.map((r) => ({ created_at: '2026-11-18T10:00:00Z', ...r })), error: null }
      const row = tr.state.rows.find((r) => r.id === st.id)
      if (st.op === 'update') return { data: row ? [{ ...row, ...st.values }] : [], error: null }
      return { data: row ? [row] : [], error: null }
    }
    const chain = { eq: (_c, id) => ((st.id = id), chain), select: () => answer(), then: (resolve, reject) => answer().then(resolve, reject) }
    return {
      upsert: (rows) => ((st.op = 'upsert'), (st.rows = rows), chain),
      update: (values) => ((st.op = 'update'), (st.values = values), chain),
      delete: () => ((st.op = 'delete'), chain),
    }
  }
}

const load = ({ transfers = NOVEMBER.transfers, state = {}, extraExpenses = [] } = {}) => {
  data.expenses = [...OCTOBER.expenses, ...NOVEMBER.expenses, ...extraExpenses]
  data.income = [...OCTOBER.income, ...NOVEMBER.income]
  tr.state = { rows: transfers, loaded: true, ...state }
}
const today = (y, m, d) => vi.setSystemTime(new Date(y, m - 1, d, 12))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  today(2026, 11, 18)
  fakeDatabase()
  db.calls = []
  db.fail = null
  addExpenseOnce.fn = vi.fn(async () => ({ error: null }))
  addIncome.fn = vi.fn(async () => ({ error: null }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  data.expenses = []
  data.income = []
  data.beforeLoaded = true
  tr.state = { rows: [], loaded: true }
  setOnlineForTest(true)
  localStorage.clear()
  getToasts().forEach((t) => dismissToast(t.id))
  forgetPartsForTest()
  delete client.supabase.from
})

const page = () => render(<ExpensesPage />)
const group = (name) => screen.getByRole('group', { name })
const pills = (name) => within(group(name)).getAllByRole('button').map((b) => b.textContent)
const paidBy = (name) => fireEvent.click(within(group('Paid by')).getByRole('button', { name }))
const receivedBy = (name) => fireEvent.click(within(group('Received by')).getByRole('button', { name }))
const both = (name) => {
  paidBy(name)
  receivedBy(name)
}
const card = () => screen.getByText('Balance').closest('div').parentElement
const inCard = () => within(card())
const tile = (name) => inCard().getByText(name).closest('div').children[1]
const leftoverLine = () => inCard().queryByText(/^Leftover from/)
const breakdown = () => leftoverLine()?.nextElementSibling ?? null
const grey = (start) => inCard().queryByText((_, el) => el?.tagName === 'P' && el.textContent.startsWith(start))
const periodResult = () => inCard().queryByText(/^This (month|range)/)
const availableText = () => inCard().queryByText(/^Available /)
const chip = (title) => screen.getByRole('heading', { name: title }).nextElementSibling.querySelector('span')
const GREEN = 'var(--color-money-in)'
const RED = 'var(--color-money-out)'
const transfersBar = () => screen.queryByRole('button', { name: /^Transfers \(\d+\)/ })
const toast = () => getToasts().at(-1)

describe('Money → top card with Joint (section 5; K221–K224)', () => {
  it('Joint / Joint: no leftover, INCOME €0.00, EXPENSES €146.81, the two grey lines (green), BALANCE +€525.67, no "This month", Available €672.48 · spent 22%', () => {
    load()
    page()
    both('Joint')
    expect(leftoverLine()).toBeNull()
    expect(tile('Income').textContent).toBe('€0.00')
    expect(tile('Expenses').textContent).toBe('€146.81')
    expect(tile('Balance').textContent).toBe('+€525.67')
    expect(grey('Transfers ·').textContent).toBe('Transfers · Joint +€620.00')
    expect(grey('Transfers ·').querySelector('span').className).toContain(GREEN)
    expect(grey('Starting balance ·').textContent).toBe('Starting balance · Joint +€52.48')
    expect(periodResult()).toBeNull()
    expect(availableText().textContent).toBe('Available €672.48 · spent 22%')
  })

  it('second person: the leftover +€438.41, €1400.00, €625.25, "Transfers · … −€320.00" in red, BALANCE +€893.16, This month +€454.75, €1518.41 · 41%', () => {
    load()
    page()
    both(L2)
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€438.41')
    expect(breakdown()?.textContent ?? '').not.toContain('·')
    expect(tile('Income').textContent).toBe('€1400.00')
    expect(tile('Expenses').textContent).toBe('€625.25')
    expect(grey('Transfers ·').textContent).toBe(`Transfers · ${L2} −€320.00`)
    expect(grey('Transfers ·').querySelector('span').className).toContain(RED)
    expect(grey('Starting balance ·')).toBeNull()
    expect(tile('Balance').textContent).toBe('+€893.16')
    expect(periodResult().textContent).toBe('This month +€454.75')
    expect(availableText().textContent).toBe('Available €1518.41 · spent 41%')
  })

  it('first person: +€1906.36, €2648.00, €456.36, Transfers −€300.00, BALANCE +€3798.00, This month +€1891.64, €4254.36 · 11%', () => {
    load()
    page()
    both(L1)
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€1906.36')
    expect([tile('Income').textContent, tile('Expenses').textContent, tile('Balance').textContent]).toEqual(['€2648.00', '€456.36', '+€3798.00'])
    expect(grey('Transfers ·').textContent).toBe(`Transfers · ${L1} −€300.00`)
    expect(periodResult().textContent).toBe('This month +€1891.64')
    expect(availableText().textContent).toBe('Available €4254.36 · spent 11%')
  })

  it('Everyone: +€2344.77, breakdown of the two people only (Joint €0.00 left out), €4048.00, €1228.42, only "Starting balance · Joint +€52.48", BALANCE +€5216.83, +€2872.06, €6445.25 · 19%', () => {
    load()
    page()
    expect(leftoverLine().textContent).toBe('Leftover from October 2026 · +€2344.77')
    expect(breakdown().textContent).toBe(`${L1} +€1906.36 · ${L2} +€438.41`)
    expect([tile('Income').textContent, tile('Expenses').textContent, tile('Balance').textContent]).toEqual(['€4048.00', '€1228.42', '+€5216.83'])
    expect(grey('Transfers ·')).toBeNull()
    expect(grey('Starting balance ·').textContent).toBe('Starting balance · Joint +€52.48')
    expect(periodResult().textContent).toBe('This month +€2872.06')
    expect(availableText().textContent).toBe('Available €6445.25 · spent 19%')
  })

  it('a mixed card (Paid by Joint, Received by Everyone): no transfers, no starting balance, BALANCE as before', () => {
    load()
    page()
    paidBy('Joint')
    expect(grey('Transfers ·')).toBeNull()
    expect(grey('Starting balance ·')).toBeNull()
    expect(leftoverLine()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€3901.19')
  })

  it('the € chips and the charts keep expenses / income only: Expenses €625.25 / €456.36 / €146.81 / €1228.42; Income €4048.00; Totals and TREND of the second person add up to €625.25', () => {
    load()
    page()
    expect(chip('Expenses').textContent).toBe('€1228.42')
    expect(chip('Income').textContent).toBe('€4048.00')
    for (const [name, value] of [
      [L2, '€625.25'],
      [L1, '€456.36'],
      ['Joint', '€146.81'],
    ]) {
      paidBy(name)
      expect(chip('Expenses').textContent).toBe(value)
    }
    paidBy(L2)
    expect(screen.getByRole('button', { name: /^Totals per category \(1\)/ }).textContent).toContain('€625.25')
    const trend = within(screen.getByRole('group', { name: /^Charts: No expenses/ }))
      .getAllByText((_, el) => el?.hasAttribute?.('data-bar'))
      .reduce((s, el) => s + Number(el.textContent), 0)
    expect(Math.round(trend * 100) / 100).toBe(625.25)
  })

  it('December: "Leftover from November 2026 · +€5216.83" and the three accounts in the breakdown; "Joint now €525.67"', () => {
    today(2026, 12, 15)
    load()
    page()
    expect(leftoverLine().textContent).toBe('Leftover from November 2026 · +€5216.83')
    expect(breakdown().textContent).toBe(`${L1} +€3798.00 · ${L2} +€893.16 · Joint +€525.67`)
    expect(screen.getByText(/^Joint now/).textContent).toBe('Joint now €525.67')
    // K233: no Joint movement in December, but Joint's money before 01/12 is
    // €525.67 → the "Received by: Joint" pill is on offer.
    expect(pills('Received by')).toEqual(['Everyone', L1, L2, 'Joint'])
  })

  it('December with a Joint transfer: both pills on Joint → "Leftover from November 2026 · +€525.67"', () => {
    today(2026, 12, 15)
    load({ transfers: [...NOVEMBER.transfers, { id: 't-dec', transfer_date: '2026-12-02', from_code: P1, to_code: JOINT, amount: 10, note: null }] })
    page()
    both('Joint')
    expect(leftoverLine().textContent).toBe('Leftover from November 2026 · +€525.67')
    expect(tile('Balance').textContent).toBe('+€535.67')
  })

  it('transfers not read yet, or offline: no transfer line, no leftover line, no bar (K196); read → shown', () => {
    load({ state: { loaded: false } })
    page()
    expect(leftoverLine()).toBeNull()
    expect(availableText()).toBeNull()
    expect(grey('Starting balance ·')).toBeNull()
    act(() => {
      tr.state = { ...tr.state, loaded: true }
      tr.listeners.forEach((l) => l())
    })
    expect(grey('Starting balance ·')).toBeTruthy()
    expect(leftoverLine()).toBeTruthy()
    act(() => setOnlineForTest(false))
    expect(grey('Starting balance ·')).toBeNull()
    expect(leftoverLine()).toBeNull()
  })
})

describe('Money → the pills (K216, K222)', () => {
  it('"Paid by": Everyone and the three accounts in November (no Shared expense); the row wraps and every pill is 36 px', () => {
    load()
    page()
    expect(pills('Paid by')).toEqual(['Everyone', L1, L2, 'Joint'])
    expect(group('Paid by').className).toContain('flex-wrap')
    for (const b of within(group('Paid by')).getAllByRole('button')) expect(b.className).toContain('min-h-9')
    expect(group('Received by').className).toContain('flex-wrap')
  })

  it('October: "Shared" is on offer (27/10 €268.58); the parts €100.00 / €168.58 stay in the people\'s October pills; Shared chosen → November → Everyone (remembered)', () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(pills('Paid by')).toEqual(['Everyone', L1, L2, 'Joint', SHARED])
    paidBy(L1)
    expect(chip('Expenses').textContent).toBe('€1000.00')
    paidBy(L2)
    expect(chip('Expenses').textContent).toBe('€961.59')
    paidBy(SHARED)
    expect(chip('Expenses').textContent).toBe('€268.58')
    expect(localStorage.getItem('money.expensePerson')).toBe('shared')
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
    expect(pills('Paid by')).toEqual(['Everyone', L1, L2, 'Joint'])
    expect(within(group('Paid by')).getByRole('button', { name: 'Everyone' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('money.expensePerson')).toBe('all')
  })

  it('K222: "Received by" offers Joint in November (transfers, a starting balance) and not in October; chosen → October → Everyone', () => {
    load()
    page()
    expect(pills('Received by')).toEqual(['Everyone', L1, L2, 'Joint'])
    receivedBy('Joint')
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(pills('Received by')).toEqual(['Everyone', L1, L2])
    expect(within(group('Received by')).getByRole('button', { name: 'Everyone' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('money.incomePerson')).toBe('all')
  })

  it('K222 off (no transfer, no Joint income): no Joint "Received by" pill', () => {
    load({ transfers: [] })
    page()
    expect(pills('Received by')).toEqual(['Everyone', L1, L2])
  })
})

describe('Money → Transfers (K228–K231)', () => {
  const openList = () => fireEvent.click(transfersBar())
  const form = () => screen.getByText(/^(Add|Edit) transfer$/).closest('form')
  const inForm = () => within(form())
  const save = () => fireEvent.click(inForm().getByRole('button', { name: /^Save (transfer|starting balance)$/ }))
  const formProblem = () => form().querySelector('.text-red-400')?.textContent ?? ''

  it('between Income and Orders: title, "+ Add transfer" (36 px), "Joint now €525.67", the closed bar "Transfers (4)"; open: newest first, texts and 36 px buttons', () => {
    load()
    page()
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings.indexOf('Transfers')).toBe(headings.indexOf('Income') + 1)
    expect(screen.getByRole('button', { name: 'Add transfer' }).className).toContain('min-h-9')
    expect(screen.getByText(/^Joint now/).textContent).toBe('Joint now €525.67')
    expect(transfersBar().getAttribute('aria-expanded')).toBe('false')
    expect(transfersBar().textContent).toContain('Transfers (4)')
    openList()
    const rows = screen.getAllByRole('button', { name: 'Edit transfer' }).map((b) => b.closest('.rounded-2xl'))
    expect(rows.map((r) => r.querySelector('p').textContent)).toEqual([`${L2} → Joint`, `${L2} → Joint`, `${L1} → Joint`, 'Starting balance → Joint'])
    expect(rows[0].textContent).toContain('14/11/2026')
    expect(rows[0].textContent).toContain('€20.00')
    expect(rows[1].textContent).toContain('TEST deposit')
    expect(rows[3].textContent).toContain('01/11/2026')
    expect(rows[3].textContent).toContain('€52.48')
    for (const b of [...screen.getAllByRole('button', { name: 'Edit transfer' }), ...screen.getAllByRole('button', { name: 'Delete transfer' })]) expect(b.className).toContain('w-9 h-9')
    // Not affected by the person pills.
    paidBy(L1)
    expect(transfersBar().textContent).toContain('Transfers (4)')
  })

  it('a period without transfers: "Transfers (0)" → "No transfers in this period."; the bar stays open through a period change', () => {
    load()
    page()
    openList()
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(transfersBar().textContent).toContain('Transfers (0)')
    expect(transfersBar().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('No transfers in this period.')).toBeTruthy()
  })

  it('before 033: the title and the notice in place of the button and the bar; the top card as before; "Joint" still a payer', () => {
    load({ transfers: [], state: { missing: true } })
    page()
    expect(screen.getByRole('heading', { name: 'Transfers' })).toBeTruthy()
    expect(screen.getByText('This needs the database update supabase/033_transfers.sql')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add transfer' })).toBeNull()
    expect(transfersBar()).toBeNull()
    expect(tile('Balance').textContent).toBe('+€5164.35')
    expect(pills('Paid by')).toContain('Joint')
  })

  it('"Add transfer": the texts in order, the "To" pill equal to "From" disabled; saved once with the form\'s id; toast with Undo, which deletes it', async () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer' }))
    expect(within(inForm().getByRole('group', { name: 'Kind' })).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Transfer', 'true'],
      ['Starting balance', 'false'],
    ])
    expect(within(inForm().getByRole('group', { name: 'From' })).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    expect(inForm().getByPlaceholderText('e.g. Deposit for the groceries')).toBeTruthy()
    save()
    expect(formProblem()).toBe('Choose where the money came from.')
    fireEvent.click(within(inForm().getByRole('group', { name: 'From' })).getByRole('button', { name: L2 }))
    expect(within(inForm().getByRole('group', { name: 'To' })).getByRole('button', { name: L2 }).disabled).toBe(true)
    save()
    expect(formProblem()).toBe('Choose where the money went.')
    fireEvent.click(within(inForm().getByRole('group', { name: 'To' })).getByRole('button', { name: 'Joint' }))
    save()
    expect(formProblem()).toBe('Enter the amount.')
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '0' } })
    save()
    expect(formProblem()).toBe('Enter an amount above 0, like 300 or 19,52.')
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '300' } })
    expect(db.calls).toEqual([])
    save()
    await waitFor(() => expect(toast()?.message).toBe(`Transfer saved · ${L2} → Joint · €300.00`))
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].rows[0]).toMatchObject({ transfer_date: '2026-11-18', from_code: P2, to_code: JOINT, amount: 300, note: null })
    expect(screen.queryByText('Add transfer', { selector: 'p' })).toBeNull()
    expect(transfersBar().textContent).toContain('Transfers (5)')
    expect(toast().action.label).toBe('Undo')
    const id = db.calls[0].rows[0].id
    await act(async () => runToastAction(toast().id))
    await waitFor(() => expect(db.calls.at(-1)).toMatchObject({ op: 'delete', id }))
    expect(transfersBar().textContent).toContain('Transfers (4)')
  })

  it('a failed save keeps what was typed (Retry); a second press sends the same id; before 033 the notice', async () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer' }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'From' })).getByRole('button', { name: 'Joint' }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'To' })).getByRole('button', { name: L1 }))
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '19,52' } })
    db.fail = { message: 'TypeError: Load failed' }
    save()
    await waitFor(() => expect(toast()?.message).toBe("Couldn't save — check your connection."))
    expect(toast().action.label).toBe('Retry')
    expect(inForm().getByLabelText('Amount (€)').value).toBe('19,52')
    db.fail = { code: 'PGRST205', message: 'Could not find the table' }
    save()
    await waitFor(() => expect(toast()?.message).toBe('This needs the database update supabase/033_transfers.sql'))
    expect(db.calls.map((c) => c.rows[0].id)).toEqual([db.calls[0].rows[0].id, db.calls[0].rows[0].id])
    expect(db.calls[0].rows[0]).toMatchObject({ from_code: JOINT, to_code: P1, amount: 19.52 })
  })

  it('offline: refused with the usual message, nothing sent, nothing queued', async () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer' }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'From' })).getByRole('button', { name: L1 }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'To' })).getByRole('button', { name: L2 }))
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '50' } })
    act(() => setOnlineForTest(false))
    save()
    await waitFor(() => expect(toast()?.message).toBe("You're offline — this needs a connection."))
    expect(db.calls).toEqual([])
    expect(form()).toBeTruthy()
  })

  it('"Starting balance": no "From", To Joint; a second one is refused with the first one\'s amount and date (K229); a date after today too', () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer' }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'Starting balance' }))
    expect(inForm().queryByRole('group', { name: 'From' })).toBeNull()
    expect(inForm().queryByRole('group', { name: 'To' })).toBeNull()
    expect(form().textContent).toContain('To Joint')
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '35,67' } })
    save()
    expect(formProblem()).toBe('Joint already has a starting balance (€52.48 on 01/11/2026). Change that one instead.')
    fireEvent.change(inForm().getByLabelText('Date'), { target: { value: '19/11/2026' } })
    fireEvent.blur(inForm().getByLabelText('Date'))
    save()
    expect(formProblem()).toBe("A transfer can't be after today.")
    expect(db.calls).toEqual([])
  })

  it('a first starting balance: "Save starting balance" → toast "Starting balance saved · Joint · €52.48"', async () => {
    load({ transfers: NOVEMBER.transfers.filter((t) => t.from_code) })
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer' }))
    fireEvent.click(within(inForm().getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'Starting balance' }))
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '52,48' } })
    save()
    await waitFor(() => expect(toast()?.message).toBe('Starting balance saved · Joint · €52.48'))
    expect(db.calls[0].rows[0]).toMatchObject({ from_code: null, to_code: JOINT, amount: 52.48 })
  })

  it('pencil "Edit transfer": the same card filled in, the kind kept; "Transfer changed" with Undo putting the old values back', async () => {
    load()
    page()
    openList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit transfer' })[1])
    expect(screen.getByText('Edit transfer', { selector: 'p' })).toBeTruthy()
    expect(inForm().queryByRole('group', { name: 'Kind' })).toBeNull()
    expect(inForm().getByLabelText('Amount (€)').value).toBe('300.00')
    expect(within(inForm().getByRole('group', { name: 'From' })).getByRole('button', { name: L2 }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(inForm().getByLabelText('Amount (€)'), { target: { value: '310' } })
    save()
    await waitFor(() => expect(toast()?.message).toBe('Transfer changed'))
    expect(db.calls[0]).toMatchObject({ op: 'update', id: 't-1', values: { amount: 310, from_code: P2, to_code: JOINT } })
    expect(screen.getByText(/^Joint now/).textContent).toBe('Joint now €535.67')
    await act(async () => runToastAction(toast().id))
    await waitFor(() => expect(db.calls.at(-1)).toMatchObject({ op: 'update', id: 't-1', values: { amount: 300, note: 'TEST deposit' } }))
    expect(screen.getByText(/^Joint now/).textContent).toBe('Joint now €525.67')
  })

  it('trash "Delete transfer": gone at once, "Transfer deleted" with Undo putting the same row back (same id)', async () => {
    load()
    page()
    openList()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete transfer' })[0])
    await waitFor(() => expect(toast()?.message).toBe('Transfer deleted'))
    expect(transfersBar().textContent).toContain('Transfers (3)')
    await act(async () => runToastAction(toast().id))
    await waitFor(() => expect(db.calls.at(-1)).toMatchObject({ op: 'upsert' }))
    expect(db.calls.at(-1).rows[0]).toMatchObject({ id: 't-3', amount: 20 })
    expect(transfersBar().textContent).toContain('Transfers (4)')
  })
})

// Update round prompt 2b: K233 (the "Received by: Joint" pill also when
// Joint's money before the period isn't €0.00) and K234 ("Joint now" =
// every Joint row up to the period's end). Today 18/11/2026 unless said.
describe('Money → Joint before the period (K233) and "Joint now" (K234)', () => {
  const periodPill = (name) => fireEvent.click(screen.getByRole('button', { name, pressed: false }))
  const prev = () => fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next period' }))
  const jointNow = () => screen.queryByText(/^Joint now/)?.textContent ?? null
  const chosen = (name) => within(group(name)).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent
  const withJoint = ['Everyone', L1, L2, 'Joint']
  const withoutJoint = ['Everyone', L1, L2]
  // A new copy of the transfer rows: the page reads every store again.
  const reread = () =>
    act(() => {
      tr.state = { ...tr.state }
      tr.listeners.forEach((l) => l())
    })

  it('fixture A, Month: November pill shown (K222), "Joint now €525.67"; October hidden, "Joint now €0.00"', () => {
    load()
    page()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €525.67')
    prev()
    expect(pills('Received by')).toEqual(withoutJoint)
    expect(jointNow()).toBe('Joint now €0.00')
  })

  it('fixture A, Week: 16–22 Nov shown (K233) €525.67; 9–15 Nov shown (K222) €525.67; 2–8 Nov shown (K233) €52.48; Joint/Joint in Week: no leftover, no "This month", no bar (K169)', () => {
    load()
    page()
    periodPill('Week')
    expect(screen.getByRole('button', { name: '16 Nov – 22 Nov 2026' })).toBeTruthy()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €525.67')
    both('Joint')
    expect(leftoverLine()).toBeNull()
    expect(periodResult()).toBeNull()
    expect(availableText()).toBeNull()
    prev()
    expect(screen.getByRole('button', { name: '9 Nov – 15 Nov 2026' })).toBeTruthy()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €525.67')
    prev()
    expect(screen.getByRole('button', { name: '2 Nov – 8 Nov 2026' })).toBeTruthy()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €52.48')
    expect(chosen('Received by')).toBe('Joint')
  })

  it('fixture A, December (today 15/12): pill shown (K233); both pills Joint → Leftover from November 2026 · +€525.67, €0.00, €0.00, +€525.67, "This month €0.00" (normal colour), Available €525.67 · spent 0%; "Joint now €525.67"', () => {
    today(2026, 12, 15)
    load()
    page()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €525.67')
    both('Joint')
    expect(leftoverLine().textContent).toBe('Leftover from November 2026 · +€525.67')
    expect([tile('Income').textContent, tile('Expenses').textContent, tile('Balance').textContent]).toEqual(['€0.00', '€0.00', '+€525.67'])
    expect(periodResult().textContent).toBe('This month €0.00')
    const tone = periodResult().querySelector('span').className
    expect(tone).not.toContain(GREEN)
    expect(tone).not.toContain(RED)
    expect(availableText().textContent).toBe('Available €525.67 · spent 0%')
    expect(jointNow()).toBe('Joint now €525.67')
  })

  it('fixture B (Joint €600.00 on 20/11; today 15/12): November Joint/Joint BALANCE −€74.33 and "Joint now −€74.33"; December: no leftover line on the Joint card (K166), the pill still shown, "Joint now −€74.33"', () => {
    today(2026, 12, 15)
    load({ extraExpenses: [JOINT_600] })
    page()
    prev()
    both('Joint')
    expect(tile('Balance').textContent).toBe('−€74.33')
    expect(jointNow()).toBe('Joint now −€74.33')
    next()
    expect(screen.getByRole('button', { name: 'December 2026' })).toBeTruthy()
    expect(pills('Received by')).toEqual(withJoint)
    expect(chosen('Received by')).toBe('Joint')
    expect(leftoverLine()).toBeNull()
    expect(jointNow()).toBe('Joint now −€74.33')
  })

  it('remembered (today 15/12): "Joint" chosen in November → December keeps it → October: hidden → "Everyone" (remembered)', () => {
    today(2026, 12, 15)
    load()
    page()
    prev()
    receivedBy('Joint')
    expect(localStorage.getItem('money.incomePerson')).toBe(JOINT)
    next()
    expect(screen.getByRole('button', { name: 'December 2026' })).toBeTruthy()
    expect(pills('Received by')).toEqual(withJoint)
    expect(chosen('Received by')).toBe('Joint')
    expect(localStorage.getItem('money.incomePerson')).toBe(JOINT)
    prev()
    prev()
    expect(pills('Received by')).toEqual(withoutJoint)
    expect(chosen('Received by')).toBe('Everyone')
    expect(localStorage.getItem('money.incomePerson')).toBe('all')
  })

  it('offline in December with "Joint" chosen: it stays "Joint" (remembered too); "Joint now" hidden; back online → shown again', () => {
    today(2026, 12, 15)
    load()
    page()
    receivedBy('Joint')
    act(() => setOnlineForTest(false))
    expect(chosen('Received by')).toBe('Joint')
    expect(localStorage.getItem('money.incomePerson')).toBe(JOINT)
    expect(jointNow()).toBeNull()
    act(() => setOnlineForTest(true))
    expect(chosen('Received by')).toBe('Joint')
    expect(jointNow()).toBe('Joint now €525.67')
  })

  it('the rows before the period not read yet (transfers known): no K233 pill of its own, but a remembered "Joint" is never reset (October); "Joint now" hidden; once read → October hides it → "Everyone"', () => {
    localStorage.setItem('money.incomePerson', JOINT)
    data.beforeLoaded = false
    load()
    page()
    prev()
    expect(pills('Received by')).toEqual(withJoint)
    expect(chosen('Received by')).toBe('Joint')
    expect(localStorage.getItem('money.incomePerson')).toBe(JOINT)
    expect(jointNow()).toBeNull()
    data.beforeLoaded = true
    reread()
    expect(pills('Received by')).toEqual(withoutJoint)
    expect(chosen('Received by')).toBe('Everyone')
    expect(localStorage.getItem('money.incomePerson')).toBe('all')
    expect(jointNow()).toBe('Joint now €0.00')
  })

  it('the rows before the period not read yet, nothing chosen, December: the pill only by K222 (hidden); read → shown (K233)', () => {
    today(2026, 12, 15)
    data.beforeLoaded = false
    load()
    page()
    expect(pills('Received by')).toEqual(withoutJoint)
    expect(jointNow()).toBeNull()
    data.beforeLoaded = true
    reread()
    expect(pills('Received by')).toEqual(withJoint)
    expect(jointNow()).toBe('Joint now €525.67')
  })

  it('before 033 (the table missing = no transfers, known): no crash; December shows the pill (Joint −€146.81 before 01/12) with no leftover line on the Joint card; November hides it (€0.00 before 01/11, no Joint income or transfer)', () => {
    today(2026, 12, 15)
    load({ transfers: [], state: { missing: true } })
    page()
    expect(screen.getByText('This needs the database update supabase/033_transfers.sql')).toBeTruthy()
    expect(jointNow()).toBeNull()
    expect(pills('Received by')).toEqual(withJoint)
    both('Joint')
    expect(leftoverLine()).toBeNull()
    prev()
    expect(pills('Received by')).toEqual(withoutJoint)
  })
})

describe('Money forms: no default payer (K217)', () => {
  it('"Add income": "Received by" starts on "Choose…" with the accounts only; refused with "Choose who received it.", nothing sent', async () => {
    load()
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }))
    const select = screen.getByRole('combobox', { name: 'Received by' })
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose…', L1, L2, 'Joint'])
    fireEvent.change(screen.getAllByLabelText('Amount (€)')[0], { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }))
    expect(screen.getByText('Choose who received it.')).toBeTruthy()
    expect(addIncome.fn).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: JOINT } })
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }))
    await waitFor(() => expect(addIncome.fn).toHaveBeenCalledTimes(1))
    expect(addIncome.fn.mock.calls[0][0]).toMatchObject({ amount: 12, receivedBy: JOINT })
  })
})
