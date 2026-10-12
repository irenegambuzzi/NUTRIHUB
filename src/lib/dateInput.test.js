import { describe, expect, it } from 'vitest'
import { formatTypedDate, looksLikeDate, parseTypedDate } from './dateInput'

describe('parseTypedDate', () => {
  it('reads day/month/year into the same value as the calendar picker', () => {
    expect(parseTypedDate('05/10/2026')).toEqual({ iso: '2026-10-05' })
    expect(parseTypedDate('5/1/2027')).toEqual({ iso: '2027-01-05' })
    expect(parseTypedDate(' 31.12.2026 ')).toEqual({ iso: '2026-12-31' })
  })
  it('accepts a leap day only in a leap year', () => {
    expect(parseTypedDate('29/02/2028').iso).toBe('2028-02-29')
    expect(parseTypedDate('29/02/2027').error).toBeTruthy()
  })
  it('rejects dates that do not exist or are not complete', () => {
    for (const bad of ['31/04/2026', '32/01/2026', '10/13/2026', '00/01/2026', '1/1/26', 'abc', '']) {
      expect(parseTypedDate(bad).error).toBeTruthy()
    }
  })
})

describe('formatTypedDate', () => {
  it('shows day/month/year', () => {
    expect(formatTypedDate('2026-10-05')).toBe('05/10/2026')
    expect(formatTypedDate(null)).toBe('')
  })
})

describe('looksLikeDate', () => {
  it('spots date-like text but not ordinary lot codes', () => {
    expect(looksLikeDate('32/13/2026')).toBe(true)
    expect(looksLikeDate('L2406A')).toBe(false)
  })
})
