import { afterEach, describe, expect, it } from 'vitest'
import { getWeekStart, legacyWeekStart, localDateString, parseLocalDate } from './week'

const originalTz = process.env.TZ

// Node picks up a changed TZ for every Date created afterwards.
function inTimeZone(tz, fn) {
  process.env.TZ = tz
  fn()
}

afterEach(() => {
  process.env.TZ = originalTz
})

describe.each(['Europe/Rome', 'Asia/Jakarta', 'America/New_York', 'UTC'])('getWeekStart in %s', (tz) => {
  it('gives the local Monday for every day of the week', () =>
    inTimeZone(tz, () => {
      expect(getWeekStart(new Date(2026, 9, 5, 0, 30))).toBe('2026-10-05') // Monday just after midnight
      expect(getWeekStart(new Date(2026, 9, 7, 12, 0))).toBe('2026-10-05') // Wednesday
      expect(getWeekStart(new Date(2026, 9, 11, 23, 30))).toBe('2026-10-05') // Sunday late evening
      expect(getWeekStart(new Date(2026, 9, 12, 0, 0))).toBe('2026-10-12') // next Monday
    }))

  it('handles daylight saving and year changes', () =>
    inTimeZone(tz, () => {
      expect(getWeekStart(new Date(2026, 2, 30, 1, 0))).toBe('2026-03-30') // after EU clocks go forward
      expect(getWeekStart(new Date(2026, 9, 25, 12, 0))).toBe('2026-10-19') // EU clocks go back (Sunday)
      expect(getWeekStart(new Date(2027, 0, 1, 9, 0))).toBe('2026-12-28')
    }))
})

describe('date helpers', () => {
  it('formats and parses local dates without shifting the day', () =>
    inTimeZone('Europe/Rome', () => {
      expect(localDateString(new Date(2026, 9, 5, 0, 10))).toBe('2026-10-05')
      const d = parseLocalDate('2026-10-05')
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 5, 0])
    }))

  it('parses dates the same way west of UTC', () =>
    inTimeZone('America/New_York', () => {
      expect(parseLocalDate('2026-10-05').getDate()).toBe(5)
    }))

  it('finds the Sunday key that weeks were saved under before the fix', () => {
    expect(legacyWeekStart('2026-10-05')).toBe('2026-10-04')
    expect(legacyWeekStart('2026-03-30')).toBe('2026-03-29')
    expect(legacyWeekStart('2027-01-04')).toBe('2027-01-03')
  })

  it('matches what the old toISOString code stored in Italy', () =>
    inTimeZone('Europe/Rome', () => {
      const monday = new Date(2026, 9, 5)
      expect(legacyWeekStart(getWeekStart(monday))).toBe(monday.toISOString().slice(0, 10))
    }))
})
