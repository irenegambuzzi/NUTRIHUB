import { describe, expect, it } from 'vitest'
import { agoLabel, dayDiff, expectedLabel, expensePatchForOrder, expenseRowForOrder, normalizeUrl, orderState, reminders, sortOnTheWay, splitOrders } from './orders'

const TODAY = '2026-10-12'
const day = (offset) => {
  const d = new Date(2026, 9, 12 + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let n = 0
const order = (extra = {}) => ({ id: `o${++n}`, item_name: 'Winter jacket', shop_id: 'vin', order_date: day(-21), price: 55, paid_by: 'irene', category_id: 'cat', expected_date: null, expected_until: null, status: 'on_the_way', created_at: `2026-09-${10 + n}`, ...extra })

describe('dates', () => {
  it('counts whole days, also across a clock change', () => {
    expect(dayDiff('2026-10-12', '2026-10-15')).toBe(3)
    expect(dayDiff('2026-10-15', '2026-10-12')).toBe(-3)
    expect(dayDiff('2026-10-20', '2026-10-30')).toBe(10)
    expect(dayDiff('2026-03-28', '2026-03-30')).toBe(2) // Europe's clocks change on 29 March
    expect(dayDiff('2026-10-24', '2026-10-26')).toBe(2) // and on 25 October
  })

  it('says how long ago something was', () => {
    expect(agoLabel(day(0), TODAY)).toBe('today')
    expect(agoLabel(day(1), TODAY)).toBe('today') // a date in the future is not "ago"
    expect(agoLabel(day(-1), TODAY)).toBe('yesterday')
    expect(agoLabel(day(-5), TODAY)).toBe('5 days ago')
    expect(agoLabel(day(-14), TODAY)).toBe('2 weeks ago')
    expect(agoLabel(day(-21), TODAY)).toBe('3 weeks ago')
    expect(agoLabel(day(-90), TODAY)).toBe('3 months ago')
    expect(agoLabel(day(-800), TODAY)).toBe('2 years ago')
  })
})

describe('orderState and expectedLabel', () => {
  it.each([
    [{ expected_date: day(-3) }, 'overdue', 'overdue by 3 days'],
    [{ expected_date: day(-1) }, 'overdue', 'overdue by 1 day'],
    [{ expected_date: day(0) }, 'today', 'expected today'],
    [{ expected_date: day(1) }, 'soon', 'expected tomorrow'],
    [{ expected_date: day(2) }, 'soon', 'expected in 2 days'],
    [{ expected_date: day(3) }, 'later', 'expected 15 Oct'],
    [{}, 'nodate', 'no expected date'],
  ])('%j → %s', (extra, state, label) => {
    expect(orderState(order(extra), TODAY)).toBe(state)
    expect(expectedLabel(order(extra), TODAY)).toBe(label)
  })

  it('treats a range as on time until its last day', () => {
    const range = { expected_date: day(-2), expected_until: day(3) }
    expect(orderState(order(range), TODAY)).toBe('today')
    expect(expectedLabel(order(range), TODAY)).toBe('expected until 15 Oct')
    expect(orderState(order({ expected_date: day(-6), expected_until: day(-1) }), TODAY)).toBe('overdue')
    expect(expectedLabel(order({ expected_date: day(-6), expected_until: day(-1) }), TODAY)).toBe('overdue by 1 day')
    expect(expectedLabel(order({ expected_date: day(5), expected_until: day(9) }), TODAY)).toBe('expected 17 Oct – 21 Oct')
  })
})

describe('sorting', () => {
  it('puts orders on the way by expected date, those without one last, and history apart', () => {
    const late = order({ expected_date: day(5) })
    const soon = order({ expected_date: day(1) })
    const noDateOld = order({ order_date: day(-30) })
    const noDateNew = order({ order_date: day(-2) })
    const arrived = order({ status: 'arrived', arrived_date: day(-1) })
    const cancelled = order({ status: 'cancelled', order_date: day(-10) })
    const { onTheWay, history } = splitOrders([late, noDateNew, arrived, soon, noDateOld, cancelled])
    expect(onTheWay.map((o) => o.id)).toEqual([soon.id, late.id, noDateOld.id, noDateNew.id])
    expect(history.map((o) => o.id)).toEqual([arrived.id, cancelled.id])
    expect(sortOnTheWay([])).toEqual([])
  })
})

describe('reminders', () => {
  const names = { vin: 'Vinted', zal: 'Zalando' }
  const shopName = (id) => names[id] ?? null

  it('brings up overdue, today, within 2 days, and old orders with no date — not the rest', () => {
    const overdue = order({ expected_date: day(-4), order_date: day(-30) })
    const todayOne = order({ expected_date: day(0) })
    const soon = order({ expected_date: day(2), shop_id: 'zal', order_date: day(-5) })
    const later = order({ expected_date: day(3) })
    const noDateOld = order({ order_date: day(-14) })
    const noDateNew = order({ order_date: day(-13) })
    const arrived = order({ status: 'arrived', expected_date: day(0) })
    const cancelled = order({ status: 'cancelled', expected_date: day(-9) })
    const found = reminders([later, noDateNew, soon, arrived, noDateOld, cancelled, todayOne, overdue], TODAY, shopName)
    expect(found.map((r) => [r.order.id, r.state])).toEqual([
      [overdue.id, 'overdue'],
      [todayOne.id, 'today'],
      [soon.id, 'soon'],
      [noDateOld.id, 'nodate'],
    ])
  })

  it('writes the message the way it is shown', () => {
    const [today] = reminders([order({ expected_date: day(0) })], TODAY, shopName)
    expect(today.message).toBe('Winter jacket from Vinted, ordered 3 weeks ago, expected today')
    const [overdue] = reminders([order({ expected_date: day(-2), shop_id: null, order_date: day(-1) })], TODAY, shopName)
    expect(overdue.message).toBe('Winter jacket, ordered yesterday, overdue by 2 days')
    const [noDate] = reminders([order({ order_date: day(-15), shop_id: 'zal' })], TODAY, shopName)
    expect(noDate.message).toBe('Winter jacket from Zalando, ordered 2 weeks ago, no expected date')
  })

  it('has nothing to say when nothing is due', () => {
    expect(reminders([], TODAY)).toEqual([])
    expect(reminders([order({ expected_date: day(10) })], TODAY)).toEqual([])
  })
})

describe('normalizeUrl', () => {
  it('opens only web addresses', () => {
    expect(normalizeUrl('https://www.vinted.it/items/123?x=1')).toBe('https://www.vinted.it/items/123?x=1')
    expect(normalizeUrl('vinted.it/items/123')).toBe('https://vinted.it/items/123')
    expect(normalizeUrl('  ')).toBeNull()
    expect(normalizeUrl(null)).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<b>x</b>')).toBeNull()
    expect(normalizeUrl('ftp://files.example.com/a')).toBeNull()
    expect(normalizeUrl('not a link')).toBeNull()
  })
})

describe('the expense an order creates and updates', () => {
  const o = order({ price: '55', order_date: '2026-09-21' })

  it('uses the order date, price, category, payer and store', () => {
    expect(expenseRowForOrder(o)).toEqual({ category_id: 'cat', amount: 55, description: 'Winter jacket', paid_by: 'irene', expense_date: '2026-09-21', shop_id: 'vin' })
    expect(expenseRowForOrder({ ...o, category_id: undefined, shop_id: undefined })).toMatchObject({ category_id: null, shop_id: null })
  })

  it('leaves the store out until stores exist in the database', () => {
    expect(expenseRowForOrder(o, false)).not.toHaveProperty('shop_id')
    expect(expensePatchForOrder(o, { ...o, shop_id: 'zal' }, false)).toEqual({})
  })

  it('changes only what the edit changed', () => {
    expect(expensePatchForOrder(o, { ...o })).toEqual({})
    expect(expensePatchForOrder(o, { ...o, expected_date: day(3), details: 'x', order_url: 'y', item_name: 'Parka' })).toEqual({})
    expect(expensePatchForOrder(o, { ...o, price: 49.9 })).toEqual({ amount: 49.9 })
    expect(expensePatchForOrder(o, { ...o, price: '55.00' })).toEqual({})
    expect(expensePatchForOrder(o, { ...o, order_date: '2026-09-22', paid_by: 'akbar', category_id: null, shop_id: 'zal' })).toEqual({
      expense_date: '2026-09-22',
      paid_by: 'akbar',
      category_id: null,
      shop_id: 'zal',
    })
  })
})
