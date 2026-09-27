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

  const addCategory = useCallback(async (name) => {
    const { data, error } = await supabase.from('expense_categories').insert([{ name }]).select()
    if (!error && data) {
      setCategories((prev) => [...prev, data[0]].sort((a, b) => a.name.localeCompare(b.name)))
    }
    return { data: data?.[0], error }
  }, [])

  const deleteExpense = useCallback(async (id) => {
    await supabase.from('expenses').delete().eq('id', id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const deleteExpenses = useCallback(async (ids) => {
    await supabase.from('expenses').delete().in('id', ids)
    setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)))
  }, [])

  return { expenses, categories, addExpense, addCategory, deleteExpense, deleteExpenses }
}
