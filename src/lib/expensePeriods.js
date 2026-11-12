import { getWeekStart, localDateString } from './week'

export { localDateString }

function localMonday(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Months a period spans when it covers whole calendar months.
const MONTHS_IN = { month: 1, '3months': 3, '6months': 6 }

// The period `offset` steps away from the one containing `referenceDate`
// (0 = current, -1 = the one before). A week starts on Monday; 3 and 6
// months end with the current calendar month; a step moves the whole
// span, so -1 on "3 Months" is the three months before.
export function getPeriodRange(period, referenceDate = new Date(), offset = 0) {
  const now = new Date(referenceDate)
  if (period === 'week') {
    const start = localMonday(now)
    start.setDate(start.getDate() + 7 * offset)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    return { start, end }
  }
  if (MONTHS_IN[period]) {
    const n = MONTHS_IN[period]
    const end = new Date(now.getFullYear(), now.getMonth() + 1 + n * offset, 1)
    return { start: new Date(end.getFullYear(), end.getMonth() - n, 1), end }
  }
  return {
    start: new Date(now.getFullYear() + offset, 0, 1),
    end: new Date(now.getFullYear() + offset + 1, 0, 1),
  }
}

export function isInPeriod(dateStr, period, referenceDate = new Date(), offset = 0) {
  const { start, end } = getPeriodRange(period, referenceDate, offset)
  const d = new Date(`${dateStr}T00:00:00`)
  return d >= start && d < end
}

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// The dates on screen, e.g. "5 Oct – 11 Oct 2026", "October 2026",
// "Aug – Oct 2026", "2026".
export function formatPeriodRange(period, referenceDate = new Date(), offset = 0) {
  const { start, end } = getPeriodRange(period, referenceDate, offset)
  const last = new Date(end)
  last.setDate(last.getDate() - 1)
  if (period === 'week') {
    const day = (d) => `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`
    return `${day(start)} – ${day(last)} ${last.getFullYear()}`
  }
  if (period === 'month') return `${FULL_MONTHS[start.getMonth()]} ${start.getFullYear()}`
  if (period === 'year') return String(start.getFullYear())
  const from = start.getFullYear() === last.getFullYear() ? MONTH_LABELS[start.getMonth()] : `${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`
  return `${from} – ${MONTH_LABELS[last.getMonth()]} ${last.getFullYear()}`
}

// The weeks of a month (plan 9O, K153 / K162): the calendar rows Monday–
// Sunday, cut to the month, so every day of the month is in exactly one
// week. `month` is 0–11. Each week: { key: the Monday of its row (it may be
// in the month before), label: "Week 1", first, last: its first and last
// day inside the month (YYYY-MM-DD) }. November 2026 (the 1st a Sunday):
// 1, 2–8, 9–15, 16–22, 23–29, 30 → six weeks.
export function monthWeeks(year, month) {
  const weeks = []
  const lastDay = new Date(year, month + 1, 0)
  const day = new Date(year, month, 1)
  while (day <= lastDay) {
    const first = new Date(day)
    // The row ends on its Sunday, or on the last day of the month.
    const sunday = new Date(day)
    sunday.setDate(day.getDate() + ((7 - day.getDay()) % 7))
    const last = sunday < lastDay ? sunday : new Date(lastDay)
    weeks.push({ key: getWeekStart(first), label: `Week ${weeks.length + 1}`, first: localDateString(first), last: localDateString(last) })
    day.setDate(last.getDate() + 1)
  }
  return weeks
}

// Sub-buckets for the chart x-axis: days within a week, weeks within a
// month, months within longer spans.
export function getPeriodBuckets(period, referenceDate = new Date(), offset = 0) {
  const { start } = getPeriodRange(period, referenceDate, offset)

  if (period === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return { key: localDateString(d), label: WEEKDAY_LABELS[d.getDay()] }
    })
  }

  if (period === 'month') return monthWeeks(start.getFullYear(), start.getMonth())

  // Months: 12 for a year, 3 or 6 for those spans.
  const count = MONTHS_IN[period] ?? 12
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTH_LABELS[d.getMonth()] }
  })
}

export function bucketKeyForDate(dateStr, period) {
  if (period === 'week') return dateStr
  if (period === 'month') return getWeekStart(new Date(`${dateStr}T00:00:00`))
  // A span longer than 12 months has a bar per calendar year (K160c-2).
  if (period === 'years') return dateStr.slice(0, 4)
  return dateStr.slice(0, 7)
}

// --- The period on screen (plan 9O, K159–K161, K160a–d, K173) ---------
//
// A "view" is what the pills and the bar under them show:
//   { pill: 'week', offset }                    – a week (‹ › move it)
//   { pill, from, months, choice }              – whole calendar months:
//        from    – the first month as a month number (year × 12 + month 0–11)
//        months  – how many months
//        choice  – what the row highlights: 'Q1'–'Q4', 'H1', 'H2', a year
//                  '2026', 'last12', '3y', '5y', '10y', 'all', or null
// The pills 'month', '3months', '6months' and 'year' all use the second
// form, so a picked month, quarter, half, year or span is one shape.

export const monthNumber = (date) => date.getFullYear() * 12 + date.getMonth()
const monthDate = (n) => new Date(Math.floor(n / 12), n % 12, 1)
const monthText = (n) => `${MONTH_LABELS[n % 12]} ${Math.floor(n / 12)}`
export const FULL_MONTH_NAMES = FULL_MONTHS

// The default period of a pill (K159): this week, this month, the 3 or 6
// months ending in this month, this calendar year.
export function defaultView(pill, now = new Date()) {
  const current = monthNumber(now)
  if (pill === 'week') return { pill, offset: 0 }
  if (pill === 'year') return calendarYearView(now.getFullYear())
  const months = MONTHS_IN[pill] ?? 1
  return { pill, from: current - months + 1, months, choice: null }
}

export const calendarYearView = (year) => ({ pill: 'year', from: year * 12, months: 12, choice: String(year) })

// 3 Months / 6 Months from a picked month (K160a): the span ending in it,
// or starting in it.
export function spanFromMonth(pill, month, how) {
  const months = MONTHS_IN[pill]
  return { pill, from: how === 'start' ? month : month - months + 1, months, choice: null }
}

// The quick buttons of a year: Q1–Q4 (3 Months) or H1, H2 (6 Months).
export function quickSpans(pill, year) {
  const months = MONTHS_IN[pill]
  const prefix = months === 3 ? 'Q' : 'H'
  return Array.from({ length: 12 / months }, (_, i) => ({ pill, from: year * 12 + i * months, months, choice: `${prefix}${i + 1}` }))
}

// The spans of the Year pill (K160c), ending in this month.
export const YEAR_SPANS = [
  { choice: 'last12', label: 'Last 12 months', months: 12 },
  { choice: '3y', label: '3 years', months: 36 },
  { choice: '5y', label: '5 years', months: 60 },
  { choice: '10y', label: '10 years', months: 120 },
]

export function yearSpanView(choice, now = new Date(), firstMonth = monthNumber(now)) {
  const current = monthNumber(now)
  if (choice === 'all') {
    const from = Math.min(firstMonth, current)
    return { pill: 'year', from, months: current - from + 1, choice }
  }
  const { months } = YEAR_SPANS.find((s) => s.choice === choice)
  return { pill: 'year', from: current - months + 1, months, choice }
}

// The calendar years that have data (K160c): from the year of the first
// month with data to this year, newest first.
export function dataYears(firstMonth, now = new Date()) {
  const last = now.getFullYear()
  const first = Math.min(Math.floor(firstMonth / 12), last)
  return Array.from({ length: last - first + 1 }, (_, i) => last - i)
}

// The choices of the Year row (K160c): the calendar years, then "All",
// then the spans from short to long, each kept only when its range — cut
// to [first month with data … this month] — differs from every choice
// kept before it. → [{ choice, label, view }]
export function yearChoices(firstMonth, now = new Date()) {
  const current = monthNumber(now)
  const first = Math.min(firstMonth, current)
  const clip = (v) => `${Math.max(v.from, first)}-${Math.min(v.from + v.months - 1, current)}`
  const candidates = [
    ...dataYears(first, now)
      .reverse()
      .map((y) => ({ choice: String(y), label: String(y), view: calendarYearView(y) })),
    { choice: 'all', label: 'All', view: yearSpanView('all', now, first) },
    ...YEAR_SPANS.map((s) => ({ choice: s.choice, label: s.label, view: yearSpanView(s.choice, now, first) })),
  ]
  const seen = new Set()
  return candidates.filter((c) => {
    const key = clip(c.view)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// The range of a view: start included, end not.
export function viewRange(view, now = new Date()) {
  if (view.pill === 'week') return getPeriodRange('week', now, view.offset)
  return { start: monthDate(view.from), end: monthDate(view.from + view.months) }
}

// The text in the bar: "9 Nov – 15 Nov 2026", "November 2026", "2026",
// "Sep – Nov 2026", "Dec 2025 – Feb 2026".
export function formatView(view, now = new Date()) {
  if (view.pill === 'week') return formatPeriodRange('week', now, view.offset)
  const last = view.from + view.months - 1
  if (view.months === 1) return `${FULL_MONTHS[view.from % 12]} ${Math.floor(view.from / 12)}`
  if (view.pill === 'year' && view.months === 12 && view.from % 12 === 0) return String(view.from / 12)
  const sameYear = Math.floor(view.from / 12) === Math.floor(last / 12)
  return `${sameYear ? MONTH_LABELS[view.from % 12] : monthText(view.from)} – ${monthText(last)}`
}

// Whether two views show the same period.
export const sameView = (a, b) => (a.pill === 'week' ? b.pill === 'week' && a.offset === b.offset : a.pill === b.pill && a.from === b.from && a.months === b.months)

// A key for the period (a new one clears the filters).
export const viewKey = (view) => (view.pill === 'week' ? `week|${view.offset}` : `${view.pill}|${view.from}|${view.months}`)

// What the TREND bars of a view are (K173): 'week' (days), 'month' (the
// weeks of the month, K153), 'months', or 'years' for more than 12 months
// (K160c-2). Used as the `period` of bucketKeyForDate / bucketChipLabel.
export function viewBucketPeriod(view) {
  if (view.pill === 'week' || view.pill === 'month') return view.pill
  return view.months > 12 ? 'years' : 'months'
}

// The TREND bars of a view. Months and years after this month get no bar
// (K160d); the Week and Month pills keep all theirs.
export function viewBuckets(view, now = new Date()) {
  if (view.pill === 'week') return getPeriodBuckets('week', now, view.offset)
  const kind = viewBucketPeriod(view)
  if (kind === 'month') return monthWeeks(Math.floor(view.from / 12), view.from % 12)
  const last = Math.min(view.from + view.months - 1, monthNumber(now))
  if (kind === 'years') {
    const firstYear = Math.floor(view.from / 12)
    const lastYear = Math.floor(last / 12)
    return Array.from({ length: Math.max(lastYear - firstYear + 1, 0) }, (_, i) => ({ key: String(firstYear + i), label: String(firstYear + i) }))
  }
  return Array.from({ length: Math.max(last - view.from + 1, 0) }, (_, i) => {
    const d = monthDate(view.from + i)
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTH_LABELS[d.getMonth()] }
  })
}
