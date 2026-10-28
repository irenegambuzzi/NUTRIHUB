// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Round 9H: the history of a purchase bought in packages — the opened
// purchase row in MONEY and Receipts say "1 box · 30 pcs" or "2 box · 30
// pcs each · 60 pcs", worked out from what really went into HOME. Old
// lines without enough to say it show as before.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const cat = { id: 'cat', name: 'Cat Wet Food', unit: 'pcs', packaging_unit: 'box', quantity_per_pack: 48 }
const lines = [
  { id: 'l1', trip_id: 't1', position: 1, name: 'Cat Wet Food', quantity: 2, unit: 'box', stock_added: 60, pantry_item_id: 'cat', expense_id: 'e1', line_total: 20 },
  { id: 'l2', trip_id: 't1', position: 2, name: 'Cat Wet Food', quantity: 1, unit: 'box', stock_added: 30, pantry_item_id: 'cat', expense_id: 'e2', line_total: 10 },
  { id: 'l3', trip_id: 't1', position: 3, name: 'Old line', quantity: null, unit: null, stock_added: 30, pantry_item_id: 'cat', expense_id: 'e3', line_total: 5 },
]
const expenses = [
  { id: 'e1', trip_id: 't1', category_id: 'g', amount: 20, paid_by: 'irene', expense_date: '2026-10-28', description: 'Cat Wet Food' },
  { id: 'e2', trip_id: 't1', category_id: 'g', amount: 10, paid_by: 'irene', expense_date: '2026-10-28', description: 'Cat Wet Food 1' },
  { id: 'e3', trip_id: 't1', category_id: 'g', amount: 5, paid_by: 'irene', expense_date: '2026-10-28', description: 'Old line' },
]
const trip = { id: 't1', trip_date: '2026-10-28', source: 'shop', total: 35 }

const fake = (rows) => ({ useRows: () => ({ rows, loaded: true }), getSnapshot: () => ({ rows, loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  tripStore: fake([trip]),
  tripItemStore: fake(lines),
  tripExpenseStore: fake(expenses),
  pantryStore: fake([cat]),
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

describe('a purchase bought in packages, in the history', () => {
  it('MONEY, the opened purchase row: "2 box · 30 pcs each · 60 pcs", "1 box · 30 pcs", an old line as before', () => {
    const byExpense = new Map(lines.map((l) => [l.expense_id, l]))
    const { container } = render(
      <PurchaseGroup
        group={{ date: '2026-10-28', items: expenses, total: 35 }}
        trip={trip}
        shop={null}
        mainOf={() => ({ id: 'g', name: 'Groceries' })}
        subName={() => null}
        styleFor={() => ({ hex: '#22C55E' })}
        lineOf={(e) => byExpense.get(e.id) ?? null}
        itemOf={(line) => (line.pantry_item_id === 'cat' ? cat : null)}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Purchase/ }))
    const text = container.textContent
    expect(text).toContain('2 box · 30 pcs each · 60 pcs')
    expect(text).toContain('1 box · 30 pcs')
    expect(text).not.toContain('1 box · 30 pcs each')
  })

  it('MONEY: without the HOME item (deleted) the line shows as before', () => {
    const { container } = render(
      <PurchaseGroup
        group={{ date: '2026-10-28', items: [expenses[0]], total: 20 }}
        trip={trip}
        shop={null}
        mainOf={() => ({ id: 'g', name: 'Groceries' })}
        subName={() => null}
        styleFor={() => ({ hex: '#22C55E' })}
        lineOf={() => lines[0]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Purchase/ }))
    expect(container.textContent).toContain('2 box·')
    expect(container.textContent).not.toContain('30 pcs')
  })

  it('Receipts: the same words under each line bought in packages', () => {
    const html = renderToStaticMarkup(<ReceiptsView />)
    expect(html).toContain('2 box · 30 pcs each · 60 pcs')
    expect(html).toContain('1 box · 30 pcs')
    expect(html.match(/30 pcs/g)).toHaveLength(2)
  })
})
