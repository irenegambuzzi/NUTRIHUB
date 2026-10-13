// Typing a date as day/month/year (DD/MM/YYYY), never month first. Dates
// are saved as YYYY-MM-DD, the same value the calendar picker gives.

const SEPARATORS = /[/.-]/
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const HINT = 'e.g. 10/10/2026'

const daysIn = (month, year) => new Date(year, month, 0).getDate()
const pad = (n, size = 2) => String(n).padStart(size, '0')

// What the field shows while typing: digits are split into day, month and
// year with slashes put in for you (10102026 → 10/10/2026), "-" and "."
// become "/", and nothing else gets in. A slash only appears once a digit
// follows it, so the last digit can always be deleted.
export function maskTypedDate(text) {
  const raw = String(text ?? '').replace(/[^\d/.-]/g, '')
  const parts = raw.split(/[/.-]+/).filter(Boolean)
  const limits = [2, 2, 4]
  const out = []
  let carry = ''
  for (let i = 0; i < 3 && (i < parts.length || carry); i++) {
    const part = carry + (parts[i] ?? '')
    carry = ''
    if (part.length > limits[i] && i < 2) {
      out.push(part.slice(0, limits[i]))
      carry = part.slice(limits[i])
    } else out.push(part.slice(0, limits[i]))
  }
  const typedSeparator = /[/.-]$/.test(raw) && out.length > 0 && out.length < 3
  return out.join('/') + (typedSeparator ? '/' : '')
}

// "10102026", "101026", "10-10-2026", "10.10.26", "1/2/26" → { iso:
// '2026-10-10' }. Two-digit years are 20YY. Anything incomplete or not a
// real date gives { error } with a short message saying what to fix.
export function parseTypedDate(text) {
  const value = String(text ?? '').trim()
  let day, month, year
  if (/^\d+$/.test(value)) {
    if (value.length === 8) [day, month, year] = [value.slice(0, 2), value.slice(2, 4), value.slice(4)]
    else if (value.length === 6) [day, month, year] = [value.slice(0, 2), value.slice(2, 4), `20${value.slice(4)}`]
    else return { error: `Incomplete date: type day, month and year (${HINT}).` }
  } else {
    const parts = value.split(SEPARATORS)
    const shape = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2}(\d{2})?$/
    if (parts.length !== 3 || !shape.test(value)) return { error: `Incomplete date: type day, month and year (${HINT}).` }
    ;[day, month, year] = parts
    if (year.length === 2) year = `20${year}`
  }
  const [d, m, y] = [day, month, year].map(Number)
  if (m < 1 || m > 12) return { error: `${value} is not a real date: the month must be 1 to 12.` }
  if (y < 1000) return { error: `${value} is not a real date: check the year.` }
  const last = daysIn(m, y)
  if (d < 1 || d > last) return { error: `${value} is not a real date: ${MONTH_NAMES[m - 1]} ${y} has ${last} days.` }
  return { iso: `${pad(y, 4)}-${pad(m)}-${pad(d)}` }
}

// "2026-10-05" → "05/10/2026"; '' when there is no date.
export function formatTypedDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Looks like a typed date (so it should be a real one), whether or not it
// is: day, month and year split by "/", "-" or ".".
export const looksLikeDate = (text) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text.trim())
