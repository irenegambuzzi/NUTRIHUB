import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { ItemTile } = await import('./ItemTile')
const { ItemEditor } = await import('./ItemEditor')
const { GroupTile } = await import('./GroupTile')
const { withGroupTotals } = await import('../../lib/groups')

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

describe('group card', () => {
  const chips = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'snacks', created_at: '2026-01-01T00:00:00Z' }
  const variant = (id, name, stock) => ({ id, name, unit: 'pcs', current_stock: stock, min_stock: 99, group_id: 'g', category_id: 'snacks', created_at: '2026-01-01T00:00:00Z' })
  const card = (stock, isNew = false) => {
    const group = withGroupTotals([chips, variant('a', 'Lays', stock), variant('b', 'Pringles', 1)])[0]
    return renderToStaticMarkup(<GroupTile group={group} variants={group.variants} newIds={new Set()} isNew={isNew} onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} onAddVariant={() => {}} onTakeOut={() => {}} onRestock={() => {}} />)
  }
  it('shows the total of its variants and colours it by the total and the group minimum', () => {
    expect(card(9)).toContain('Total: 10 pcs')
    expect(card(9)).toContain('2 variants')
    expect(card(9)).toContain('34,197,94') // green
    expect(card(3)).toContain('234,179,8') // 4 <= 4: low, though Lays alone is above 0
    expect(card(-1)).toContain('239,68,68') // 0: out
    expect(card(9, true)).toContain('New Item')
  })
  it('keeps the variants folded away until opened', () => {
    expect(card(9)).not.toContain('Lays')
  })
})

describe('item editor: groups', () => {
  const render = (props) => renderToStaticMarkup(<ItemEditor parents={[]} subsByParent={new Map()} onSave={() => {}} onClose={() => {}} {...props} />)
  const group = { id: 'g', name: 'Chips & Snacks', unit: 'pcs' }
  it('offers the groups to move an item into, only when there are some', () => {
    expect(render({ item: base, groups: [group] })).toContain('Chips &amp; Snacks (pcs)')
    expect(render({ item: base })).not.toContain('Group (optional)')
  })
  it('a group form has no stock, expiry or batch', () => {
    const html = render({ asGroup: true })
    expect(html).toContain('Add a group')
    expect(html).not.toContain('Current stock')
    expect(html).not.toContain('Expiry date')
    expect(html).not.toContain('Batch')
  })
  it('says how to set up a purchase unit', () => {
    expect(render({ item: base })).toContain('1 pack = 12 pcs, 1 bottle = 1.5 L')
  })
})
