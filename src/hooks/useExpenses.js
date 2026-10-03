import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'

export function useExpenses() {
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])

  const fetchAll = useCallback(async function fetchAll() {
    const [expenseResult, categoryResult] = await Promise.all([
      supabase.from('expenses').select('*, expense_categories(name)').order('expense_date', { ascending: false }),
      supabase.from('expense_categories').select('*').order('name'),
    ])
    const error = expenseResult.error || categoryResult.error
    if (error) return toastLoadError(error, fetchAll, 'expenses')
    setExpenses(expenseResult.data)
    setCategories(categoryResult.data)
  }, [])

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel(`expenses-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_categories' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchAll])

  const addExpense = useCallback(
    ({ categoryId, amount, description, paidBy, expenseDate }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('expenses')
              .insert([{ category_id: categoryId, amount, description, paid_by: paidBy, expense_date: expenseDate }])
              .select('*, expense_categories(name)')
          )
          setExpenses((prev) => [rows[0], ...prev])
        },
        { retry: false }
      ),
    []
  )

  const addCategory = useCallback(async (name, parentId = null) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('expense_categories').insert([{ name, parent_id: parentId, type: parentId ? 'sub' : 'parent' }]).select())[0],
      { retry: false }
    )
    if (!error) setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return { data, error }
  }, [])

  // Deleting a category never loses expenses: they (and those in its
  // sub-categories) move to "Other" first, which is created if missing.
  const deleteCategory = useCallback(
    async (id) => {
      const other = categories.find((c) => c.name === 'Other' && !c.parent_id)
      if (other?.id === id) return { error: { message: '"Other" holds moved expenses and can\'t be deleted.' } }
      const ids = [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)]
      const result = await attempt(
        async () => {
          const target =
            other ?? must(await supabase.from('expense_categories').insert([{ name: 'Other', type: 'parent' }]).select().single())
          must(await supabase.from('expenses').update({ category_id: target.id }).in('category_id', ids))
          must(await supabase.from('expense_categories').delete().in('id', ids))
        },
        { retry: false, onFail: fetchAll }
      )
      if (!result.error) await fetchAll()
      return result
    },
    [categories, fetchAll]
  )

  // Deletes right away; Undo puts the expenses back exactly and re-links
  // the grocery entries that pointed to them (the database unlinks them).
  const deleteExpenses = useCallback(
    (ids, message = ids.length === 1 ? 'Expense deleted' : `${ids.length} expenses deleted`) =>
      deleteWithUndo({
        message,
        remove: async () => {
          const links = must(await supabase.from('grocery_items').select('id, expense_id').in('expense_id', ids))
          const rows = must(await supabase.from('expenses').delete().in('id', ids).select())
          setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)))
          return { rows, links }
        },
        restore: async ({ rows, links }) => {
          if (rows.length) must(await supabase.from('expenses').upsert(rows))
          for (const link of links) must(await supabase.from('grocery_items').update({ expense_id: link.expense_id }).eq('id', link.id))
          await fetchAll()
        },
        onFail: fetchAll,
      }),
    [fetchAll]
  )

  const deleteExpense = useCallback((id) => deleteExpenses([id]), [deleteExpenses])

  return { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense, deleteExpenses }
}
