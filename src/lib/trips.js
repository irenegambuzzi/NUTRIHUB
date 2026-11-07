// What a confirmed purchase (shopping trip) still is, after parts of it
// may have been deleted by hand elsewhere: the database unlinks a deleted
// expense or pantry item (expense_id / pantry_item_id become empty), so a
// line that had them and now doesn't was deleted.

// lines: one per item, with the expense's real amount (0 once deleted);
// merged: the single expenses merged into the purchase (supabase/023:
// they are never lines, only point to it); total: what's really left,
// merged ones included; incomplete: something was deleted by hand.
// `expenses`: the expenses that point to this purchase.
export function tripState(items, expenses) {
  const byId = new Map(expenses.map((e) => [e.id, e]))
  const lines = items.map((item) => {
    const expense = item.expense_id ? byId.get(item.expense_id) ?? null : null
    const expenseGone = Number(item.line_total) > 0 && !item.expense_id
    const pantryGone = !item.pantry_item_id && (Number(item.stock_added) > 0 || item.pantry_created)
    return { item, amount: expense ? Number(expense.amount) || 0 : 0, expenseGone, pantryGone }
  })
  const merged = expenses.filter((e) => e.merged_at)
  const sum = lines.reduce((s, l) => s + l.amount, 0) + merged.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const total = Math.round(sum * 100) / 100
  return { lines, merged, total, incomplete: lines.some((l) => l.expenseGone || l.pantryGone) }
}

// How a purchase is undone, by where it was made (shopping_trips.source):
// a SHOP purchase is reopened (its items go back to the cart), a MONEY
// purchase is undone, and one made by merging old expenses is split (its
// expenses existed before it and are never deleted).
export function purchaseUndo(source) {
  if (source === 'merged') return { kind: 'split', label: 'Split' }
  if (source === 'money') return { kind: 'undo', label: 'Undo purchase' }
  return { kind: 'reopen', label: 'Reopen purchase' }
}

// How many SHOP cards the lines of a purchase are (plan 9N, K96): name lines
// of one card are one card; a line whose card was deleted counts by the card
// it keeps a copy of.
export const cardCount = (lines) => new Set(lines.map((l) => l.grocery_item_id ?? l.grocery_snapshot?.id ?? l.id)).size

// "Already deleted by hand, so not undone: …" for the reopen message.
export function goneSummary(lines) {
  const parts = lines.flatMap((l) => [
    ...(l.expenseGone ? [`${l.item.name} (expense)`] : []),
    ...(l.pantryGone ? [`${l.item.name} (pantry item)`] : []),
  ])
  return parts.length ? `Already deleted by hand, so not undone: ${parts.join(', ')}.` : null
}
