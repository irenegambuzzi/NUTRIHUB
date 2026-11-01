import { PAID_BY_OPTIONS } from '../data/constants'
import { decimalProblem, moneyText, parseDecimal } from './decimal'
import { round2, spreadCoupon } from './discounts'

// "Paid by: Shared" with each person's part in € (plan 9K, NOTE 3 phase
// 1). A Shared expense may keep what each of the two people really paid
// (supabase/029: expenses.part_<code>, both empty or both filled). The
// payers come from PAID_BY_OPTIONS: "shared" and the two people, whose
// codes name the columns and whose labels name the fields. Pure, so every
// rule can be tested.
//
// Parts are only meaningful while the expense is paid by Shared: another
// path (Edit order, an order group, the SHOP payer buttons) may change an
// expense's amount or payer without knowing about them, so the database
// does not check that they add up — the app shows them scaled to the
// amount (K9) and asks to check them.

export const SHARED = 'shared'
// The two people, in the order of PAID_BY_OPTIONS: the cents left over
// always go to the second one.
export const PEOPLE = PAID_BY_OPTIONS.filter((o) => o.value !== SHARED).map((o) => o.value)
const [FIRST, SECOND] = PEOPLE

export const payerLabel = (code) => PAID_BY_OPTIONS.find((o) => o.value === code)?.label ?? code
export const otherPerson = (code) => (code === FIRST ? SECOND : FIRST)

// The column that keeps a person's part, on expenses and on a purchase
// line sent to confirm_shopping_trip.
export const partColumn = (code) => `part_${code}`
export const PART_COLUMNS = PEOPLE.map(partColumn)

export const PARTS_FILE = 'supabase/029_shared_parts.sql'
export const PARTS_NOTICE = `This needs the database update ${PARTS_FILE}`

// Whether the database has the part columns: an expense read from it
// carries them (every expense is read with all its columns), also when
// they are empty. Before 029 nothing about parts shows.
export const partsColumnsReady = (rows = []) => rows.some((row) => row && PART_COLUMNS.every((c) => c in row))

// A write that failed because the part columns aren't there (PostgREST
// PGRST204 / Postgres 42703 naming one of them).
export const missingPartsColumn = (error) => ['PGRST204', '42703'].includes(error?.code) && /part_/.test(String(error?.message ?? ''))

const euro = (n) => `€${round2(Number(n) || 0).toFixed(2)}`
// A typed part rounded to cents as written (K21): 100,555 → 100.56, not
// the 100.55 that 100.555 × 100 = 10055.4999… would give.
const typedCents = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100
const sumOf = (parts) => round2(PEOPLE.reduce((sum, c) => sum + parts[c], 0))

// The parts kept on an expense ({ [code]: € }), or null when it has none.
export function storedParts(expense) {
  if (!expense) return null
  const values = PEOPLE.map((c) => expense[partColumn(c)])
  if (values.some((v) => v == null || v === '' || !Number.isFinite(Number(v)))) return null
  return Object.fromEntries(PEOPLE.map((c, i) => [c, round2(Number(values[i]))]))
}

// A Shared expense that has its parts.
export const hasParts = (expense) => expense?.paid_by === SHARED && storedParts(expense) !== null

// A Shared expense without parts (an old one, an order's expense, one
// saved by an older app version): never counted in a personal view (K4).
export const withoutParts = (expense) => expense?.paid_by === SHARED && storedParts(expense) === null

// The parts made to fit `amount` (K9): in proportion, rounded to cents,
// the rest to the second person. Parts that already add up stay as they are.
export function scaleParts(parts, amount) {
  const total = round2(Number(amount) || 0)
  const sum = sumOf(parts)
  if (sum === total) return parts
  const first = sum > 0 ? round2((total * parts[FIRST]) / sum) : 0
  return { [FIRST]: first, [SECOND]: round2(total - first) }
}

// What a Shared expense with parts shows (null without): `parts` fit its
// amount; `stale` when the amount changed since they were typed, by
// another path (the stored parts stay as they are, K9).
export function shownParts(expense) {
  if (!hasParts(expense)) return null
  const stored = storedParts(expense)
  const amount = round2(Number(expense.amount) || 0)
  const storedTotal = sumOf(stored)
  return { parts: scaleParts(stored, amount), stale: storedTotal !== amount, storedTotal, amount }
}

// "{label} €100.00 · {label} €168.58" under a Shared expense with parts.
export function partsLine(expense) {
  const shown = shownParts(expense)
  return shown ? PEOPLE.map((c) => `${payerLabel(c)} ${euro(shown.parts[c])}`).join(' · ') : ''
}

// The amber note when the amount changed since the parts were typed.
export function staleNote(expense) {
  const shown = shownParts(expense)
  return shown?.stale ? `Parts were for ${euro(shown.storedTotal)} — the expense is now ${euro(shown.amount)}. Edit to check.` : ''
}

// The expenses a person's pill shows (A1, K2): their own expenses whole,
// plus their part of every Shared expense that has parts — as a copy whose
// amount is that part (`sharedPart.real` is the expense itself, for Edit
// and Delete), so every total and chart adds it unchanged. A part of €0 is
// left out (K14): nothing of it is that person's, so the row (or the line
// of a purchase, and the purchase when no line is left) isn't shown there.
// Everyone and Shared show whole amounts.
export function personalExpenses(expenses, person) {
  if (person === 'all') return expenses
  if (!PEOPLE.includes(person)) return expenses.filter((e) => e.paid_by === person)
  const out = []
  for (const e of expenses) {
    if (e.paid_by === person) {
      out.push(e)
      continue
    }
    const shown = shownParts(e)
    if (shown && shown.parts[person] > 0) out.push({ ...e, amount: shown.parts[person], sharedPart: { real: e, person, total: shown.amount } })
  }
  return out
}

// The expense itself behind a row (a personal view's copy, or the row).
export const realExpense = (expense) => expense?.sharedPart?.real ?? expense

// What a whole amount is shown with in a personal view (the part's row
// reads "€100.00 of €268.58").
export const wholeAmount = (expense) => (expense?.sharedPart ? expense.sharedPart.total : Number(expense?.amount) || 0)
export const partOfText = (expense) => (expense?.sharedPart ? `of ${euro(expense.sharedPart.total)}` : '')

// The note under a personal total (K4): "N Shared expenses without parts
// (€…) are not in this total." — '' when there are none.
export function withoutPartsNote(expenses) {
  const left = expenses.filter(withoutParts)
  if (!left.length) return ''
  const total = left.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  const one = left.length === 1
  return `${left.length} ${payerLabel(SHARED)} expense${one ? '' : 's'} without parts (${euro(total)}) ${one ? 'is' : 'are'} not in this total.`
}

// ── The two part fields of a form ─────────────────────────────────
// `split`: { texts: { [code]: text }, typed: { [code]: typed by hand },
// last: the field typed last }. Nothing is ever filled in by itself
// (never 50:50, K3).

export const emptySplit = () => ({ texts: { [FIRST]: '', [SECOND]: '' }, typed: { [FIRST]: false, [SECOND]: false }, last: null })

// The fields for parts already kept (Edit expense).
export const splitFrom = (parts) => ({
  texts: Object.fromEntries(PEOPLE.map((c) => [c, moneyText(parts[c])])),
  typed: { [FIRST]: true, [SECOND]: true },
  last: null,
})

// One field typed (K6): the other takes the rest (total − typed) until it
// is typed by hand itself. A cleared field is no longer "typed by hand".
export function typePart(split, code, text, total) {
  const other = otherPerson(code)
  const next = { texts: { ...split.texts, [code]: text }, typed: { ...split.typed, [code]: Boolean(String(text).trim()) }, last: code }
  if (!split.typed[other]) {
    const value = typedCents(parseDecimal(text))
    const rest = round2(total - value)
    next.texts[other] = String(text).trim() && Number.isFinite(value) && Number.isFinite(total) && rest >= 0 ? moneyText(rest) : ''
  }
  return next
}

// "Split equally" (K3): both halves, the odd cent to the second person.
export function splitEqually(total) {
  const cents = Math.round((Number(total) || 0) * 100)
  const first = Math.floor(cents / 2)
  return { texts: { [FIRST]: moneyText(first / 100), [SECOND]: moneyText((cents - first) / 100) }, typed: { [FIRST]: true, [SECOND]: true }, last: null }
}

// The one-tap fix: the difference put on one person.
export const applyFix = (split, fix) => ({ texts: { ...split.texts, [fix.code]: fix.text }, typed: { ...split.typed, [fix.code]: true }, last: split.last })

// What the fields allow for a Shared total of `total`:
//   problem   why it can't be saved ('' when it can)
//   fix       { code, text, label } — "Put the difference on {label}" — or null
//   hint      the €0 hint (K10), or ''
//   parts     { [code]: € } to save, or null (none typed, or not yet right)
// `required`: parts must be typed (every new Shared expense); without it
// (an old Shared expense saved for another change, K11) both may stay
// empty, but once one is typed they must add up. A total of 0 (or not a
// number yet) needs nothing: there is no expense to share.
export function checkSplit(split, total, { required = true } = {}) {
  const none = { problem: '', fix: null, hint: '', parts: null }
  if (!(Number.isFinite(total) && total > 0)) return none
  const sum = round2(total)
  const texts = Object.fromEntries(PEOPLE.map((c) => [c, String(split.texts[c] ?? '').trim()]))
  if (PEOPLE.every((c) => !texts[c])) return { ...none, problem: required ? `Type what ${payerLabel(FIRST)} and ${payerLabel(SECOND)} paid.` : '' }
  if (PEOPLE.some((c) => decimalProblem(texts[c]))) return { ...none, problem: 'Type each part as a number, like 100 or 168,58.' }
  // Each part rounded to cents first; the check adds up the rounded values
  // (K21), which are also what is saved.
  const values = Object.fromEntries(PEOPLE.map((c) => [c, texts[c] ? typedCents(parseDecimal(texts[c])) : null]))
  const fixOn = (code) => {
    const value = round2(sum - (values[otherPerson(code)] ?? 0))
    return value >= 0 ? { code, text: moneyText(value), label: `Put the difference on ${payerLabel(code)}` } : null
  }
  const over = PEOPLE.find((c) => values[c] !== null && values[c] > sum)
  if (over) return { ...none, problem: `The part of ${payerLabel(over)} (${euro(values[over])}) is more than the total (${euro(sum)}).` }
  const missing = PEOPLE.find((c) => values[c] === null)
  if (missing) return { ...none, problem: `Type what ${payerLabel(missing)} paid too.`, fix: fixOn(missing) }
  const typed = sumOf(values)
  if (typed !== sum) {
    // On the field not typed last (the second person when neither was).
    const first = split.last ? otherPerson(split.last) : SECOND
    return { ...none, problem: `The parts add up to ${euro(typed)}, not ${euro(sum)}.`, fix: fixOn(first) ?? fixOn(otherPerson(first)) }
  }
  const zero = PEOPLE.find((c) => values[c] === 0)
  const payer = zero ? payerLabel(otherPerson(zero)) : ''
  return { ...none, parts: values, hint: zero ? `Only ${payer} paid — you could choose Paid by ${payer} instead.` : '' }
}

// ── Purchases ─────────────────────────────────────────────────────

// One split for a whole purchase (K7): `amounts` are what each Shared line
// really pays (after its discount and coupon share; 0 or not a number = no
// expense, no part), `parts` what each person paid at the till (they add
// up to the lines' sum). The first person's part is spread over the lines
// in proportion to their amounts with the coupon rule (rounded to cents,
// the cents left on the last line, or the one before if needed); the
// second person's part of a line is the rest of it. So every line's parts
// add up to it, and both totals are exactly what was typed.
// → per line { [code]: € }, or null for a line without an expense.
export function spreadParts(amounts, parts) {
  const costs = amounts.map((a) => (Number.isFinite(a) && a > 0 ? round2(a) : 0))
  const { shares } = spreadCoupon(costs, { kind: 'amount', value: parts[FIRST] })
  return costs.map((a, i) => (a > 0 ? { [FIRST]: shares[i], [SECOND]: round2(a - shares[i]) } : null))
}

// What a line or an expense row sends for its parts ({} without).
export const partFields = (parts) => (parts ? Object.fromEntries(PEOPLE.map((c) => [partColumn(c), parts[c]])) : {})

// Both part columns emptied (a payer that isn't Shared, K11).
export const noPartFields = () => Object.fromEntries(PART_COLUMNS.map((c) => [c, null]))
