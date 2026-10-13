import { describe, expect, it } from 'vitest'
import { formatTypedDate, looksLikeDate, maskTypedDate, parseTypedDate } from './dateInput'

describe('parseTypedDate', () => {
  it('reads day/month/year into the same value as the calendar picker', () => {
    expect(parseTypedDate('05/10/2026')).toEqual({ iso: '2026-10-05' })
    expect(parseTypedDate('5/1/2027')).toEqual({ iso: '2027-01-05' })
    expect(parseTypedDate(' 31.12.2026 ')).toEqual({ iso: '2026-12-31' })
  })
  it('always reads day first, never month first', () => {
    expect(parseTypedDate('10/11/2026').iso).toBe('2026-11-10')
    expect(parseTypedDate('11/10/2026').iso).toBe('2026-10-11')
    expect(parseTypedDate('10/13/2026').error).toBeTruthy()
  })
  it('reads digits only: 8 digits DDMMYYYY, 6 digits DDMMYY', () => {
    expect(parseTypedDate('10102026').iso).toBe('2026-10-10')
    expect(parseTypedDate('101026').iso).toBe('2026-10-10')
    expect(parseTypedDate('01022027').iso).toBe('2027-02-01')
  })
  it('reads "-" and "." separators, and one-digit days and months', () => {
    expect(parseTypedDate('10-10-2026').iso).toBe('2026-10-10')
    expect(parseTypedDate('10.10.26').iso).toBe('2026-10-10')
    expect(parseTypedDate('1/2/26').iso).toBe('2026-02-01')
    expect(parseTypedDate('1-2-2026').iso).toBe('2026-02-01')
  })
  it('accepts a leap day only in a leap year', () => {
    expect(parseTypedDate('29/02/2028').iso).toBe('2028-02-29')
    expect(parseTypedDate('29/02/2027').error).toBeTruthy()
  })
  it('says what is wrong with an impossible date', () => {
    expect(parseTypedDate('31/04/2026').error).toBe('31/04/2026 is not a real date: April 2026 has 30 days.')
    expect(parseTypedDate('10/13/2026').error).toMatch(/month must be 1 to 12/)
  })
  it('calls an incomplete date incomplete', () => {
    for (const bad of ['10/10', '10/10/2', '10/10/202', '1010', '10102', '1/2/', '10/', 'abc', '']) {
      expect(parseTypedDate(bad).error).toMatch(/Incomplete date/)
    }
  })
  it('rejects days or months that are zero or too big', () => {
    for (const bad of ['31/04/2026', '32/01/2026', '10/13/2026', '00/01/2026', '01/00/2026']) {
      expect(parseTypedDate(bad).error).toBeTruthy()
    }
  })
})

describe('maskTypedDate', () => {
  it('puts the slashes in while digits are typed', () => {
    expect(maskTypedDate('1')).toBe('1')
    expect(maskTypedDate('10')).toBe('10')
    expect(maskTypedDate('101')).toBe('10/1')
    expect(maskTypedDate('1010')).toBe('10/10')
    expect(maskTypedDate('10102')).toBe('10/10/2')
    expect(maskTypedDate('10102026')).toBe('10/10/2026')
    expect(maskTypedDate('101026')).toBe('10/10/26')
  })
  it('keeps what is typed with separators, turning - and . into /', () => {
    expect(maskTypedDate('1/')).toBe('1/')
    expect(maskTypedDate('1/2')).toBe('1/2')
    expect(maskTypedDate('1/2/26')).toBe('1/2/26')
    expect(maskTypedDate('10-10-2026')).toBe('10/10/2026')
    expect(maskTypedDate('10.10.26')).toBe('10/10/26')
  })
  it('lets the last digit be deleted: a slash only shows once a digit follows it', () => {
    expect(maskTypedDate('10/1')).toBe('10/1')
    expect(maskTypedDate('10/')).toBe('10/')
    expect(maskTypedDate('10')).toBe('10')
  })
  it('moves extra digits on, drops letters and extra year digits', () => {
    expect(maskTypedDate('10/102')).toBe('10/10/2')
    expect(maskTypedDate('10/10/20266')).toBe('10/10/2026')
    expect(maskTypedDate('1a0b')).toBe('10')
    expect(maskTypedDate('')).toBe('')
  })
})

describe('formatTypedDate', () => {
  it('shows day/month/year', () => {
    expect(formatTypedDate('2026-10-05')).toBe('05/10/2026')
    expect(formatTypedDate(null)).toBe('')
  })
  it('shows every saved date unchanged when read back', () => {
    for (const iso of ['2026-10-05', '2024-02-29', '2031-12-31', '2026-01-01']) {
      expect(parseTypedDate(formatTypedDate(iso)).iso).toBe(iso)
    }
  })
})

describe('looksLikeDate', () => {
  it('spots date-like text but not ordinary lot codes', () => {
    expect(looksLikeDate('32/13/2026')).toBe(true)
    expect(looksLikeDate('1/2/26')).toBe(true)
    expect(looksLikeDate('L2345')).toBe(false)
    expect(looksLikeDate('20261010')).toBe(false)
  })
})
