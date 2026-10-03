import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in Supabase client that records the order of what is sent.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { confirmCart } = await import('./usePurchase')
const { editPatch, editedItem, purchaseLine } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')
const { dismissToast, getToasts } = await import('../lib/feedback')

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

function fakeDb() {
  const sent = []
  const answer = (data) => {
    const q = { eq: () => q, in: () => q, select: () => q, maybeSingle: () => q, single: () => q, order: () => q, limit: () => q, then: (r) => Promise.resolve({ data, error: null }).then(r) }
    return q
  }
  client.supabase = {
    from: (table) => ({
      update: (patch) => (sent.push({ op: 'update', table, patch }), answer([{ id: 'g1', ...patch }])),
      select: () => answer(table === 'expense_categories' ? { id: 'cat-groceries' } : []),
    }),
    rpc: (name, args) => (sent.push({ op: 'rpc', name, args }), answer({ id: 'trip', total: args.payload?.items?.[0]?.line_total ?? 0 })),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return sent
}

describe('confirming with a price changed on the confirm screen (€1 → €2)', () => {
  it('saves the edit to the grocery entry first, then confirms with the same €2', async () => {
    const sent = fakeDb()
    const milk = { id: 'g1', name: 'Milk', quantity: 1, unit: 'btl', price: 1, price_qty: 1, price_unit: 'btl', payer: 'shared', category_id: 'dairy' }
    const edit = { total: 2, payer: 'akbar' }
    const edited = editedItem(milk, edit)
    const { error } = await confirmCart({
      id: 'trip',
      date: '2026-10-05',
      lines: [purchaseLine(edited, [])],
      answers: {},
      totalOf: (i) => lineTotal(i),
      photoIds: [],
      patches: [{ id: 'g1', patch: editPatch(milk, edit) }],
    })
    expect(error).toBeNull()
    const update = sent.findIndex((s) => s.op === 'update' && s.table === 'grocery_items')
    const rpc = sent.findIndex((s) => s.op === 'rpc' && s.name === 'confirm_shopping_trip')
    expect(update).toBeGreaterThanOrEqual(0)
    expect(update).toBeLessThan(rpc)
    expect(sent[update].patch).toEqual({ price: 2, payer: 'akbar' })
    expect(sent[rpc].args.payload).toMatchObject({ trip_date: '2026-10-05', items: [{ grocery_item_id: 'g1', line_total: 2, payer: 'akbar', add: 1 }] })
  })
})
