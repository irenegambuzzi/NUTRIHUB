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

export function getPeriodRange(period, referenceDate = new Date()) {
  const now = new Date(referenceDate)
  if (period === 'week') {
    const start = localMonday(now)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    return { start, end }
  }
  if (period === 'month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    }
  }
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear() + 1, 0, 1),
  }
}

export function isInPeriod(dateStr, period, referenceDate = new Date()) {
  const { start, end } = getPeriodRange(period, referenceDate)
  const d = new Date(`${dateStr}T00:00:00`)
  return d >= start && d < end
}

// Sub-buckets for the chart x-axis: days within a week, weeks within a
// month, months within a year.
export function getPeriodBuckets(period, referenceDate = new Date()) {
  const { start, end } = getPeriodRange(period, referenceDate)

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

  return Array.from({ length: 12 }, (_, m) => ({
    key: `${start.getFullYear()}-${String(m + 1).padStart(2, '0')}`,
    label: MONTH_LABELS[m],
  }))
}

export function bucketKeyForDate(dateStr, period) {
  if (period === 'week') return dateStr
  if (period === 'month') return getWeekStart(new Date(`${dateStr}T00:00:00`))
  return dateStr.slice(0, 7)
}
