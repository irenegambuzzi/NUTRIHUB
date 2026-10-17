import { describe, expect, it } from 'vitest'
import { DECIMAL_MESSAGE, decimalProblem, firstDecimalProblem, moneyText, parseDecimal } from './decimal'

describe('typing decimal numbers', () => {
  it.each([
    ['13,60', 13.6],
    ['13.60', 13.6],
    ['13,6', 13.6],
    ['0,5', 0.5],
    ['.5', 0.5],
    [',5', 0.5],
    ['13', 13],
    ['13,', 13],
    [' 7,25 ', 7.25],
    ['1360', 1360],
  ])('%s is %s', (text, number) => {
    expect(parseDecimal(text)).toBe(number)
  })

  it.each(['13,6,0', '13.6.0', '13,6.0', '1.234,50', '1,234.50', '13a', 'abc', '', '-5', '13 60', '1e3', '--1', ',', '.'])(
    '"%s" is refused, never turned into another number',
    (text) => {
      expect(parseDecimal(text)).toBeNaN()
    }
  )

  it('lets a sign through only when asked', () => {
    expect(parseDecimal('-2,5', { negative: true })).toBe(-2.5)
    expect(parseDecimal('--2', { negative: true })).toBeNaN()
  })

  it('passes numbers through', () => {
    expect(parseDecimal(13.6)).toBe(13.6)
    expect(parseDecimal(Number.NaN)).toBeNaN()
  })

  it('says what is wrong with typed text, and nothing for empty or good text', () => {
    expect(decimalProblem('13,6,0')).toBe(DECIMAL_MESSAGE)
    expect(decimalProblem('12ab')).toBe(DECIMAL_MESSAGE)
    expect(decimalProblem('')).toBe('')
    expect(decimalProblem(null)).toBe('')
    expect(decimalProblem('13,60')).toBe('')
    expect(firstDecimalProblem('1', '2,5', '')).toBe('')
    expect(firstDecimalProblem('1', '2,5,5', 'x')).toBe(DECIMAL_MESSAGE)
  })

  it('shows saved amounts with two decimals, and never rounds a stored value', () => {
    expect(moneyText(13.6)).toBe('13.60')
    expect(moneyText('13.6')).toBe('13.60')
    expect(moneyText(5)).toBe('5.00')
    expect(moneyText(1.234)).toBe('1.234')
    expect(moneyText(null)).toBe('')
    expect(moneyText('')).toBe('')
  })
})
