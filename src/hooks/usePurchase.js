import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { getDurableExpenseCategoryId, getGroceriesCategoryId, syncShoppingForItem, updateRows } from '../lib/inventory'
import { confirmationPayload } from '../lib/purchase'
import { money } from '../lib/pricing'
import { groceryStore, pantryStore, tripItemStore, tripStore } from '../lib/stores'
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
// Parts already deleted by hand are skipped (stock never goes below 0);
// `note` says which, after it's done.
export async function reopenTrip(tripId, note = null) {
  const result = await attempt(async () => must(await supabase.rpc('reopen_shopping_trip', { trip_id: tripId })), { onFail: reloadAll })
  if (!result.error) {
    showToast({ message: note ? `Purchase reopened — the items are back in the cart. ${note}` : 'Purchase reopened — the items are back in the cart.', duration: note ? 10000 : 5000 })
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
  // Undo is offered the moment the purchase is saved — never held up by
  // the reloads and list updates that follow (they run in the background).
  showToast({
    message: `Purchase confirmed · ${lines.length} item${lines.length === 1 ? '' : 's'} · ${money(result.data?.total ?? 0)}`,
    duration: UNDO_FOR,
    action: { label: 'Undo', onClick: () => reopenTrip(id) },
  })
  afterConfirm(lines)
  return result
}

const UNDO_FOR = 10000

// Reload the lists, then give items still low after the purchase their
// automatic list entry. Failures show their own toast.
function afterConfirm(lines) {
  const restocked = new Set(lines.map((l) => l.pantry?.id).filter(Boolean))
  reloadAll()
    .then(() =>
      followUp('the shopping list', async () => {
        for (const item of pantryStore.getSnapshot().rows) if (restocked.has(item.id)) await syncShoppingForItem(item)
      })
    )
    .catch((error) => console.error(error))
}

// Deletes only the record of a purchase (Receipts), with Undo: its stock,
// history and expenses stay as they are. Its grocery entries, expenses and
// receipt photos are unlinked from it (the database does that), and Undo
// links them again.
export function deleteTripRecord(trip) {
  return deleteWithUndo({
    message: 'Purchase record deleted',
    remove: async () => {
      const linked = async (table) => must(await supabase.from(table).select('id').eq('trip_id', trip.id)).map((r) => r.id)
      const groceryIds = await linked('grocery_items')
      const expenseIds = await linked('expenses')
      const photoIds = await linked('receipt_photos')
      const items = must(await supabase.from('shopping_trip_items').select('*').eq('trip_id', trip.id))
      const [row] = must(await supabase.from('shopping_trips').delete().eq('id', trip.id).select())
      tripStore.removeLocal([trip.id])
      tripItemStore.removeLocal(items.map((i) => i.id))
      return { row, items, groceryIds, expenseIds, photoIds }
    },
    restore: async ({ row, items, groceryIds, expenseIds, photoIds }) => {
      if (row) must(await supabase.from('shopping_trips').upsert(row))
      if (items.length) must(await supabase.from('shopping_trip_items').upsert(items))
      for (const [table, ids] of [
        ['grocery_items', groceryIds],
        ['expenses', expenseIds],
        ['receipt_photos', photoIds],
      ]) {
        if (ids.length) must(await supabase.from(table).update({ trip_id: trip.id }).in('id', ids))
      }
      await reloadAll()
    },
    onFail: reloadAll,
  })
}

export function usePurchase() {
  const confirmPurchase = useCallback((purchase) => confirmCart(purchase), [])
  return { confirmPurchase, reopenTrip }
}
