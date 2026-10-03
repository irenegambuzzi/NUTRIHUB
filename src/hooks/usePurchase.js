import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, followUp, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { getDurableExpenseCategoryId, getGroceriesCategoryId, syncShoppingForItem, updateRows } from '../lib/inventory'
import { confirmationPayload } from '../lib/purchase'
import { money } from '../lib/pricing'
import { groceryStore, pantryStore } from '../lib/stores'
import { refreshStartedStores } from '../lib/tableStore'

// Every list that a confirmation or reopen changes, reloaded afterwards.
const reloadAll = () => refreshStartedStores()

// The expense category for each line: Groceries, or the matching "Home &
// Appliances" one for durables.
async function expenseCategories(lines) {
  const groceries = await getGroceriesCategoryId()
  const byItem = new Map()
  for (const { item, durable } of lines) {
    byItem.set(item.id, durable ? await getDurableExpenseCategoryId(item.subcategory_id) : groceries)
  }
  return (item) => byItem.get(item.id) ?? null
}

// Puts a confirmed purchase back: stock, history and expenses are undone
// in one go (reopen_shopping_trip) and its items return to the cart.
export async function reopenTrip(tripId) {
  const result = await attempt(async () => must(await supabase.rpc('reopen_shopping_trip', { trip_id: tripId })), { onFail: reloadAll })
  if (!result.error) {
    await reloadAll()
    await followUp('the shopping list', async () => {
      for (const item of pantryStore.getSnapshot().rows) await syncShoppingForItem(item)
    })
  }
  return result
}

// Confirming the cart: everything (stock, history, expenses dated by the
// shopping day, new pantry items, items marked bought, receipt photos
// linked) is saved at once by confirm_shopping_trip, or nothing is.
// `id` is made once per confirm screen, so pressing again after a failed
// connection can't save the purchase twice. Then "Undo" for a few seconds.
// `patches` ([{ id, patch }]) are the edits made on the confirm screen:
// saved to the grocery entries first, so the entries and everything the
// confirmation writes use the same values as `lines` and `totalOf`.
export async function confirmCart({ id, date, lines, answers, totalOf, photoIds, patches = [] }) {
  const result = await attempt(
    async () => {
      for (const { id: itemId, patch } of patches) {
        must(await updateRows('grocery_items', itemId, patch))
        groceryStore.patchLocal([itemId], patch)
      }
      const expenseCategoryFor = await expenseCategories(lines)
      const payload = confirmationPayload({ id, date, at: new Date().toISOString(), lines, answers, totalOf, expenseCategoryFor, photoIds })
      return must(await supabase.rpc('confirm_shopping_trip', { payload }))
    },
    { retry: false, onFail: reloadAll }
  )
  if (result.error) return result
  await reloadAll()
  // Items still low after the purchase get their automatic list entry.
  const restocked = new Set(lines.map((l) => l.pantry?.id).filter(Boolean))
  await followUp('the shopping list', async () => {
    for (const item of pantryStore.getSnapshot().rows) if (restocked.has(item.id)) await syncShoppingForItem(item)
  })
  showToast({
    message: `Purchase confirmed · ${lines.length} item${lines.length === 1 ? '' : 's'} · ${money(result.data?.total ?? 0)}`,
    duration: 8000,
    action: { label: 'Undo', onClick: () => reopenTrip(id) },
  })
  return result
}

export function usePurchase() {
  const confirmPurchase = useCallback((purchase) => confirmCart(purchase), [])
  return { confirmPurchase, reopenTrip }
}
