import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useExpenses() {
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])

  const fetchAll = useCallback(async () => {
    const [{ data: expenseData }, { data: categoryData }] = await Promise.all([
      supabase.from('expenses').select('*, expense_categories(name)').order('expense_date', { ascending: false }),
      supabase.from('expense_categories').select('*').order('name'),
    ])
    if (expenseData) setExpenses(expenseData)
    if (categoryData) setCategories(categoryData)
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

  const addExpense = useCallback(async ({ categoryId, amount, description, paidBy, expenseDate }) => {
    const { data, error } = await supabase
      .from('expenses')
      .insert([{ category_id: categoryId, amount, description, paid_by: paidBy, expense_date: expenseDate }])
      .select('*, expense_categories(name)')

    if (!error && data) setExpenses((prev) => [data[0], ...prev])
    return { error }
  }, [])

  const addCategory = useCallback(async (name, parentId = null) => {
    const { data, error } = await supabase
      .from('expense_categories')
      .insert([{ name, parent_id: parentId, type: parentId ? 'sub' : 'parent' }])
      .select()
    if (!error && data) {
      setCategories((prev) => [...prev, data[0]].sort((a, b) => a.name.localeCompare(b.name)))
    }
    return { data: data?.[0], error }
  }, [])

  // Deleting a category never loses expenses: they (and those in its
  // sub-categories) move to "Other" first, which is created if missing.
  const deleteCategory = useCallback(
    async (id) => {
      let other = categories.find((c) => c.name === 'Other' && !c.parent_id)
      if (!other) {
        const { data, error } = await supabase.from('expense_categories').insert([{ name: 'Other', type: 'parent' }]).select().single()
        if (error) return { error }
        other = data
      }
      if (other.id === id) return { error: { message: '"Other" holds moved expenses and can\'t be deleted.' } }

      const ids = [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)]
      const { error: moveError } = await supabase.from('expenses').update({ category_id: other.id }).in('category_id', ids)
      if (moveError) return { error: moveError }
      const { error } = await supabase.from('expense_categories').delete().in('id', ids)
      if (!error) await fetchAll()
      return { error }
    },
    [categories, fetchAll]
  )

  const deleteExpense = useCallback(async (id) => {
    await supabase.from('expenses').delete().eq('id', id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const deleteExpenses = useCallback(async (ids) => {
    await supabase.from('expenses').delete().in('id', ids)
    setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)))
  }, [])

  return { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense, deleteExpenses }
}
