import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { ShoppingMode } = await import('./ShoppingMode')
const { QuickAdd } = await import('./QuickAdd')
const { AddItemForm } = await import('./AddItemForm')
const { ReceiptsView } = await import('./ReceiptsView')
const { PriceCheck } = await import('./PriceCheck')

const parents = [
  { id: 'beverages', name: 'Beverages' },
  { id: 'snacks', name: 'Snacks' },
]
const categoryName = (id) => parents.find((p) => p.id === id)?.name ?? 'Uncategorized'
const items = [
  { id: 'g1', name: 'Milk', category_id: 'beverages', quantity: 2, unit: 'btl', price: 1.2, completed: false, created_at: '1' },
  { id: 'g2', name: 'Chips', category_id: 'snacks', quantity: 1, unit: 'pack', price: 0, completed: true, created_at: '2' },
]
const totalOf = (i) => (i.price ? i.price * i.quantity : 0)

describe('grocery components render', () => {
  it('shopping mode: open items by category, the cart, and the running total', () => {
    const html = renderToStaticMarkup(
      <ShoppingMode items={items} parents={parents} categoryName={categoryName} totalOf={totalOf} costOf={totalOf} budget={10} onCheck={() => {}} />
    )
    expect(html).toContain('1 to get')
    expect(html).toContain('Beverages')
    expect(html).toContain('In the cart (1)')
    expect(html).toContain('€2.40')
    expect(html).toContain('€10.00 left in budget')
    expect(html).toContain('By category')
    expect(html).toContain('My route')
  })

  it('quick add', () => {
    const html = renderToStaticMarkup(
      <QuickAdd
        items={items}
        pantryItems={[]}
        parents={parents}
        subsByParent={new Map()}
        categoryName={categoryName}
        addItem={async () => ({})}
        updatePricing={async () => ({})}
        totalFor={totalOf}
        onMoreOptions={() => {}}
      />
    )
    expect(html).toContain('Add an item')
    expect(html).toContain('More options')
  })

  it('the full form starts from a typed name, with the guessed category', () => {
    const html = renderToStaticMarkup(
      <AddItemForm initialName="Green tea" parents={parents} subsByParent={new Map()} categoryName={categoryName} pantryByName={new Map()} onAdd={async () => ({})} />
    )
    expect(html).toContain('value="Green tea"')
    expect(html).toMatch(/<option value="beverages" selected=""/)
  })

  it("leaves the category empty when the name isn't known, and offers to add one", () => {
    const html = renderToStaticMarkup(
      <AddItemForm
        initialName="Stuff for Marco"
        parents={parents}
        subsByParent={new Map()}
        categoryName={categoryName}
        pantryByName={new Map()}
        onAdd={async () => ({})}
        onAddCategory={async () => ({})}
      />
    )
    expect(html).toMatch(/<option value="" disabled="" selected="">Choose a category…/)
    expect(html).toContain('+ New category…')
  })

  it('receipts: add a photo with the camera or a file', () => {
    const html = renderToStaticMarkup(<ReceiptsView />)
    expect(html).toContain('Add a receipt photo')
    expect(html).toContain('Take photo')
    expect(html).toContain('capture="environment"')
    expect(html).toContain('accept="image/*,application/pdf"')
  })

  it('check prices: each line with an editable price and the total', () => {
    const lines = [
      { id: 'e1', description: 'Milk', amount: 1.2 },
      { id: 'e2', description: 'Bread', amount: 2 },
    ]
    const html = renderToStaticMarkup(
      <PriceCheck date="2026-10-03" photos={[]} lines={lines} linkFor={(e) => (e.id === 'e1' ? {} : null)} onSave={async () => ({})} onClose={() => {}} />
    )
    expect(html).toContain('Check prices')
    expect(html).toContain('value="1.20"')
    expect(html).toContain('Only the expense changes')
    expect(html).toContain('€3.20')
  })
})
