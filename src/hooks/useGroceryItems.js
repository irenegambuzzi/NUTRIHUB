import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_UNIT } from '../data/constants'
import {
  expiryState,
  getDurableExpenseCategoryId,
  getGroceriesCategoryId,
  insertRows,
  isDurable,
  logStockChange,
  normalizeItem,
  syncShoppingForItem,
  toBaseQuantity,
  updateRows,
} from '../lib/inventory'
import { priceFields } from '../lib/pricing'

async function createExpense(item, amount) {
  const categoryId = isDurable(item) ? await getDurableExpenseCategoryId(item.subcategory_id) : await getGroceriesCategoryId()
  const { data } = await supabase
    .from('expenses')
    .insert([{ category_id: categoryId, amount, description: item.name, paid_by: item.payer || 'shared' }])
    .select()
    .single()
  return data?.id ?? null
}

export function useGroceryItems() {
  const [items, setItems] = useState([])

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('grocery_items').select('*').order('created_at', { ascending: false })
    if (data) setItems(data.map(normalizeItem))
  }, [])

  useEffect(() => {
    fetchItems()
    const channel = supabase
      .channel(`grocery_items-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, fetchItems)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchItems])

  const addItem = useCallback(
    async ({
      name,
      categoryId,
      subcategoryId = null,
      price,
      priceQty = null,
      priceUnit = null,
      quantity = 1,
      unit = DEFAULT_UNIT,
      payer = 'shared',
      pantryItemId = null,
    }) => {
      const { data, error } = await insertRows('grocery_items', [
        {
          name,
          category_id: categoryId,
          subcategory_id: subcategoryId,
          price: price || 0,
          price_qty: priceQty,
          price_unit: priceUnit,
          quantity,
          unit,
          payer,
          completed: false,
          pantry_item_id: pantryItemId,
        },
      ])
      if (!error && data) setItems((prev) => [normalizeItem(data[0]), ...prev])
      return { error }
    },
    []
  )

  // Checking off an item logs its line total (unit price × quantity) as
  // a Groceries expense (Home & Appliances for durables), paid by the
  // item's payer, and — except for durables — adds its quantity
  // to the linked (or same-named) pantry item, converted to that item's
  // base unit, along with the unit price and payer. Unchecking removes
  // the expense.
  const toggleComplete = useCallback(async (item, total) => {
    const completed = !item.completed

    if (!completed) {
      await supabase.from('grocery_items').update({ completed, expense_id: null }).eq('id', item.id)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: null } : i)))
      if (item.expense_id) await supabase.from('expenses').delete().eq('id', item.expense_id)
      return
    }

    const expenseId = total > 0 ? await createExpense(item, total) : (item.expense_id ?? null)

    await supabase.from('grocery_items').update({ completed, expense_id: expenseId }).eq('id', item.id)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: expenseId } : i)))

    // Appliances and other durables are expenses only — no pantry stock.
    if (isDurable(item)) return

    let existing = null
    if (item.pantry_item_id) {
      const { data } = await supabase.from('pantry_items').select('*').eq('id', item.pantry_item_id).maybeSingle()
      existing = data && normalizeItem(data)
    }
    if (!existing) {
      const { data } = await supabase.from('pantry_items').select('*').ilike('name', item.name.trim()).limit(1)
      existing = data?.[0] ? normalizeItem(data[0]) : null
    }

    const purchase = { payer: item.payer || 'shared', last_purchased_at: new Date().toISOString() }
    if (Number(item.price) > 0) Object.assign(purchase, priceFields(item))

    if (existing) {
      const added = toBaseQuantity(existing, item.quantity || 1, item.unit)
      const newStock = Math.round((Number(existing.current_stock) + added) * 100) / 100
      const patch = { ...purchase, current_stock: newStock }
      // A fresh purchase replaces an expired batch.
      if (expiryState(existing) === 'expired') patch.expiry_date = null
      await updateRows('pantry_items', existing.id, patch)
      const updated = { ...existing, ...patch }
      await logStockChange(updated, added, newStock, 'purchased')
      await syncShoppingForItem(updated)
    } else {
      const { data } = await insertRows('pantry_items', [
        {
          ...purchase,
          name: item.name.trim(),
          category_id: item.category_id,
          subcategory_id: item.subcategory_id ?? null,
          current_stock: item.quantity || 1,
          unit: item.unit || DEFAULT_UNIT,
        },
      ])
      const created = data?.[0]
      if (created) await logStockChange(created, Number(created.current_stock), Number(created.current_stock), 'purchased')
    }
  }, [])

  // Price (amount + basis) and quantity edits. If the item was already
  // checked off, its expense follows the new line total — created,
  // updated or removed as needed.
  const updatePricing = useCallback(async (item, patch, total) => {
    const { error } = await updateRows('grocery_items', item.id, patch)
    if (error) return { error }

    let expenseId = item.expense_id ?? null
    if (item.completed) {
      if (total > 0) {
        if (expenseId) await supabase.from('expenses').update({ amount: total }).eq('id', expenseId)
        else {
          expenseId = await createExpense(item, total)
          await supabase.from('grocery_items').update({ expense_id: expenseId }).eq('id', item.id)
        }
      } else if (expenseId) {
        await supabase.from('expenses').delete().eq('id', expenseId)
        expenseId = null
        await supabase.from('grocery_items').update({ expense_id: null }).eq('id', item.id)
      }
    }

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch, expense_id: expenseId } : i)))
    return { error: null }
  }, [])

  // One payer for many items at once (e.g. every Out/Low/Expired entry).
  const updatePayer = useCallback(async (targets, payer) => {
    const list = Array.isArray(targets) ? targets : [targets]
    if (list.length === 0) return { error: null }
    const ids = list.map((i) => i.id)
    const { error } = await updateRows('grocery_items', ids, { payer })
    if (error) return { error }
    const expenseIds = list.map((i) => i.expense_id).filter(Boolean)
    if (expenseIds.length) await supabase.from('expenses').update({ paid_by: payer }).in('id', expenseIds)
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, payer } : i)))
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

  return { items, addItem, toggleComplete, updatePricing, updatePayer, deleteItem, clearCompleted }
}
