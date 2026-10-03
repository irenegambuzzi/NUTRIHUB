import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_UNIT } from '../data/constants'
import {
  changeStock,
  expiryState,
  getDurableExpenseCategoryId,
  getGroceriesCategoryId,
  insertRows,
  isDurable,
  logStockChange,
  normalizeItem,
  toBaseQuantity,
  updateRows,
} from '../lib/inventory'
import { priceFields } from '../lib/pricing'
import { localDateString } from '../lib/week'

async function createExpense(item, amount) {
  const categoryId = isDurable(item) ? await getDurableExpenseCategoryId(item.subcategory_id) : await getGroceriesCategoryId()
  // Dated today in local time: the database default (current_date) is UTC.
  const { data } = await supabase
    .from('expenses')
    .insert([{ category_id: categoryId, amount, description: item.name, paid_by: item.payer || 'shared', expense_date: localDateString() }])
    .select()
    .single()
  return data?.id ?? null
}

// The pantry item a grocery entry restocks: its linked item, else the
// one with the same name.
async function findPantryItem(item) {
  if (item.pantry_item_id) {
    const { data } = await supabase.from('pantry_items').select('*').eq('id', item.pantry_item_id).maybeSingle()
    if (data) return normalizeItem(data)
  }
  const { data } = await supabase.from('pantry_items').select('*').ilike('name', item.name.trim()).limit(1)
  return data?.[0] ? normalizeItem(data[0]) : null
}

const MEASURE_UNITS = ['gr', 'kg', 'ml', 'L']

// The entry's quantity in the pantry item's base unit, or null when the
// units can't be converted and no pack size was given (e.g. 2 pack of an
// item counted in gr).
function purchasedQuantity(pantry, item, packSize) {
  const quantity = Number(item.quantity) || 1
  const base = toBaseQuantity(pantry, quantity, item.unit) ?? (packSize > 0 ? quantity * packSize : null)
  return base === null ? null : Math.round(base * 100) / 100
}

// A pack size the user just gave is kept on the pantry item, unless the
// item already has a different multipack or the unit is a measure (kg…).
function packSizePatch(pantry, unit, packSize) {
  if (!(packSize > 0) || MEASURE_UNITS.includes(unit)) return {}
  if (pantry.packaging_unit && pantry.packaging_unit !== unit) return {}
  return { packaging_unit: unit, quantity_per_pack: packSize }
}

// Returned instead of changing anything when the quantity can't be
// converted: the page asks for the pack size and calls again with it.
const needsPackSize = (item, pantry) => ({ needsPackSize: { name: item.name, unit: item.unit, baseUnit: pantry.unit } })

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
  // base unit, along with the unit price and payer. The entry keeps the
  // pantry item's id, so unchecking can remove the expense and take the
  // same quantity back out of stock. If the entry's unit can't be
  // converted to the pantry item's (a pack of something counted in gr),
  // nothing changes and { needsPackSize } is returned; call again with
  // `packSize` (base units in one entry unit).
  const toggleComplete = useCallback(async (item, total, packSize = null) => {
    const completed = !item.completed

    if (!completed) {
      // Appliances and other durables never added stock.
      const pantry = isDurable(item) ? null : await findPantryItem(item)
      const removed = pantry && purchasedQuantity(pantry, item, packSize)
      if (pantry && removed === null) return needsPackSize(item, pantry)

      await supabase.from('grocery_items').update({ completed, expense_id: null }).eq('id', item.id)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: null } : i)))
      if (item.expense_id) await supabase.from('expenses').delete().eq('id', item.expense_id)
      if (pantry) {
        const patch = packSizePatch(pantry, item.unit, packSize)
        if (Object.keys(patch).length) await updateRows('pantry_items', pantry.id, patch)
        await changeStock(pantry, -removed, 'unpurchased')
      }
      return {}
    }

    // Appliances and other durables are expenses only — no pantry stock.
    const existing = isDurable(item) ? null : await findPantryItem(item)
    const added = existing && purchasedQuantity(existing, item, packSize)
    if (existing && added === null) return needsPackSize(item, existing)

    const expenseId = total > 0 ? await createExpense(item, total) : (item.expense_id ?? null)
    const pantryItemId = existing?.id ?? item.pantry_item_id ?? null

    await supabase.from('grocery_items').update({ completed, expense_id: expenseId, pantry_item_id: pantryItemId }).eq('id', item.id)
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, completed, expense_id: expenseId, pantry_item_id: pantryItemId } : i))
    )

    if (isDurable(item)) return {}

    const purchase = { payer: item.payer || 'shared', last_purchased_at: new Date().toISOString() }
    if (Number(item.price) > 0) Object.assign(purchase, priceFields(item))

    if (existing) {
      // A fresh purchase replaces an expired batch.
      if (expiryState(existing) === 'expired') purchase.expiry_date = null
      await updateRows('pantry_items', existing.id, { ...purchase, ...packSizePatch(existing, item.unit, packSize) })
      await changeStock(existing, added, 'purchased')
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
      if (created) {
        await logStockChange(created, Number(created.current_stock), Number(created.current_stock), 'purchased')
        await supabase.from('grocery_items').update({ pantry_item_id: created.id }).eq('id', item.id)
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, pantry_item_id: created.id } : i)))
      }
    }
    return {}
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
