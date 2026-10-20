import { PAID_BY_OPTIONS } from '../data/constants'
import { parseLocalDate } from './week'

// Merging old single expenses into one purchase (supabase/023
// merge_expenses_into_purchase). The database checks everything again;
// these rules let the screen say why before anything is sent. Pure.

const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label ?? value
const day = (date) => parseLocalDate(date).toLocaleDateString('en-GB')

// Why an expense can't be ticked (null = it can): only single expenses,
// never one that is part of a purchase or an online order's expense.
// `orderExpenseIds`: the expense ids of all orders.
export function selectBlock(expense, orderExpenseIds = new Set()) {
  if (expense.trip_id) return 'In a purchase'
  if (orderExpenseIds.has(expense.id)) return 'Online order'
  return null
}

// Why the ticked expenses can't be merged into a new purchase (null = they
// can): at least two, all of the same day and paid by the same person.
export function mergeProblem(selected, { existing = false } = {}) {
  if (selected.length < (existing ? 1 : 2)) return existing ? 'Tick at least one expense.' : 'Tick at least two expenses to merge them into one purchase.'
  const dates = [...new Set(selected.map((e) => e.expense_date))].sort()
  if (dates.length > 1) return `Only expenses of the same day can be merged — these are on ${dates.map(day).join(', ')}.`
  const payers = [...new Set(selected.map((e) => e.paid_by))]
  if (payers.length > 1) return `Only expenses paid by the same person can be merged — these are paid by ${payers.map(payerLabel).join(' and ')}.`
  return null
}

// The store of the new purchase: prefilled when every ticked expense has
// the same one; it must be chosen when they differ or have none.
export function mergeStore(selected) {
  const shops = new Set(selected.map((e) => e.shop_id ?? null))
  const shared = shops.size === 1 ? [...shops][0] : null
  return { shopId: shared ?? '', mustChoose: !shared }
}

// The purchases the ticked expenses can be added to: same day, and every
// expense in it (and the purchase itself) paid by the same person.
// `trips`: shopping_trips rows; `expenses`: the expenses on the phone.
export function joinablePurchases(selected, trips, expenses) {
  if (mergeProblem(selected, { existing: true })) return []
  const { expense_date: date, paid_by: payer } = selected[0]
  return trips.filter((t) => {
    if (t.trip_date !== date) return false
    if (t.paid_by && t.paid_by !== payer) return false
    const own = expenses.filter((e) => e.trip_id === t.id)
    return own.length > 0 && own.every((e) => e.paid_by === payer)
  })
}

// The message for a refused merge. Two phones merging the same expenses:
// the second one is refused by the database ("already part of a
// purchase"), which is said plainly.
export function mergeErrorMessage(message) {
  const text = String(message ?? '')
  if (/already part of a purchase/i.test(text)) return `${text} They may have just been merged on the other phone — nothing was changed.`
  return text
}
