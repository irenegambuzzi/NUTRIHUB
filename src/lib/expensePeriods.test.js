import { describe, expect, it } from 'vitest'
import * as periods from './expensePeriods'
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

// Plan 9O, prompt 3: choosing periods (K159–K161, K160a–d, K173).
describe('the periods of the pills (K160a–d)', () => {
  const { calendarYearView, dataYears, defaultView, formatView, monthNumber, quickSpans, spanFromMonth, viewBucketPeriod, viewBuckets, viewRange, yearChoices, yearSpanView } = periods
  const day = (y, m, d) => new Date(y, m - 1, d, 12)
  const month = (y, m) => y * 12 + m - 1
  const NOW = day(2026, 11, 12)
  const OCT_2026 = month(2026, 10)
  const text = (view, now = NOW) => formatView(view, now)
  const q = (pill, year, name) => quickSpans(pill, year).find((s) => s.choice === name)

  it('3 Months on 12/11/2026 (K160a)', () => {
    expect(text(defaultView('3months', NOW))).toBe('Sep – Nov 2026')
    expect(text(spanFromMonth('3months', month(2026, 9), 'end'))).toBe('Jul – Sep 2026')
    expect(text(spanFromMonth('3months', month(2026, 9), 'start'))).toBe('Sep – Nov 2026')
    expect(text(q('3months', 2026, 'Q3'))).toBe('Jul – Sep 2026')
    expect(text(q('3months', 2026, 'Q4'))).toBe('Oct – Dec 2026')
    expect(quickSpans('3months', 2026).map((s) => text(s))).toEqual(['Jan – Mar 2026', 'Apr – Jun 2026', 'Jul – Sep 2026', 'Oct – Dec 2026'])
    // Data from January 2025: December 2025 + Starting in.
    expect(text(spanFromMonth('3months', month(2025, 12), 'start'))).toBe('Dec 2025 – Feb 2026')
  })

  it('6 Months on 12/11/2026 (K160a)', () => {
    expect(text(defaultView('6months', NOW))).toBe('Jun – Nov 2026')
    expect(text(q('6months', 2026, 'H1'))).toBe('Jan – Jun 2026')
    expect(text(q('6months', 2026, 'H2'))).toBe('Jul – Dec 2026')
    expect(quickSpans('6months', 2026).map((s) => s.choice)).toEqual(['H1', 'H2'])
  })

  it('Month and Year: the defaults and their texts', () => {
    expect(text(defaultView('month', NOW))).toBe('November 2026')
    expect(text({ pill: 'month', from: month(2026, 9), months: 1, choice: null })).toBe('September 2026')
    expect(text(defaultView('year', NOW))).toBe('2026')
    expect(text(defaultView('week', NOW))).toBe('9 Nov – 15 Nov 2026')
    expect(text(yearSpanView('last12', NOW, OCT_2026))).toBe('Dec 2025 – Nov 2026')
  })

  it('the Year row: first data October 2026 (K160c)', () => {
    const labels = (now) => yearChoices(OCT_2026, now).map((c) => c.label)
    expect(labels(day(2026, 11, 12))).toEqual(['2026'])
    expect(labels(day(2027, 1, 15))).toEqual(['2026', '2027', 'All'])
    expect(text(yearSpanView('all', day(2027, 1, 15), OCT_2026), day(2027, 1, 15))).toBe('Oct 2026 – Jan 2027')
    expect(labels(day(2027, 11, 15))).toEqual(['2026', '2027', 'All', 'Last 12 months'])
    expect(text(yearSpanView('last12', day(2027, 11, 15), OCT_2026), day(2027, 11, 15))).toBe('Dec 2026 – Nov 2027')
    expect(labels(day(2029, 11, 15))).toEqual(['2026', '2027', '2028', '2029', 'All', 'Last 12 months', '3 years'])
    expect(text(yearSpanView('3y', day(2029, 11, 15), OCT_2026), day(2029, 11, 15))).toBe('Dec 2026 – Nov 2029')
  })

  it('"Last 12 months" = the 12 whole months ending in this month (K160c-1); "All" = from the first month with data', () => {
    const range = viewRange(yearSpanView('last12', NOW, OCT_2026), NOW)
    expect([localDateString(range.start), localDateString(range.end)]).toEqual(['2025-12-01', '2026-12-01'])
    const all = viewRange(yearSpanView('all', day(2027, 1, 15), OCT_2026), day(2027, 1, 15))
    expect([localDateString(all.start), localDateString(all.end)]).toEqual(['2026-10-01', '2027-02-01'])
    expect(viewRange(calendarYearView(2026), NOW).start.getMonth()).toBe(0)
  })

  it('the years with data: from the first year to this one, newest first, none later', () => {
    expect(dataYears(month(2025, 1), NOW)).toEqual([2026, 2025])
    expect(dataYears(OCT_2026, NOW)).toEqual([2026])
    expect(dataYears(OCT_2026, day(2029, 11, 15))).toEqual([2029, 2028, 2027, 2026])
  })

  it('TREND has no bar after this month (K160d); Week and Month keep all theirs', () => {
    const labels = (view) => viewBuckets(view, NOW).map((b) => b.label)
    expect(labels(calendarYearView(2026))).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
    expect(labels(q('3months', 2026, 'Q4'))).toEqual(['Oct', 'Nov'])
    expect(labels(q('6months', 2026, 'H2'))).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
    expect(labels(spanFromMonth('3months', OCT_2026, 'start'))).toEqual(['Oct', 'Nov'])
    expect(labels(defaultView('week', NOW))).toHaveLength(7)
    expect(labels(defaultView('month', NOW))).toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'])
    expect(calendarYearView(2025).months).toBe(12)
    expect(viewBuckets(calendarYearView(2025), NOW)).toHaveLength(12)
  })

  it('TREND follows the period (K173): days, weeks, months, years for more than 12 months (K160c-2)', () => {
    const later = day(2029, 11, 15)
    expect(viewBucketPeriod(defaultView('week', NOW))).toBe('week')
    expect(viewBucketPeriod(defaultView('month', NOW))).toBe('month')
    expect(viewBucketPeriod(defaultView('3months', NOW))).toBe('months')
    expect(viewBucketPeriod(yearSpanView('last12', NOW, OCT_2026))).toBe('months')
    const threeYears = yearSpanView('3y', later, OCT_2026)
    expect(viewBucketPeriod(threeYears)).toBe('years')
    expect(viewBuckets(threeYears, later).map((b) => b.label)).toEqual(['2026', '2027', '2028', '2029'])
    expect(bucketKeyForDate('2027-03-04', 'years')).toBe('2027')
    expect(bucketChipLabel('years', { key: '2027', label: '2027' })).toBe('2027')
    expect(monthNumber(NOW)).toBe(month(2026, 11))
  })
})
