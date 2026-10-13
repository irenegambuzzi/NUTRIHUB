import { supabase } from './supabaseClient'
import { must } from './db'
import { isMissingTable } from './tableStore'
import { budgetCategoryFor } from './budgetMap'

// What a purchase needs to pick budget categories, read fresh from the
// database at the moment of buying: the expense categories, the item
// categories and the mapping (empty before supabase/021, so purchases are
// booked exactly as before). `flowReady`: supabase/021 has been run.
export async function loadBudgetContext() {
  const expenseCategories = must(await supabase.from('expense_categories').select('id, name, parent_id'))
  const inventoryCategories = must(await supabase.from('inventory_categories').select('id, name, parent_id'))
  const map = await supabase.from('category_budget_map').select('id, expense_category_id')
  if (map.error && !isMissingTable(map.error)) throw map.error
  return { expenseCategories, inventoryCategories, mapRows: map.error ? [] : map.data, flowReady: !map.error }
}

// (item) → budget category id, for items being bought now.
export async function budgetResolver() {
  const ctx = await loadBudgetContext()
  return { ctx, budgetFor: (item) => budgetCategoryFor(item, ctx) }
}
