import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function usePantryItems() {
  const [items, setItems] = useState([])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
    if (data) setItems(data)
  }, [])

  useEffect(() => {
    fetchItems()
    const channel = supabase
      .channel(`pantry_items-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pantry_items' }, fetchItems)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchItems])

  const addItem = useCallback(async ({ name, category, status = 'ok', quantity = 1, unit = 'pcs' }) => {
    const { data, error } = await supabase.from('pantry_items').insert([{ name, category, status, quantity, unit }]).select()
    if (!error && data) setItems((prev) => [data[0], ...prev])
    return { data: data?.[0], error }
  }, [])

  const toggleStatus = useCallback(async (id, currentStatus) => {
    const status = currentStatus === 'ok' ? 'out' : 'ok'
    await supabase.from('pantry_items').update({ status }).eq('id', id)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
  }, [])

  const deleteItem = useCallback(async (id) => {
    await supabase.from('pantry_items').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  return { items, addItem, toggleStatus, deleteItem }
}
