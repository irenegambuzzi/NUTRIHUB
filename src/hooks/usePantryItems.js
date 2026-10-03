import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { changeStock, insertRows, logStockChange, normalizeItem, syncShoppingForItem, updateRows, upsertRows } from '../lib/inventory'

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
  'price',
  'price_qty',
  'price_unit',
  'payer',
  'last_purchased_at',
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
    if (data) setItems(data.map(normalizeItem))
  }, [])

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase.from('stock_logs').select('*').order('created_at', { ascending: false }).limit(1000)
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
    const { data: rows, error } = await insertRows('pantry_items', [pickFields(fields)])
    const data = rows?.[0]
    if (error || !data) return { error }
    setItems((prev) => [data, ...prev])
    await logStockChange(data, Number(data.current_stock), Number(data.current_stock), 'added')
    await syncShoppingForItem(data)
    return { data }
  }, [])

  const updateItem = useCallback(async (item, fields) => {
    const { current_stock: stock, ...patch } = pickFields(fields)
    let data = item
    if (Object.keys(patch).length) {
      const { data: rows, error } = await updateRows('pantry_items', item.id, patch)
      data = rows?.[0] && normalizeItem(rows[0])
      if (error || !data) return { error }
    }
    // The edited stock is applied as a change from what the form started
    // with, so a concurrent change by someone else isn't overwritten.
    const delta = stock == null ? 0 : Math.round((Number(stock) - Number(item.current_stock)) * 100) / 100
    if (delta) {
      const result = await changeStock(data, delta, 'edited')
      if (result.error) return { error: result.error }
      data = result.data
    } else {
      await syncShoppingForItem(data)
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))
    // A rename carries over to the item's open grocery entries.
    if (data.name !== item.name) {
      await supabase.from('grocery_items').update({ name: data.name }).eq('pantry_item_id', item.id).eq('completed', false)
    }
    return { data }
  }, [])

  const adjustStock = useCallback(async (item, delta, reason = delta > 0 ? 'restocked' : 'used') => {
    const { data, error } = await changeStock(item, Math.round(delta * 100) / 100, reason)
    if (error) return { error }
    setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))
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
      const { error } = await upsertRows('pantry_items', withId)
      if (error) return { error }
    }
    if (withoutId.length) {
      const { error } = await insertRows('pantry_items', withoutId)
      if (error) return { error }
    }
    const { data } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
    if (data) {
      setItems(data.map(normalizeItem))
      for (const item of data) await syncShoppingForItem(item)
    }
    return { error: null, count: rows.length }
  }, [])

  return { items, logs, addItem, updateItem, adjustStock, deleteItem, importItems }
}
