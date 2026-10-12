import { localDateString } from './week'

// Typing a date as day/month/year (DD/MM/YYYY). Dates are saved as
// YYYY-MM-DD, the same value the calendar picker gives.

const TYPED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/

// "5/10/2026" → { iso: '2026-10-05' }; real dates only, else { error }.
export function parseTypedDate(text) {
  const match = TYPED.exec(text.trim())
  if (!match) return { error: 'Type the date as DD/MM/YYYY, e.g. 31/12/2026.' }
  const [day, month, year] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { error: `${text.trim()} is not a real date.` }
  }
  return { iso: localDateString(date) }
}

// "2026-10-05" → "05/10/2026"; '' when there is no date.
export function formatTypedDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Looks like a typed date (so it should be a real one), whether or not it is.
export const looksLikeDate = (text) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text.trim())
