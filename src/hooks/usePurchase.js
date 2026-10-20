import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, must } from '../lib/db'
import { confirmDialog, showToast } from '../lib/feedback'
import { syncShoppingForItem, updateRows } from '../lib/inventory'
import { budgetResolver } from '../lib/budgetContext'
import { newVariantFields } from '../lib/groups'
import { confirmationPayload } from '../lib/purchase'
import { money } from '../lib/pricing'
import { allExpenseStores, groceryStore, pantryStore, shopStore, tripItemStore, tripStore } from '../lib/stores'
import { shopsAvailable } from '../lib/shops'
import { refreshStartedStores } from '../lib/tableStore'
import { purchaseUndo } from '../lib/trips'
import { splitPurchase } from './useMerge'

// Every list that a confirmation or reopen changes, reloaded afterwards.
const reloadAll = () => refreshStartedStores()

// The budget category for each line, from its item category (see
// lib/budgetMap.js): with no mapping chosen, Groceries, or the matching
// "Home & Appliances" one for durables, as always. `flowReady`: the
// database has supabase/021 (the trip's store is saved by the purchase).
async function expenseCategories(lines) {
  const { ctx, budgetFor } = await budgetResolver()
  const byItem = new Map(lines.map(({ item }) => [item.id, budgetFor(item)]))
  return { expenseCategoryFor: (item) => byItem.get(item.id) ?? null, flowReady: ctx.flowReady }
}

// Puts a confirmed purchase back: stock, history and expenses are undone
// in one go (reopen_shopping_trip). A SHOP purchase's items return to the
// cart; a MONEY purchase (`source` 'money') has no cart: its SHOP entries
// it took off the list are "to buy" again. Expenses merged into it are
// never deleted: they become single expenses again (the database does it).
// Parts already deleted by hand are skipped (stock never goes below 0);
// `note` says which, after it's done.
export async function reopenTrip(tripId, note = null, source = 'shop') {
  const result = await attempt(async () => must(await supabase.rpc('reopen_shopping_trip', { trip_id: tripId })), { onFail: reloadAll })
  if (!result.error) {
    const done = source === 'money' ? 'Purchase undone — its expenses are deleted and HOME stock is back as before.' : 'Purchase reopened — the items are back in the cart.'
    showToast({ message: note ? `${done} ${note}` : done, duration: note ? 10000 : 5000 })
    await reloadAll()
    await followUp('the shopping list', async () => {
      for (const item of pantryStore.getSnapshot().rows) await syncShoppingForItem(item)
    })
  }
  return result
}

// Asks, then undoes a purchase the way its source needs (lib/trips.js
// purchaseUndo): Reopen (SHOP), Undo purchase (MONEY) or Split (merged
// expenses, never deleted). `count` / `total`: what it holds now; `gone`:
// the parts already deleted by hand (goneSummary).
export async function askUndoPurchase(trip, { count, total, gone = null }) {
  const { kind } = purchaseUndo(trip.source)
  const things = `${count} item${count === 1 ? '' : 's'} (${money(total)})`
  if (kind === 'split') {
    const ok = await confirmDialog({
      title: 'Split this purchase?',
      message: `Its ${count} expense${count === 1 ? '' : 's'} (${money(total)}) become single expenses again, each with the store it had before. Nothing is deleted.`,
      confirmLabel: 'Split',
    })
    return ok ? splitPurchase(trip.id) : null
  }
  if (kind === 'undo') {
    const ok = await confirmDialog({
      title: 'Undo this purchase?',
      message: `The expenses of its ${things} are deleted, and the stock it added to HOME is taken back (an item it created is removed again). Expenses merged into it stay, as single expenses.${gone ? ` ${gone}` : ''}`,
      confirmLabel: 'Undo purchase',
    })
    return ok ? reopenTrip(trip.id, gone, 'money') : null
  }
  const ok = await confirmDialog({
    title: 'Reopen this purchase?',
    message: `The ${things} go back to the cart, and the stock, history and expenses from this purchase are undone.${gone ? ` ${gone}` : ''}`,
    confirmLabel: 'Reopen',
  })
  return ok ? reopenTrip(trip.id, gone) : null
}

// A purchase typed in MONEY (the purchase form, lib/moneyPurchase.js):
// every line's expense, stock and new HOME item at once, by the same
// confirm_shopping_trip as a SHOP purchase, or nothing. `payload.id` is
// made once per form, so pressing Save again can't save it twice. Then
// "Undo" for a few seconds (= reopen). `restocked`: the HOME items whose
// stock goes up, to update their SHOP entries afterwards.
export async function recordMoneyPurchase({ payload, restocked = [] }) {
  const result = await attempt(async () => must(await supabase.rpc('confirm_shopping_trip', { payload })), { retry: false, onFail: reloadAll })
  if (result.error) return result
  const count = payload.items.length
  showToast({
    message: `Purchase saved · ${count} item${count === 1 ? '' : 's'} · ${money(result.data?.total ?? 0)}`,
    duration: UNDO_FOR,
    action: { label: 'Undo', onClick: () => reopenTrip(payload.id, null, 'money') },
  })
  afterSave(new Set(restocked))
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
// `shopId`: the store of the whole trip (optional) and `paidBy` who paid
// for all of it (null when mixed). With supabase/021 both are saved with
// the purchase, on the trip and its expenses; before it, the store is put
// on the expenses once the purchase is saved.
export async function confirmCart({ id, date, lines, answers, totalOf, photoIds, patches = [], variantIds = new Map(), shopId = null, paidBy = null }) {
  let flowReady = false
  const result = await attempt(
    async () => {
      for (const { id: itemId, patch } of patches) {
        must(await updateRows('grocery_items', itemId, patch))
        groceryStore.patchLocal([itemId], patch)
      }
      const categories = await expenseCategories(lines)
      flowReady = categories.flowReady
      const made = await makeVariants(lines, variantIds)
      const payload = confirmationPayload({ id, date, at: new Date().toISOString(), lines, answers, totalOf, expenseCategoryFor: categories.expenseCategoryFor, photoIds, variantIds, shopId, paidBy })
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
  afterConfirm(lines, shopId && !flowReady ? { tripId: id, shopId } : null)
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
  afterSave(new Set(lines.map((l) => l.pantry?.id).filter(Boolean)), shop)
}

function afterSave(restocked, shop = null) {
  Promise.resolve(shop ? saveShop(shop) : null)
    .then(() => reloadAll())
    .then(() =>
      followUp('the shopping list', async () => {
        for (const item of pantryStore.getSnapshot().rows) if (restocked.has(item.id)) await syncShoppingForItem(item)
      })
    )
    .catch((error) => console.error(error))
}

// A whole purchase moves to another store (or to none): every expense of
// it and the purchase itself. Undo puts each expense's own store back.
// (A merged expense keeps the store it had before merging for Split.)
export async function setTripShop(tripId, shopId, { flowReady = true } = {}) {
  const result = await attempt(
    async () => {
      const before = must(await supabase.from('expenses').select('id, shop_id').eq('trip_id', tripId))
      const rows = must(await supabase.from('expenses').update({ shop_id: shopId || null }).eq('trip_id', tripId).select())
      if (flowReady) must(await supabase.from('shopping_trips').update({ shop_id: shopId || null }).eq('id', tripId))
      allExpenseStores().forEach((s) => s.upsertLocal(rows))
      if (tripStore.isStarted()) tripStore.patchLocal([tripId], { shop_id: shopId || null })
      return before
    },
    { onFail: reloadAll }
  )
  if (result.error) return result
  const before = result.data
  const undo = () =>
    attempt(
      async () => {
        for (const shop of new Set(before.map((e) => e.shop_id ?? null))) {
          const ids = before.filter((e) => (e.shop_id ?? null) === shop).map((e) => e.id)
          must(await supabase.from('expenses').update({ shop_id: shop }).in('id', ids))
        }
        if (flowReady) {
          const common = new Set(before.map((e) => e.shop_id ?? null))
          must(await supabase.from('shopping_trips').update({ shop_id: common.size === 1 ? [...common][0] : null }).eq('id', tripId))
        }
        await reloadAll()
      },
      { onFail: reloadAll }
    )
  showToast({ message: `Store changed for ${before.length} expense${before.length === 1 ? '' : 's'} of this purchase`, duration: 8000, action: { label: 'Undo', onClick: undo } })
  return result
}

// Deletes only the record of a purchase (Receipts), with Undo: its stock,
// history and expenses stay as they are. Its grocery entries, expenses and
// receipt photos are unlinked from it (the database does that), and Undo
// links them again. Expenses merged into it are split off first (each gets
// its own store back, supabase/023); Undo merges them in again.
export function deleteTripRecord(trip) {
  return deleteWithUndo({
    message: 'Purchase record deleted',
    remove: async () => {
      const [before] = must(await supabase.from('shopping_trips').select('*').eq('id', trip.id))
      const merged = must(await supabase.from('expenses').select('id, amount').eq('trip_id', trip.id).not('merged_at', 'is', null))
      if (merged.length) must(await supabase.rpc('split_merged_purchase', { trip_id: trip.id, expense_ids: null }))
      const linked = async (table) => must(await supabase.from(table).select('id').eq('trip_id', trip.id)).map((r) => r.id)
      const groceryIds = await linked('grocery_items')
      const expenseIds = await linked('expenses')
      const photoIds = await linked('receipt_photos')
      const items = must(await supabase.from('shopping_trip_items').select('*').eq('trip_id', trip.id))
      must(await supabase.from('shopping_trips').delete().eq('id', trip.id))
      tripStore.removeLocal([trip.id])
      tripItemStore.removeLocal(items.map((i) => i.id))
      if (merged.length) await reloadAll()
      const mergedTotal = merged.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      const row = before ? { ...before, total: Math.round(Math.max(0, Number(before.total) - mergedTotal) * 100) / 100 } : null
      return { row, items, groceryIds, expenseIds, photoIds, mergedIds: merged.map((e) => e.id) }
    },
    restore: async ({ row, items, groceryIds, expenseIds, photoIds, mergedIds = [] }) => {
      if (row) must(await supabase.from('shopping_trips').upsert(row))
      if (items.length) must(await supabase.from('shopping_trip_items').upsert(items))
      for (const [table, ids] of [
        ['grocery_items', groceryIds],
        ['expenses', expenseIds],
        ['receipt_photos', photoIds],
      ]) {
        if (ids.length) must(await supabase.from(table).update({ trip_id: trip.id }).in('id', ids))
      }
      if (row && mergedIds.length) must(await supabase.rpc('merge_expenses_into_purchase', { payload: { trip_id: trip.id, expense_ids: mergedIds } }))
      await reloadAll()
    },
    onFail: reloadAll,
  })
}

export function usePurchase() {
  const confirmPurchase = useCallback((purchase) => confirmCart(purchase), [])
  return { confirmPurchase, reopenTrip }
}
