// What a confirmed purchase (shopping trip) still is, after parts of it
// may have been deleted by hand elsewhere: the database unlinks a deleted
// expense or pantry item (expense_id / pantry_item_id become empty), so a
// line that had them and now doesn't was deleted.

// lines: one per item, with the expense's real amount (0 once deleted);
// total: what's really left; incomplete: something was deleted by hand.
export function tripState(items, expenses) {
  const byId = new Map(expenses.map((e) => [e.id, e]))
  const lines = items.map((item) => {
    const expense = item.expense_id ? byId.get(item.expense_id) ?? null : null
    const expenseGone = Number(item.line_total) > 0 && !item.expense_id
    const pantryGone = !item.pantry_item_id && (Number(item.stock_added) > 0 || item.pantry_created)
    return { item, amount: expense ? Number(expense.amount) || 0 : 0, expenseGone, pantryGone }
  })
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100
  return { lines, total, incomplete: lines.some((l) => l.expenseGone || l.pantryGone) }
}

// "Already deleted by hand, so not undone: …" for the reopen message.
export function goneSummary(lines) {
  const parts = lines.flatMap((l) => [
    ...(l.expenseGone ? [`${l.item.name} (expense)`] : []),
    ...(l.pantryGone ? [`${l.item.name} (pantry item)`] : []),
  ])
  return parts.length ? `Already deleted by hand, so not undone: ${parts.join(', ')}.` : null
}
