import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { ItemTile } = await import('./ItemTile')
const { ItemEditor } = await import('./ItemEditor')

const base = { id: 'p1', name: 'Rice', category_id: 'pantry-staples', unit: 'gr', current_stock: 500, min_stock: 100, created_at: '2026-10-13T08:00:00Z' }
const tile = (item, isNew) =>
  renderToStaticMarkup(<ItemTile item={item} isNew={isNew} onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} />)
const tileClass = (html) => html.match(/^<div class="([^"]*)"/)[1]

describe('HOME item tile: New Item label', () => {
  it('shows the same blue label as SHOP, without changing the stock colours', () => {
    expect(tile(base, true)).toContain('New Item')
    expect(tile(base, true)).toContain('bg-blue-500/20 text-blue-300')
    expect(tile(base, false)).not.toContain('New Item')
    for (const stock of [500, 50, 0]) {
      const item = { ...base, current_stock: stock }
      expect(tileClass(tile(item, true))).toBe(tileClass(tile(item, false)))
    }
    expect(tileClass(tile(base, true))).toContain('34,197,94')
    expect(tileClass(tile({ ...base, current_stock: 50 }, true))).toContain('234,179,8')
    expect(tileClass(tile({ ...base, current_stock: 0 }, true))).toContain('239,68,68')
  })
})

describe('item editor: expiry date and batch / lot', () => {
  const editor = (item) => renderToStaticMarkup(<ItemEditor item={item} parents={[]} subsByParent={new Map()} onSave={() => {}} onClose={() => {}} />)
  it('shows a stored expiry as DD/MM/YYYY with a remove button and a calendar', () => {
    const html = editor({ ...base, expiry_date: '2026-12-31', batch_lot: 'L42' })
    expect(html).toContain('value="31/12/2026"')
    expect(html).toContain('placeholder="DD/MM/YYYY"')
    expect(html).toContain('aria-label="Remove expiry date"')
    expect(html).toContain('aria-label="Remove batch / lot"')
    expect(html).toContain('type="date"')
  })
  it('has no remove buttons while the fields are empty', () => {
    const html = editor(base)
    expect(html).not.toContain('Remove expiry date')
    expect(html).not.toContain('Remove batch')
  })
})
