import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in Supabase client that records updates.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { setReceiptLineAmount } = await import('./useExpenses')
const { dismissToast, getToasts } = await import('../lib/feedback')

function fakeDb() {
  const updates = []
  client.supabase = {
    from: (table) => ({
      update: (patch) => {
        updates.push({ table, patch })
        const q = { eq: () => q, in: () => q, select: () => q, then: (r) => Promise.resolve({ data: [{ id: 'g1', ...patch }], error: null }).then(r) }
        return q
      },
    }),
  }
  return updates
}

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

describe('editing a price from a receipt', () => {
  it('changes the expense and the unit price of the grocery entry it came from', async () => {
    const updates = fakeDb()
    const expense = { id: 'e1', amount: 6 }
    // 3 cans at €2 each; the receipt says €4.50 in total.
    const item = { id: 'g1', quantity: 3, unit: 'can', price: 2, price_qty: 1, price_unit: 'can' }
    const { error } = await setReceiptLineAmount(expense, 4.5, item, null)
    expect(error).toBeNull()
    expect(updates).toEqual([
      { table: 'expenses', patch: { amount: 4.5 } },
      { table: 'grocery_items', patch: { price: 1.5 } },
    ])
  })

  it('changes only the expense when the entry is no longer on the list', async () => {
    const updates = fakeDb()
    await setReceiptLineAmount({ id: 'e1', amount: 6 }, 5, null)
    expect(updates).toEqual([{ table: 'expenses', patch: { amount: 5 } }])
  })
})
