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
