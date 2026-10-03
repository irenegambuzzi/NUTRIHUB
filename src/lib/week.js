// Dates are YYYY-MM-DD strings in local time. toISOString() gives UTC,
// which in Italy (UTC+1/+2) turns local midnight into the previous day.
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// "2026-10-05" → local midnight on that day. new Date("2026-10-05") would
// be UTC midnight, the previous evening west of Greenwich.
export function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Returns the ISO Monday of the week containing `date` as a YYYY-MM-DD string.
export function getWeekStart(date = new Date()) {
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  return localDateString(monday)
}

export function getCurrentWeekStart() {
  return getWeekStart(new Date())
}

// The key the same week was saved under before getWeekStart used local
// time: east of UTC (Italy, Indonesia) that was the Sunday before.
export function legacyWeekStart(weekStart) {
  const sunday = parseLocalDate(weekStart)
  sunday.setDate(sunday.getDate() - 1)
  return localDateString(sunday)
}
