import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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

  const addItem = useCallback(async ({ name, category, price }) => {
    const { data, error } = await supabase
      .from('grocery_items')
      .insert([{ name, category, price: price || 0, completed: false }])
      .select()

    if (!error && data) setItems((prev) => [data[0], ...prev])
    return { error }
  }, [])

  // Checking off an item with a price logs it as a Groceries expense.
  const toggleComplete = useCallback(async (item) => {
    const completed = !item.completed
    await supabase.from('grocery_items').update({ completed }).eq('id', item.id)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed } : i)))

    if (completed && Number(item.price) > 0) {
      const { data: category } = await supabase
        .from('expense_categories')
        .select('id')
        .eq('name', 'Groceries')
        .maybeSingle()

      await supabase.from('expenses').insert([
        {
          category_id: category?.id ?? null,
          amount: item.price,
          description: item.name,
          paid_by: 'shared',
        },
      ])
    }
  }, [])

  const deleteItem = useCallback(async (id) => {
    await supabase.from('grocery_items').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clearCompleted = useCallback(async () => {
    await supabase.from('grocery_items').delete().eq('completed', true)
    setItems((prev) => prev.filter((i) => !i.completed))
  }, [])

  return { items, addItem, toggleComplete, deleteItem, clearCompleted }
}
