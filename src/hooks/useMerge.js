import { supabase } from '../lib/supabaseClient'
import { OFFLINE_MESSAGE } from '../lib/db'
import { isOffline } from '../lib/connection'
import { showToast, toastSaveError } from '../lib/feedback'
import { plainError } from '../lib/inventoryCategoryEdit'
import { mergeErrorMessage } from '../lib/merge'
import { money } from '../lib/pricing'
import { refreshStartedStores } from '../lib/tableStore'

// Old single expenses merged into one purchase, and split again
// (supabase/023). Their amount, category, date and payer never change;
// each takes the purchase's store while merged and gets its own back when
// split. The database checks every rule again and refuses with a plain
// message (e.g. the other phone merged them a moment ago).

const reload = () => refreshStartedStores()
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Runs one of the merge functions. Returns { data, error }; a refusal is
// shown as the database says it, nothing was changed then.
async function run(name, args) {
  if (isOffline()) {
    showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
    return { data: null, error: { message: OFFLINE_MESSAGE, offline: true } }
  }
  const { data, error } = await supabase.rpc(name, args)
  await reload()
  if (error) {
    const message = mergeErrorMessage(plainError(error))
    toastSaveError(error, null, message)
    return { data: null, error: { ...error, message } }
  }
  return { data, error: null }
}

// A new purchase from `expenseIds` (at least two, same day and payer).
// `id` is made once per merge form, so pressing again saves it once.
// Undo splits them again.
export async function mergeExpenses({ id, expenseIds, shopId = null, total = 0 }) {
  const result = await run('merge_expenses_into_purchase', { payload: { id, expense_ids: expenseIds, shop_id: shopId || null } })
  if (result.error) return result
  showToast({
    message: `${plural(expenseIds.length, 'expense')} merged into one purchase · ${money(total)}`,
    duration: 10000,
    action: { label: 'Undo', onClick: () => splitPurchase(id, expenseIds, { offerUndo: false }) },
  })
  return result
}

// Adds single expenses to an existing purchase of the same day and payer.
export async function addToPurchase({ tripId, expenseIds, total = 0 }) {
  const result = await run('merge_expenses_into_purchase', { payload: { trip_id: tripId, expense_ids: expenseIds } })
  if (result.error) return result
  showToast({
    message: `${plural(expenseIds.length, 'expense')} added to the purchase · ${money(total)}`,
    duration: 10000,
    action: { label: 'Undo', onClick: () => splitPurchase(tripId, expenseIds, { offerUndo: false }) },
  })
  return result
}

// Merged expenses become single expenses again, each with the store it
// had (`expenseIds` null = all of the purchase). A purchase made only by
// merging, with nothing left, is gone. Undo merges them back.
export async function splitPurchase(tripId, expenseIds = null, { offerUndo = true } = {}) {
  let before = null
  if (offerUndo && !isOffline()) {
    let q = supabase.from('expenses').select('id, amount').eq('trip_id', tripId).not('merged_at', 'is', null)
    if (expenseIds) q = q.in('id', expenseIds)
    const trip = await supabase.from('shopping_trips').select('id, shop_id').eq('id', tripId).maybeSingle()
    const rows = await q
    if (!rows.error && !trip.error) before = { expenses: rows.data, trip: trip.data }
  }
  const result = await run('split_merged_purchase', { trip_id: tripId, expense_ids: expenseIds })
  if (result.error) return result
  const count = Number(result.data) || 0
  if (count === 0) {
    showToast({ message: 'Nothing to split — it was already split (on the other phone?).' })
    return result
  }
  const undo = before ? undoSplit(tripId, before) : null
  showToast({
    message: `${plural(count, 'expense')} single again, each with its own store`,
    duration: 10000,
    action: undo ? { label: 'Undo', onClick: undo } : null,
  })
  return result
}

// Merges split expenses back: into the same purchase if it is still
// there, else as the same purchase again (same id and store).
function undoSplit(tripId, { expenses, trip }) {
  const ids = expenses.map((e) => e.id)
  if (!ids.length || !trip) return null
  return async () => {
    const still = await supabase.from('shopping_trips').select('id').eq('id', tripId).maybeSingle()
    const payload = still.data ? { trip_id: tripId, expense_ids: ids } : { id: tripId, expense_ids: ids, shop_id: trip.shop_id }
    if (!still.data && ids.length < 2) return showToast({ message: 'One expense alone is not a purchase — tick it with another one and merge again.' })
    await run('merge_expenses_into_purchase', { payload })
  }
}
