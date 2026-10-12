import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { getDurableExpenseCategoryId, getGroceriesCategoryId, syncShoppingForItem, updateRows } from '../lib/inventory'
import { newVariantFields } from '../lib/groups'
import { confirmationPayload } from '../lib/purchase'
import { money } from '../lib/pricing'
import { groceryStore, pantryStore, shopStore, tripItemStore, tripStore } from '../lib/stores'
import { shopsAvailable } from '../lib/shops'
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
// `shopId`: the store the purchase was made in (optional), put on the
// expenses it made once it is saved.
export async function confirmCart({ id, date, lines, answers, totalOf, photoIds, patches = [], variantIds = new Map(), shopId = null }) {
  const result = await attempt(
    async () => {
      for (const { id: itemId, patch } of patches) {
        must(await updateRows('grocery_items', itemId, patch))
        groceryStore.patchLocal([itemId], patch)
      }
      const expenseCategoryFor = await expenseCategories(lines)
      const made = await makeVariants(lines, variantIds)
      const payload = confirmationPayload({ id, date, at: new Date().toISOString(), lines, answers, totalOf, expenseCategoryFor, photoIds, variantIds })
      try {
        return must(await supabase.rpc('confirm_shopping_trip', { payload }))
      } catch (error) {
        await removeEmptyVariants(made)
        throw error
      }
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
  afterConfirm(lines, shopId ? { tripId: id, shopId } : null)
  return result
}

// The new variants chosen for group lines are made first (the purchase
// then restocks them like any item). Each has an id fixed for this
// confirm screen and is only made if it isn't there yet, so pressing
// Confirm again never makes a second one or resets its stock.
async function makeVariants(lines, variantIds) {
  const made = []
  const byName = new Map()
  for (const line of lines) {
    if (!line.newVariant) continue
    const key = `${line.group.id}:${line.newVariant.toLowerCase()}`
    if (byName.has(key)) {
      variantIds.set(line.item.id, byName.get(key))
      continue
    }
    const id = variantIds.get(line.item.id) ?? crypto.randomUUID()
    variantIds.set(line.item.id, id)
    byName.set(key, id)
    const row = {
      id,
      ...newVariantFields(line.group, line.newVariant, {
        current_stock: 0,
        packaging_unit: line.group.packaging_unit ?? null,
        quantity_per_pack: line.group.quantity_per_pack ?? null,
      }),
    }
    must(await supabase.from('pantry_items').upsert([row], { onConflict: 'id', ignoreDuplicates: true }))
    made.push(id)
  }
  if (made.length) await pantryStore.refresh()
  return made
}

// A purchase that didn't go through leaves no empty variant behind (one
// that got stock — the purchase saved after all — is never touched).
async function removeEmptyVariants(ids) {
  if (!ids.length) return
  try {
    await supabase.from('pantry_items').delete().in('id', ids).eq('current_stock', 0)
    await pantryStore.refresh()
  } catch (error) {
    console.error(error)
  }
}

const UNDO_FOR = 10000

// Puts the store on the expenses the purchase made. The purchase stays
// saved if this fails; the toast offers Retry.
function saveShop({ tripId, shopId }) {
  if (!shopsAvailable(shopStore.getSnapshot())) return Promise.resolve(false)
  return followUp('the store', async () => must(await supabase.from('expenses').update({ shop_id: shopId }).eq('trip_id', tripId)))
}

// Save the store, reload the lists, then give items still low after the
// purchase their automatic list entry. Failures show their own toast.
function afterConfirm(lines, shop) {
  const restocked = new Set(lines.map((l) => l.pantry?.id).filter(Boolean))
  Promise.resolve(shop ? saveShop(shop) : null)
    .then(() => reloadAll())
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
