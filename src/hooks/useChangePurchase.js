import { supabase } from '../lib/supabaseClient'
import { OFFLINE_MESSAGE, must } from '../lib/db'
import { isOffline } from '../lib/connection'
import { showToast, toastSaveError } from '../lib/feedback'
import { refreshStartedStores } from '../lib/tableStore'
import { allExpenseStores, groceryStore, receiptPhotoStore, tripStore } from '../lib/stores'
import { CHANGED_MEANWHILE, purchaseState, refusalText, refusedByDatabase, undoPayload } from '../lib/changePurchase'
import { PART_COLUMNS } from '../lib/sharedParts'

// "Change purchase ▾" → Date / Paid by (plan 9P, K205–K209, K237): one call
// to change_purchase (supabase/034), which writes every expense of the
// purchase (merged ones too), the purchase, its receipt photos and its SHOP
// cards together or not at all, and refuses when the purchase changed
// meanwhile (on another device). It needs a connection: nothing is queued.
// Amounts, stock, HOME items, history, purchase lines and orders are never
// touched. The store keeps its own path (usePurchase.setTripShop).

// The purchase as it is in the database now, in the request's shape (lib/
// changePurchase.js): the app's "was". null when the purchase is gone.
// Throws if it can't be read.
export async function readPurchase(tripId) {
  const [trip] = must(await supabase.from('shopping_trips').select('*').eq('id', tripId))
  if (!trip) return null
  const expenses = must(await supabase.from('expenses').select('*').eq('trip_id', tripId))
  const photos = must(await supabase.from('receipt_photos').select('*').eq('trip_id', tripId))
  const cards = must(await supabase.from('grocery_items').select('*').eq('trip_id', tripId))
  return purchaseState({ trip, expenses, photos, cards })
}

// What was written, shown on this device at once (every list that has
// those rows); then every list is read again in the background, so an
// expense moved into another month lands in the right one (and in the
// leftover's rows).
function showLocally({ trip_id: tripId, now }) {
  for (const e of now.expenses) {
    const patch = { expense_date: e.expense_date, paid_by: e.paid_by, ...Object.fromEntries(PART_COLUMNS.map((c) => [c, e[c]])) }
    allExpenseStores().forEach((s) => s.patchLocal([e.id], patch))
  }
  if (tripStore.isStarted()) tripStore.patchLocal([tripId], { trip_date: now.trip.trip_date, paid_by: now.trip.paid_by })
  if (receiptPhotoStore.isStarted()) for (const p of now.photos) receiptPhotoStore.patchLocal([p.id], { receipt_date: p.receipt_date })
  if (groceryStore.isStarted()) for (const c of now.cards) groceryStore.patchLocal([c.id], { payer: c.payer })
  refreshStartedStores().catch((error) => console.error(error))
}

// One request. → { error } (null when saved, or when it already was so).
async function send(payload) {
  const { error } = await supabase.rpc('change_purchase', { payload })
  if (error) return { error }
  showLocally(payload)
  return { error: null }
}

// Offline: said at once, nothing sent or queued.
function refuseOffline() {
  showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
  return { error: { message: OFFLINE_MESSAGE, offline: true } }
}

// A change from the panel, then a toast with Undo (20 s) that sends the
// old values back, row by row. → { error, refusal }:
//   refusal   the database's reason, for the panel's red line (the 034
//             notice, the guard text, …); the lists are read again
//   error     without refusal: offline, or a failed connection (the
//             toast "Couldn't save — check your connection." with Retry =
//             `again`, which presses Save again while the panel is open)
export async function changePurchase(payload, { message, again = null }) {
  if (isOffline()) return refuseOffline()
  const { error } = await send(payload)
  if (error) {
    if (refusedByDatabase(error)) {
      refreshStartedStores().catch((e) => console.error(e))
      return { error, refusal: refusalText(error) }
    }
    toastSaveError(error, again)
    return { error }
  }
  showToast({ message, action: { label: 'Undo', onClick: () => undoChange(payload) } })
  return { error: null }
}

// The toast's Undo: the same call with the old values (`was` and `now`
// swapped). Refused when the purchase changed meanwhile (the guard text);
// a failed connection offers Retry.
export async function undoChange(payload) {
  if (isOffline()) return refuseOffline()
  const back = undoPayload(payload)
  const { error } = await send(back)
  if (!error) return { error: null }
  if (refusedByDatabase(error)) {
    refreshStartedStores().catch((e) => console.error(e))
    toastSaveError(error, null, refusalText(error))
  } else {
    toastSaveError(error, () => undoChange(payload), "Couldn't undo — check your connection.")
  }
  return { error }
}

// The purchase is gone (deleted or reopened meanwhile): said like the guard.
export const GONE = { error: { message: CHANGED_MEANWHILE }, refusal: CHANGED_MEANWHILE }
