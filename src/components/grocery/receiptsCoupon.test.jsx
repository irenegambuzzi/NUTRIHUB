// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
// What the Receipts screen reads: one purchase with a coupon of −€50 on
// €200, its three lines (as confirm_shopping_trip saves them) and expenses.
const data = vi.hoisted(() => ({
  trips: [],
  items: [],
  expenses: [],
}))
vi.mock('../../lib/stores', async (original) => {
  const stores = await original()
  const rows = (key) => ({ useRows: () => ({ rows: data[key], loaded: true }) })
  return { ...stores, tripStore: rows('trips'), tripItemStore: rows('items'), tripExpenseStore: rows('expenses'), groceryStore: { useRows: () => ({ rows: [], loaded: true }) }, pantryStore: { useRows: () => ({ rows: [], loaded: true }) } }
})
vi.mock('../../hooks/useExpenses', () => ({
  useExpenseCategories: () => ({ categories: [] }),
  useCategoryExpenses: () => ({ expenses: [], loaded: true }),
  deleteExpenses: vi.fn(),
  setReceiptLineAmount: vi.fn(),
}))
vi.mock('../../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), replacePhoto: vi.fn(), movePhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../../hooks/usePurchase', () => ({ askUndoPurchase: vi.fn(), deleteTripRecord: vi.fn() }))
const { ReceiptsView } = await import('./ReceiptsView')

afterEach(cleanup)

const line = (id, name, list, paid, share, extra = {}) => ({
  id: `i-${id}`, trip_id: 't1', name, position: id, expense_id: `e-${id}`, pantry_item_id: `p-${id}`, line_total: paid, list_total: list, coupon_share: share, ...extra,
})

describe('Receipts show the discounts of a purchase like MONEY does', () => {
  it('the coupon under the total and each line\'s "€120.00 → €90.00 (coupon −€30.00)"', () => {
    data.trips = [{ id: 't1', trip_date: '2026-10-21', source: 'shop', coupon_kind: 'amount', coupon_value: 50, coupon_total: 50 }]
    data.items = [line(1, 'Test one', 120, 90, 30), line(2, 'Test two', 60, 45, 15), line(3, 'Test three', 20, 15, 5, { item_discount_kind: null })]
    data.expenses = [90, 45, 15].map((amount, i) => ({ id: `e-${i + 1}`, trip_id: 't1', amount }))
    render(<ReceiptsView />)
    expect(screen.getByText('€150.00')).toBeTruthy()
    const note = screen.getByText('(coupon −€50)')
    expect(note.className).toContain('text-emerald-300')
    expect(screen.getByText('€120.00 → €90.00 (coupon −€30.00)').className).toContain('break-words')
    expect(screen.getByText('€60.00 → €45.00 (coupon −€15.00)')).toBeTruthy()
    expect(screen.getByText('€20.00 → €15.00 (coupon −€5.00)')).toBeTruthy()
  })

  it('a per-item discount: "€80.00 → €56.00 (−30%)"; a purchase without any discount shows nothing extra', () => {
    data.trips = [{ id: 't1', trip_date: '2026-10-21', source: 'money', coupon_kind: null, coupon_total: 0 }]
    data.items = [line(1, 'Test sneakers', 80, 56, 0, { item_discount_kind: 'percent', item_discount_value: 30 }), line(2, 'Test plain', 5, 5, 0, { list_total: null })]
    data.expenses = [56, 5].map((amount, i) => ({ id: `e-${i + 1}`, trip_id: 't1', amount }))
    render(<ReceiptsView />)
    expect(screen.getByText('€80.00 → €56.00 (−30%)')).toBeTruthy()
    expect(screen.queryByText(/coupon/)).toBeNull()
    expect(screen.getByText('€61.00')).toBeTruthy()
  })
})
