import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { ItemTile } = await import('./ItemTile')
const { ItemEditor } = await import('./ItemEditor')

const base = { id: 'p1', name: 'Rice', category_id: 'pantry-staples', unit: 'gr', current_stock: 500, min_stock: 100, created_at: '2026-10-15T08:00:00Z' }
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

describe('a group row from an older app version (round 6D stage 5, K138)', () => {
  const chips = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'snacks', created_at: '2026-01-01T00:00:00Z' }
  it('is a plain item tile with its own stored stock and the grey note, never red or yellow', () => {
    for (const stock of [0, 2, 9]) {
      const html = tile({ ...chips, current_stock: stock })
      expect(html).toContain(`${stock} pcs`)
      expect(html).toContain('Item group from an older app version — merge its variants into it: Edit item → Merge other items into this one…')
      expect(html).not.toContain('variants</')
      expect(html).not.toContain('Total:')
      expect(tileClass(html)).toContain('34,197,94')
    }
  })
  it('a normal item has no such note', () => {
    expect(tile(base)).not.toContain('older app version')
  })
})

describe('item editor: no groups any more', () => {
  const render = (props) => renderToStaticMarkup(<ItemEditor parents={[]} subsByParent={new Map()} onSave={() => {}} onClose={() => {}} {...props} />)
  it('never offers a group to move an item into', () => {
    expect(render({ item: base, groups: [{ id: 'g', name: 'Chips & Snacks', unit: 'pcs' }] })).not.toContain('Group (optional)')
    expect(render({ item: { ...base, group_id: 'g' } })).not.toContain('Group (optional)')
  })
  it('"Add an item" is the only new form: no "Add a group", "Create group" or "Add a variant to …"', () => {
    const html = render({ asGroup: true, group: { id: 'g', name: 'Chips & Snacks', unit: 'pcs' } })
    expect(html).toContain('Add an item')
    expect(html).toContain('Add to inventory')
    expect(html).not.toMatch(/Add a group|Create group|Add a variant/)
    expect(html).toContain('Current stock')
  })
  it('says how to set up a purchase unit', () => {
    expect(render({ item: base })).toContain('1 pack = 12 pcs, 1 bottle = 1.5 L')
  })
})
