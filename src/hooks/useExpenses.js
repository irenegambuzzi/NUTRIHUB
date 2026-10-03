import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, inSteps, must } from '../lib/db'
import { updateRows } from '../lib/inventory'
import { unitPriceFromTotal } from '../lib/pricing'
import { allExpenseStores, currentExpensesSince, expenseCategoryStore, expensesInCategory, expensesSince, groceryStore } from '../lib/stores'
import { emptyStore } from '../lib/tableStore'

const refreshExpenses = () => Promise.all(allExpenseStores().map((s) => s.refresh()))

// Expense categories, and adding/removing them.
export function useExpenseCategories() {
  const { rows: categories } = expenseCategoryStore.useRows()

  const addCategory = useCallback(async (name, parentId = null) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('expense_categories').insert([{ name, parent_id: parentId, type: parentId ? 'sub' : 'parent' }]).select())[0],
      { retry: false }
    )
    if (!error) expenseCategoryStore.upsertLocal([data])
    return { data, error }
  }, [])

  // Deleting a category never loses expenses: they (and those in its
  // sub-categories) move to "Other" first, which is created if missing.
  const deleteCategory = useCallback(
    async (id) => {
      const other = categories.find((c) => c.name === 'Other' && !c.parent_id)
      if (other?.id === id) return { error: { message: '"Other" holds moved expenses and can\'t be deleted.' } }
      const ids = [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)]
      const refreshAll = () => Promise.all([expenseCategoryStore.refresh(), refreshExpenses()])
      const result = await attempt(
        async () => {
          const target =
            other ?? must(await supabase.from('expense_categories').insert([{ name: 'Other', type: 'parent' }]).select().single())
          must(await supabase.from('expenses').update({ category_id: target.id }).in('category_id', ids))
          must(await supabase.from('expense_categories').delete().in('id', ids))
        },
        { retry: false, onFail: refreshAll }
      )
      if (!result.error) await refreshAll()
      return result
    },
    [categories]
  )

  return { categories, addCategory, deleteCategory }
}

// Deletes right away; Undo puts the expenses back exactly and re-links
// the grocery entries that pointed to them (the database unlinks them).
export function deleteExpenses(ids, message = ids.length === 1 ? 'Expense deleted' : `${ids.length} expenses deleted`) {
  return deleteWithUndo({
    message,
    remove: async () => {
      const links = must(await supabase.from('grocery_items').select('id, expense_id').in('expense_id', ids))
      const rows = must(await supabase.from('expenses').delete().in('id', ids).select())
      allExpenseStores().forEach((s) => s.removeLocal(ids))
      return { rows, links }
    },
    restore: async ({ rows, links }) => {
      if (rows.length) must(await supabase.from('expenses').upsert(rows))
      for (const link of links) must(await supabase.from('grocery_items').update({ expense_id: link.expense_id }).eq('id', link.id))
      await refreshExpenses()
    },
    onFail: refreshExpenses,
  })
}

// This week's, month's and year's expenses (what the Expenses page can
// show), plus the categories.
export function useExpenses() {
  const { rows: expenses } = expensesSince(currentExpensesSince()).useRows()
  const { categories, addCategory, deleteCategory } = useExpenseCategories()

  const addExpense = useCallback(
    ({ categoryId, amount, description, paidBy, expenseDate }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('expenses')
              .insert([{ category_id: categoryId, amount, description, paid_by: paidBy, expense_date: expenseDate }])
              .select()
          )
          allExpenseStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false }
      ),
    []
  )

  const deleteExpense = useCallback((id) => deleteExpenses([id]), [])

  return { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense, deleteExpenses }
}

// Every expense in one category (the Groceries receipts); nothing is
// loaded until a component uses it.
export function useCategoryExpenses(categoryId) {
  const { rows: expenses, loaded } = (categoryId ? expensesInCategory(categoryId) : emptyStore).useRows()
  return { expenses, loaded }
}

// A receipt line's price, edited while checking a receipt: the expense
// takes the new amount and, if the grocery entry it came from is still on
// the list, that entry's unit price follows (so its line total matches).
// `pack` is the entry's pantry item, for unit conversions. Both are saved
// together, or neither.
export function setReceiptLineAmount(expense, amount, groceryItem = null, pack = null) {
  return attempt(
    () =>
      inSteps(async (onFail) => {
        must(await supabase.from('expenses').update({ amount }).eq('id', expense.id))
        onFail(async () => must(await supabase.from('expenses').update({ amount: expense.amount }).eq('id', expense.id)))
        if (groceryItem) {
          const price = unitPriceFromTotal(amount, groceryItem, pack)
          if (price != null) {
            must(await updateRows('grocery_items', groceryItem.id, { price }))
            groceryStore.patchLocal([groceryItem.id], { price })
          }
        }
        allExpenseStores().forEach((s) => s.patchLocal([expense.id], { amount }))
      }),
    { retry: false, onFail: refreshExpenses }
  )
}

