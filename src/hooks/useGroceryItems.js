import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_UNIT } from '../data/constants'
import {
  changeStock,
  changeStockParts,
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
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'
import { localDateString } from '../lib/week'

async function createExpense(item, amount) {
  const categoryId = isDurable(item) ? await getDurableExpenseCategoryId(item.subcategory_id) : await getGroceriesCategoryId()
  // Dated today in local time: the database default (current_date) is UTC.
  const data = must(
    await supabase
      .from('expenses')
      .insert([{ category_id: categoryId, amount, description: item.name, paid_by: item.payer || 'shared', expense_date: localDateString() }])
      .select()
      .single()
  )
  return data.id
}

const deleteExpense = async (id) => must(await supabase.from('expenses').delete().eq('id', id))

const setGroceryFields = async (id, fields) => must(await supabase.from('grocery_items').update(fields).eq('id', id))

// The pantry item a grocery entry restocks: its linked item, else the
// one with the same name.
// Throws if it couldn't look (so a network error never passes for "no
// such item" and creates a duplicate).
async function findPantryItem(item) {
  if (item.pantry_item_id) {
    const data = must(await supabase.from('pantry_items').select('*').eq('id', item.pantry_item_id).maybeSingle())
    if (data) return normalizeItem(data)
  }
  const data = must(await supabase.from('pantry_items').select('*').ilike('name', item.name.trim()).limit(1))
  return data[0] ? normalizeItem(data[0]) : null
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

// Puts back the fields a patch changed, from the row as it was before.
async function restoreFields(before, patch, table = 'pantry_items') {
  const original = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null]))
  must(await updateRows(table, before.id, original))
}

// Returned instead of changing anything when the quantity can't be
// converted: the page asks for the pack size and calls again with it.
const needsPackSize = (item, pantry) => ({ needsPackSize: { name: item.name, unit: item.unit, baseUnit: pantry.unit } })

// Returned instead of changing anything when the pantry item has expired:
// the page asks whether to throw the expired stock away and for the new
// expiry date, and calls again with the answer.
const needsExpiryChoice = (pantry) => ({
  needsExpiryChoice: { name: pantry.name, stock: Number(pantry.current_stock) || 0, unit: pantry.unit, expiryDate: pantry.expiry_date },
})

export function useGroceryItems() {
  const [items, setItems] = useState([])

  const fetchItems = useCallback(async function fetchItems() {
    const { data, error } = await supabase.from('grocery_items').select('*').order('created_at', { ascending: false })
    if (error) return toastLoadError(error, fetchItems, 'grocery_items')
    setItems(data.map(normalizeItem))
  }, [])

  useEffect(() => {
    fetchItems()
    const channel = supabase
      .channel(`grocery_items-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, fetchItems)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchItems])

  const patchLocal = (id, fields) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } : i)))

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
    }) =>
      attempt(
        async () => {
          const rows = must(
            await insertRows('grocery_items', [
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
          )
          setItems((prev) => [normalizeItem(rows[0]), ...prev])
        },
        { retry: false }
      ),
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
  // options.packSize (base units in one entry unit). If the pantry item
  // has expired, { needsExpiryChoice } is returned; call again with
  // options.expired = { discard, expiryDate }: discard throws the expired
  // stock away (logged as "discarded"), and the item takes expiryDate
  // (or none) — it now describes what was just bought. options.quantity
  // replaces the entry's quantity (what was really bought); it's saved
  // with the check mark and `total` must already be for that quantity.
  //
  // The expense, the check mark and the stock change are saved together:
  // if one fails, the others are undone and the toast offers Retry. The
  // stock history, shopping list and leftover expense clean-up are
  // follow-ups with their own Retry.
  const toggleComplete = useCallback(
    async (original, total, { packSize = null, expired = null, quantity = null } = {}) => {
      const item = quantity > 0 && !original.completed ? { ...original, quantity } : original
      let pending = null
      const { data, error } = await attempt(
        () =>
          inSteps(async (onFail) => {
            if (item.completed) {
              // Appliances and other durables never added stock.
              const pantry = isDurable(item) ? null : await findPantryItem(item)
              const removed = pantry && purchasedQuantity(pantry, item, packSize)
              if (pantry && removed === null) return needsPackSize(item, pantry)

              await setGroceryFields(item.id, { completed: false, expense_id: null })
              onFail(() => setGroceryFields(item.id, { completed: true, expense_id: item.expense_id ?? null }))
              if (pantry) {
                const patch = packSizePatch(pantry, item.unit, packSize)
                if (Object.keys(patch).length) {
                  must(await updateRows('pantry_items', pantry.id, patch))
                  onFail(() => restoreFields(pantry, patch))
                }
                await changeStock(pantry, -removed, 'unpurchased')
              }
              patchLocal(item.id, { completed: false, expense_id: null })
              if (item.expense_id) pending = () => followUp('the expenses', () => deleteExpense(item.expense_id))
              return {}
            }

            // Appliances and other durables are expenses only — no pantry stock.
            const existing = isDurable(item) ? null : await findPantryItem(item)
            const added = existing && purchasedQuantity(existing, item, packSize)
            if (existing && added === null) return needsPackSize(item, existing)
            const isExpired = existing && expiryState(existing) === 'expired'
            if (isExpired && !expired) return needsExpiryChoice(existing)

            let expenseId = item.expense_id ?? null
            if (total > 0) {
              expenseId = await createExpense(item, total)
              onFail(() => deleteExpense(expenseId))
            }
            const pantryItemId = existing?.id ?? item.pantry_item_id ?? null
            await setGroceryFields(item.id, { completed: true, expense_id: expenseId, pantry_item_id: pantryItemId, quantity: item.quantity })
            onFail(() =>
              setGroceryFields(item.id, {
                completed: false,
                expense_id: original.expense_id ?? null,
                pantry_item_id: original.pantry_item_id ?? null,
                quantity: original.quantity,
              })
            )

            if (!isDurable(item)) {
              const purchase = { payer: item.payer || 'shared', last_purchased_at: new Date().toISOString() }
              if (Number(item.price) > 0) Object.assign(purchase, priceFields(item))
              if (existing) {
                if (isExpired) purchase.expiry_date = expired.expiryDate || null
                const patch = { ...purchase, ...packSizePatch(existing, item.unit, packSize) }
                must(await updateRows('pantry_items', existing.id, patch))
                onFail(() => restoreFields(existing, patch))
                const expiredStock = isExpired && expired.discard ? Number(existing.current_stock) || 0 : 0
                await changeStockParts(existing, [
                  { change: -expiredStock, reason: 'discarded' },
                  { change: added, reason: 'purchased' },
                ])
              } else {
                const created = must(
                  await insertRows('pantry_items', [
                    {
                      ...purchase,
                      name: item.name.trim(),
                      category_id: item.category_id,
                      subcategory_id: item.subcategory_id ?? null,
                      current_stock: item.quantity || 1,
                      unit: item.unit || DEFAULT_UNIT,
                    },
                  ])
                )[0]
                const stock = Number(created.current_stock)
                pending = async () => {
                  await followUp('the stock history', () => logStockChange(created, stock, stock, 'purchased'))
                  // Remembered so unchecking knows which item to take the stock from.
                  const linked = await followUp('the link to the new pantry item', () =>
                    setGroceryFields(item.id, { pantry_item_id: created.id })
                  )
                  if (linked) patchLocal(item.id, { pantry_item_id: created.id })
                }
              }
            }
            patchLocal(item.id, { completed: true, expense_id: expenseId, pantry_item_id: pantryItemId, quantity: item.quantity })
            return {}
          }),
        { onFail: fetchItems }
      )
      await pending?.()
      return error ? { error } : data
    },
    [fetchItems]
  )

  // Price (amount + basis) and quantity edits. If the item was already
  // checked off, its expense follows the new line total — created,
  // updated or removed as needed — together with the edit.
  const updatePricing = useCallback(
    (item, patch, total) =>
      attempt(
        () =>
          inSteps(async (onFail) => {
            must(await updateRows('grocery_items', item.id, patch))
            onFail(() => restoreFields(item, patch, 'grocery_items'))

            let expenseId = item.expense_id ?? null
            if (item.completed) {
              if (total > 0 && expenseId) {
                must(await supabase.from('expenses').update({ amount: total }).eq('id', expenseId))
              } else if (total > 0) {
                expenseId = await createExpense(item, total)
                onFail(() => deleteExpense(expenseId))
                await setGroceryFields(item.id, { expense_id: expenseId })
              } else if (expenseId) {
                await setGroceryFields(item.id, { expense_id: null })
                onFail(() => setGroceryFields(item.id, { expense_id: item.expense_id }))
                await deleteExpense(expenseId)
                expenseId = null
              }
            }
            patchLocal(item.id, { ...patch, expense_id: expenseId })
          }),
        { retry: false, onFail: fetchItems }
      ),
    [fetchItems]
  )

  // One payer for many items at once (e.g. every Out/Low/Expired entry).
  // Their expenses follow as a follow-up.
  const updatePayer = useCallback(
    async (targets, payer) => {
      const list = Array.isArray(targets) ? targets : [targets]
      if (list.length === 0) return { error: null }
      const ids = list.map((i) => i.id)
      const result = await attempt(
        async () => {
          must(await updateRows('grocery_items', ids, { payer }))
          setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, payer } : i)))
        },
        { onFail: fetchItems }
      )
      const expenseIds = list.map((i) => i.expense_id).filter(Boolean)
      if (!result.error && expenseIds.length) {
        await followUp('who paid the expenses', async () => must(await supabase.from('expenses').update({ paid_by: payer }).in('id', expenseIds)))
      }
      return result
    },
    [fetchItems]
  )

  // Deletes right away; Undo puts the exact rows back.
  const removeWithUndo = useCallback(
    (query, message) =>
      deleteWithUndo({
        message,
        remove: async () => {
          const rows = must(await query(supabase.from('grocery_items').delete()).select())
          const ids = rows.map((r) => r.id)
          setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
          return rows
        },
        restore: async (rows) => {
          must(await supabase.from('grocery_items').upsert(rows))
          await fetchItems()
        },
        onFail: fetchItems,
      }),
    [fetchItems]
  )

  const deleteItem = useCallback(
    (item) => removeWithUndo((q) => q.eq('id', item.id), `Removed "${item.name}"`),
    [removeWithUndo]
  )

  const clearCompleted = useCallback(() => removeWithUndo((q) => q.eq('completed', true), 'Checked items removed'), [removeWithUndo])

  return { items, addItem, toggleComplete, updatePricing, updatePayer, deleteItem, clearCompleted }
}
