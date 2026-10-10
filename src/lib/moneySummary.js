// Totals for the Money page. Pure, so they can be tested.

const amountOf = (row) => Number(row.amount || 0)

export const sumAmounts = (rows) => rows.reduce((sum, row) => sum + amountOf(row), 0)

// Spending per main category, highest first, each with its share of the
// total in percent. `mainOf(categoryId)` gives the main category (or null
// for none); categories with nothing spent don't appear.
export function categoryTotals(expenses, mainOf) {
  const byKey = new Map()
  for (const e of expenses) {
    const main = mainOf(e.category_id)
    const key = main?.id ?? 'none'
    if (!byKey.has(key)) byKey.set(key, { key, id: main?.id ?? null, name: main?.name || 'Uncategorized', total: 0 })
    byKey.get(key).total += amountOf(e)
  }
  const total = sumAmounts(expenses)
  return [...byKey.values()]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, share: total > 0 ? (c.total / total) * 100 : 0 }))
}

// "12%", or "<1%" for a share too small to round to 1.
export function formatShare(share) {
  if (share > 0 && share < 1) return '<1%'
  return `${Math.round(share)}%`
}
