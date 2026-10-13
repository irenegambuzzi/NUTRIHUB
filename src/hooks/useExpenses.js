import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, inSteps, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { updateRows } from '../lib/inventory'
import { unitPriceFromTotal } from '../lib/pricing'
import { allExpenseStores, currentExpensesSince, expenseCategoryStore, expensesInCategory, expensesSince, groceryStore, orderStore, shopStore } from '../lib/stores'
import { emptyStore, isMissingTable } from '../lib/tableStore'
import { shopsAvailable } from '../lib/shops'

const refreshExpenses = () => Promise.all(allExpenseStores().map((s) => s.refresh()))
const refreshOrders = () => (orderStore.isStarted() ? orderStore.refresh() : null)

// The store column is only sent once stores exist in the database
// (supabase/019); `shopId` undefined leaves an expense's store alone.
const shopField = (shopId) => (shopId !== undefined && shopsAvailable(shopStore.getSnapshot()) ? { shop_id: shopId || null } : {})

// The orders linked to these expenses ([] before supabase/019).
async function ordersLinkedTo(expenseIds) {
  const { data, error } = await supabase.from('orders').select('id, expense_id').in('expense_id', expenseIds)
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data
}

// Expense categories, and adding, renaming, moving and removing them.
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

  // Same category, new name: its id (so its color, sub-categories and
  // expenses) is untouched.
  const renameCategory = useCallback(async (id, name) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('expense_categories').update({ name }).eq('id', id).select())[0],
      { retry: false, onFail: () => expenseCategoryStore.refresh() }
    )
    if (!error && data) expenseCategoryStore.upsertLocal([data])
    return { data, error }
  }, [])

  // Under another main category (parentId) or as a main category (null).
  // Only the category's own row changes: its expenses stay attached.
  const moveCategory = useCallback(async (id, parentId) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('expense_categories').update({ parent_id: parentId, type: parentId ? 'sub' : 'parent' }).eq('id', id).select())[0],
      { retry: false, onFail: () => expenseCategoryStore.refresh() }
    )
    if (!error && data) expenseCategoryStore.upsertLocal([data])
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
          // Orders keep their category too (they are about to lose it).
          const moved = await supabase.from('orders').update({ category_id: target.id }).in('category_id', ids)
          if (moved.error && !isMissingTable(moved.error)) throw moved.error
          must(await supabase.from('expense_categories').delete().in('id', ids))
        },
        { retry: false, onFail: refreshAll }
      )
      if (!result.error) await Promise.all([refreshAll(), refreshOrders()])
      return result
    },
    [categories]
  )

  return { categories, addCategory, renameCategory, moveCategory, deleteCategory }
}

// Deletes right away; Undo puts the expenses back exactly and re-links
// the grocery entries and orders that pointed to them (the database
// unlinks them).
export function deleteExpenses(ids, message = ids.length === 1 ? 'Expense deleted' : `${ids.length} expenses deleted`) {
  const refreshBoth = () => Promise.all([refreshExpenses(), refreshOrders()])
  return deleteWithUndo({
    message,
    remove: async () => {
      const links = must(await supabase.from('grocery_items').select('id, expense_id').in('expense_id', ids))
      const orderLinks = await ordersLinkedTo(ids)
      const rows = must(await supabase.from('expenses').delete().in('id', ids).select())
      allExpenseStores().forEach((s) => s.removeLocal(ids))
      if (orderLinks.length) await refreshOrders()
      return { rows, links, orderLinks }
    },
    restore: async ({ rows, links, orderLinks }) => {
      if (rows.length) must(await supabase.from('expenses').upsert(rows))
      for (const link of links) must(await supabase.from('grocery_items').update({ expense_id: link.expense_id }).eq('id', link.id))
      for (const link of orderLinks) must(await supabase.from('orders').update({ expense_id: link.expense_id }).eq('id', link.id))
      await refreshBoth()
    },
    onFail: refreshBoth,
  })
}

// Expenses from `since` on (by default the start of this week, month and
// year: what the Expenses page opens on), plus the categories.
export function useExpenses(since = currentExpensesSince()) {
  const { rows: expenses } = expensesSince(since).useRows()
  const { categories, addCategory, renameCategory, moveCategory, deleteCategory } = useExpenseCategories()

  const addExpense = useCallback(
    ({ categoryId, amount, description, paidBy, expenseDate, shopId }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('expenses')
              .insert([{ category_id: categoryId, amount, description, paid_by: paidBy, expense_date: expenseDate, ...shopField(shopId) }])
              .select()
          )
          allExpenseStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false }
      ),
    []
  )

  // Saves every field of an existing expense in place (same row, same id).
  const updateExpense = useCallback(
    (id, { categoryId, amount, description, paidBy, expenseDate, shopId }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('expenses')
              .update({ category_id: categoryId, amount, description, paid_by: paidBy, expense_date: expenseDate, ...shopField(shopId) })
              .eq('id', id)
              .select()
          )
          allExpenseStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false, onFail: refreshExpenses }
      ),
    []
  )

  const deleteExpense = useCallback((id) => deleteExpenses([id]), [])

  return { expenses, categories, addExpense, updateExpense, addCategory, renameCategory, moveCategory, deleteCategory, deleteExpense, deleteExpenses }
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


// Several expenses (e.g. old ones, from before stores) get one store, or
// none. Only their store changes. Undo puts back each one's own store.
export async function setExpensesShop(ids, shopId) {
  const result = await attempt(
    async () => {
      const before = must(await supabase.from('expenses').select('id, shop_id').in('id', ids))
      const rows = must(await supabase.from('expenses').update({ shop_id: shopId || null }).in('id', ids).select())
      allExpenseStores().forEach((s) => s.upsertLocal(rows))
      return before
    },
    { onFail: refreshExpenses }
  )
  if (result.error) return result
  const before = result.data
  const undo = () =>
    attempt(
      async () => {
        for (const shop of new Set(before.map((e) => e.shop_id ?? null))) {
          const same = before.filter((e) => (e.shop_id ?? null) === shop).map((e) => e.id)
          must(await supabase.from('expenses').update({ shop_id: shop }).in('id', same))
        }
        await refreshExpenses()
      },
      { onFail: refreshExpenses }
    )
  showToast({ message: `Store set for ${ids.length} expense${ids.length === 1 ? '' : 's'}`, duration: 8000, action: { label: 'Undo', onClick: undo } })
  return result
}
