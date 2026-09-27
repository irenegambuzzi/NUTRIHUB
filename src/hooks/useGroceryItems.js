import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { GROCERY_TO_PANTRY_CATEGORY } from '../data/constants'

async function getGroceriesCategoryId() {
  const { data } = await supabase.from('expense_categories').select('id').eq('name', 'Groceries').maybeSingle()
  return data?.id ?? null
}

export function useGroceryItems() {
  const [items, setItems] = useState([])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('grocery_items').select('*').order('created_at', { ascending: false })
    if (data) setItems(data)
  }, [])

  useEffect(() => {
    fetchItems()
    const channel = supabase
      .channel(`grocery_items-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, fetchItems)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchItems])

  const addItem = useCallback(async ({ name, category, price, quantity = 1, unit = 'pcs' }) => {
    const { data, error } = await supabase
      .from('grocery_items')
      .insert([{ name, category, price: price || 0, quantity, unit, completed: false }])
      .select()

    if (!error && data) setItems((prev) => [data[0], ...prev])
    return { error }
  }, [])

  // Checking off an item logs it as a Groceries expense (if priced)
  // and merges its quantity into the matching pantry item. Unchecking
  // removes that expense again.
  const toggleComplete = useCallback(async (item) => {
    const completed = !item.completed

    if (!completed) {
      await supabase.from('grocery_items').update({ completed, expense_id: null }).eq('id', item.id)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: null } : i)))
      if (item.expense_id) await supabase.from('expenses').delete().eq('id', item.expense_id)
      return
    }

    let expenseId = item.expense_id ?? null
    if (Number(item.price) > 0) {
      const categoryId = await getGroceriesCategoryId()
      const { data } = await supabase
        .from('expenses')
        .insert([{ category_id: categoryId, amount: item.price, description: item.name, paid_by: 'shared' }])
        .select()
        .single()
      expenseId = data?.id ?? null
    }

    await supabase.from('grocery_items').update({ completed, expense_id: expenseId }).eq('id', item.id)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: expenseId } : i)))

    const pantryCategory = GROCERY_TO_PANTRY_CATEGORY[item.category] || 'Home'
    const { data: existing } = await supabase.from('pantry_items').select('*').ilike('name', item.name).maybeSingle()

    if (existing) {
      await supabase
        .from('pantry_items')
        .update({ quantity: Number(existing.quantity) + Number(item.quantity || 1), status: 'ok' })
        .eq('id', existing.id)
    } else {
      await supabase.from('pantry_items').insert([
        {
          name: item.name,
          category: pantryCategory,
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          status: 'ok',
        },
      ])
    }
  }, [])

  // Editing the price after the item is already checked off keeps the
  // linked expense in sync instead of leaving it stuck at whatever it
  // was worth at check-off time (or never created at all).
  const updatePrice = useCallback(async (item, price) => {
    await supabase.from('grocery_items').update({ price }).eq('id', item.id)

    let expenseId = item.expense_id ?? null

    if (item.completed) {
      if (price > 0) {
        if (expenseId) {
          await supabase.from('expenses').update({ amount: price }).eq('id', expenseId)
        } else {
          const categoryId = await getGroceriesCategoryId()
          const { data } = await supabase
            .from('expenses')
            .insert([{ category_id: categoryId, amount: price, description: item.name, paid_by: 'shared' }])
            .select()
            .single()
          expenseId = data?.id ?? null
          await supabase.from('grocery_items').update({ expense_id: expenseId }).eq('id', item.id)
        }
      } else if (expenseId) {
        await supabase.from('expenses').delete().eq('id', expenseId)
        expenseId = null
        await supabase.from('grocery_items').update({ expense_id: null }).eq('id', item.id)
      }
    }

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, price, expense_id: expenseId } : i)))
    return { error: null }
  }, [])

  const deleteItem = useCallback(async (id) => {
    await supabase.from('grocery_items').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clearCompleted = useCallback(async () => {
    await supabase.from('grocery_items').delete().eq('completed', true)
    setItems((prev) => prev.filter((i) => !i.completed))
  }, [])

  return { items, addItem, toggleComplete, updatePrice, deleteItem, clearCompleted }
}
