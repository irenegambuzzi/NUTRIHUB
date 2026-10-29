import { describe, expect, it } from 'vitest'
import {
  GROUPS_NOTICE,
  candidateLabel,
  groupDiscountNote,
  groupDiscountTotal,
  groupErrorMessage,
  groupLabel,
  groupMembers,
  groupPayload,
  groupPreview,
  groupingPlan,
  itemNames,
  joinCandidates,
  keptNote,
  respreadNote,
  undoGroupPayload,
} from './orderGroups'
import { expenseDiscountNote, orderBase, orderNormalPrice, orderPriceNote } from './orders'
import { bundleTrips, groupPurchases } from './moneyList'

const AMAZON = 'shop-amazon'
const shopName = (id) => ({ [AMAZON]: 'Amazon.it', zal: 'Zalando' })[id] ?? null

// The 7 orders of 17/10, saved in this order (created_at), no group yet.
const order = (i, item_name, price, extra = {}) => ({
  id: `o${i}`,
  item_name,
  price,
  group_share: 0,
  group_id: null,
  shop_id: AMAZON,
  order_date: '2026-10-17',
  paid_by: 'akbar',
  status: 'on_the_way',
  expense_id: `x${i}`,
  created_at: `2026-10-17T10:0${i}:00Z`,
  ...extra,
})
const OCT17 = [
  order(1, 'Cat Dry Food', 30.79),
  order(2, 'Cat Wet Food', 26.6),
  order(3, 'Hairs all Relief', 21.99),
  order(4, 'Working Ear Plug', 8.49),
  order(5, 'Wood Cleaner Spray', 10.99),
  order(6, 'Silicone Gun', 4.99),
  order(7, 'Catnip Snack', 9.99),
]
const PETS = ['Cat Dry Food', 'Cat Wet Food', 'Hairs all Relief', 'Catnip Snack']
const round2 = (n) => Math.round(n * 100) / 100

// What save_order_group writes, applied to the orders (as the database does).
function apply(orders, payload) {
  const byId = new Map(orders.map((o) => [o.id, { ...o }]))
  for (const m of payload.orders) Object.assign(byId.get(m.id), { group_id: payload.id, group_share: m.share, price: round2(m.base - m.share) })
  for (const m of payload.leaving) Object.assign(byId.get(m.id), { group_id: null, group_share: 0, price: m.base })
  return [...byId.values()]
}
const amazonDiscount = { kind: 'amount', value: 3.23 }

describe('the order of 17/10 at Amazon.it: 7 orders, discount −€3.23', () => {
  const payload = groupPayload({ id: 'g1', place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' }, discount: amazonDiscount, members: [...OCT17].reverse() })
  const after = apply(OCT17, payload)

  it('spreads it in proportion, the 2 leftover cents on the order saved last (Catnip Snack)', () => {
    expect(payload.orders.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'])
    expect(payload.orders.map((o) => o.share)).toEqual([0.87, 0.75, 0.62, 0.24, 0.31, 0.14, 0.3])
    expect(round2(payload.orders.reduce((s, o) => s + o.share, 0))).toBe(3.23)
    expect(payload).toMatchObject({ discount_kind: 'amount', discount_value: 3.23, discount_total: 3.23, shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar', leaving: [] })
    expect(payload.orders[0]).toEqual({ id: 'o1', base: 30.79, share: 0.87, was: { price: 30.79, group_share: 0, group_id: null } })
  })

  it('pays 29.92, 25.85, 21.37, 8.25, 10.68, 4.85, 9.69 = €110.61; Pets 2.54 → €86.83', () => {
    expect(after.map((o) => o.price)).toEqual([29.92, 25.85, 21.37, 8.25, 10.68, 4.85, 9.69])
    expect(round2(after.reduce((s, o) => s + o.price, 0))).toBe(110.61)
    const pets = after.filter((o) => PETS.includes(o.item_name))
    expect(groupDiscountTotal(pets)).toBe(2.54)
    expect(round2(pets.reduce((s, o) => s + o.price, 0))).toBe(86.83)
  })

  it('each order says it: "€10.99 → €10.68 (order discount −€0.31)"; the base is the price before it', () => {
    const wood = after.find((o) => o.item_name === 'Wood Cleaner Spray')
    expect(orderBase(wood)).toBe(10.99)
    expect(orderPriceNote(wood)).toBe('€10.99 → €10.68 (order discount −€0.31)')
    expect(orderNormalPrice(wood)).toBe(10.99)
    expect(expenseDiscountNote({ id: 'x5', amount: 10.68 }, (id) => after.find((o) => o.expense_id === id))).toBe('€10.99 → €10.68 (order discount −€0.31)')
    // An expense edited by hand to another amount: the line would not describe it.
    expect(expenseDiscountNote({ id: 'x5', amount: 11 }, (id) => after.find((o) => o.expense_id === id))).toBe('')
  })

  it('a return of Working Ear Plug with "Delete the expense" moves nothing: €102.36 left, the group still −€3.23', () => {
    const returned = after.map((o) => (o.item_name === 'Working Ear Plug' ? { ...o, status: 'returned', expense_id: null, expense_outcome: 'deleted' } : o))
    const expenses = returned.filter((o) => o.expense_id).map((o) => o.price)
    expect(expenses).toEqual([29.92, 25.85, 21.37, 10.68, 4.85, 9.69])
    expect(round2(expenses.reduce((s, a) => s + a, 0))).toBe(102.36)
    expect(groupDiscountNote(returned)).toBe('(order discount −€3.23)')
    expect(returned.find((o) => o.item_name === 'Working Ear Plug')).toMatchObject({ price: 8.25, group_share: 0.24 })
  })

  it('the label and the tag', () => {
    expect(groupLabel(groupMembers('g1', after), shopName)).toBe('Amazon.it · 17/10 (7 items)')
    expect(itemNames(after)).toBe('Cat Dry Food, Cat Wet Food, Hairs all Relief +4 more')
  })
})

describe('other groups: the rule is general', () => {
  const place = { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' }

  it('2 orders 30.79 + 4.99 with −€1.00 → 0.86 / 0.14', () => {
    const p = groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 1 }, members: [order(1, 'A', 30.79), order(2, 'B', 4.99)] })
    expect(p.orders.map((o) => o.share)).toEqual([0.86, 0.14])
    expect(p.discount_total).toBe(1)
  })

  it('−10% on €38.40 → €3.84 spread', () => {
    const p = groupPayload({ id: 'g', place, discount: { kind: 'percent', value: 10 }, members: [order(1, 'A', 10), order(2, 'B', 8.4), order(3, 'C', 20)] })
    expect(p.orders.map((o) => o.share)).toEqual([1, 0.84, 2])
    expect(p).toMatchObject({ discount_kind: 'percent', discount_value: 10, discount_total: 3.84 })
  })

  it('an order with its own −30% (€80 → €56) and a group discount: its own discount first, then its share', () => {
    const sneakers = order(1, 'Sneakers', 56, { list_price: 80, discount_kind: 'percent', discount_value: 30 })
    const p = groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 2 }, members: [sneakers, order(2, 'Socks', 37.33)] })
    expect(p.orders.map((o) => [o.base, o.share])).toEqual([[56, 1.2], [37.33, 0.8]])
    const [after] = apply([sneakers], { ...p, orders: [p.orders[0]] })
    expect(orderPriceNote(after)).toBe('€80.00 → €56.00 (−30%) · order discount −€1.20 → €54.80')
    expect(orderNormalPrice(after)).toBe(80)
  })

  it('a third order joining a group with a discount: spread again over all three', () => {
    const two = apply([order(1, 'A', 30.79), order(2, 'B', 4.99)], groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 1 }, members: [order(1, 'A', 30.79), order(2, 'B', 4.99)] }))
    const third = order(3, 'C', 10)
    const p = groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 1 }, members: [...two, third] })
    expect(p.orders.map((o) => [o.id, o.base, o.share])).toEqual([['o1', 30.79, 0.67], ['o2', 4.99, 0.11], ['o3', 10, 0.22]])
    expect(p.orders[0].was).toEqual({ price: 29.93, group_share: 0.86, group_id: 'g' })
  })

  it('a member whose price is edited (K3): its new base, then everything spread again', () => {
    const two = apply([order(1, 'A', 30.79), order(2, 'B', 4.99)], groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 1 }, members: [order(1, 'A', 30.79), order(2, 'B', 4.99)] }))
    const p = groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 1 }, members: two, bases: { o2: 9.21 } })
    expect(p.orders.map((o) => [o.base, o.share])).toEqual([[30.79, 0.77], [9.21, 0.23]])
  })

  it('a € discount bigger than the order is capped at the order; a percent above 100 is never sent (the sheet refuses it)', () => {
    const p = groupPayload({ id: 'g', place, discount: { kind: 'amount', value: 50 }, members: [order(1, 'A', 10), order(2, 'B', 5)] })
    expect(p.discount_total).toBe(15)
    expect(p.orders.map((o) => o.share)).toEqual([10, 5])
  })

  it('take one out: its share 0, its price back; the discount spread again over the rest — and Undo puts every share back', () => {
    const members = apply(OCT17, groupPayload({ id: 'g1', place, discount: amazonDiscount, members: OCT17 }))
    const ear = members.find((o) => o.item_name === 'Working Ear Plug')
    const out = groupPayload({ id: 'g1', place, discount: amazonDiscount, members: members.filter((o) => o !== ear), leaving: [ear] })
    expect(out.leaving).toEqual([{ id: 'o4', base: 8.49, was: { price: 8.25, group_share: 0.24, group_id: 'g1' } }])
    expect(round2(out.orders.reduce((s, o) => s + o.share, 0))).toBe(3.23)
    const now = apply(members, out)
    expect(now.find((o) => o.id === 'o4')).toMatchObject({ price: 8.49, group_share: 0, group_id: null })
    const undo = undoGroupPayload({ id: 'g1', groupBefore: { ...place, discount_kind: 'amount', discount_value: 3.23, discount_total: 3.23, created_at: 'then' }, before: members, now })
    expect(undo).toMatchObject({ undo: true, created_at: 'then', discount_total: 3.23, leaving: [] })
    expect(apply(now, undo)).toEqual(members)
  })

  it('ungroup: every share 0, every price back; Undo makes the same group again', () => {
    const members = apply(OCT17, groupPayload({ id: 'g1', place, discount: amazonDiscount, members: OCT17 }))
    const ungroup = groupPayload({ id: 'g1', place, members: [], leaving: members })
    expect(ungroup.orders).toEqual([])
    const now = apply(members, ungroup)
    expect(now.map((o) => o.price)).toEqual(OCT17.map((o) => o.price))
    const undo = undoGroupPayload({ id: 'g1', groupBefore: { ...place, discount_kind: 'amount', discount_value: 3.23, discount_total: 3.23 }, before: members, now })
    expect(apply(now, undo)).toEqual(members)
  })

  it('Undo of a new group: no group before, so every order leaves it again', () => {
    const singles = [order(1, 'A', 30.79), order(2, 'B', 4.99)]
    const now = apply(singles, groupPayload({ id: 'g', place, members: singles }))
    const undo = undoGroupPayload({ id: 'g', groupBefore: null, before: singles, now })
    expect(undo.orders).toEqual([])
    expect(apply(now, undo)).toEqual(singles)
  })
})

describe('"Same order as" for a new order (K2)', () => {
  const place = { shopId: AMAZON, orderDate: '2026-10-17', paidBy: 'akbar' }
  const grouped = apply(OCT17.slice(0, 3), groupPayload({ id: 'g1', place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' }, members: OCT17.slice(0, 3) }))

  it('no store, another day or payer: no offer', () => {
    expect(joinCandidates(OCT17, { ...place, shopId: '' })).toEqual([])
    expect(joinCandidates(OCT17, { ...place, orderDate: '2026-10-18' })).toEqual([])
    expect(joinCandidates(OCT17, { ...place, paidBy: 'irene' })).toEqual([])
  })

  it('one single order: one candidate (the form ticks it), any status', () => {
    const one = joinCandidates([{ ...OCT17[0], status: 'returned' }], place)
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ key: 'o1', groupId: null })
    expect(candidateLabel(one[0], shopName)).toBe('Same order as: Cat Dry Food (Amazon.it · 17/10)')
  })

  it('a group is one candidate, with all its orders; with a single order beside it: two (none ticked)', () => {
    const two = joinCandidates([...grouped, OCT17[4]], place)
    expect(two.map((c) => [c.key, c.orders.length])).toEqual([['g1', 3], ['o5', 1]])
    expect(candidateLabel(two[0], shopName)).toBe('Same order as: Cat Dry Food, Cat Wet Food, Hairs all Relief (Amazon.it · 17/10)')
    expect(candidateLabel({ orders: OCT17 }, shopName)).toBe('Same order as: Cat Dry Food, Cat Wet Food, Hairs all Relief +4 more (Amazon.it · 17/10)')
  })

  it('the note before saving', () => {
    expect(respreadNote(8)).toBe('The order discount will be spread again over 8 items.')
  })
})

describe('"Group orders": what the ticked orders can do', () => {
  const grouped = apply(OCT17.slice(0, 3), groupPayload({ id: 'g1', place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' }, members: OCT17.slice(0, 3) }))
  const all = [...grouped, ...OCT17.slice(3)]

  it('refuses fewer than 2 for a new group, mixed store / date / payer, no store, another group', () => {
    expect(groupingPlan([], all).problem).toBe('Tick at least two orders to group them as one order.')
    expect(groupingPlan([order(9, 'Lonely', 5, { order_date: '2026-10-20' })], [order(9, 'Lonely', 5, { order_date: '2026-10-20' })]).problem).toBe('Tick at least two orders to group them as one order.')
    expect(groupingPlan([OCT17[3], order(9, 'Jacket', 55, { shop_id: 'zal' })], all, shopName).problem).toBe('Only orders of the same store can be one order — these are from Amazon.it and Zalando.')
    expect(groupingPlan([OCT17[3], order(9, 'Later', 5, { order_date: '2026-10-18' })], all).problem).toBe('Only orders of the same order date can be one order — these are on 17/10/2026, 18/10/2026.')
    expect(groupingPlan([OCT17[3], order(9, 'Mine', 5, { paid_by: 'irene' })], all).problem).toBe('Only orders paid by the same person can be one order — these are paid by Akbar and Irene.')
    expect(groupingPlan([OCT17[3], order(9, 'Nowhere', 5, { shop_id: null })], all).problem).toBe('"Nowhere" has no store. Set the store on the order first.')
    const other = order(9, 'In another', 5, { group_id: 'g2' })
    expect(groupingPlan([grouped[0], other], [...all, other]).problem).toBe('"In another" is already in another order group.')
    expect(groupingPlan([grouped[0], grouped[1]], all).problem).toBe('These orders are already one order.')
  })

  it('two single orders: a new group; when a group of the same store, date and payer exists, "Group as one order" AND "Add to" it', () => {
    expect(groupingPlan([OCT17[3], OCT17[4]], OCT17.slice(3))).toMatchObject({ newGroup: true, targets: [] })
    const plan = groupingPlan([OCT17[3], OCT17[4]], all)
    expect(plan.newGroup).toBe(true)
    expect(plan.targets.map((t) => [t.groupId, t.members.length])).toEqual([['g1', 3]])
    expect(plan.singles.map((o) => o.id)).toEqual(['o4', 'o5'])
  })

  it('one single order beside a group: only "Add to" it (a new group needs two)', () => {
    const plan = groupingPlan([OCT17[6]], all)
    expect(plan).toMatchObject({ newGroup: false, singles: [OCT17[6]] })
    expect(plan.targets.map((t) => t.groupId)).toEqual(['g1'])
  })

  it('one single order with one of the group ticked: only "Add to" that group', () => {
    const plan = groupingPlan([grouped[0], OCT17[5]], all)
    expect(plan).toMatchObject({ newGroup: false, singles: [OCT17[5]] })
    expect(plan.targets[0].groupId).toBe('g1')
  })
})

describe('two separate orders at the same store on the same day (two checkouts)', () => {
  // Zalando, 22/10, paid by Irene: checkout A (2 items, −€5) and checkout
  // B (3 items, no discount) are two groups; two more orders are single.
  const zal = (i, item_name, price, extra = {}) => order(i, item_name, price, { shop_id: 'zal', order_date: '2026-10-22', paid_by: 'irene', created_at: `2026-10-22T08:0${i}:00Z`, ...extra })
  const place = { shop_id: 'zal', order_date: '2026-10-22', paid_by: 'irene' }
  const checkoutA = apply([zal(1, 'Rain Jacket', 49.95), zal(2, 'Wool Scarf', 19.9)], groupPayload({ id: 'gA', place, discount: { kind: 'amount', value: 5 }, members: [zal(1, 'Rain Jacket', 49.95), zal(2, 'Wool Scarf', 19.9)] }))
  const checkoutB = apply([zal(3, 'Sneakers', 64.5), zal(4, 'Socks', 12.5), zal(5, 'Belt', 24)], groupPayload({ id: 'gB', place, members: [zal(3, 'Sneakers', 64.5), zal(4, 'Socks', 12.5), zal(5, 'Belt', 24)] }))
  const hat = zal(6, 'Beanie', 15.99)
  const gloves = zal(7, 'Gloves', 22.4)
  const elsewhere = [zal(8, 'Coat', 120, { order_date: '2026-10-23' }), zal(9, 'Shirt', 30, { paid_by: 'akbar' }), order(10, 'Cable', 7.5, { order_date: '2026-10-22', paid_by: 'irene' })]
  const all = [...checkoutA, ...checkoutB, hat, gloves, ...elsewhere]

  it('two single orders: "Group as one order" and one "Add to" for EACH group of the same store, date and payer (oldest first)', () => {
    const plan = groupingPlan([hat, gloves], all, shopName)
    expect(plan.newGroup).toBe(true)
    expect(plan.targets.map((t) => [t.groupId, t.members.map((o) => o.item_name)])).toEqual([
      ['gA', ['Rain Jacket', 'Wool Scarf']],
      ['gB', ['Sneakers', 'Socks', 'Belt']],
    ])
    expect(plan.targets.map((t) => groupLabel(t.members, shopName))).toEqual(['Zalando · 22/10 (2 items)', 'Zalando · 22/10 (3 items)'])
    expect(plan.singles.map((o) => o.item_name)).toEqual(['Beanie', 'Gloves'])
  })

  it('one single order: an "Add to" for each group, no new group', () => {
    const plan = groupingPlan([gloves], all, shopName)
    expect(plan.newGroup).toBe(false)
    expect(plan.targets.map((t) => t.groupId)).toEqual(['gA', 'gB'])
  })

  it('one order of checkout B ticked with a single one: only "Add to" checkout B', () => {
    const plan = groupingPlan([checkoutB[1], hat], all, shopName)
    expect(plan.newGroup).toBe(false)
    expect(plan.targets.map((t) => t.groupId)).toEqual(['gB'])
    expect(plan.singles).toEqual([hat])
  })

  it('a new group of the two leaves both checkouts exactly as they are', () => {
    const payload = groupPayload({ id: 'gC', place, members: [hat, gloves] })
    expect(payload.orders.map((o) => o.id)).toEqual(['o6', 'o7'])
    expect(payload.leaving).toEqual([])
    const after = apply(all, payload)
    expect(after.filter((o) => o.group_id === 'gA').map((o) => [o.item_name, o.price, o.group_share])).toEqual(checkoutA.map((o) => [o.item_name, o.price, o.group_share]))
    expect(after.filter((o) => o.group_id === 'gB').map((o) => o.item_name)).toEqual(['Sneakers', 'Socks', 'Belt'])
    expect(after.filter((o) => o.group_id === 'gC').map((o) => o.item_name)).toEqual(['Beanie', 'Gloves'])
  })

  it('"Same order as" in the form: both checkouts and the single orders, oldest first', () => {
    const c = joinCandidates(all, { shopId: 'zal', orderDate: '2026-10-22', paidBy: 'irene' })
    expect(c.map((x) => [x.key, x.orders.length])).toEqual([['gA', 2], ['gB', 3], ['o6', 1], ['o7', 1]])
    expect(candidateLabel(c[1], shopName)).toBe('Same order as: Sneakers, Socks, Belt (Zalando · 22/10)')
  })

  it('a group on another day, of another payer or store is not offered', () => {
    const later = [zal(11, 'Boots', 89, { order_date: '2026-10-23' }), zal(12, 'Laces', 3.5, { order_date: '2026-10-23' })]
    const otherDay = apply(later, groupPayload({ id: 'gD', place: { ...place, order_date: '2026-10-23' }, members: later }))
    expect(otherDay.map((o) => [o.group_id, o.order_date])).toEqual([['gD', '2026-10-23'], ['gD', '2026-10-23']])
    const plan = groupingPlan([hat, gloves], [...all, ...otherDay], shopName)
    expect(plan.targets.map((t) => t.groupId)).toEqual(['gA', 'gB'])
  })
})

describe('the "Order group" sheet preview', () => {
  it('lists every order (cancelled ones too) with its base, share and what it pays', () => {
    const members = OCT17.map((o, i) => (i === 3 ? { ...o, status: 'returned' } : o))
    const preview = groupPreview(members, amazonDiscount)
    expect(preview.total).toBe(3.23)
    expect(preview.rows[3]).toMatchObject({ base: 8.49, share: 0.24, paid: 8.25, note: '€8.49 → €8.25 (order discount −€0.24)' })
    expect(groupPreview(members, null).rows[0]).toMatchObject({ share: 0, paid: 30.79, note: '' })
  })
})

describe('messages', () => {
  it('before 028: one line', () => {
    expect(groupErrorMessage({ code: 'PGRST202', message: 'Could not find the function public.save_order_group(payload)' })).toBe(GROUPS_NOTICE)
    expect(groupErrorMessage({ code: '42P01', message: 'relation "order_groups" does not exist' })).toBe(GROUPS_NOTICE)
    expect(groupErrorMessage({ code: 'PGRST204', message: "Could not find the 'group_id' column of 'orders'" })).toBe(GROUPS_NOTICE)
    expect(GROUPS_NOTICE).toBe('This needs the database update supabase/028_order_groups.sql')
  })

  it('a refusal as the database says it; the household check', () => {
    expect(groupErrorMessage({ code: 'P0001', message: '"A" changed meanwhile (on the other phone?) — open Orders again. Nothing was changed.' })).toMatch(/changed meanwhile/)
    expect(groupErrorMessage({ code: '42501', message: 'x' })).toBe('Not allowed: log in with the household account.')
  })

  it('an expense edited by hand is named', () => {
    expect(keptNote([{ name: 'Hairs all Relief', amount: 20 }])).toBe('"Hairs all Relief": its expense was changed by hand (€20.00), so it was left as it is.')
    expect(keptNote([])).toBe('')
  })
})

describe('MONEY Expenses: the expenses of a group are one row (K9)', () => {
  const after = apply(OCT17, groupPayload({ id: 'g1', place: { shop_id: AMAZON, order_date: '2026-10-17', paid_by: 'akbar' }, discount: amazonDiscount, members: OCT17 }))
  const expenses = after.map((o, i) => ({ id: o.expense_id, amount: o.price, expense_date: '2026-10-17', category_id: PETS.includes(o.item_name) ? 'pets' : 'home', created_at: `t${i}` }))
  const groupOf = (e) => after.find((o) => o.expense_id === e.id)?.group_id ?? null
  const mainOf = (id) => ({ id, name: id })

  it('the plain list: one group row with all 7, €110.61', () => {
    const groups = groupPurchases([...expenses, { id: 'other', amount: 5, expense_date: '2026-10-17', category_id: 'pets' }], { mainOf, orderGroupOf: groupOf })
    const row = groups.find((g) => g.orderGroupId === 'g1')
    expect(row.items).toHaveLength(7)
    expect(row.total).toBe(110.61)
    expect(groups.find((g) => !g.orderGroupId).items.map((e) => e.id)).toEqual(['other'])
  })

  it('the sorted lists bundle them like a purchase; a lone expense stays a plain row', () => {
    const parts = bundleTrips(expenses, groupOf)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ key: 'order:g1', orderGroupId: 'g1', total: 110.61 })
    expect(bundleTrips(expenses.slice(0, 1), groupOf)).toEqual([{ key: 'x1', entry: expenses[0] }])
  })
})
