// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Round 9H: "Put back on the way" on an arrived order (the MONEY Orders
// card), all the way through: the question, unarrive_order (exactly the
// stock that arrival added) and the first-time usual size undone only
// while the item still has what that arrival saved. The cards show the
// pack size: "1 box · 24 pcs".
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const asked = vi.hoisted(() => ({ titles: [] }))
vi.mock('../lib/feedback', async (original) => ({
  ...(await original()),
  confirmDialog: async ({ title }) => (asked.titles.push(title), true),
  showToast: () => {},
}))

const { OrderCard } = await import('./expenses/OrderCard')
const { OnTheWay } = await import('./grocery/OnTheWay')
const { askBackOnTheWay } = await import('../hooks/orderActions')

// A fake database for the item "Tuna" (stock in pcs) and its order: it
// applies the guarded update the app sends, so the test sees the item as
// the database would.
let db
let calls
function fakeDb(item) {
  db = { item: { ...item } }
  calls = []
  client.supabase = {
    from: (table) => {
      const call = { table, op: 'select', filters: [] }
      const q = {
        update: (patch) => ((call.op = 'update'), (call.patch = patch), q),
        select: () => q,
        eq: (col, val) => (call.filters.push([col, val]), q),
        is: (col, val) => (call.filters.push([col, val]), q),
        maybeSingle: () => q,
        order: () => q,
        range: () => q,
        gte: () => q,
        not: () => q,
        then: (resolve) => {
          calls.push(call)
          let data = []
          if (call.op === 'update' && table === 'pantry_items') {
            const matches = call.filters.every(([col, val]) => (col === 'id' ? val === db.item.id : (db.item[col] ?? null) === val))
            if (matches) Object.assign(db.item, call.patch)
            data = matches ? [db.item] : []
          } else if (call.op === 'update') data = [{ id: 'o1', ...call.patch }]
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return q
    },
    rpc: (name, args) => {
      calls.push({ op: 'rpc', name, args })
      db.item.current_stock -= 12
      return Promise.resolve({ data: { id: 'o1', status: 'on_the_way' }, error: null })
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
}

beforeEach(() => (asked.titles = []))
afterEach(cleanup)

const arrived = {
  id: 'o1',
  item_name: 'Tuna',
  status: 'arrived',
  arrived_date: '2026-10-28',
  order_date: '2026-10-20',
  price: 9,
  paid_by: 'shared',
  pantry_item_id: 'tuna',
  arrived_item_id: 'tuna',
  stock_added: 12,
  quantity: 1,
  unit: 'box',
  pack_size: 12,
  arrival_pack_before: { packaging_unit: null, quantity_per_pack: null, saved: { packaging_unit: 'box', quantity_per_pack: 12 } },
}
const card = (order, item) =>
  render(
    <OrderCard
      order={order}
      names={() => ({})}
      today="2026-10-28"
      open
      onToggle={() => {}}
      onBackOnTheWay={(o) => askBackOnTheWay(o, { unit: item.unit })}
      onEdit={() => {}}
      onDelete={() => {}}
      linkedItem={item}
    />
  )

describe('"Put back on the way" after an Arrived that saved the usual size the first time', () => {
  it('no usual size before, Arrived 1 box typed 12 (usual became box 12) → −12, usual empty again', async () => {
    const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs', current_stock: 17, packaging_unit: 'box', quantity_per_pack: 12 }
    fakeDb(tuna)
    card(arrived, tuna)
    expect(document.body.textContent).toContain('HOME: Tuna · 1 box · 12 pcs')
    fireEvent.click(screen.getByRole('button', { name: /Back on the way/ }))
    await waitFor(() => expect(calls.some((c) => c.table === 'orders' && c.patch?.arrival_pack_before === null)).toBe(true))
    expect(asked.titles).toEqual(['Put "Tuna" back on the way?'])
    expect(calls.find((c) => c.op === 'rpc')).toMatchObject({ name: 'unarrive_order' })
    expect(db.item).toMatchObject({ current_stock: 5, packaging_unit: null, quantity_per_pack: null })
  })

  it('the usual size changed to 15 in the HOME editor meanwhile → stock −12, the usual 15 stays', async () => {
    const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs', current_stock: 17, packaging_unit: 'box', quantity_per_pack: 15 }
    fakeDb(tuna)
    card(arrived, tuna)
    fireEvent.click(screen.getByRole('button', { name: /Back on the way/ }))
    await waitFor(() => expect(calls.some((c) => c.table === 'orders' && c.patch?.arrival_pack_before === null)).toBe(true))
    expect(db.item).toMatchObject({ current_stock: 5, packaging_unit: 'box', quantity_per_pack: 15 })
  })

  it('an arrival that saved nothing (usual box 48 kept): only the stock comes out', async () => {
    const cat = { id: 'tuna', name: 'Cat Wet Food', unit: 'pcs', current_stock: 17, packaging_unit: 'box', quantity_per_pack: 48 }
    fakeDb(cat)
    card({ ...arrived, item_name: 'Cat Wet Food', arrival_pack_before: null }, cat)
    fireEvent.click(screen.getByRole('button', { name: /Back on the way/ }))
    await waitFor(() => expect(calls.some((c) => c.op === 'rpc')).toBe(true))
    expect(calls.filter((c) => c.op === 'update')).toEqual([])
    expect(db.item).toMatchObject({ current_stock: 5, packaging_unit: 'box', quantity_per_pack: 48 })
  })
})

describe('the order cards show the pack size', () => {
  it('MONEY Orders card: "1 box · 24 pcs"; without a pack size as before', () => {
    const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs' }
    fakeDb(tuna)
    card({ ...arrived, status: 'on_the_way', pack_size: 24 }, tuna)
    expect(document.body.textContent).toContain('HOME: Tuna · 1 box · 24 pcs')
    cleanup()
    card({ ...arrived, status: 'on_the_way', pack_size: null, quantity: 2 }, tuna)
    expect(document.body.textContent).toContain('HOME: Tuna · 2 box')
    expect(document.body.textContent).not.toContain('each')
  })

  it('SHOP "On the way" card: "2 box · 24 pcs each · 48 pcs"', () => {
    const tuna = { id: 'tuna', name: 'Tuna', unit: 'pcs' }
    render(<OnTheWay entries={[{ entry: { id: 'g1', name: 'Tuna', category_id: 'canned' }, order: { ...arrived, status: 'on_the_way', quantity: 2, pack_size: 24 }, pantry: tuna }]} shopById={new Map()} today="2026-10-28" onArrived={() => {}} onCancel={() => {}} />)
    expect(document.body.textContent).toContain('2 box · 24 pcs each · 48 pcs')
  })
})
