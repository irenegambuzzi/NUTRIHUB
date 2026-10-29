import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Order groups (plan 9I) as the app saves them: "Group orders", the
// discount, "Take out of the group", "Ungroup", a new order joining (K2),
// a member edited (K3) or deleted (K5) — each with Undo — against a fake
// database that does what save_order_group does (supabase/028; the real
// function is tested in supabase/migrations.test.js, block "028").
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const net = vi.hoisted(() => ({ offline: false }))
vi.mock('../lib/connection', async (original) => ({ ...(await original()), isOffline: () => net.offline }))

const { groupOrders, saveGroupDetails, takeOutOfGroup, ungroupOrders } = await import('./useOrderGroups')
const { createOrder, editOrder, removeOrder } = await import('./useOrders')
const { orderGroupStore, orderStore } = await import('../lib/stores')
const { dismissToast, getToasts, runToastAction } = await import('../lib/feedback')
const { GROUPS_NOTICE } = await import('../lib/orderGroups')

const round2 = (n) => Math.round(n * 100) / 100
const AMAZON = 'amazon'

let db
let rpcs
// The fake database: three tables, plain reads and writes, and
// save_order_group (the same rules as 028: was-check, shares, the expense
// guard). `missing`: 028 not run yet.
function fakeDb({ missing = false } = {}) {
  db = { orders: new Map(), expenses: new Map(), order_groups: new Map() }
  rpcs = []
  const table = (name) => db[name] ?? new Map()
  client.supabase = {
    from: (name) => {
      const call = { op: 'select', filters: [] }
      const matches = (r) => call.filters.every(([col, val]) => (Array.isArray(val) ? val.includes(r[col]) : (r[col] ?? null) === val))
      const q = {
        select: () => q,
        eq: (col, val) => (call.filters.push([col, val]), q),
        in: (col, val) => (call.filters.push([col, val]), q),
        neq: () => q,
        order: () => q,
        range: () => q,
        gte: () => q,
        not: () => q,
        maybeSingle: () => ((call.single = true), q),
        upsert: (rows, opts) => ((call.op = 'upsert'), (call.rows = rows), (call.opts = opts), q),
        update: (patch) => ((call.op = 'update'), (call.patch = patch), q),
        delete: () => ((call.op = 'delete'), q),
        then: (resolve) => {
          const t = table(name)
          let data = []
          if (call.op === 'upsert') {
            for (const r of [call.rows].flat()) {
              if (call.opts?.ignoreDuplicates && t.has(r.id)) continue
              t.set(r.id, { ...(t.get(r.id) ?? { created_at: new Date(Date.UTC(2026, 9, 17, 10, 0, t.size + 1)).toISOString(), group_id: null, group_share: 0 }), ...r })
              data.push(t.get(r.id))
            }
          } else if (call.op === 'update') {
            for (const r of t.values()) if (matches(r)) data.push(Object.assign(r, call.patch))
          } else if (call.op === 'delete') {
            for (const r of [...t.values()]) {
              if (!matches(r)) continue
              data.push(r)
              t.delete(r.id)
            }
            if (name === 'expenses') for (const o of db.orders.values()) if (data.some((e) => e.id === o.expense_id)) o.expense_id = null
          } else data = [...t.values()].filter(matches)
          data = data.map((r) => ({ ...r }))
          return Promise.resolve({ data: call.single ? data[0] ?? null : data, error: null }).then(resolve)
        },
      }
      return q
    },
    rpc: (name, args) => {
      rpcs.push({ name, args })
      if (missing) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_order_group(payload) in the schema cache' } })
      try {
        return Promise.resolve({ data: saveOrderGroup(args.payload), error: null })
      } catch (error) {
        return Promise.resolve({ data: null, error: { code: 'P0001', message: error.message } })
      }
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
}

function saveOrderGroup(p) {
  const all = [...p.orders.map((o) => ({ ...o, stays: true })), ...p.leaving.map((o) => ({ ...o, share: 0, stays: false }))]
  for (const w of all) {
    const o = db.orders.get(w.id)
    if (!o) throw new Error('An order was deleted meanwhile — open Orders again. Nothing was changed.')
    if (o.price !== w.was.price || o.group_share !== w.was.group_share || o.group_id !== w.was.group_id) throw new Error(`"${o.item_name}" changed meanwhile (on the other phone?) — open Orders again. Nothing was changed.`)
  }
  if (round2(p.orders.reduce((s, o) => s + o.share, 0)) !== p.discount_total && p.orders.length) throw new Error("The parts of the order discount don't add up")
  const kept = []
  const expenses = []
  for (const w of all) {
    const o = db.orders.get(w.id)
    const price = round2(w.base - w.share)
    const e = o.expense_id && db.expenses.get(o.expense_id)
    if (e && price !== o.price) {
      if (e.amount === o.price) {
        e.amount = price
        expenses.push({ ...e })
      } else if (e.amount !== price) kept.push({ order_id: o.id, expense_id: e.id, name: o.item_name, amount: e.amount, price })
    }
    if (e && w.stays && (o.shop_id !== p.shop_id || o.order_date !== p.order_date || o.paid_by !== p.paid_by)) {
      Object.assign(e, { shop_id: p.shop_id, expense_date: p.order_date, paid_by: p.paid_by })
      expenses.push({ ...e })
    }
    Object.assign(o, w.stays ? { group_id: p.id, group_share: w.share, price, shop_id: p.shop_id, order_date: p.order_date, paid_by: p.paid_by } : { group_id: null, group_share: 0, price })
  }
  if (p.orders.length) {
    const before = db.order_groups.get(p.id)
    db.order_groups.set(p.id, { id: p.id, shop_id: p.shop_id, order_date: p.order_date, paid_by: p.paid_by, discount_kind: p.discount_kind, discount_value: p.discount_value, discount_total: p.discount_total, created_at: before?.created_at ?? p.created_at ?? 'now' })
  } else db.order_groups.delete(p.id)
  return { group: db.order_groups.get(p.id) ?? null, orders: all.map((w) => ({ ...db.orders.get(w.id) })), expenses, kept }
}

// An order and its expense, already saved (and on the phone).
function seed(i, name, price, extra = {}) {
  const order = { id: `o${i}`, item_name: name, price, group_id: null, group_share: 0, shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar', status: 'on_the_way', expense_id: `x${i}`, created_at: `2026-10-17T10:00:0${i}Z`, ...extra }
  db.orders.set(order.id, { ...order })
  db.expenses.set(`x${i}`, { id: `x${i}`, amount: price, description: name, expense_date: '2026-10-17', paid_by: 'akbar', shop_id: AMAZON })
  return order
}
// The phone's copy, as realtime would bring it.
function sync() {
  orderStore.removeLocal(orderStore.getSnapshot().rows.map((o) => o.id))
  orderStore.upsertLocal([...db.orders.values()].map((o) => ({ ...o })))
  orderGroupStore.removeLocal(orderGroupStore.getSnapshot().rows.map((g) => g.id))
  orderGroupStore.upsertLocal([...db.order_groups.values()].map((g) => ({ ...g })))
}
const view = () => [...db.orders.values()].map((o) => [o.item_name, o.price, o.group_share, o.group_id])
const amounts = () => [...db.expenses.values()].map((e) => e.amount)
const lastToast = () => getToasts().at(-1)

beforeEach(() => {
  net.offline = false
  fakeDb()
})
afterEach(() => getToasts().forEach((t) => dismissToast(t.id)))

describe('"Group orders", the discount, and Undo', () => {
  it('two single orders → one group; Undo makes them single again', async () => {
    const a = seed(1, 'A', 30.79)
    const b = seed(2, 'B', 4.99)
    sync()
    const { error } = await groupOrders({ id: 'g1', singles: [a, b], shopName: () => 'Amazon.it' })
    expect(error).toBeNull()
    expect(view()).toEqual([['A', 30.79, 0, 'g1'], ['B', 4.99, 0, 'g1']])
    expect(lastToast()).toMatchObject({ message: '2 orders grouped as one order', action: { label: 'Undo' } })
    expect(orderGroupStore.getSnapshot().rows.map((g) => g.id)).toEqual(['g1'])
    await runToastAction(lastToast().id)
    expect(view()).toEqual([['A', 30.79, 0, null], ['B', 4.99, 0, null]])
    expect(db.order_groups.size).toBe(0)
  })

  it('"Save" with −€1.00: 0.86 / 0.14, the expenses follow; Undo puts the old prices back', async () => {
    seed(1, 'A', 30.79)
    seed(2, 'B', 4.99)
    sync()
    await groupOrders({ id: 'g1', singles: orderStore.getSnapshot().rows })
    sync()
    const group = db.order_groups.get('g1')
    await saveGroupDetails(group, orderStore.getSnapshot().rows, { discount: { kind: 'amount', value: 1 }, place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' } })
    expect(view()).toEqual([['A', 29.93, 0.86, 'g1'], ['B', 4.85, 0.14, 'g1']])
    expect(amounts()).toEqual([29.93, 4.85])
    expect(lastToast().message).toBe('Order group saved')
    await runToastAction(lastToast().id)
    expect(view()).toEqual([['A', 30.79, 0, 'g1'], ['B', 4.99, 0, 'g1']])
    expect(amounts()).toEqual([30.79, 4.99])
  })

  it('an expense edited by hand is left alone, and the toast says so', async () => {
    seed(1, 'A', 30.79)
    seed(2, 'B', 4.99)
    sync()
    await groupOrders({ id: 'g1', singles: orderStore.getSnapshot().rows })
    db.expenses.get('x2').amount = 20
    sync()
    await saveGroupDetails(db.order_groups.get('g1'), orderStore.getSnapshot().rows, { discount: { kind: 'amount', value: 1 }, place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' } })
    expect(amounts()).toEqual([29.93, 20])
    expect(lastToast().detail).toBe('"B": its expense was changed by hand (€20.00), so it was left as it is.')
  })

  it('"Take out of the group" and Undo; "Ungroup" and Undo', async () => {
    seed(1, 'A', 30.79)
    seed(2, 'B', 4.99)
    seed(3, 'C', 10)
    sync()
    await groupOrders({ id: 'g1', singles: orderStore.getSnapshot().rows })
    sync()
    await saveGroupDetails(db.order_groups.get('g1'), orderStore.getSnapshot().rows, { discount: { kind: 'amount', value: 1 }, place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' } })
    sync()
    const grouped = view()
    const members = orderStore.getSnapshot().rows
    await takeOutOfGroup(db.order_groups.get('g1'), members, members.find((o) => o.id === 'o3'))
    expect(view()).toEqual([['A', 29.93, 0.86, 'g1'], ['B', 4.85, 0.14, 'g1'], ['C', 10, 0, null]])
    expect(lastToast().message).toBe('"C" taken out of the order group')
    await runToastAction(lastToast().id)
    expect(view()).toEqual(grouped)
    sync()
    await ungroupOrders(db.order_groups.get('g1'), orderStore.getSnapshot().rows)
    expect(view()).toEqual([['A', 30.79, 0, null], ['B', 4.99, 0, null], ['C', 10, 0, null]])
    expect(lastToast().message).toBe('Ungrouped — the 3 orders are on their own again')
    await runToastAction(lastToast().id)
    expect(view()).toEqual(grouped)
    expect(db.order_groups.get('g1')).toMatchObject({ discount_kind: 'amount', discount_value: 1, discount_total: 1 })
  })

  it('a third order added to a group with a discount: spread again over all three', async () => {
    seed(1, 'A', 30.79)
    seed(2, 'B', 4.99)
    sync()
    await groupOrders({ id: 'g1', singles: orderStore.getSnapshot().rows })
    sync()
    await saveGroupDetails(db.order_groups.get('g1'), orderStore.getSnapshot().rows, { discount: { kind: 'amount', value: 1 }, place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' } })
    const c = seed(3, 'C', 10)
    sync()
    const members = orderStore.getSnapshot().rows.filter((o) => o.group_id === 'g1')
    await groupOrders({ singles: [c], target: { groupId: 'g1', members }, shopName: () => 'Amazon.it' })
    expect(view().map((r) => r[2])).toEqual([0.67, 0.11, 0.22])
    expect(lastToast().message).toBe('1 order added to the order Amazon.it · 17/10 (2 items)')
  })
})

describe('two separate orders at the same store on the same day (two checkouts)', () => {
  // Zalando, 22/10, paid by Irene: checkout A (2 items, −€5.00) and
  // checkout B (2 items, no discount), then two more single orders.
  const ZAL = 'zal'
  const place = { shop_id: ZAL, order_date: '2026-10-22', paid_by: 'irene' }
  const zal = (i, name, price) => {
    const o = seed(i, name, price, { ...place, created_at: `2026-10-22T08:00:0${i}Z` })
    Object.assign(db.expenses.get(`x${i}`), { expense_date: place.order_date, paid_by: place.paid_by, shop_id: ZAL })
    return o
  }
  const members = (id) => orderStore.getSnapshot().rows.filter((o) => o.group_id === id)
  const zalName = () => 'Zalando'

  async function twoCheckouts() {
    const a = [zal(1, 'Rain Jacket', 49.95), zal(2, 'Wool Scarf', 19.9)]
    const b = [zal(3, 'Sneakers', 64.5), zal(4, 'Socks', 12.5)]
    sync()
    await groupOrders({ id: 'gA', singles: a })
    sync()
    await saveGroupDetails(db.order_groups.get('gA'), members('gA'), { discount: { kind: 'amount', value: 5 }, place })
    await groupOrders({ id: 'gB', singles: b })
    const singles = [zal(5, 'Beanie', 15.99), zal(6, 'Gloves', 22.4)]
    sync()
    // The toasts of the two checkouts are closed (the same message isn't shown twice).
    getToasts().forEach((t) => dismissToast(t.id))
    return singles
  }

  it('"Group as one order": a new group of only the ticked orders; both checkouts stay exactly as they are', async () => {
    const singles = await twoCheckouts()
    const before = view().slice(0, 4)
    const groupsBefore = [db.order_groups.get('gA'), db.order_groups.get('gB')].map((g) => ({ ...g }))
    const { error } = await groupOrders({ id: 'gC', singles, shopName: zalName })
    expect(error).toBeNull()
    expect(rpcs.at(-1).args.payload.orders.map((o) => o.id)).toEqual(['o5', 'o6'])
    expect(view()).toEqual([...before, ['Beanie', 15.99, 0, 'gC'], ['Gloves', 22.4, 0, 'gC']])
    expect([db.order_groups.get('gA'), db.order_groups.get('gB')]).toEqual(groupsBefore)
    expect(db.order_groups.get('gC')).toMatchObject({ ...place, discount_total: 0 })
    expect(amounts()).toEqual([46.37, 18.48, 64.5, 12.5, 15.99, 22.4])
    expect(lastToast().message).toBe('2 orders grouped as one order')
    await runToastAction(lastToast().id)
    expect(view()).toEqual([...before, ['Beanie', 15.99, 0, null], ['Gloves', 22.4, 0, null]])
    expect(db.order_groups.has('gC')).toBe(false)
  })

  it('"Add to" checkout B: only checkout B and the ticked orders change; checkout A and its discount stay', async () => {
    const singles = await twoCheckouts()
    const checkoutA = view().slice(0, 2)
    const { error } = await groupOrders({ singles, target: { groupId: 'gB', members: members('gB') }, shopName: zalName })
    expect(error).toBeNull()
    expect(rpcs.at(-1).args.payload).toMatchObject({ id: 'gB', discount_total: 0 })
    expect(view()).toEqual([...checkoutA, ['Sneakers', 64.5, 0, 'gB'], ['Socks', 12.5, 0, 'gB'], ['Beanie', 15.99, 0, 'gB'], ['Gloves', 22.4, 0, 'gB']])
    expect(db.order_groups.get('gA')).toMatchObject({ discount_kind: 'amount', discount_value: 5, discount_total: 5 })
    expect(lastToast().message).toBe('2 orders added to the order Zalando · 22/10 (2 items)')
  })

  it('"Add to" checkout A: its −€5.00 is spread again over the four; checkout B stays', async () => {
    const singles = await twoCheckouts()
    const checkoutB = view().slice(2, 4)
    await groupOrders({ singles, target: { groupId: 'gA', members: members('gA') }, shopName: zalName })
    expect(view().slice(2, 4)).toEqual(checkoutB)
    expect(view().filter((r) => r[3] === 'gA').map((r) => r[0])).toEqual(['Rain Jacket', 'Wool Scarf', 'Beanie', 'Gloves'])
    expect(round2(view().filter((r) => r[3] === 'gA').reduce((s, r) => s + r[2], 0))).toBe(5)
  })
})

describe('offline, and before 028', () => {
  it('offline: nothing is sent, the same message as merging', async () => {
    const a = seed(1, 'A', 30.79)
    const b = seed(2, 'B', 4.99)
    sync()
    net.offline = true
    const { error } = await groupOrders({ id: 'g1', singles: [a, b] })
    expect(error.message).toBe("You're offline — this needs a connection.")
    expect(rpcs).toEqual([])
  })

  it('before 028: one line, "This needs the database update supabase/028_order_groups.sql"', async () => {
    fakeDb({ missing: true })
    const a = seed(1, 'A', 30.79)
    const b = seed(2, 'B', 4.99)
    sync()
    const { error } = await groupOrders({ id: 'g1', singles: [a, b] })
    expect(error.message).toBe(GROUPS_NOTICE)
    expect(lastToast()).toMatchObject({ tone: 'error', message: GROUPS_NOTICE })
  })

  it('refused (changed on the other phone): the database message, nothing changed', async () => {
    const a = seed(1, 'A', 30.79)
    const b = seed(2, 'B', 4.99)
    sync()
    db.orders.get('o1').price = 31
    const { error } = await groupOrders({ id: 'g1', singles: [a, b] })
    expect(error.message).toBe('"A" changed meanwhile (on the other phone?) — open Orders again. Nothing was changed.')
    expect(db.order_groups.size).toBe(0)
  })
})

describe('orders of a group, from the order form and the order cards', () => {
  const values = { itemName: 'C', details: '', shopId: AMAZON, orderDate: '2026-10-17', price: 10, listPrice: null, discountKind: null, discountValue: null, paidBy: 'akbar', categoryId: null, expectedDate: '', expectedUntil: '', url: '' }
  async function groupOfTwo() {
    seed(1, 'A', 30.79)
    seed(2, 'B', 4.99)
    sync()
    await groupOrders({ id: 'g1', singles: orderStore.getSnapshot().rows })
    sync()
    await saveGroupDetails(db.order_groups.get('g1'), orderStore.getSnapshot().rows, { discount: { kind: 'amount', value: 1 }, place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' } })
    sync()
  }

  it('a new order ticked "Same order as" a group (K2): saved, then joined; the discount spread again; its expense too', async () => {
    await groupOfTwo()
    const { error } = await createOrder({ ...values, joinWith: { groupId: 'g1' } }, { orderId: 'o3', expenseId: 'x3', groupId: 'new' })
    expect(error).toBeNull()
    expect(view()).toEqual([['A', 30.12, 0.67, 'g1'], ['B', 4.88, 0.11, 'g1'], ['C', 9.78, 0.22, 'g1']])
    expect(db.expenses.get('x3').amount).toBe(9.78)
  })

  it('a new order ticked "Same order as" a single order: a new group of the two (no discount yet)', async () => {
    seed(1, 'A', 30.79)
    sync()
    await createOrder({ ...values, joinWith: { orderId: 'o1' } }, { orderId: 'o3', expenseId: 'x3', groupId: 'g9' })
    expect(view()).toEqual([['A', 30.79, 0, 'g9'], ['C', 10, 0, 'g9']])
  })

  it('a refused join undoes the new order and its expense (the form keeps what was typed)', async () => {
    await groupOfTwo()
    db.orders.get('o1').group_share = 0.5 // changed on the other phone
    const { error } = await createOrder({ ...values, joinWith: { groupId: 'g1' } }, { orderId: 'o3', expenseId: 'x3' })
    expect(error.message).toMatch(/changed meanwhile/)
    expect(db.orders.has('o3')).toBe(false)
    expect(db.expenses.has('x3')).toBe(false)
  })

  it('a member\'s price edited (K3): store, date and payer stay the group\'s; the discount is spread again', async () => {
    await groupOfTwo()
    const member = orderStore.getSnapshot().rows.find((o) => o.id === 'o2')
    const { error } = await editOrder(member, { ...values, itemName: 'B', price: 9.21, shopId: 'other', orderDate: '2026-10-01', paidBy: 'irene' })
    expect(error).toBeNull()
    expect(view()).toEqual([['A', 30.02, 0.77, 'g1'], ['B', 8.98, 0.23, 'g1']])
    expect(db.orders.get('o2')).toMatchObject({ shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' })
    expect(amounts()).toEqual([30.02, 8.98])
  })

  it('a member edited without a new price: no group request', async () => {
    await groupOfTwo()
    rpcs.length = 0
    await editOrder(orderStore.getSnapshot().rows.find((o) => o.id === 'o2'), { ...values, itemName: 'B renamed', price: 4.99 })
    expect(rpcs).toEqual([])
    expect(db.orders.get('o2')).toMatchObject({ item_name: 'B renamed', price: 4.85, group_share: 0.14 })
  })

  for (const alsoExpense of [false, true]) {
    it(`deleting a member ("${alsoExpense ? 'Delete the order and its expense' : 'Delete the order only'}"): it leaves the group first; Undo puts everything back`, async () => {
      await groupOfTwo()
      seed(3, 'C', 10)
      sync()
      await groupOrders({ singles: [orderStore.getSnapshot().rows.find((o) => o.id === 'o3')], target: { groupId: 'g1', members: orderStore.getSnapshot().rows.filter((o) => o.group_id === 'g1') } })
      sync()
      const grouped = view()
      const before = amounts()
      await removeOrder(orderStore.getSnapshot().rows.find((o) => o.id === 'o3'), { alsoExpense })
      expect(view()).toEqual([['A', 29.93, 0.86, 'g1'], ['B', 4.85, 0.14, 'g1']])
      expect(db.expenses.has('x3')).toBe(!alsoExpense)
      if (!alsoExpense) expect(db.expenses.get('x3').amount).toBe(10)
      expect(lastToast().message).toBe(alsoExpense ? 'Order and its expense deleted' : 'Order deleted')
      await runToastAction(lastToast().id)
      expect(view()).toEqual(grouped)
      expect(amounts()).toEqual(before)
    })
  }
})
