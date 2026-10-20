import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { recordMoneyPurchase } = await import('./usePurchase')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')

afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

function fakeDb() {
  const calls = []
  const empty = () => {
    const q = { eq: () => q, in: () => q, select: () => q, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }
    return q
  }
  client.supabase = {
    from: () => ({ select: () => empty() }),
    rpc: (name, args) => {
      calls.push({ name, args })
      return Promise.resolve(name === 'confirm_shopping_trip' ? { data: { id: args.payload.id, total: 33.4 }, error: null } : { data: 3, error: null })
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return calls
}

describe('saving a MONEY purchase', () => {
  it('sends the whole purchase once, says "Purchase saved · 3 items · €33.40", and Undo reopens it', async () => {
    const calls = fakeDb()
    const payload = { id: 'p1', source: 'money', items: [{}, {}, {}] }
    const { error } = await recordMoneyPurchase({ payload })
    expect(error).toBeNull()
    expect(calls).toEqual([{ name: 'confirm_shopping_trip', args: { payload } }])
    const toast = getToasts().at(-1)
    expect(toast).toMatchObject({ message: 'Purchase saved · 3 items · €33.40', action: { label: 'Undo' } })
    await runToastAction(toast.id)
    expect(calls.at(-1)).toEqual({ name: 'reopen_shopping_trip', args: { trip_id: 'p1' } })
    expect(getToasts().some((t) => t.message === 'Purchase undone — its expenses are deleted and HOME stock is back as before.')).toBe(true)
  })
})
