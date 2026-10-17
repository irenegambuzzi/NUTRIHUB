// Typing numbers: money and quantities accept a comma or a dot as the
// decimal separator ("13,60" and "13.60" are both 13.6). Anything else —
// letters, a second separator, a thousands separator, a sign — is refused,
// never silently turned into some other number.

export const DECIMAL_MESSAGE = 'Use digits with one comma or dot, like 13,60.'

const PLAIN = /^\d+[.,]?\d*$|^[.,]\d+$/
const SIGNED = /^-?\d+[.,]?\d*$|^-?[.,]\d+$/

// "13,60" or "13.60" → 13.6; "" or anything not a plain number → NaN.
// Numbers pass through. `negative: true` also allows a leading "-".
export function parseDecimal(text, { negative = false } = {}) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : NaN
  const s = String(text ?? '').trim()
  if (!(negative ? SIGNED : PLAIN).test(s)) return NaN
  return Number(s.replace(',', '.'))
}

// Why typed text isn't a number ('' when it is one, or nothing is typed).
export function decimalProblem(text, options) {
  const s = String(text ?? '').trim()
  return s && Number.isNaN(parseDecimal(s, options)) ? DECIMAL_MESSAGE : ''
}

// The first problem among several typed texts ('' when all are fine).
export const firstDecimalProblem = (...texts) => texts.map((t) => decimalProblem(t)).find(Boolean) ?? ''

// A saved amount as text for an input: two decimals ("13.60"), unless the
// stored value has more (then it is shown as it is, so saving can't round it).
export function moneyText(value) {
  const n = Number(value)
  if (value === '' || value == null || !Number.isFinite(n)) return ''
  return Math.round(n * 100) / 100 === n ? n.toFixed(2) : String(n)
}
