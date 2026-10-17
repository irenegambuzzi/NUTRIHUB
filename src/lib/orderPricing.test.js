import { describe, expect, it } from 'vitest'
import { chooseTotalPrice, chooseUnitPrice, changeQuantity, emptyPrice, orderTotal, prefilledPrice, priceMismatch, savedPrice, typeTotalPrice, typeUnitPrice } from './orderPricing'
import { expensePatchForOrder, expenseRowForOrder, linkedOrderUnits, orderAmountLabel } from './orders'
import { orderRowFrom } from '../hooks/useOrders'

const U = 'box'

describe('order price: unit price and total price', () => {
  it('2 box at 6,65 each is a total of 13.30', () => {
    const s = typeUnitPrice(emptyPrice, '6,65', '2', U)
    expect(s).toMatchObject({ unit: '6,65', total: '13.30', totalSrc: 'auto' })
    expect(orderTotal(s)).toBe(13.3)
  })

  it('typing only the total works out the unit price', () => {
    const s = typeTotalPrice(emptyPrice, '13,30', '2', U)
    expect(s).toMatchObject({ total: '13,30', unit: '6.65', unitSrc: 'auto' })
    expect(orderTotal(s)).toBe(13.3)
  })

  it('a new quantity changes the total from the unit price', () => {
    let s = typeUnitPrice(emptyPrice, '6.65', '2', U)
    s = changeQuantity(s, '3', U)
    expect(s.total).toBe('19.95')
    s = changeQuantity(s, '0,5', U)
    expect(s.total).toBe('3.33')
    expect(orderTotal(s)).toBe(3.33)
  })

  it('a typed total stays the amount paid when the quantity changes; the unit price follows', () => {
    let s = typeTotalPrice(emptyPrice, '12', '2', U)
    expect(s.unit).toBe('6.00')
    s = changeQuantity(s, '4', U)
    expect(s).toMatchObject({ total: '12', unit: '3.00' })
  })

  it('does not calculate from a quantity that is not a number yet', () => {
    const s = typeUnitPrice(emptyPrice, '6,65', '2,', U)
    expect(s.total).toBe('13.30')
    expect(changeQuantity(s, '2,,', U)).toBe(s)
    expect(typeUnitPrice(emptyPrice, '6,65', '', U).total).toBe('')
  })

  it('clears the worked-out price when the typed one is emptied', () => {
    let s = typeUnitPrice(emptyPrice, '6,65', '2', U)
    s = typeUnitPrice(s, '', '2', U)
    expect(s).toMatchObject({ unit: '', total: '' })
  })

  it('wrong text calculates nothing and is kept as typed', () => {
    const s = typeUnitPrice(emptyPrice, '6,6,5', '2', U)
    expect(s).toMatchObject({ unit: '6,6,5', total: '' })
    expect(orderTotal(s)).toBeNaN()
  })

  describe('both prices typed', () => {
    const both = (unit, total) => typeTotalPrice(typeUnitPrice(emptyPrice, unit, '2', U), total, '2', U)

    it('agreeing prices are fine', () => {
      const s = both('6,65', '13,30')
      expect(priceMismatch(s, '2', U)).toBeNull()
      expect(orderTotal(s)).toBe(13.3)
    })

    it('prices that do not agree are a mismatch until one is chosen', () => {
      const s = both('6,65', '14')
      expect(priceMismatch(s, '2', U)).toEqual({ unit: 6.65, total: 14, expected: 13.3 })
      // The quantity changing does not hide it.
      expect(priceMismatch(changeQuantity(s, '3', U), '3', U)).toMatchObject({ expected: 19.95, total: 14 })
      const unitRight = chooseUnitPrice(s, '2', U)
      expect(priceMismatch(unitRight, '2', U)).toBeNull()
      expect(orderTotal(unitRight)).toBe(13.3)
      const totalRight = chooseTotalPrice(s, '2', U)
      expect(priceMismatch(totalRight, '2', U)).toBeNull()
      expect(orderTotal(totalRight)).toBe(14)
      expect(totalRight.unit).toBe('7.00')
    })

    it('is not a mismatch when one price was only worked out', () => {
      expect(priceMismatch(typeUnitPrice(emptyPrice, '6,65', '2', U), '2', U)).toBeNull()
    })
  })

  describe('an existing order', () => {
    it('keeps its saved price as the total, shown with quantity 1, and does not recalculate on opening', () => {
      const s = savedPrice(55, '1', U)
      expect(s).toMatchObject({ total: '55.00', unit: '55.00' })
      expect(orderTotal(s)).toBe(55)
      expect(priceMismatch(s, '1', U)).toBeNull()
    })

    it('keeps an amount that does not divide evenly exactly as saved', () => {
      expect(orderTotal(savedPrice(10, '3', U))).toBe(10)
    })

    it('keeps the total when only the quantity is corrected', () => {
      const s = changeQuantity(savedPrice(13.3, '1', U), '2', U)
      expect(orderTotal(s)).toBe(13.3)
      expect(s.unit).toBe('6.65')
    })

    it('a unit price typed over it is an explicit change of the total', () => {
      expect(orderTotal(typeUnitPrice(savedPrice(13.3, '2', U), '7', '2', U))).toBe(14)
    })
  })

  it('an order from the SHOP list starts with its total and follows the quantity', () => {
    const s = prefilledPrice(6, '2', U)
    expect(s).toMatchObject({ total: '6.00', unit: '3.00' })
    expect(changeQuantity(s, '3', U).total).toBe('9.00')
  })
})

describe('what is saved', () => {
  const values = { itemName: ' Cat Wet Food ', orderDate: '2026-10-17', paidBy: 'shared', price: orderTotal(typeUnitPrice(emptyPrice, '6,65', '2', U)), quantity: 2, unit: U }

  it('saves the total as the order price and the quantity with its unit', () => {
    expect(orderRowFrom(values)).toMatchObject({ item_name: 'Cat Wet Food', price: 13.3, quantity: 2, unit: 'box' })
  })

  it('makes one expense of the total, not the unit price', () => {
    const expense = expenseRowForOrder({ ...orderRowFrom(values), category_id: null }, false)
    expect(expense).toMatchObject({ amount: 13.3, description: 'Cat Wet Food' })
  })

  it('editing the quantity of an existing order leaves its expense alone; a new total changes only the amount', () => {
    const order = { price: 55, quantity: null, unit: null, order_date: '2026-10-01', category_id: null, paid_by: 'shared', shop_id: null }
    expect(expensePatchForOrder(order, { ...order, ...orderRowFrom({ ...values, orderDate: '2026-10-01', price: 55 }) }, false)).toEqual({})
    expect(expensePatchForOrder(order, { ...order, ...orderRowFrom({ ...values, orderDate: '2026-10-01', price: 13.3 }) }, false)).toEqual({ amount: 13.3 })
  })
})

describe('showing an order', () => {
  it('says quantity, unit and total', () => {
    expect(orderAmountLabel({ quantity: 2, unit: 'box', price: 13.3 })).toBe('2 box · €13.30')
    expect(orderAmountLabel({ quantity: '1.5', unit: 'kg', price: '4' })).toBe('1.5 kg · €4.00')
  })
  it('shows an existing order with quantity 1 and its price as the total', () => {
    expect(orderAmountLabel({ price: 55 })).toBe('1 · €55.00')
    expect(orderAmountLabel({ quantity: null, unit: null, price: '55.00' })).toBe('1 · €55.00')
  })
  it('offers a linked order the purchase unit first, then the stock unit', () => {
    expect(linkedOrderUnits({ unit: null }, { unit: 'pcs', packaging_unit: 'box', quantity_per_pack: 12 })).toEqual(['box', 'pcs'])
    expect(linkedOrderUnits({ unit: null }, { unit: 'kg', packaging_unit: null })).toEqual(['kg'])
    expect(linkedOrderUnits({ unit: 'pack' }, { unit: 'kg' })).toEqual(['kg', 'pack'])
  })
})
