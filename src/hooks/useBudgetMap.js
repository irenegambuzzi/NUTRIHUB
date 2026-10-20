import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { allExpenseStores, budgetMapStore } from '../lib/stores'
import { loadBudgetContext } from '../lib/budgetContext'
import { pastPurchaseChanges, purchasedItemsByExpense } from '../lib/budgetMap'

const refreshExpenses = () => Promise.all(allExpenseStores().map((s) => s.refresh()))

// Item category (or sub-category) `id` → budget category, chosen by hand;
// `expenseCategoryId` null goes back to the default (nothing stored).
// Only future purchases follow it.
export function setBudgetMapping(id, expenseCategoryId) {
  return attempt(
    async () => {
      if (!expenseCategoryId) {
        must(await supabase.from('category_budget_map').delete().eq('id', id))
        budgetMapStore.removeLocal([id])
        return
      }
      const rows = must(
        await supabase
          .from('category_budget_map')
          .upsert([{ id, expense_category_id: expenseCategoryId, updated_at: new Date().toISOString() }], { onConflict: 'id' })
          .select()
      )
      budgetMapStore.upsertLocal(rows)
    },
    { onFail: () => budgetMapStore.refresh() }
  )
}

// Every row of a query, 1000 at a time (the most one request returns).
async function allRows(make) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const page = must(await make().range(from, from + 999))
    out.push(...page)
    if (page.length < 1000) return out
  }
}

// Ids in groups small enough for one request.
const chunks = (ids, size = 150) => Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size))

// For "Apply the mapping to past purchases": every expense that came from a
// purchase — a confirmed SHOP trip, an item checked off on the list
// before trips, or an order made from the SHOP list — with the item
// category of what was bought, and what the mapping would change. Nothing
// is changed here. Returns { changes, summary } (see pastPurchaseChanges).
export async function previewPastPurchases() {
  const ctx = await loadBudgetContext()
  const orderItems = []
  const orders = await supabase.from('orders').select('expense_id, pantry_item_id').not('expense_id', 'is', null).not('pantry_item_id', 'is', null)
  if (!orders.error && orders.data.length) {
    const pantryIds = [...new Set(orders.data.map((o) => o.pantry_item_id))]
    const items = new Map()
    for (const ids of chunks(pantryIds)) for (const p of must(await supabase.from('pantry_items').select('id, category_id, subcategory_id').in('id', ids))) items.set(p.id, p)
    for (const o of orders.data) if (items.has(o.pantry_item_id)) orderItems.push([o.expense_id, items.get(o.pantry_item_id)])
  }
  const groceries = await allRows(() => supabase.from('grocery_items').select('id, expense_id, category_id, subcategory_id').not('expense_id', 'is', null).order('id'))
  const tripLines = await allRows(() => supabase.from('shopping_trip_items').select('id, expense_id, grocery_snapshot, line_kind').not('expense_id', 'is', null).order('id'))
  const itemByExpense = purchasedItemsByExpense({ orderItems, groceries, tripLines })
  const expenses = []
  for (const ids of chunks([...itemByExpense.keys()])) expenses.push(...must(await supabase.from('expenses').select('id, category_id, amount, description, expense_date').in('id', ids)))
  return { ...pastPurchaseChanges(expenses, (id) => itemByExpense.get(id) ?? null, ctx), expenseCategories: ctx.expenseCategories }
}

// Moves each listed expense to its new budget category; Undo puts every
// one back where it was. `changes`: [{ expense, from, to }].
export async function applyPastPurchases(changes) {
  const move = async (pairs) => {
    const byTarget = new Map()
    for (const [id, target] of pairs) byTarget.set(target, [...(byTarget.get(target) ?? []), id])
    for (const [target, ids] of byTarget) for (const part of chunks(ids)) must(await supabase.from('expenses').update({ category_id: target }).in('id', part))
  }
  const result = await attempt(() => move(changes.map((c) => [c.expense.id, c.to])), { onFail: refreshExpenses, retry: false })
  await refreshExpenses()
  if (result.error) return result
  const undo = () =>
    attempt(
      async () => {
        await move(changes.map((c) => [c.expense.id, c.from]))
        await refreshExpenses()
      },
      { onFail: refreshExpenses }
    )
  showToast({ message: `${changes.length} past purchase${changes.length === 1 ? '' : 's'} moved to their mapped budget category`, duration: 10000, action: { label: 'Undo', onClick: undo } })
  return result
}
