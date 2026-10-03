import { enqueue, flush, getQueue, registerHandler, setAfterSync } from './offlineQueue'
import { groceryStore, pantryStore } from './stores'
import { refreshStartedStores, setRefreshGate } from './tableStore'
import { expiryState, isDurable, normalizeItem, syncShoppingForItem } from './inventory'
import { followUp, must } from './db'
import { askDialog, showToast } from './feedback'
import { expiredChoice, expiredDialog, packSizeDialog } from './purchaseDialogs'
import { lineTotal } from './pricing'
import { normName } from './grocery'
import { supabase } from './supabaseClient'
import { findPantryItem, needsExpiryChoice, needsPackSize, purchasedQuantity, toggleGroceryItem } from '../hooks/useGroceryItems'

// The changes that still work without signal, chosen because they're
// safe to send later:
//   toggle   – check off / uncheck a grocery entry. Sent as "make it
//              checked" (or unchecked): skipped if the other phone already
//              did it, and checking then unchecking offline sends nothing.
//   quantity – how much of an open grocery entry to buy: the last value
//              wins, so sending it twice changes nothing.
//   stock    – the pantry − / +. Each tap has its own id and is applied by
//              apply_stock_change (supabase/009), which skips an id it has
//              already applied, so a resend never counts twice.
// The screen shows each change at once; the real values replace it once
// everything is sent.

const round = (n) => Math.round(n * 100) / 100

function localPantryFor(item) {
  const rows = pantryStore.getSnapshot().rows
  return rows.find((p) => p.id === item.pantry_item_id) ?? rows.find((p) => normName(p.name) === normName(item.name)) ?? null
}

function showStock(pantry, delta) {
  pantryStore.patchLocal([pantry.id], { current_stock: round(Math.max(0, (Number(pantry.current_stock) || 0) + delta)) })
}

// Same questions as online (pack size, expired stock), answered from the
// lists kept on the phone; then queued.
export function queueToggle(original, options = {}) {
  const completed = !original.completed
  const item = completed && options.quantity > 0 ? { ...original, quantity: options.quantity } : original
  const pantry = isDurable(item) ? null : localPantryFor(item)
  if (pantry) {
    const amount = purchasedQuantity(pantry, item, options.packSize)
    if (amount === null) return needsPackSize(item, pantry)
    const expired = completed && expiryState(pantry) === 'expired'
    if (expired && !options.expired) return needsExpiryChoice(pantry)
    const discarded = expired && options.expired.discard ? Number(pantry.current_stock) || 0 : 0
    showStock(pantry, completed ? amount - discarded : -amount)
  }
  enqueue(
    'toggle',
    { id: item.id, completed, options: { ...options, at: new Date().toISOString() } },
    { key: item.id, label: `${completed ? 'checking off' : 'unchecking'} "${item.name}"` }
  )
  groceryStore.patchLocal([item.id], { completed, quantity: item.quantity })
  return {}
}

export function queueQuantity(item, quantity) {
  enqueue('quantity', { id: item.id, quantity }, { key: item.id, label: `the quantity of "${item.name}"` })
  groceryStore.patchLocal([item.id], { quantity })
  return { error: null }
}

export function queueStock(item, delta, reason) {
  enqueue('stock', { opId: crypto.randomUUID(), itemId: item.id, delta, reason }, { label: `the stock of "${item.name}"` })
  showStock(item, delta)
  return { error: null }
}

registerHandler('toggle', async ({ id, completed, options }) => {
  const fresh = must(await supabase.from('grocery_items').select('*').eq('id', id).maybeSingle())
  // Deleted meanwhile, or the other phone already did it.
  if (!fresh || fresh.completed === completed) return
  const item = normalizeItem(fresh)
  const answers = { ...options }
  for (;;) {
    const pantry = isDurable(item) ? null : await findPantryItem(item)
    const total = lineTotal(answers.quantity ? { ...item, quantity: answers.quantity } : item, pantry)
    const result = await toggleGroceryItem(item, total, answers)
    // The pantry changed since: ask again, now with the real data.
    if (result?.needsPackSize) {
      const answer = await askDialog(packSizeDialog(result.needsPackSize))
      if (!answer) return showToast({ message: `"${item.name}" wasn't ${completed ? 'checked off' : 'unchecked'}.` })
      answers.packSize = answer.packSize
    } else if (result?.needsExpiryChoice) {
      const answer = await askDialog(expiredDialog({ ...result.needsExpiryChoice, quantity: answers.quantity ?? item.quantity, listUnit: item.unit }))
      if (!answer) return showToast({ message: `"${item.name}" wasn't checked off.` })
      answers.expired = expiredChoice(answer)
      answers.quantity = answer.quantity
    } else return
  }
})

registerHandler('quantity', async ({ id, quantity }) => {
  // Only while still on the list: a checked-off entry keeps what was bought.
  must(await supabase.from('grocery_items').update({ quantity }).eq('id', id).eq('completed', false))
})

registerHandler('stock', async ({ opId, itemId, delta, reason }) => {
  const data = must(await supabase.rpc('apply_stock_change', { op_id: opId, item_id: itemId, delta, reason }))
  if (!data?.id) return
  const item = normalizeItem(data)
  pantryStore.upsertLocal([item])
  await followUp('the shopping list', () => syncShoppingForItem(item))
})

// While changes wait to be sent, the lists aren't reloaded (they'd lose
// those changes on screen); once everything is sent, they are.
setRefreshGate(() => getQueue().length === 0)
setAfterSync(refreshStartedStores)

// Anything left from last time goes out as soon as the app opens online.
export function startOfflineSync() {
  flush()
}
