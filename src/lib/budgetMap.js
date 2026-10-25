import { DURABLE_EXPENSE_CATEGORY } from '../data/constants'
import { isDurable, pickDurableCategory } from './inventory'
import { isChosenOnPurpose } from './durable'

// Item category (what kind of product, in HOME and SHOP) → budget category
// (what the money was for, in MONEY). Pure, so it can be tested.
//
// category_budget_map (supabase/021) holds only what was chosen by hand:
// a row { id: item category or sub-category id, expense_category_id }.
// Everything else is booked as the app always has: Groceries, or for
// appliances the "Home & Appliances" sub-category named like the item's
// sub-category (else Home & Appliances itself).

export const GROCERIES = 'Groceries'

// The budget category the app used before any mapping: the default.
// `expenseCategories` [{ id, name, parent_id }], `inventoryCategories`
// [{ id, name }] (as stored). Throws, as before, when an appliance can't
// be booked because "Home & Appliances" is missing.
export function defaultBudgetCategory(item, { expenseCategories, inventoryCategories }) {
  if (isDurable(item)) {
    const subName = item.subcategory_id ? inventoryCategories.find((c) => c.id === item.subcategory_id)?.name ?? null : null
    const names = [DURABLE_EXPENSE_CATEGORY, subName].filter(Boolean)
    return pickDurableCategory(
      expenseCategories.filter((c) => names.includes(c.name)),
      subName
    )
  }
  return expenseCategories.find((c) => c.name === GROCERIES)?.id ?? null
}

// What was chosen for an item category or sub-category, if it still exists.
function chosen(id, mapRows, expenseCategories) {
  if (!id) return null
  const target = mapRows.find((r) => r.id === id)?.expense_category_id
  return target && expenseCategories.some((c) => c.id === target) ? target : null
}

// The budget category for something bought: { category_id,
// subcategory_id } of a HOME item or SHOP entry. The sub-category's
// choice first, then its main category's, then the default.
export function budgetCategoryFor(item, { mapRows = [], expenseCategories, inventoryCategories }) {
  return (
    chosen(item.subcategory_id, mapRows, expenseCategories) ??
    chosen(item.category_id, mapRows, expenseCategories) ??
    defaultBudgetCategory(item, { expenseCategories, inventoryCategories })
  )
}

// For the mapping editor: where an item category (or sub-category) is
// booked now. { target, source }: source 'own' (chosen for it), 'main'
// (follows its main category's choice) or 'default'. A sub-category of
// appliances defaults to its own Home & Appliances sub-category.
export function effectiveBudget(category, ctx) {
  const { mapRows = [], expenseCategories } = ctx
  const own = chosen(category.id, mapRows, expenseCategories)
  if (own) return { target: own, source: 'own' }
  const item = category.parent_id ? { category_id: category.parent_id, subcategory_id: category.id } : { category_id: category.id, subcategory_id: null }
  const main = category.parent_id ? chosen(category.parent_id, mapRows, expenseCategories) : null
  if (main) return { target: main, source: 'main' }
  let target = null
  try {
    target = defaultBudgetCategory(item, ctx)
  } catch {
    target = null
  }
  return { target, source: 'default' }
}

// "Apply the mapping to past purchases": the expenses whose budget
// category would change. `expenses` [{ id, category_id, amount }];
// `itemOf(expenseId)` → the { category_id, subcategory_id } of what was
// bought, or null when the expense isn't from a purchase (left alone).
// Also left alone (plan 9F): what was bought without a HOME category (it
// says nothing about where it belongs — a durable bought from SHOP before
// it had one would go to Groceries), and an expense whose budget category
// was chosen on purpose (Work, Family Support, Trips & Holidays and their
// subs, e.g. a SHOP purchase changed to Work by hand in MONEY).
// Returns { changes: [{ expense, from, to }], summary: [{ from, to,
// count, total }] } (biggest moves first).
export function pastPurchaseChanges(expenses, itemOf, ctx) {
  const changes = []
  for (const expense of expenses) {
    const item = itemOf(expense.id)
    if (!item?.category_id) continue
    if (isChosenOnPurpose(expense.category_id, ctx.expenseCategories)) continue
    let to = null
    try {
      to = budgetCategoryFor(item, ctx)
    } catch {
      continue
    }
    if (!to || to === expense.category_id) continue
    changes.push({ expense, from: expense.category_id ?? null, to })
  }
  const byMove = new Map()
  for (const c of changes) {
    const key = `${c.from}>${c.to}`
    if (!byMove.has(key)) byMove.set(key, { from: c.from, to: c.to, count: 0, total: 0 })
    const m = byMove.get(key)
    m.count += 1
    m.total = Math.round((m.total + Number(c.expense.amount || 0)) * 100) / 100
  }
  return { changes, summary: [...byMove.values()].sort((a, b) => b.count - a.count || b.total - a.total) }
}

// For "Apply the mapping to past purchases": expense id → the { category_id,
// subcategory_id } of what was bought. From orders (`orderItems`: [expense
// id, HOME item]), SHOP entries checked off (`groceries`) and purchase
// lines (`tripLines`, as bought then: their snapshot). Only SHOP lines
// count (decision 18, supabase/023): a line typed in MONEY had its budget
// category chosen in the form, so the mapping never moves it — not even
// through the SHOP entry it took off the list.
export function purchasedItemsByExpense({ orderItems = [], groceries = [], tripLines = [] }) {
  const byExpense = new Map()
  for (const [expenseId, item] of orderItems) byExpense.set(expenseId, item)
  for (const g of groceries) byExpense.set(g.expense_id, { category_id: g.category_id, subcategory_id: g.subcategory_id })
  for (const t of tripLines) {
    if ((t.line_kind ?? 'shop') !== 'shop') {
      byExpense.delete(t.expense_id)
      continue
    }
    const snap = t.grocery_snapshot ?? {}
    byExpense.set(t.expense_id, { category_id: snap.category_id ?? null, subcategory_id: snap.subcategory_id ?? null })
  }
  return byExpense
}
