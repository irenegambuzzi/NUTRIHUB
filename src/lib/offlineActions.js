import { enqueue, flush, getQueue, registerHandler, setAfterSync } from './offlineQueue'
import { groceryStore, pantryStore } from './stores'
import { refreshStartedStores, setRefreshGate } from './tableStore'
import { normalizeItem, syncShoppingForItem } from './inventory'
import { followUp, must } from './db'
import { supabase } from './supabaseClient'

// The changes that still work without signal, chosen because they're
// safe to send later:
//   cart     – put a grocery entry in the cart or take it out (nothing
//              else changes until the purchase is confirmed, which needs a
//              connection). The last tap wins.
//   quantity – how much of an open grocery entry to buy: the last value
//              wins, so sending it twice changes nothing.
//   stock    – the pantry − / +. Each tap has its own id and is applied by
//              apply_stock_change (supabase/009), which skips an id it has
//              already applied, so a resend never counts twice.
// The screen shows each change at once; the real values replace it once
// everything is sent.

const round = (n) => Math.round(n * 100) / 100

function showStock(pantry, delta) {
  pantryStore.patchLocal([pantry.id], { current_stock: round(Math.max(0, (Number(pantry.current_stock) || 0) + delta)) })
}

// In or out of the cart; the last tap wins, so sending it late or twice
// changes nothing else.
export function queueCart(item, inCart) {
  enqueue('cart', { id: item.id, inCart }, { key: item.id, label: `${inCart ? 'putting' : 'taking'} "${item.name}" ${inCart ? 'in' : 'out of'} the cart` })
  groceryStore.patchLocal([item.id], { in_cart: inCart })
  return { error: null }
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

const setInCart = async ({ id, inCart }) => {
  // Only while not bought yet.
  must(await supabase.from('grocery_items').update({ in_cart: inCart }).eq('id', id).eq('completed', false))
}

registerHandler('cart', setInCart)

// Check-offs queued by an older version of the app: now they only put the
// item in the cart (or take it out) — the purchase is confirmed in the app.
registerHandler('toggle', ({ id, completed }) => setInCart({ id, inCart: completed }))

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
