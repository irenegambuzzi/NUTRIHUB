import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'

// Plan 9N, K96: a sentence about items bought or expenses counts LINES, a
// sentence about cards in the cart counts CARDS. One card bought under
// three names (€1.39 + €0.99 + €1.49 = €3.87).
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { askUndoPurchase, confirmCart, recordMoneyPurchase } = await import('./usePurchase')
const { emptyNameLine, laterNameLine, purchaseLine } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')
const { cardCount } = await import('../lib/trips')
const { closeDialog, dismissToast, getDialog, getToasts } = await import('../lib/feedback')

const [P1] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
})

function fakeDb() {
  const sent = []
  const answer = (data) => {
    const q = { eq: () => q, in: () => q, select: () => q, maybeSingle: () => q, single: () => q, order: () => q, limit: () => q, range: () => q, then: (r) => Promise.resolve({ data, error: null }).then(r) }
    return q
  }
  client.supabase = {
    from: (table) => ({
      update: (patch) => (sent.push({ op: 'update', table, patch }), answer([])),
      select: () => answer(table === 'expense_categories' ? [{ id: 'cat-groceries', name: 'Groceries', parent_id: null }] : []),
    }),
    rpc: (name, args) => (sent.push({ op: 'rpc', name, args }), answer({ id: args.payload?.id, total: Math.round((args.payload?.items ?? []).reduce((s, l) => s + l.line_total, 0) * 100) / 100 })),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return sent
}

const chips = { id: 'chips', name: 'Chips & Snacks', unit: 'pcs', current_stock: 1, min_stock: 2, category_id: 'snacks', names: [{ name: 'Corn Snack', origin: null }, { name: 'Nuvole di drago', origin: null }] }
const entry = { id: 'e1', name: 'Corn Snack', pantry_item_id: 'chips', quantity: 1, unit: 'pcs', price: 1.39, price_qty: 1, price_unit: 'pcs', payer: P1, category_id: 'snacks' }

describe('K96: lines or cards', () => {
  it('"Purchase confirmed · 3 items · €3.87" for one card with three name lines, all of them in one confirm_shopping_trip', async () => {
    const sent = fakeDb()
    const first = purchaseLine(entry, [chips], {}, { typedName: 'Corn Snack' })
    const lines = [first, laterNameLine(first, { ...emptyNameLine(1, 'pcs'), name: 'Nuvole di drago', totalText: '0.99' }, [chips]), laterNameLine(first, { ...emptyNameLine(2, 'pcs'), name: 'Patatine paprika', totalText: '1.49' }, [chips])]
    const { error } = await confirmCart({ id: 'trip-387', date: '2026-11-07', lines, answers: {}, totalOf: (i) => lineTotal(i), photoIds: [] })
    expect(error).toBeNull()
    const rpcs = sent.filter((s) => s.op === 'rpc' && s.name === 'confirm_shopping_trip')
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0].args.payload.items.map((i) => i.grocery_item_id)).toEqual(['e1', 'e1', 'e1'])
    const toast = getToasts().find((t) => t.message.startsWith('Purchase confirmed'))
    expect(toast.message).toBe('Purchase confirmed · 3 items · €3.87')
    expect(toast.action.label).toBe('Undo')
  })

  it('MONEY: "Purchase saved · 1 item · €4.50" with Undo for a row attached as a new name', async () => {
    fakeDb()
    await recordMoneyPurchase({ payload: { id: 'm1', items: [{ name: 'Darjeeling Tin', pantry_item_id: 'tea', add: 1, add_name: true, line_total: 4.5 }] } })
    const toast = getToasts().find((t) => t.message.startsWith('Purchase saved'))
    expect(toast.message).toBe('Purchase saved · 1 item · €4.50')
    expect(toast.action.label).toBe('Undo')
  })

  it('"Reopen this purchase?" counts the card: "The 1 item (€3.87) goes back to the cart, …"', async () => {
    const lines = [{ id: 'a', grocery_item_id: 'e1' }, { id: 'b', grocery_item_id: 'e1' }, { id: 'c', grocery_item_id: 'e1' }]
    const asked = askUndoPurchase({ id: 't', source: 'shop' }, { count: 3, cards: cardCount(lines), total: 3.87 })
    await vi.waitFor(() => expect(getDialog()).toBeTruthy())
    expect(getDialog()).toMatchObject({ title: 'Reopen this purchase?', message: 'The 1 item (€3.87) goes back to the cart, and the stock, history and expenses from this purchase are undone.' })
    closeDialog(null)
    expect(await asked).toBeNull()
  })

  it('two cards, one deleted meanwhile (its copy counts): "The 2 items (€5.10) go back to the cart, …"', async () => {
    const lines = [{ id: 'a', grocery_item_id: 'e1' }, { id: 'b', grocery_item_id: 'e1' }, { id: 'c', grocery_item_id: null, grocery_snapshot: { id: 'e9' } }]
    const asked = askUndoPurchase({ id: 't', source: 'shop' }, { count: 3, cards: cardCount(lines), total: 5.1 })
    await vi.waitFor(() => expect(getDialog()).toBeTruthy())
    expect(getDialog().message).toBe('The 2 items (€5.10) go back to the cart, and the stock, history and expenses from this purchase are undone.')
    closeDialog(null)
    await asked
  })

  it('"Undo this purchase?" (MONEY) counts the lines: "its 3 items (€3.87)"', async () => {
    const asked = askUndoPurchase({ id: 't', source: 'money' }, { count: 3, cards: 1, total: 3.87 })
    await vi.waitFor(() => expect(getDialog()).toBeTruthy())
    expect(getDialog().message).toMatch(/^The expenses of its 3 items \(€3\.87\) are deleted/)
    closeDialog(null)
    await asked
  })
})
