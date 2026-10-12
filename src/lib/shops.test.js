import { describe, expect, it } from 'vitest'
import { NO_STORE, onlineSplit, quickShops, shopKeyFor, shopNameProblem, shopTotals, shopsAvailable } from './shops'

const shops = [
  { id: 'zal', name: 'Zalando', is_online: true },
  { id: 'lid', name: 'Lidl', is_online: false },
  { id: 'vin', name: 'Vinted', is_online: true },
  { id: 'ikea', name: 'IKEA', is_online: false },
]
const byId = new Map(shops.map((s) => [s.id, s]))
const expenses = [
  { id: 1, amount: 40, shop_id: 'lid' },
  { id: 2, amount: '25.50', shop_id: 'zal' },
  { id: 3, amount: 10, shop_id: 'lid' },
  { id: 4, amount: 9.5, shop_id: null },
  { id: 5, amount: 15, shop_id: 'vin' },
  { id: 6, amount: 5, shop_id: 'deleted-shop' },
  { id: 7, amount: 5 },
]
const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

describe('shopTotals', () => {
  const totals = shopTotals(expenses, byId)

  it('adds up per store, highest first, with expenses without a store as one "No store" row', () => {
    expect(totals.map((t) => [t.name, t.total, t.count])).toEqual([
      ['Lidl', 50, 2],
      ['Zalando', 25.5, 1],
      ['No store', 19.5, 3],
      ['Vinted', 15, 1],
    ])
    const none = totals.find((t) => t.name === 'No store')
    expect(none.key).toBe(NO_STORE)
    expect(none.id).toBeNull()
  })

  it('never loses or adds money: the stores add up to the same total', () => {
    expect(totals.reduce((s, t) => s + t.total, 0)).toBeCloseTo(total, 10)
    expect(totals.reduce((s, t) => s + t.share, 0)).toBeCloseTo(100, 8)
    expect(totals.reduce((s, t) => s + t.count, 0)).toBe(expenses.length)
  })

  it('handles no expenses', () => {
    expect(shopTotals([], byId)).toEqual([])
  })
})

describe('onlineSplit', () => {
  it('splits online, in store and no store', () => {
    const split = onlineSplit(expenses, byId)
    expect(split.online).toEqual({ total: 40.5, count: 2 })
    expect(split.inStore).toEqual({ total: 50, count: 2 })
    expect(split.none).toEqual({ total: 19.5, count: 3 })
    expect(split.online.total + split.inStore.total + split.none.total).toBeCloseTo(total, 10)
  })
})

describe('shopKeyFor', () => {
  it('files an unknown or empty store under none', () => {
    const keyOf = shopKeyFor(byId)
    expect(keyOf({ shop_id: 'lid' })).toBe('lid')
    expect(keyOf({ shop_id: 'gone' })).toBe(NO_STORE)
    expect(keyOf({ shop_id: null })).toBe(NO_STORE)
    expect(keyOf({})).toBe(NO_STORE)
  })
})

describe('quickShops', () => {
  const usage = [{ shop_id: 'vin' }, { shop_id: 'vin' }, { shop_id: 'vin' }, { shop_id: 'lid' }, { shop_id: 'lid' }, { shop_id: 'zal' }, { shop_id: null }]

  it('puts the most used first, then by name', () => {
    expect(quickShops(shops, usage, { limit: 3 }).map((s) => s.name)).toEqual(['Vinted', 'Lidl', 'Zalando'])
    expect(quickShops(shops, [], { limit: 2 }).map((s) => s.name)).toEqual(['IKEA', 'Lidl'])
  })

  it('always shows the store that is picked', () => {
    expect(quickShops(shops, usage, { limit: 2, alwaysInclude: ['ikea'] }).map((s) => s.name)).toEqual(['Vinted', 'Lidl', 'IKEA'])
    expect(quickShops(shops, usage, { limit: 2, alwaysInclude: ['vin', 'nobody'] }).map((s) => s.name)).toEqual(['Vinted', 'Lidl'])
  })
})

describe('shopNameProblem', () => {
  it('refuses empty, too long and repeated names (any capitals)', () => {
    expect(shopNameProblem(shops, '  ')).toMatch(/name/)
    expect(shopNameProblem(shops, 'x'.repeat(41))).toMatch(/at most/)
    expect(shopNameProblem(shops, 'lidl')).toBe('"lidl" already exists.')
    expect(shopNameProblem(shops, 'Amazon')).toBe('')
  })

  it('lets a store keep its own name when renamed', () => {
    expect(shopNameProblem(shops, 'LIDL', 'lid')).toBe('')
    expect(shopNameProblem(shops, 'Vinted', 'lid')).toMatch(/already exists/)
  })
})

describe('shopsAvailable', () => {
  it('needs the stores loaded and not missing', () => {
    expect(shopsAvailable({ loaded: true, rows: [] })).toBe(true)
    expect(shopsAvailable({ loaded: true, missing: true, rows: [] })).toBe(false)
    expect(shopsAvailable({ loaded: false, rows: [] })).toBe(false)
  })
})
