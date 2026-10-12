import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Rendering only: no effects run, so nothing is loaded from Supabase.
vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { StoreTotals } = await import('./StoreTotals')
const { OrderCard } = await import('./OrderCard')
const { OrdersSection } = await import('./OrdersSection')
const { ExpenseRow } = await import('./EntryRows')
const { onlineSplit, shopTotals } = await import('../../lib/shops')

const shops = [
  { id: 'zal', name: 'Zalando', is_online: true },
  { id: 'lid', name: 'Lidl', is_online: false },
]
const byId = new Map(shops.map((s) => [s.id, s]))
const expenses = [
  { id: 1, amount: 40, shop_id: 'lid' },
  { id: 2, amount: 25.5, shop_id: 'zal' },
  { id: 3, amount: 9.5, shop_id: null },
]

describe('By store', () => {
  const html = renderToStaticMarkup(<StoreTotals totals={shopTotals(expenses, byId)} split={onlineSplit(expenses, byId)} selected={null} onSelect={() => {}} emptyText="No expenses" />)

  it('lists the stores biggest first, with No store, and the Online / In store line', () => {
    expect(html.indexOf('Lidl')).toBeLessThan(html.indexOf('Zalando'))
    expect(html).toContain('No store')
    expect(html).toContain('Online <b class="font-mono text-[var(--color-text)]">€25.50</b>')
    expect(html).toContain('In store <b class="font-mono text-[var(--color-text)]">€40.00</b>')
  })

  it('says so before the database update, instead of failing', () => {
    expect(renderToStaticMarkup(<StoreTotals missing totals={[]} split={null} onSelect={() => {}} />)).toContain('supabase/019_stores_and_orders.sql')
  })
})

describe('an order', () => {
  const order = { id: 'o1', item_name: 'Winter jacket', shop_id: 'zal', order_date: '2026-09-21', price: 55, paid_by: 'irene', category_id: null, expected_date: '2026-10-09', expected_until: null, status: 'on_the_way', expense_id: 'e1' }
  const card = (extra = {}, state = {}) =>
    renderToStaticMarkup(<OrderCard order={{ ...order, ...extra }} shop={shops[0]} names={() => ({ main: null, sub: null })} today="2026-10-12" open={false} onToggle={() => {}} {...state} />)

  it('shows how long ago it was ordered and highlights an overdue one', () => {
    const html = card()
    expect(html).toContain('ordered 3 weeks ago')
    expect(html).toContain('overdue by 3 days')
    expect(html).toContain('border-red-400/60')
    expect(html).toContain('</svg> Arrived</button>')
  })

  it('has no Arrived button once it arrived, and offers to put it back on the way', () => {
    const html = card({ status: 'arrived', arrived_date: '2026-10-11' })
    expect(html).not.toContain('</svg> Arrived</button>')
    expect(html).toContain('Back on the way')
    expect(html).not.toContain('border-red-400/60')
  })
})

describe('the Orders section before the database update', () => {
  it('shows a notice and no way to add an order', () => {
    // Nothing is loaded when only rendering, so the section is in its "not ready" state.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <OrdersSection person="all" onPerson={() => {}} shopById={new Map()} categories={[]} mainCategories={[]} subsOf={() => []} namesOf={() => ({})} styleFor={() => ({})} />
      </MemoryRouter>
    )
    expect(html).toContain('>Orders</h2>')
    expect(html).not.toContain('Add order')
  })
})

describe('an expense row', () => {
  const names = () => ({ main: 'Clothing', sub: null })
  const row = (expense, shopOf) => renderToStaticMarkup(<ExpenseRow expense={{ id: 1, amount: 10, expense_date: '2026-10-05', paid_by: 'irene', category_id: 'c', ...expense }} names={names} shopOf={shopOf} onEdit={() => {}} onDelete={() => {}} />)

  it('shows the store next to the category, with its icon', () => {
    const html = row({ shop_id: 'zal' }, (id) => byId.get(id))
    expect(html).toContain('Clothing')
    expect(html).toContain('Zalando')
    expect(html).toContain('Online store')
    expect(row({ shop_id: 'lid' }, (id) => byId.get(id))).toContain('Physical store')
  })

  it('shows nothing extra without a store — as before', () => {
    const html = row({ shop_id: null }, () => undefined)
    expect(html).not.toContain('data-shop')
    expect(html).toContain('05/10/2026')
    expect(html).toContain('Clothing')
  })
})
