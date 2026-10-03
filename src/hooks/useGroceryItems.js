import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_UNIT } from '../data/constants'
import { getDurableExpenseCategoryId, getGroceriesCategoryId, insertRows, isDurable, updateRows } from '../lib/inventory'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { groceryStore } from '../lib/stores'
import { localDateString } from '../lib/week'
import { isOffline } from '../lib/connection'
import { queueCart, queueQuantity } from '../lib/offlineActions'

async function createExpense(item, amount, when = new Date()) {
  const categoryId = isDurable(item) ? await getDurableExpenseCategoryId(item.subcategory_id) : await getGroceriesCategoryId()
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
          groceryStore.upsertLocal(rows)
        },
        { retry: false }
      ),
    []
  )

  // Tapping an item puts it in the cart or takes it out — nothing else
  // changes (no stock, history or expense) until the purchase is
  // confirmed. Shared live by both phones; kept and sent later offline.
  const toggleCart = useCallback(async (item) => {
    const inCart = !item.in_cart
    if (isOffline()) return queueCart(item, inCart)
    const { error } = await attempt(
      async () => {
        must(await supabase.from('grocery_items').update({ in_cart: inCart }).eq('id', item.id).eq('completed', false))
        patchLocal(item.id, { in_cart: inCart })
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


  return { items, addItem, toggleCart, updatePricing, updatePayer, deleteItem }
}
