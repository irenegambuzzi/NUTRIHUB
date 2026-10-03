import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { afterStockChange, changeStock, insertRows, normalizeItem, syncShoppingForItem, updateRows, upsertRows } from '../lib/inventory'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { showToast, toastLoadError } from '../lib/feedback'

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

  const fetchItems = useCallback(async function fetchItems() {
    const { data, error } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
    if (error) return toastLoadError(error, fetchItems, 'pantry_items')
    setItems(data.map(normalizeItem))
  }, [])

  const fetchLogs = useCallback(async function fetchLogs() {
    const { data, error } = await supabase.from('stock_logs').select('*').order('created_at', { ascending: false }).limit(1000)
    if (error) return toastLoadError(error, fetchLogs, 'stock_logs')
    setLogs(data)
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
    const { data, error } = await attempt(async () => must(await insertRows('pantry_items', [pickFields(fields)]))[0], { retry: false })
    if (error) return { error }
    setItems((prev) => [data, ...prev])
    const stock = Number(data.current_stock)
    await afterStockChange(data, stock, stock, 'added')
    return { data }
  }, [])

  // Saved from the item editor. The field changes and the stock change
  // are saved together (the fields are put back if the stock fails).
  const updateItem = useCallback(
    async (item, fields) => {
      const { current_stock: stock, ...patch } = pickFields(fields)
      // The edited stock is applied as a change from what the form started
      // with, so a concurrent change by someone else isn't overwritten.
      const delta = stock == null ? 0 : Math.round((Number(stock) - Number(item.current_stock)) * 100) / 100
      const { data, error } = await attempt(
        () =>
          inSteps(async (onFail) => {
            let saved = item
            if (Object.keys(patch).length) {
              saved = normalizeItem(must(await updateRows('pantry_items', item.id, patch))[0])
              const original = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k] ?? null]))
              onFail(async () => must(await updateRows('pantry_items', item.id, original)))
            }
            return delta ? changeStock(saved, delta, 'edited') : saved
          }),
        { retry: false, onFail: fetchItems }
      )
      if (error) return { error }
      setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))
      if (!delta) await followUp('the shopping list', () => syncShoppingForItem(data))
      // A rename carries over to the item's open grocery entries.
      if (data.name !== item.name) {
        await followUp('the shopping list', async () =>
          must(await supabase.from('grocery_items').update({ name: data.name }).eq('pantry_item_id', item.id).eq('completed', false))
        )
      }
      return { data }
    },
    [fetchItems]
  )

  const adjustStock = useCallback(
    async (item, delta, reason = delta > 0 ? 'restocked' : 'used') => {
      const { data, error } = await attempt(() => changeStock(item, Math.round(delta * 100) / 100, reason), { onFail: fetchItems })
      if (error) return { error }
      setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))
      return { error: null }
    },
    [fetchItems]
  )

  // Throws away an expired item's stock (logged as "discarded") and
  // clears its expiry date, which described the stock that's gone. Undo
  // puts both back.
  const discardExpired = useCallback(
    async (item) => {
      const amount = Number(item.current_stock) || 0
      const setExpiry = async (expiry_date) => must(await updateRows('pantry_items', item.id, { expiry_date }))
      const { data, error } = await attempt(
        () =>
          inSteps(async (onFail) => {
            await setExpiry(null)
            onFail(() => setExpiry(item.expiry_date))
            return changeStock({ ...item, expiry_date: null }, -amount, 'discarded')
          }),
        { onFail: fetchItems }
      )
      if (error) return { error }
      setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)))

      const undo = () =>
        attempt(
          async () =>
            inSteps(async (onFail) => {
              await setExpiry(item.expiry_date)
              onFail(() => setExpiry(null))
              const restored = await changeStock({ ...data, expiry_date: item.expiry_date }, amount, 'edited')
              setItems((prev) => prev.map((i) => (i.id === item.id ? restored : i)))
            }),
          { onFail: fetchItems }
        )
      showToast({
        message: amount ? `Discarded ${amount} ${item.unit} of "${item.name}"` : `Cleared the expiry date of "${item.name}"`,
        action: { label: 'Undo', onClick: undo },
      })
      return { error: null }
    },
    [fetchItems]
  )

  // Deletes right away; Undo puts the item back exactly, including the
  // grocery entries and history rows that pointed to it (the database
  // unlinks them on delete).
  const deleteItem = useCallback(
    (item) =>
      deleteWithUndo({
        message: `Deleted "${item.name}"`,
        remove: async () => {
          const grocery = must(await supabase.from('grocery_items').select('id').eq('pantry_item_id', item.id))
          const history = must(await supabase.from('stock_logs').select('id').eq('item_id', item.id))
          const [row] = must(await supabase.from('pantry_items').delete().eq('id', item.id).select())
          setItems((prev) => prev.filter((i) => i.id !== item.id))
          return { row, groceryIds: grocery.map((g) => g.id), logIds: history.map((l) => l.id) }
        },
        restore: async ({ row, groceryIds, logIds }) => {
          if (row) must(await supabase.from('pantry_items').upsert(row))
          if (groceryIds.length) must(await supabase.from('grocery_items').update({ pantry_item_id: item.id }).in('id', groceryIds))
          if (logIds.length) must(await supabase.from('stock_logs').update({ item_id: item.id }).in('id', logIds))
          await fetchItems()
        },
        onFail: fetchItems,
      }),
    [fetchItems]
  )

  // Restore/import: rows with an id overwrite that item, rows without
  // one are added as new items.
  const importItems = useCallback(
    async (rows) => {
      const withId = rows.filter((r) => r.id).map((r) => ({ id: r.id, ...pickFields(r) }))
      const withoutId = rows.filter((r) => !r.id).map(pickFields)
      const { error } = await attempt(
        async () => {
          if (withId.length) must(await upsertRows('pantry_items', withId))
          if (withoutId.length) must(await insertRows('pantry_items', withoutId))
        },
        { retry: false, onFail: fetchItems }
      )
      if (error) return { error }
      const { data, error: loadError } = await supabase.from('pantry_items').select('*').order('created_at', { ascending: false })
      if (loadError) {
        toastLoadError(loadError, fetchItems, 'pantry_items')
      } else {
        setItems(data.map(normalizeItem))
        await followUp('the shopping list', async () => {
          for (const item of data) await syncShoppingForItem(item)
        })
      }
      return { error: null, count: rows.length }
    },
    [fetchItems]
  )

  return { items, logs, addItem, updateItem, adjustStock, discardExpired, deleteItem, importItems }
}
