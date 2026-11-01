// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Plan 9M, K29: Home → History marks every row whose HOME item no longer
// exists (item_id empty) with a small grey "deleted item". Nothing else of
// the row changes, and nothing is deleted.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
const data = vi.hoisted(() => ({ logs: [] }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({ ...(await original()), stockLogStore: fake(() => data.logs) }))
const { HistoryView } = await import('./inventory/HistoryView')

afterEach(() => {
  cleanup()
  data.logs = []
})

const rowOf = (name) => screen.getByText(name, { selector: 'p' }).closest('div.flex')

describe('Home → History: rows of a deleted item (K29)', () => {
  it('"deleted item" on the rows without an item, never on the others; the rest of the row as before', () => {
    data.logs = [
      { id: 'l1', item_id: null, item_name: 'TEST Plonk', change: 3, new_stock: 4, unit: 'pcs', reason: 'converted', created_at: '2026-11-01T10:00:00Z' },
      { id: 'l2', item_id: 'p2', item_name: 'Cola', change: 1, new_stock: 2, unit: 'pack', reason: 'purchased', created_at: '2026-10-31T10:00:00Z' },
      { id: 'l3', item_id: null, item_name: 'Old Tea', change: -1, new_stock: 0, unit: 'pcs', reason: 'used', created_at: '2026-10-30T10:00:00Z' },
    ]
    render(<HistoryView />)
    const plonk = rowOf('TEST Plonk')
    expect(plonk.textContent).toContain('Unit changed')
    expect(plonk.textContent).toContain('· deleted item')
    expect(plonk.textContent).toContain('→ 4 pcs')
    expect(rowOf('Old Tea').textContent).toContain('Used')
    expect(rowOf('Old Tea').textContent).toContain('deleted item')
    expect(rowOf('Old Tea').textContent).toContain('-1 pcs')
    expect(rowOf('Cola').textContent).not.toContain('deleted item')
    expect(screen.getAllByText('deleted item')).toHaveLength(2)
    expect(screen.getByLabelText('Delete this entry for TEST Plonk')).toBeTruthy()
  })
})
