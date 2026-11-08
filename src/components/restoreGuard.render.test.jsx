// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// K117 + K118 (plan 9N): Home → Import / Export → "Restore backup" with a
// backup made before a merge. The items of now are read first; merged-away
// items are skipped and their history goes to the item holding their name;
// that item keeps its stock and names and is no group. Test 12 of stage 4,
// against arrivalDb.fixture.js.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('../hooks/arrivalDb.fixture')
const { DataView } = await import('./inventory/DataView')
const { Feedback } = await import('./ui/Feedback')
const { usePantryItems } = await import('../hooks/usePantryItems')
const { closeDialog, dismissToast, getToasts } = await import('../lib/feedback')

let db
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
})

function Restore() {
  const { importItems } = usePantryItems()
  return (
    <>
      <DataView items={[]} categories={[]} categoryName={() => ''} importItems={importItems} />
      <Feedback />
    </>
  )
}

const item = (id, name, extra = {}) => ({ id, name, unit: 'pcs', category_id: 'snacks', current_stock: 0, min_stock: 0, is_group: false, group_id: null, ...extra })
const backup = {
  app: 'nutrihub-inventory',
  version: 1,
  exported_at: '2026-11-01T10:00:00Z',
  categories: [],
  items: [item('t', 'TEST T', { current_stock: 1, price: 1, price_qty: 1, price_unit: 'pcs' }), item('a', 'TEST A', { current_stock: 2 }), item('b', 'TEST B', { current_stock: 3 })],
  stock_logs: [
    { id: 'la', item_id: 'a', item_name: 'TEST A', change: 2, new_stock: 2, unit: 'pcs', reason: 'added' },
    { id: 'lb', item_id: 'b', item_name: 'TEST B', change: 3, new_stock: 3, unit: 'pcs', reason: 'added' },
  ],
}
const choose = (json) => {
  const input = document.querySelector('input[accept=".json,application/json"]')
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(json)], 'backup.json', { type: 'application/json' })] } })
}

describe('Restore backup after a merge (K117, K118)', () => {
  it('test 12: A and B skipped, their history on T; T keeps 6 pcs, its names, no group; its price back to €1.00; the texts', async () => {
    const names = [{ name: 'TEST A', origin: { id: 'a' }, from_item_id: 'a' }, { name: 'TEST B', origin: { id: 'b' }, from_item_id: 'b' }]
    db.add('pantry_items', { ...item('t', 'TEST T', { current_stock: 6, price: 1.2, price_qty: 1, price_unit: 'pcs' }), names })
    db.add('stock_logs', { id: 'la', item_id: 't', item_name: 'TEST A', change: 2, new_stock: 2, unit: 'pcs', reason: 'added' })
    render(<Restore />)
    choose(backup)
    await waitFor(() => expect(screen.getByText('Restore 3 items?')).toBeTruthy())
    expect(screen.getByText('2 of these items were merged into another item since this backup — they are skipped, and their history goes to that item.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restore' })))
    await waitFor(() => expect(screen.getByText('Restored 1 items. 2 skipped: merged into another item. 1 item kept its merged names and stock: TEST T.')).toBeTruthy())
    expect(db.tables.pantry_items.map((r) => r.id)).toEqual(['t'])
    expect(db.row('pantry_items', 't')).toMatchObject({ current_stock: 6, price: 1, is_group: false, group_id: null, names })
    expect(db.tables.stock_logs.map((l) => [l.id, l.item_id])).toEqual([['la', 't'], ['lb', 't']])
  })

  it('a backup with nothing merged since: the question and the result as before', async () => {
    render(<Restore />)
    choose({ ...backup, items: [backup.items[0]], stock_logs: [] })
    await waitFor(() => expect(screen.getByText('Restore 1 items?')).toBeTruthy())
    expect(screen.queryByText(/merged into another item/)).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restore' })))
    await waitFor(() => expect(screen.getByText('Restored 1 items.')).toBeTruthy())
    expect(db.row('pantry_items', 't')).toMatchObject({ current_stock: 1, price: 1 })
  })
})
