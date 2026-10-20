import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_UNIT } from '../data/constants'
import { insertRows, updateRows } from '../lib/inventory'
import { variantPurchase } from '../lib/groupShop'
import { priceFields } from '../lib/pricing'
import { budgetResolver } from '../lib/budgetContext'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { groceryStore } from '../lib/stores'
import { localDateString } from '../lib/week'
import { isOffline } from '../lib/connection'
import { queueCart, queueQuantity, setCart } from '../lib/offlineActions'

async function createExpense(item, amount, when = new Date()) {
  // The budget category from the item category (see lib/budgetMap.js).
  const categoryId = (await budgetResolver()).budgetFor(item)
  // Dated today in local time: the database default (current_date) is UTC.
  const data = must(
    await supabase
      .from('expenses')
      .insert([{ category_id: categoryId, amount, description: item.name, paid_by: item.payer || 'shared', expense_date: localDateString(when) }])
      .select()
      .single()
  )
  return data.id
}

const patchLocal = (id, fields) => groceryStore.patchLocal([id], fields)

const deleteExpense = async (id) => must(await supabase.from('expenses').delete().eq('id', id))

const setGroceryFields = async (id, fields) => must(await supabase.from('grocery_items').update(fields).eq('id', id))

// Puts back the fields a patch changed, from the row as it was before.
async function restoreFields(before, patch, table = 'pantry_items') {
  const original = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null]))
  must(await updateRows(table, before.id, original))
}

// The grocery list: everything not bought yet (bought items stay in the
// table for receipts, but leave the list).
export function useGroceryItems() {
  const { rows } = groceryStore.useRows()
  const items = useMemo(() => rows.filter((i) => !i.completed), [rows])
  const fetchItems = groceryStore.refresh

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
      oneTime = false,
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
                // A new item not in HOME yet, bought once: Confirm purchase
                // makes its HOME item one-time too (supabase/023).
                ...(oneTime ? { one_time: true } : {}),
              },
            ])
          )
          groceryStore.upsertLocal(rows)
        },
        { retry: false }
      ),
    []
  )

  // Tapping an item puts it in the cart or takes it out — nothing else
  // changes (no stock, history or expense) until the purchase is
  // confirmed. Shared live by both phones; kept and sent later offline.
  // The tap time goes along as the cart time, only when it goes into the
  // cart: an entry the other phone put in the cart first keeps its time.
  const toggleCart = useCallback(async (item) => {
    const inCart = !item.in_cart
    const at = new Date().toISOString()
    if (isOffline()) return queueCart(item, inCart, at)
    const { error } = await attempt(
      async () => {
        const rows = must(await setCart(item.id, inCart, at))
        // Already in the cart on the other phone: nothing changed here.
        if (rows.length) groceryStore.upsertLocal(rows)
        else await groceryStore.refresh()
      },
      { onFail: groceryStore.refresh }
    )
    return { error }
  }, [])

  // Price (amount + basis) and quantity edits. If the item was already
  // checked off, its expense follows the new line total — created,
  // updated or removed as needed — together with the edit.
  const updatePricing = useCallback(
    (item, patch, total) =>
      // No signal: a quantity change to an open entry is kept and sent later.
      isOffline() && !item.completed && Object.keys(patch).join() === 'quantity'
        ? queueQuantity(item, patch.quantity)
        : attempt(
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
          groceryStore.patchLocal(ids, { payer })
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

  // Gives an entry saved without a category its category (and sub-category)
  // — the grey "No category" label's fix. Its budget category follows the
  // mapping when it is bought.
  const updateCategory = useCallback(
    async (item, { categoryId, subcategoryId = null }) =>
      attempt(
        async () => {
          const patch = { category_id: categoryId, subcategory_id: subcategoryId || null }
          must(await updateRows('grocery_items', [item.id], patch))
          groceryStore.patchLocal([item.id], patch)
        },
        { onFail: fetchItems }
      ),
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
          groceryStore.removeLocal(ids)
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

  // "+ Add another variant" in a group's card: an entry for a variant that
  // still has stock (e.g. on offer), 1 of its purchase unit at its last
  // price. Added by hand, so it can be removed again (× on its row) and
  // the list never takes it away by itself. Never a second entry for the
  // same variant.
  const addVariant = useCallback(
    (variant) =>
      attempt(
        async () => {
          const open = must(await supabase.from('grocery_items').select('id').eq('pantry_item_id', variant.id).eq('completed', false))
          if (open.length) return groceryStore.refresh()
          const { quantity, unit } = variantPurchase(variant)
          const rows = must(
            await insertRows('grocery_items', [
              {
                name: variant.name,
                category_id: variant.category_id,
                subcategory_id: variant.subcategory_id ?? null,
                quantity,
                unit,
                ...priceFields(variant),
                payer: variant.payer || 'shared',
                completed: false,
                pantry_item_id: variant.id,
              },
            ])
          )
          groceryStore.upsertLocal(rows)
        },
        { onFail: fetchItems }
      ),
    [fetchItems]
  )

  return { items, addItem, toggleCart, updatePricing, updatePayer, updateCategory, deleteItem, addVariant }
}
