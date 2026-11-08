// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// K107 (plan 9N): Shop → Receipts shows the quantity of every line under its
// name, small and grey, with the same rule as Money's opened purchase row:
// "2 pcs", "1 pcs", "1 pack · 4 pcs"; an old line without quantity shows
// nothing in either.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const snack = { id: 'snack', name: 'TEST Snack Box', unit: 'pcs' }
const lines = [
  { id: 'l1', trip_id: 't1', position: 1, name: 'TEST Snack Box', quantity: 2, unit: 'pcs', stock_added: 2, stock_unit: 'pcs', pantry_item_id: 'snack', expense_id: 'e1', line_total: 2.4 },
  { id: 'l2', trip_id: 't1', position: 2, name: 'Corn Snack', quantity: 1, unit: 'pcs', stock_added: 1, stock_unit: 'pcs', pantry_item_id: 'snack', expense_id: 'e2', line_total: 0.99 },
  { id: 'l3', trip_id: 't1', position: 3, name: 'TEST Felix', quantity: 1, unit: 'pack', stock_added: 4, stock_unit: 'pcs', pantry_item_id: 'snack', expense_id: 'e3', line_total: 3.2 },
  { id: 'l4', trip_id: 't1', position: 4, name: 'TEST Old line', quantity: null, unit: null, stock_added: 0, pantry_item_id: null, expense_id: 'e4', line_total: 1 },
]
const expenses = lines.map((l) => ({ id: l.expense_id, trip_id: 't1', category_id: 'g', amount: l.line_total, paid_by: 'shared', expense_date: '2026-11-08', description: l.name }))
const trip = { id: 't1', trip_date: '2026-11-08', source: 'shop', total: 7.59 }

const fake = (rows) => ({ useRows: () => ({ rows, loaded: true }), getSnapshot: () => ({ rows, loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  tripStore: fake([trip]),
  tripItemStore: fake(lines),
  tripExpenseStore: fake(expenses),
  pantryStore: fake([snack]),
  groceryStore: fake([]),
}))
vi.mock('../hooks/useExpenses', () => ({
  useExpenseCategories: () => ({ categories: [{ id: 'g', name: 'Groceries', parent_id: null }] }),
  useCategoryExpenses: () => ({ expenses: [], loaded: true }),
  deleteExpenses: vi.fn(),
  setReceiptLineAmount: vi.fn(),
}))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), replacePhoto: vi.fn(), movePhoto: vi.fn(), deletePhoto: vi.fn() }) }))

const { PurchaseGroup } = await import('./expenses/ExpenseGroup')
const { ReceiptsView } = await import('./grocery/ReceiptsView')

afterEach(cleanup)

// The small grey line under each name, by line name.
const underReceipts = () => {
  render(<ReceiptsView />)
  return Object.fromEntries(lines.map((l) => [l.name, screen.getByText(l.name, { selector: 'span' }).querySelector('span.text-\\[10px\\]')?.textContent ?? null]))
}
const underMoney = () => {
  const byExpense = new Map(lines.map((l) => [l.expense_id, l]))
  const { container } = render(
    <PurchaseGroup
      group={{ date: '2026-11-08', items: expenses, total: 7.59 }}
      trip={trip}
      shop={null}
      mainOf={() => ({ id: 'g', name: 'Groceries' })}
      subName={() => null}
      styleFor={() => ({ hex: '#22C55E' })}
      lineOf={(e) => byExpense.get(e.id) ?? null}
      itemOf={(line) => (line.pantry_item_id === 'snack' ? snack : null)}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /Purchase/ }))
  return Object.fromEntries(lines.map((l) => [l.name, [...container.querySelectorAll('p')].find((p) => p.textContent === l.name).nextElementSibling.textContent]))
}

describe('Shop → Receipts: the quantity under every line (K107)', () => {
  it('"2 pcs", "1 pcs", "1 pack · 4 pcs"; nothing for an old line', () => {
    expect(underReceipts()).toEqual({ 'TEST Snack Box': '2 pcs', 'Corn Snack': '1 pcs', 'TEST Felix': '1 pack · 4 pcs', 'TEST Old line': null })
  })

  it('the same as Money\'s opened purchase row', () => {
    const receipts = underReceipts()
    cleanup()
    const money = underMoney()
    for (const line of lines.slice(0, 3)) expect(money[line.name]).toContain(receipts[line.name])
    expect(money['TEST Old line']).not.toMatch(/pcs|pack/)
  })
})
