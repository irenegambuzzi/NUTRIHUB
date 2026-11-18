import { PAID_BY_OPTIONS } from '../data/constants'
import { parseDecimal } from './decimal'
import { ACCOUNTS, JOINT } from './payers'
import { parseLocalDate } from './week'

// Money moved between the household's accounts (plan 9P K210, K218,
// K228–K231; supabase/033_transfers.sql). A transfer goes from one of
// the three accounts (the two people, Joint) to another (all six directions); it is never an
// expense and never income, so no list, chip, chart or Totals card ever
// counts it — only the top card's BALANCE, "This month", "Available" and
// the leftover. A "Starting balance" is a transfer from no one
// (`from_code` empty), only into Joint, at most one (K229 b). Pure, so
// every rule can be tested.

export const TRANSFERS_FILE = 'supabase/033_transfers.sql'
export const TRANSFERS_NOTICE = `This needs the database update ${TRANSFERS_FILE}`

// The kinds of the "Add transfer" form.
export const KIND_TRANSFER = 'transfer'
export const KIND_START = 'start'

export const isStartingBalance = (row) => !row?.from_code
export const kindOf = (row) => (isStartingBalance(row) ? KIND_START : KIND_TRANSFER)

const labelOf = (code) => PAID_BY_OPTIONS.find((o) => o.value === code)?.label ?? code
export const euro = (n) => `€${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`
export const centsOf = (amount) => Math.round((Number(amount) || 0) * 100)
const dayText = (date) => parseLocalDate(date).toLocaleDateString('en-GB')

// "{From} → {To}" with the labels, or "Starting balance → Joint".
export const transferText = (row) => `${isStartingBalance(row) ? 'Starting balance' : labelOf(row.from_code)} → ${labelOf(row.to_code)}`

// The rows dated in [start, end) (YYYY-MM-DD), newest first (then the one
// saved last first).
export const transfersBetween = (rows, start, end) =>
  rows
    .filter((t) => t.transfer_date >= start && t.transfer_date < end)
    .sort((a, b) => String(b.transfer_date).localeCompare(String(a.transfer_date)) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))

// What the rows move for one account, in cents: transfers in, transfers
// out, its starting balances, and how many transfers (not starting
// balances) touch it.
export function accountMoves(rows, code) {
  const out = { inCents: 0, outCents: 0, startCents: 0, count: 0 }
  for (const t of rows) {
    const cents = centsOf(t.amount)
    if (isStartingBalance(t)) {
      if (t.to_code === code) out.startCents += cents
      continue
    }
    if (t.to_code === code) {
      out.inCents += cents
      out.count += 1
    }
    if (t.from_code === code) {
      out.outCents += cents
      out.count += 1
    }
  }
  return out
}

// Every starting balance of the rows, in cents (the household's money; the
// transfers between accounts cancel out).
export const startCentsOf = (rows) => rows.filter(isStartingBalance).reduce((sum, t) => sum + centsOf(t.amount), 0)

// The starting balance already saved for `code` (other than `exceptId`).
export const startingBalanceOf = (rows, code, exceptId = null) => rows.find((t) => isStartingBalance(t) && t.to_code === code && t.id !== exceptId) ?? null

// A typed amount rounded to cents as written (19,52 → 19.52; 10,005 → 10.01).
export const typedAmount = (text) => {
  const n = parseDecimal(text)
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(12))) / 100 : NaN
}

// Why the form can't be saved yet ('' when it can). values: { kind, from,
// to, amountText, date, dateOk }; `rows` every transfer (for the one
// starting balance), `editingId` the row being changed, `today`
// (YYYY-MM-DD).
export function transferProblem({ kind, from, to, amountText, date, dateOk }, { rows = [], editingId = null, today }) {
  if (kind === KIND_TRANSFER) {
    if (!ACCOUNTS.includes(from)) return 'Choose where the money came from.'
    if (!ACCOUNTS.includes(to)) return 'Choose where the money went.'
    if (from === to) return '"From" and "To" must be different.'
  }
  if (!String(amountText ?? '').trim()) return 'Enter the amount.'
  if (!(typedAmount(amountText) > 0)) return 'Enter an amount above 0, like 300 or 19,52.'
  if (!dateOk || !date) return 'Fix the date first (DD/MM/YYYY).'
  if (date > today) return "A transfer can't be after today."
  if (kind === KIND_START) {
    const kept = startingBalanceOf(rows, JOINT, editingId)
    if (kept) return `${labelOf(JOINT)} already has a starting balance (${euro(kept.amount)} on ${dayText(kept.transfer_date)}). Change that one instead.`
  }
  return ''
}

// The row the form saves (without its id).
export function transferRow({ kind, from, to, amountText, date, note }) {
  const start = kind === KIND_START
  return {
    transfer_date: date,
    from_code: start ? null : from,
    to_code: start ? JOINT : to,
    amount: typedAmount(amountText),
    note: String(note ?? '').trim() || null,
  }
}

// The toast after a save.
export const savedMessage = (row) =>
  isStartingBalance(row) ? `Starting balance saved · ${labelOf(row.to_code)} · ${euro(row.amount)}` : `Transfer saved · ${transferText(row)} · ${euro(row.amount)}`
