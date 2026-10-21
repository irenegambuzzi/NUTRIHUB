import { describe, expect, it } from 'vitest'
import {
  applyDiscount,
  couponFields,
  couponText,
  discountLabel,
  discountOff,
  discountProblem,
  lineDiscountFields,
  lineHistory,
  parseDiscount,
  priceLines,
  purchaseCouponNote,
  spreadCoupon,
} from './discounts'

const percent = (value) => ({ kind: 'percent', value })
const amount = (value) => ({ kind: 'amount', value })
const typed = (kind, text) => ({ kind, text })

describe('a discount on one item', () => {
  it('Sneakers €80 −30% → €56', () => {
    expect(applyDiscount(80, percent(30))).toBe(56)
    expect(discountOff(80, percent(30))).toBe(24)
  })

  it('Jacket €120 −€25 → €95', () => {
    expect(applyDiscount(120, amount(25))).toBe(95)
  })

  it('is shown "€80 → €56 (−30%)" and "€120 → €95 (−€25)"', () => {
    expect(discountLabel(80, 56, percent(30))).toBe('€80 → €56 (−30%)')
    expect(discountLabel(120, 95, amount(25))).toBe('€120 → €95 (−€25)')
  })

  it('the history shows cents: "€6.00 → €3.00 (−50%)"', () => {
    expect(discountLabel(6, 3, percent(50), { exact: true })).toBe('€6.00 → €3.00 (−50%)')
    expect(discountLabel(2.5, 2, amount(0.5))).toBe('€2.50 → €2.00 (−€0.50)')
    expect(discountLabel(80, 80, null)).toBe('')
  })

  it('rounds to cents', () => {
    expect(applyDiscount(9.99, percent(33))).toBe(6.69) // 9.99 − 3.2967 → 3.30 off
    expect(applyDiscount(0.05, percent(50))).toBe(0.02) // 0.025 rounds up to 0.03 off
    expect(applyDiscount(10, percent(12.5))).toBe(8.75)
  })

  it('100% is free; no discount changes nothing', () => {
    expect(applyDiscount(80, percent(100))).toBe(0)
    expect(applyDiscount(80, null)).toBe(80)
    expect(applyDiscount(80, undefined)).toBe(80)
  })

  it('what the user typed becomes a discount; empty, 0 or text is none', () => {
    expect(parseDiscount(typed('percent', '30'))).toEqual(percent(30))
    expect(parseDiscount(typed('amount', '2,50'))).toEqual(amount(2.5))
    expect(parseDiscount(typed('amount', ''))).toBeNull()
    expect(parseDiscount(typed('amount', '0'))).toBeNull()
    expect(parseDiscount(typed('percent', 'abc'))).toBeNull()
  })
})

describe('refusing a discount that is too big', () => {
  it('a percent above 100 is refused with a clear message', () => {
    expect(discountProblem(80, typed('percent', '120'))).toBe("A discount can't be more than 100%.")
    expect(discountProblem(80, typed('percent', '100'))).toBe('')
  })

  it('an amount larger than the price is refused, naming both', () => {
    expect(discountProblem(20, typed('amount', '25'))).toBe('The discount (€25) is bigger than the price (€20).')
    expect(discountProblem(20, typed('amount', '2,5'))).toBe('')
    expect(discountProblem(20, typed('amount', '20'))).toBe('')
  })

  it('text that is not a number is refused; nothing typed is fine', () => {
    expect(discountProblem(80, typed('percent', '3o'))).toMatch(/as a number/)
    expect(discountProblem(80, typed('percent', ''))).toBe('')
    expect(discountProblem(80, undefined)).toBe('')
  })

  it('a refused line is not discounted and the purchase has a problem', () => {
    const priced = priceLines([{ list: 20, discount: typed('amount', '25') }])
    expect(priced.problem).toBe('The discount (€25) is bigger than the price (€20).')
    expect(priced.lines[0].paid).toBe(20)
  })
})

describe('the purchase discount (coupon)', () => {
  it('€200 = Groceries €120 + Groceries €60 + Pets €20, coupon −€50 → €90 + €45 + €15 = €150', () => {
    const priced = priceLines(
      [{ list: 120 }, { list: 60 }, { list: 20 }],
      typed('amount', '50')
    )
    expect(priced.lines.map((l) => l.share)).toEqual([30, 15, 5])
    expect(priced.lines.map((l) => l.paid)).toEqual([90, 45, 15])
    expect(priced.paidTotal).toBe(150)
    expect(priced.listTotal).toBe(200)
    expect(priced.couponTotal).toBe(50)
  })

  it('is shown on the purchase row as "(coupon −€50)" or "(coupon −10%)"', () => {
    expect(couponText(amount(50))).toBe('−€50')
    expect(couponText(percent(10))).toBe('−10%')
  })

  it('a percent coupon: −10% of €38.40 → €3.84 spread', () => {
    const priced = priceLines([{ list: 10 }, { list: 8.4 }, { list: 20 }], typed('percent', '10'))
    expect(priced.couponTotal).toBe(3.84)
    expect(priced.lines.reduce((s, l) => s + l.share, 0)).toBeCloseTo(3.84, 10)
    expect(priced.paidTotal).toBe(34.56)
  })

  it('item discounts first, then the coupon by the price after them (the 023 example)', () => {
    // 10 + 12 −30% (=8.40) + 20 = 38.40, coupon −€5
    const priced = priceLines([{ list: 10 }, { list: 12, discount: typed('percent', '30') }, { list: 20 }], typed('amount', '5'))
    expect(priced.lines.map((l) => l.itemPaid)).toEqual([10, 8.4, 20])
    expect(priced.lines.map((l) => l.share)).toEqual([1.3, 1.09, 2.61])
    expect(priced.lines.map((l) => l.paid)).toEqual([8.7, 7.31, 17.39])
    expect(priced.paidTotal).toBe(33.4)
  })

  it('cents that do not divide evenly: €10 over three lines of 33.30 / 33.30 / 33.40 is exact', () => {
    const { shares, total } = spreadCoupon([33.3, 33.3, 33.4], amount(10))
    expect(shares).toEqual([3.33, 3.33, 3.34])
    expect(total).toBe(10)
    expect(shares.reduce((s, x) => Math.round((s + x) * 100) / 100, 0)).toBe(10)
  })

  it('three equal lines: the odd cent goes to the LAST line', () => {
    const { shares } = spreadCoupon([10, 10, 10], amount(10))
    expect(shares).toEqual([3.33, 3.33, 3.34])
  })

  it('€10 off lines of €3.33 / €3.33 / €3.34: the receipt total is exact', () => {
    const priced = priceLines([{ list: 3.33 }, { list: 3.33 }, { list: 3.34 }], typed('amount', '1'))
    expect(priced.lines.map((l) => l.share)).toEqual([0.33, 0.33, 0.34])
    expect(priced.paidTotal).toBe(9)
  })

  it('always adds up exactly, for many awkward splits', () => {
    const prices = [[0.01, 0.02, 0.03], [9.99, 0.01], [1.11, 2.22, 3.33, 4.44], [7, 7, 7, 7, 7, 7, 7], [100.01, 0.33, 12.5]]
    for (const list of prices) {
      const sum = Math.round(list.reduce((s, x) => s + x, 0) * 100) / 100
      for (const coupon of [amount(0.01), amount(1), amount(sum / 3), percent(7), percent(33.3), percent(100)]) {
        const { shares, total } = spreadCoupon(list, coupon)
        expect(Math.round(shares.reduce((s, x) => s + x, 0) * 100) / 100).toBe(total)
        shares.forEach((share, i) => {
          expect(share).toBeGreaterThanOrEqual(0)
          expect(share).toBeLessThanOrEqual(list[i])
        })
      }
    }
  })

  it('a € coupon bigger than the purchase is capped at the total', () => {
    const priced = priceLines([{ list: 5 }, { list: 3 }], typed('amount', '50'))
    expect(priced.couponTotal).toBe(8)
    expect(priced.lines.map((l) => l.paid)).toEqual([0, 0])
    expect(priced.problem).toBe('')
  })

  it('a percent coupon above 100 is refused', () => {
    expect(priceLines([{ list: 5 }], typed('percent', '101')).problem).toBe("A discount can't be more than 100%.")
  })

  it('a €0 line gets share 0', () => {
    const priced = priceLines([{ list: 0 }, { list: 10 }, { list: 10 }], typed('amount', '5'))
    expect(priced.lines.map((l) => l.share)).toEqual([0, 2.5, 2.5])
  })

  it('when the last line cannot take what is left, the line before takes it', () => {
    const { shares } = spreadCoupon([0.01, 0.01], amount(0.02))
    expect(shares).toEqual([0.01, 0.01])
    const free = spreadCoupon([10, 10, 0], amount(10))
    expect(free.shares).toEqual([5, 5, 0])
  })

  it('a line without a price yet takes no part', () => {
    const priced = priceLines([{ list: NaN }, { list: 10 }], typed('amount', '2'))
    expect(priced.lines[1].share).toBe(2)
    expect(Number.isNaN(priced.lines[0].paid)).toBe(true)
    expect(priced.paidTotal).toBe(8)
  })

  it('no coupon: nothing changes', () => {
    const priced = priceLines([{ list: 4.5 }, { list: 2 }])
    expect(priced.paidTotal).toBe(6.5)
    expect(priced.couponTotal).toBe(0)
    expect(couponFields(priced)).toEqual({})
  })
})

describe('what is sent to the database', () => {
  it('a line with a discount and a coupon share sends the normal price, the discount and the share', () => {
    const priced = priceLines([{ list: 6, discount: typed('percent', '50') }, { list: 4 }], typed('amount', '1'))
    expect(lineDiscountFields(priced.lines[0])).toEqual({ list_total: 6, item_discount_kind: 'percent', item_discount_value: 50, coupon_share: 0.43 })
    expect(lineDiscountFields(priced.lines[1])).toEqual({ list_total: 4, coupon_share: 0.57 })
    expect(couponFields(priced)).toEqual({ coupon_kind: 'amount', coupon_value: 1, coupon_total: 1 })
  })

  it('a plain line sends only its normal price', () => {
    const priced = priceLines([{ list: 7.5 }])
    expect(lineDiscountFields(priced.lines[0])).toEqual({ list_total: 7.5 })
  })

  it('a percent coupon sends the percent and the euros it came to', () => {
    const priced = priceLines([{ list: 100 }, { list: 100 }], typed('percent', '10'))
    expect(couponFields(priced)).toEqual({ coupon_kind: 'percent', coupon_value: 10, coupon_total: 20 })
  })
})

describe('the history shown on a saved purchase', () => {
  it('an item discount: "€6.00 → €3.00 (−50%)"', () => {
    expect(lineHistory({ list_total: 6, item_discount_kind: 'percent', item_discount_value: 50, coupon_share: 0 })).toBe('€6.00 → €3.00 (−50%)')
  })

  it('with a coupon share as well', () => {
    expect(lineHistory({ list_total: 6, item_discount_kind: 'percent', item_discount_value: 50, coupon_share: 1.5 })).toBe('€6.00 → €3.00 (−50%) · coupon −€1.50')
  })

  it('a coupon share only: "€6.00 → €4.50 (coupon −€1.50)"', () => {
    expect(lineHistory({ list_total: 6, item_discount_kind: null, item_discount_value: null, coupon_share: 1.5 })).toBe('€6.00 → €4.50 (coupon −€1.50)')
  })

  it('nothing for a line without any discount, or from before round 6', () => {
    expect(lineHistory({ list_total: 6, coupon_share: 0 })).toBe('')
    expect(lineHistory({ list_total: null, coupon_share: 0 })).toBe('')
    expect(lineHistory(null)).toBe('')
  })

  it('the purchase row says "(coupon −€50)" or "(coupon −10%)", and nothing without a coupon', () => {
    expect(purchaseCouponNote({ coupon_kind: 'amount', coupon_value: 50, coupon_total: 50 })).toBe('(coupon −€50)')
    expect(purchaseCouponNote({ coupon_kind: 'percent', coupon_value: 10, coupon_total: 20 })).toBe('(coupon −10%)')
    expect(purchaseCouponNote({ coupon_kind: null, coupon_total: 0 })).toBe('')
    expect(purchaseCouponNote(null)).toBe('')
  })
})
