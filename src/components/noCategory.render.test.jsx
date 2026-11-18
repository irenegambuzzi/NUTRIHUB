// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useCategorySuggestions', () => ({ useCategorySuggestions: () => ({ suggestions: () => [], remember: vi.fn() }) }))
vi.mock('../hooks/useInventoryCategories', () => ({ useInventoryCategories: () => ({ parents: [], subsByParent: new Map() }) }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const { GroceryItemTile } = await import('./grocery/GroceryItemTile')
const { ItemTile } = await import('./inventory/ItemTile')
const { NoCategoryLabel } = await import('./ui/NoCategoryLabel')
const { NO_CATEGORY, RESTOCK_LABELS, SMALL_LABEL } = await import('../lib/inventoryStyles')
const { PAID_BY_OPTIONS } = await import('../data/constants')
const { payerTotals } = await import('../lib/payers')

afterEach(cleanup)

const entry = (extra) => ({ id: 'g1', name: 'Kefir', quantity: 1, unit: 'pcs', price: 0, payer: 'shared', in_cart: false, category_id: null, ...extra })
const tile = (item, props = {}) => render(<GroceryItemTile item={item} reason="new" categoryName={(id) => `cat ${id}`} onToggle={vi.fn()} onDelete={vi.fn()} onUpdatePricing={vi.fn()} onUpdatePayer={vi.fn()} {...props} />)

describe('the grey "No category" label', () => {
  it('has the same size as "New Item", in grey', () => {
    render(<NoCategoryLabel />)
    const label = screen.getByText('No category')
    for (const cls of SMALL_LABEL.split(' ')) expect(label.className).toContain(cls)
    expect(label.className).toContain('zinc')
    expect(RESTOCK_LABELS.new.className).not.toContain('zinc')
    expect(NO_CATEGORY.label).toBe('No category')
  })

  it('shows on a SHOP entry saved without a category, not on one with a category', () => {
    tile(entry())
    expect(screen.getByText('No category')).toBeTruthy()
    cleanup()
    tile(entry({ category_id: 'dairy' }))
    expect(screen.queryByText('No category')).toBeNull()
  })

  it('on a SHOP entry it can be tapped to choose a category', () => {
    tile(entry(), { onUpdateCategory: vi.fn() })
    expect(screen.getByRole('button', { name: 'Choose a category for Kefir' })).toBeTruthy()
  })

  it('shows on a HOME item without a category', () => {
    const item = { id: 'p1', name: 'Kefir', unit: 'pcs', current_stock: 1, min_stock: 1, category_id: null }
    render(<ItemTile item={item} onAdjust={vi.fn()} onDiscard={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSendToGrocery={vi.fn()} />)
    expect(screen.getByText('No category')).toBeTruthy()
    cleanup()
    render(<ItemTile item={{ ...item, category_id: 'dairy' }} onAdjust={vi.fn()} onDiscard={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSendToGrocery={vi.fn()} />)
    expect(screen.queryByText('No category')).toBeNull()
  })
})

// Plan 9P K225: a SHOP card's payer.
describe('a SHOP card\'s "Paid by" pills', () => {
  const lit = () => [...screen.getByRole('group', { name: 'Paid by' }).querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)
  it('the three accounts only; "shared" or empty = not chosen yet (nothing lit, title "Paid by: not chosen yet"); Joint lit with "Paid by Joint"', () => {
    for (const payer of ['shared', '', null]) {
      tile(entry({ payer }))
      expect([...screen.getByRole('group', { name: 'Paid by' }).querySelectorAll('button')].map((b) => b.textContent)).toEqual(PAID_BY_OPTIONS.filter((o) => o.kind !== 'split').map((o) => o.label))
      expect(lit()).toEqual([])
      expect(screen.getByRole('group', { name: 'Paid by' }).parentElement.getAttribute('title')).toBe('Paid by: not chosen yet')
      cleanup()
    }
    tile(entry({ payer: 'joint' }))
    expect(lit()).toEqual(['Joint'])
    expect(screen.getByRole('group', { name: 'Paid by' }).parentElement.getAttribute('title')).toBe('Paid by Joint')
  })
})

describe('the SHOP budget card\'s bottom line (K225)', () => {
  it('each account, then "No payer yet" only when above €0.00', () => {
    const items = [
      { payer: 'joint', cost: 2.5 },
      { payer: 'shared', cost: 1.2 },
      { payer: '', cost: 0.3 },
      { payer: PAID_BY_OPTIONS[0].value, cost: 4 },
    ]
    expect(payerTotals(items, (i) => i.cost).map((p) => [p.label, Math.round(p.total * 100) / 100])).toEqual([
      [PAID_BY_OPTIONS[0].label, 4],
      [PAID_BY_OPTIONS[1].label, 0],
      ['Joint', 2.5],
      ['No payer yet', 1.5],
    ])
    expect(payerTotals(items.filter((i) => i.payer === 'joint'), (i) => i.cost).map((p) => p.label)).not.toContain('No payer yet')
  })
})
