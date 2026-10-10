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

// Sub-buckets for the chart x-axis: days within a week, weeks within a
// month, months within longer spans.
export function getPeriodBuckets(period, referenceDate = new Date(), offset = 0) {
  const { start, end } = getPeriodRange(period, referenceDate, offset)

  if (period === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return { key: localDateString(d), label: WEEKDAY_LABELS[d.getDay()] }
    })
  }

  if (period === 'month') {
    const buckets = []
    const cursor = new Date(start)
    let i = 1
    while (cursor < end) {
      buckets.push({ key: getWeekStart(cursor), label: `Week ${i}` })
      cursor.setDate(cursor.getDate() + 7)
      i++
    }
    return buckets.filter((b, idx, arr) => arr.findIndex((x) => x.key === b.key) === idx)
  }

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
  return dateStr.slice(0, 7)
}
