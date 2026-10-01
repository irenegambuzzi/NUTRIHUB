import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logStockChange, syncShoppingForItem } from '../lib/inventory'

export const ITEM_FIELDS = [
  'name',
  'category_id',
  'subcategory_id',
  'unit',
  'packaging_unit',
  'quantity_per_pack',
  'current_stock',
  'min_stock',
  'expiry_date',
  'batch_lot',
  'notes',
]

function pickFields(source) {
  const out = {}
  for (const f of ITEM_FIELDS) if (f in source) out[f] = source[f] === '' ? null : source[f]
  return out
}

export function usePantryItems() {
  const [items, setItems] = useState([])
  const [logs, setLogs] = useState([])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
    if (data) setItems(data)
  }, [])

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase.from('stock_logs').select('*').order('created_at', { ascending: false }).limit(200)
    if (data) setLogs(data)
  }, [])

  useEffect(() => {
    fetchItems()
    fetchLogs()
    const channel = supabase
      .channel(`pantry_items-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pantry_items' }, fetchItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_logs' }, fetchLogs)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchItems, fetchLogs])

  const addItem = useCallback(async (fields) => {
    const { data, error } = await supabase.from('pantry_items').insert([pickFields(fields)]).select().single()
    if (error || !data) return { error }
    setItems((prev) => [data, ...prev])
    await logStockChange(data, Number(data.current_stock), Number(data.current_stock), 'added')
    await syncShoppingForItem(data)
    return { data }
  }, [])

  const updateItem = useCallback(async (item, fields) => {
    const patch = pickFields(fields)
    const { data, error } = await supabase.from('pantry_items').update(patch).eq('id', item.id).select().single()
    if (error || !data) return { error }
    setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))
    const change = Number(data.current_stock) - Number(item.current_stock)
    await logStockChange(data, change, Number(data.current_stock), 'edited')
    await syncShoppingForItem(data)
    return { data }
  }, [])

  const adjustStock = useCallback(async (item, delta, reason = delta > 0 ? 'restocked' : 'used') => {
    const newStock = Math.max(0, Math.round((Number(item.current_stock) + delta) * 100) / 100)
    const { error } = await supabase.from('pantry_items').update({ current_stock: newStock }).eq('id', item.id)
    if (error) return { error }
    const updated = { ...item, current_stock: newStock }
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    await logStockChange(updated, newStock - Number(item.current_stock), newStock, reason)
    await syncShoppingForItem(updated)
    return { error: null }
  }, [])

  const deleteItem = useCallback(async (id) => {
    await supabase.from('pantry_items').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // Restore/import: rows with an id overwrite that item, rows without
  // one are added as new items.
  const importItems = useCallback(async (rows) => {
    const withId = rows.filter((r) => r.id).map((r) => ({ id: r.id, ...pickFields(r) }))
    const withoutId = rows.filter((r) => !r.id).map(pickFields)
    if (withId.length) {
      const { error } = await supabase.from('pantry_items').upsert(withId)
      if (error) return { error }
    }
    if (withoutId.length) {
      const { error } = await supabase.from('pantry_items').insert(withoutId)
      if (error) return { error }
    }
    const { data } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
    if (data) {
      setItems(data)
      for (const item of data) await syncShoppingForItem(item)
    }
    return { error: null, count: rows.length }
  }, [])

  return { items, logs, addItem, updateItem, adjustStock, deleteItem, importItems }
}
