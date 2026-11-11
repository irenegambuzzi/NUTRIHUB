import { describe, expect, it } from 'vitest'
import { bucketKeyForDate, getPeriodBuckets, monthWeeks } from './expensePeriods'
import { bucketChipLabel, formatMonthWeek } from './moneyList'
import { localDateString } from './week'

// Plan 9O, K153 / K162: the weeks of a month are its calendar rows Monday–
// Sunday, cut to the month; the Month pill's TREND has one bar per row.
const days = (year, month) => monthWeeks(year, month - 1).map((w) => [Number(w.first.slice(8)), Number(w.last.slice(8))])

describe('the weeks of a month (K153 / K162)', () => {
  it.each([
    ['Oct 2026 (the 1st a Thursday)', 2026, 10, [[1, 4], [5, 11], [12, 18], [19, 25], [26, 31]]],
    ['Nov 2026 (a Sunday)', 2026, 11, [[1, 1], [2, 8], [9, 15], [16, 22], [23, 29], [30, 30]]],
    ['Feb 2026 (a Sunday)', 2026, 2, [[1, 1], [2, 8], [9, 15], [16, 22], [23, 28]]],
    ['Mar 2026 (a Sunday)', 2026, 3, [[1, 1], [2, 8], [9, 15], [16, 22], [23, 29], [30, 31]]],
    ['Aug 2026 (a Saturday)', 2026, 8, [[1, 2], [3, 9], [10, 16], [17, 23], [24, 30], [31, 31]]],
    ['Feb 2027 (a Monday)', 2027, 2, [[1, 7], [8, 14], [15, 21], [22, 28]]],
  ])('%s', (_, year, month, expected) => {
    expect(days(year, month)).toEqual(expected)
    expect(monthWeeks(year, month - 1).map((w) => w.label)).toEqual(expected.map((_w, i) => `Week ${i + 1}`))
  })

  it('every day of every month from January 2025 to December 2027 is in exactly one Month bar', () => {
    for (let year = 2025; year <= 2027; year++) {
      for (let month = 0; month < 12; month++) {
        const buckets = getPeriodBuckets('month', new Date(year, month, 15))
        const lastDay = new Date(year, month + 1, 0).getDate()
        for (let d = 1; d <= lastDay; d++) {
          const date = localDateString(new Date(year, month, d))
          const key = bucketKeyForDate(date, 'month')
          const holding = buckets.filter((b) => b.key === key)
          expect(holding, date).toHaveLength(1)
          expect(holding[0].first <= date && date <= holding[0].last, date).toBe(true)
          // ... and in no other bar's days.
          expect(buckets.filter((b) => b.first <= date && date <= b.last), date).toHaveLength(1)
        }
      }
    }
  })

  it('the Month pill gives those weeks (offset and all); the bar keys are the Mondays of the rows', () => {
    const november = getPeriodBuckets('month', new Date(2026, 10, 11))
    expect(november.map((b) => b.key)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(getPeriodBuckets('month', new Date(2026, 10, 11), -1).map((b) => b.first)).toEqual(['2026-10-01', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  })

  it('the other pills are unchanged', () => {
    const now = new Date(2026, 10, 11)
    expect(getPeriodBuckets('week', now).map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(getPeriodBuckets('3months', now).map((b) => b.key)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(getPeriodBuckets('6months', now)).toHaveLength(6)
    expect(getPeriodBuckets('year', now).map((b) => b.label)[0]).toBe('Jan')
  })

  it('the chip of a week bar: "Week 2 · 2–8 Nov", one day "Week 1 · 1 Nov" / "Week 6 · 30 Nov"', () => {
    const november = getPeriodBuckets('month', new Date(2026, 10, 11))
    expect(november.map((b) => bucketChipLabel('month', b))).toEqual([
      'Week 1 · 1 Nov',
      'Week 2 · 2–8 Nov',
      'Week 3 · 9–15 Nov',
      'Week 4 · 16–22 Nov',
      'Week 5 · 23–29 Nov',
      'Week 6 · 30 Nov',
    ])
    expect(formatMonthWeek('2026-10-05', '2026-10-11')).toBe('5–11 Oct')
    // Other pills: as before.
    expect(bucketChipLabel('year', { key: '2026-10', label: 'Oct' })).toBe('Oct 2026')
  })
})
