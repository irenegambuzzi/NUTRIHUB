import { useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { normalizeItem, syncShoppingForItem } from '../lib/inventory'
import { allExpenseStores, groceryStore, orderGroupStore, orderStore, pantryStore, shopStore } from '../lib/stores'
import { expensePatchForOrder, expenseRowForOrder, missingPackColumn, normalizeUrl, orderBase, packColumnsReady, withoutPackColumns } from '../lib/orders'
import { groupDiscount, groupMembers, groupPayload, placeOf, undoGroupPayload } from '../lib/orderGroups'
import { shopsAvailable } from '../lib/shops'
import { isOffline } from '../lib/connection'
import { ENTRY_GRACE_MS } from '../lib/newItems'
import { groupOf, saveOrderGroup, sayKept } from './useOrderGroups'

const refreshOrdersAndExpenses = () => Promise.all([orderStore.refresh(), ...allExpenseStores().map((s) => s.refresh())])
const showExpenses = (rows) => rows.length && allExpenseStores().forEach((s) => s.upsertLocal(rows))

// The order's own columns from the form's values. Dates are YYYY-MM-DD,
// '' means none; a last expected date only makes sense with a first one.
// With a discount `price` is the amount paid and `listPrice` the normal
// price; both come from the form (undefined = the caller doesn't know about
// discounts: those columns are left alone).
// The quantity and unit are only there for an order linked to a HOME item
// (supabase/021), and only sent then. `packSize`: how many of the HOME
// item's stock units are in 1 package of this order (plan 9H; null = not
// typed yet; undefined = the form has no pack field: the column is left
// alone).
export function orderRowFrom(values) {
  return {
    item_name: values.itemName.trim(),
    details: values.details?.trim() || null,
    shop_id: values.shopId || null,
    order_date: values.orderDate,
    price: Number(values.price),
    paid_by: values.paidBy,
    category_id: values.categoryId || null,
    expected_date: values.expectedDate || null,
    expected_until: values.expectedDate && values.expectedUntil ? values.expectedUntil : null,
    order_url: normalizeUrl(values.url),
    // The normal price and the discount (only an order's own discount: a
    // coupon belongs to purchases). `price` above is what was paid.
    ...(values.listPrice !== undefined
      ? { list_price: values.listPrice ?? null, discount_kind: values.discountKind ?? null, discount_value: values.discountValue ?? null }
      : {}),
    ...(values.quantity !== undefined ? { quantity: Number(values.quantity) > 0 ? Number(values.quantity) : null, unit: values.unit || null } : {}),
    ...(values.packSize !== undefined ? { pack_size: Number(values.packSize) > 0 ? Number(values.packSize) : null } : {}),
  }
}

// Writes an order row (`write(row)` → the Supabase query). Before
// supabase/027 the database has no pack size yet: the row is then written
// again without it, so saving an order never fails or is blocked by it
// (and no error is shown). → { rows, sent }: what came back and the row
// really written.
async function writeOrderRow(row, write) {
  const result = await write(row)
  if (result.error && 'pack_size' in row && missingPackColumn(result.error)) {
    const sent = withoutPackColumns(row)
    return { rows: must(await write(sent)), sent }
  }
  return { rows: must(result), sent: row }
}

// The database refused a second order on the way for one SHOP list entry
// (orders_open_grocery_key): said in words.
const ALREADY_ORDERED = 'This item already has an order on the way — open it in the SHOP list or in Orders.'
const friendly = (error) => (error?.code === '23505' && String(error.message).includes('orders_open_grocery_key') ? Object.assign(new Error(ALREADY_ORDERED), { rolledBack: true }) : error)

const originalOf = (order, row) => Object.fromEntries(Object.keys(row).map((k) => [k, order[k] ?? null]))

// A new order and the expense it creates (the money is spent when
// ordering), saved together or not at all. `ids` ({ orderId, expenseId,
// groupId }) are made once per form, so pressing Save again after a
// dropped connection can't make a second expense, order or group. `link`
// ({ pantryItemId, groceryItemId }), for "Order online" from the SHOP
// list: the order is linked to the HOME item and the list entry, and the
// entry leaves the cart. The database allows one order on the way per
// entry. `values.joinWith` (plan 9I, K2): { groupId } or { orderId } — the
// new order is the same order at the store as that group, or as that
// single order (which makes a new group of the two); a group's discount
// is then spread again over all its orders.
export function createOrder(values, { orderId, expenseId, groupId = null }, link = null) {
  const row = {
    id: orderId,
    ...orderRowFrom(values),
    status: 'on_the_way',
    expense_id: expenseId,
    ...(link ? { pantry_item_id: link.pantryItemId ?? null, grocery_item_id: link.groceryItemId ?? null } : {}),
  }
  const expense = { id: expenseId, ...expenseRowForOrder(row, shopsAvailable(shopStore.getSnapshot())) }
  const join = values.joinWith ?? null
  return attempt(
    () =>
      inSteps(async (onFail) => {
        try {
          // Saved already, joined and all, and only the answer was lost.
          if (join && must(await supabase.from('orders').select('id, group_id').eq('id', orderId)).some((o) => o.group_id)) return Promise.all([refreshOrdersAndExpenses(), orderGroupStore.refresh()])
          if (link?.groceryItemId) {
            const open = must(await supabase.from('orders').select('id').eq('grocery_item_id', link.groceryItemId).eq('status', 'on_the_way').neq('id', orderId))
            if (open.length) throw Object.assign(new Error(ALREADY_ORDERED), { rolledBack: true })
          }
          const expenseRows = must(await supabase.from('expenses').upsert([expense], { onConflict: 'id', ignoreDuplicates: true }).select())
          onFail(async () => must(await supabase.from('expenses').delete().eq('id', expenseId)))
          const { rows: orderRows } = await writeOrderRow(row, (r) => supabase.from('orders').upsert([r], { onConflict: 'id' }).select())
          if (join) {
            onFail(async () => must(await supabase.from('orders').delete().eq('id', orderId)))
            await joinGroup(orderRows[0], join, groupId)
          }
          // A retry finds the expense already there: nothing new to show.
          if (expenseRows.length && !join) showExpenses(expenseRows)
          else await Promise.all(allExpenseStores().map((s) => s.refresh()))
          if (!join) orderStore.upsertLocal(orderRows)
          if (link?.groceryItemId) {
            must(await supabase.from('grocery_items').update({ in_cart: false }).eq('id', link.groceryItemId))
            groceryStore.patchLocal([link.groceryItemId], { in_cart: false })
          }
        } catch (error) {
          throw friendly(error)
        }
      }),
    { retry: false, onFail: refreshOrdersAndExpenses }
  )
}

// A new order (just saved, `order`) joins a group, or a single order as a
// new group (`newGroupId`), with the group's discount spread again over
// every order of it (save_order_group, supabase/028). Throws when refused.
async function joinGroup(order, join, newGroupId) {
  const orders = orderStore.getSnapshot().rows
  if (join.groupId) {
    const group = orderGroupStore.getSnapshot().rows.find((g) => g.id === join.groupId)
    if (!group) throw Object.assign(new Error('That order group is still loading — try again in a moment.'), { rolledBack: true })
    const members = [...groupMembers(group.id, orders).filter((o) => o.id !== order.id), order]
    return sayKept(await saveOrderGroup(groupPayload({ id: group.id, place: placeOf(group), discount: groupDiscount(group), members })))
  }
  const other = orders.find((o) => o.id === join.orderId)
  if (!other) throw Object.assign(new Error('That order was deleted meanwhile — open Orders again.'), { rolledBack: true })
  return saveOrderGroup(groupPayload({ id: newGroupId ?? crypto.randomUUID(), place: placeOf(other), members: [other, order] }))
}

// Saves an edited order. The linked expense follows what changed in its
// price, date, category, payer or store (and the name, when the expense
// still carries the old one); nothing else of it is touched.
export function editOrder(order, values) {
  if (order.group_id) return editGroupMember(order, values)
  const row = orderRowFrom(values)
  const patch = order.expense_id ? expensePatchForOrder(order, { ...order, ...row }, shopsAvailable(shopStore.getSnapshot())) : {}
  return attempt(
    () =>
      inSteps(async (onFail) => {
        const { rows: orderRows, sent } = await writeOrderRow(row, (r) => supabase.from('orders').update(r).eq('id', order.id).select())
        onFail(async () => must(await supabase.from('orders').update(originalOf(order, sent)).eq('id', order.id)))
        if (order.expense_id) {
          if (row.item_name !== order.item_name) {
            const current = must(await supabase.from('expenses').select('description').eq('id', order.expense_id).maybeSingle())
            if (current?.description === order.item_name) patch.description = row.item_name
          }
          if (Object.keys(patch).length) showExpenses(must(await supabase.from('expenses').update(patch).eq('id', order.expense_id).select()))
        }
        orderStore.upsertLocal(orderRows)
      }),
    { retry: false, onFail: refreshOrdersAndExpenses }
  )
}

// An order in an order group (plan 9I) is edited like any other, except
// that its store, order date and payer belong to the group (K7: changed
// there, for all its orders), and its price goes through the group: when
// what it costs before the group discount changes (its price or its own
// discount, K3), the group's discount is spread again over all its orders,
// in the same step as their prices and expenses (save_order_group).
function editGroupMember(order, values) {
  const { shop_id: _shop, order_date: _date, paid_by: _payer, price: _price, ...row } = orderRowFrom(values)
  const base = Math.round(Number(values.price) * 100) / 100
  const patch = order.expense_id ? expensePatchForOrder(order, { ...order, ...row }, shopsAvailable(shopStore.getSnapshot())) : {}
  return attempt(
    () =>
      inSteps(async (onFail) => {
        const { rows: orderRows, sent } = await writeOrderRow(row, (r) => supabase.from('orders').update(r).eq('id', order.id).select())
        onFail(async () => must(await supabase.from('orders').update(originalOf(order, sent)).eq('id', order.id)))
        orderStore.upsertLocal(orderRows)
        if (base !== orderBase(order)) {
          const { group, members } = groupOf(order)
          if (!group) throw Object.assign(new Error('That order group is still loading — try again in a moment.'), { rolledBack: true })
          const answer = sayKept(await saveOrderGroup(groupPayload({ id: group.id, place: placeOf(group), discount: groupDiscount(group), members, bases: { [order.id]: base } })))
          onFail(() => saveOrderGroup(undoGroupPayload({ id: group.id, groupBefore: group, before: members, now: answer.orders })))
        }
        if (order.expense_id) {
          if (row.item_name !== order.item_name) {
            const current = must(await supabase.from('expenses').select('description').eq('id', order.expense_id).maybeSingle())
            if (current?.description === order.item_name) patch.description = row.item_name
          }
          if (Object.keys(patch).length) showExpenses(must(await supabase.from('expenses').update(patch).eq('id', order.expense_id).select()))
        }
      }),
    { retry: false, onFail: () => Promise.all([refreshOrdersAndExpenses(), orderGroupStore.refresh()]) }
  )
}

// The order arrived. Only the order (and its SHOP list entry) changes: its
// expense was made when ordering and is never made again. Gives the order
// as saved (`data`), for the Undo on the toast.
export function markArrived(order, date) {
  return attempt(
    async () => {
      const rows = must(await supabase.from('orders').update({ status: 'arrived', arrived_date: date }).eq('id', order.id).select())
      orderStore.upsertLocal(rows)
      // Ordered from the SHOP list for something not in HOME: it leaves the list.
      if (order.grocery_item_id) {
        must(await supabase.from('grocery_items').update({ completed: true, in_cart: false }).eq('id', order.grocery_item_id))
        await groceryStore.refresh()
      }
      return rows[0] ?? null
    },
    { onFail: () => Promise.all([orderStore.refresh(), groceryStore.refresh()]) }
  )
}

// A durable order arrived (lib/durable.js orderLock; `kind` 'durable' or
// 'service'): marked arrived like any other, but nothing goes into HOME,
// so neither "Arrived" dialog opens (plan 9F). The toast has Undo (plan
// 9J).
export async function markDurableArrived(order, date, kind = 'durable') {
  const result = await markArrived(order, date)
  if (!result.error) arrivedToast(`“${order.item_name}” arrived — ${kind === 'service' ? 'service' : 'durable'}, nothing added to HOME.`, result.data ? { order, arrived: result.data } : null)
  return result
}

// The HOME item (or group) an order is linked to, if it is still there.
export const linkedItemOf = (order, items) => (order.pantry_item_id ? items.find((i) => i.id === order.pantry_item_id) ?? null : null)

const refreshFlow = () => Promise.all([orderStore.refresh(), pantryStore.refresh(), groceryStore.refresh(), ...allExpenseStores().map((s) => s.refresh())])

// The SHOP list follows the HOME item of a linked order: back to "to
// buy" if it is still low, gone if it isn't (automatic entries only). An
// order not linked to HOME follows the item its arrival went to
// (`itemId`, plan 9J), if any.
export function syncListFor(order, itemId = null) {
  const id = order.pantry_item_id ?? itemId
  if (!id) return Promise.resolve(true)
  return followUp('the shopping list', async () => {
    const item = must(await supabase.from('pantry_items').select('*').eq('id', id).maybeSingle())
    if (item) await syncShoppingForItem(normalizeItem(item))
    await groceryStore.refresh()
  })
}

export const alreadyArrivedMessage = (order) => `"${order.item_name}" was already marked as arrived (on the other phone?) — nothing was added again.`

// An order arrived — linked to a HOME item, or through "It arrived!" (plan
// 9J): the stock (`delta`, in the item's own unit) goes to `itemId` — an
// item, or a variant of a group — in one step with marking it arrived
// (arrive_order, supabase/021), so "Back on the way" and Undo can take out
// exactly that. Only the first Arrived adds anything, whichever phone
// presses it. `newVariant` / `newItem` ({ id, fields }): a new variant of
// a group, or a new HOME item ("Create a new item"), made first with stock
// 0 and an id fixed by the dialog, so pressing again never makes a second
// one; when the other phone was first it is deleted again (still at 0).
// Never an expense. `pack` ({ unit, value, firstTime }): the pack field of
// the arrival and `packItem` the item it counts for (plan 9H,
// rememberArrivalPack). Returns { error, added, arrival }: `arrival` is
// what the Undo on the toast needs (undoArrival).
export async function arriveLinkedOrder(order, { itemId, delta, newVariant = null, newItem = null, date, pack = null, packItem = null }) {
  const made = newVariant ?? newItem
  let added = false
  let arrived = null
  const result = await attempt(
    async () => {
      if (made) {
        const fresh = must(await supabase.from('pantry_items').upsert([{ id: made.id, ...made.fields, current_stock: 0 }], { onConflict: 'id', ignoreDuplicates: true }).select())
        // Already made by a try that failed after this step: it gets what
        // was typed now (a name changed meanwhile), only while still at 0.
        if (!fresh?.length) {
          const { current_stock: _stock, ...fields } = made.fields
          must(await supabase.from('pantry_items').update(fields).eq('id', made.id).eq('current_stock', 0))
        }
      }
      const answer = must(await supabase.rpc('arrive_order', { order_id: order.id, item_id: made?.id ?? itemId ?? null, add_qty: delta || 0, arrived_on: date }))
      added = Boolean(answer?.added)
      if (!added && made) await supabase.from('pantry_items').delete().eq('id', made.id).eq('current_stock', 0)
      if (answer?.order) {
        orderStore.upsertLocal([answer.order])
        arrived = answer.order
      }
    },
    { retry: false, onFail: refreshFlow }
  )
  if (result.error) return { ...result, added: false, arrival: null }
  if (added && delta > 0) await rememberArrivalPack(order, packItem, pack)
  await refreshFlow()
  await syncListFor(order, added ? made?.id ?? itemId : null)
  return { ...result, added, arrival: added && arrived ? { order, arrived, madeId: made?.id ?? null } : null }
}

// A new item or variant made for an arrival that then never happened
// (the second step failed and the dialog was closed): deleted again while
// it is still empty and nothing was written about it.
export function discardUnusedItem(id) {
  return followUp('HOME', async () => {
    if (must(await supabase.from('stock_logs').select('id').eq('item_id', id)).length) return
    const gone = must(await supabase.from('pantry_items').delete().eq('id', id).eq('current_stock', 0).select())
    if (gone.length) pantryStore.removeLocal([id])
  })
}

// The toast after Arrived (plan 9J, K11): 10 seconds with Undo when the
// arrival is known (`arrival` from arriveLinkedOrder / markArrived), so a
// wrong tap is put right at once. Without it a plain toast.
export function arrivedToast(message, arrival) {
  showToast({ message, ...(arrival ? { duration: 10000, action: { label: 'Undo', onClick: () => undoArrival(arrival) } } : {}) })
}

export const changedMeanwhileMessage = (order) => `"${order.item_name}" changed meanwhile (on the other phone?) — nothing was undone.`

// Whether the order still has the arrival we made (K5): arrived, with the
// same history row — or, when nothing was added, the same day and no
// stock. Otherwise the other phone put it back (and maybe arrived it
// again) meanwhile, and Undo must not touch that.
const sameArrival = (now, arrived) =>
  Boolean(now) &&
  now.status === 'arrived' &&
  (arrived.arrived_log_id ? now.arrived_log_id === arrived.arrived_log_id : !now.arrived_log_id && now.arrived_date === arrived.arrived_date && !(Number(now.stock_added) > 0))

// A new HOME item or variant made by an arrival (plan 9J, K3 / K4), as it
// is now, when it can go again with the arrival: after taking out what the
// arrival added it is at 0, it has no history row but the arrival's, no
// SHOP entry but its automatic ones still "to buy", and no other order.
// `madeId`: the item the app made (the toast's Undo knows it); without it
// ("Back on the way" days later) the arrival's item counts as made by it
// only when it was created within 30 seconds before the arrival's history
// row. Read before unarrive_order, which deletes that row. Any doubt →
// null, and the item is kept.
async function madeByArrival(order, madeId = null) {
  const id = madeId ?? order.arrived_item_id
  if (!id || (madeId && order.arrived_item_id && order.arrived_item_id !== madeId)) return null
  const item = must(await supabase.from('pantry_items').select('*').eq('id', id).maybeSingle())
  if (!item || item.is_group) return null
  const logs = must(await supabase.from('stock_logs').select('id, created_at').eq('item_id', id))
  if (logs.some((l) => l.id !== order.arrived_log_id)) return null
  if (!madeId) {
    const own = logs.find((l) => l.id === order.arrived_log_id)
    const gap = own ? Date.parse(own.created_at) - Date.parse(item.created_at) : NaN
    if (!(gap >= 0 && gap <= ENTRY_GRACE_MS)) return null
  }
  const added = order.arrived_item_id === id ? Number(order.stock_added) || 0 : 0
  if ((Number(item.current_stock) || 0) - added > 0) return null
  const entries = must(await supabase.from('grocery_items').select('id, auto_generated, completed, in_cart').eq('pantry_item_id', id))
  if (entries.some((g) => !g.auto_generated || g.completed || g.in_cart)) return null
  const linked = must(await supabase.from('orders').select('id').eq('pantry_item_id', id).neq('id', order.id))
  const arrivedThere = must(await supabase.from('orders').select('id').eq('arrived_item_id', id).neq('id', order.id))
  if (linked.length || arrivedThere.length) return null
  return normalizeItem(item)
}

// Deletes an item made by an arrival, once the arrival is undone: only
// while it is still at 0 with no history row (the other phone may have
// used it meanwhile); its automatic "to buy" entries go with it. Its
// group, for a variant, is judged again. → whether it was deleted.
async function deleteMadeItem(item) {
  let gone = false
  await followUp(`the new item "${item.name}"`, async () => {
    if (must(await supabase.from('stock_logs').select('id').eq('item_id', item.id)).length) return
    const entries = must(await supabase.from('grocery_items').select('id').eq('pantry_item_id', item.id).eq('auto_generated', true).eq('completed', false).eq('in_cart', false))
    gone = must(await supabase.from('pantry_items').delete().eq('id', item.id).eq('current_stock', 0).select()).length > 0
    if (!gone) return
    pantryStore.removeLocal([item.id])
    if (entries.length) {
      must(await supabase.from('grocery_items').delete().in('id', entries.map((g) => g.id)))
      groceryStore.removeLocal(entries.map((g) => g.id))
    }
  })
  return gone
}

// What came out of HOME, for the toasts: "6 pcs taken out of "Cat Wet
// Food"", "2 pcs taken out, and the new item "Catnip Snack" deleted from
// HOME".
function takenOutText({ qty, item, made, gone }) {
  const what = made ? `the new ${made.group_id ? 'variant' : 'item'} "${made.name}"` : ''
  if (gone) return qty ? `${qty} taken out, and ${what} deleted from HOME` : `${what} deleted from HOME`
  if (!qty) return ''
  return `${qty} taken out of "${item?.name ?? made?.name ?? 'HOME'}"${made ? ' (kept in HOME: it changed meanwhile)' : ''}`
}

// Undo on the Arrived toast (plan 9J, K11): as if Arrived had never been
// pressed. Only while the order still has this arrival (K5); then
// unarrive_order takes out exactly the stock it added and deletes its
// history row, the order and its SHOP entry are on the way again, a
// first-time usual size is undone (restoreArrivalPack) and the order's
// pack size is what it was before (K8); a new item or variant made by it
// goes too while untouched (K3, K4); the SHOP list is judged again. Never
// a price, an order group, a share or an expense. Refused offline.
export async function undoArrival({ order, arrived, madeId = null }) {
  let state = null
  const result = await attempt(
    async () => {
      const now = must(await supabase.from('orders').select('*').eq('id', order.id).maybeSingle())
      if (!sameArrival(now, arrived)) return (state = { changed: true })
      const made = madeId ? await madeByArrival(now, madeId) : null
      const item = now.arrived_item_id ? pantryStore.getSnapshot().rows.find((r) => r.id === now.arrived_item_id) ?? null : null
      const row = must(await supabase.rpc('unarrive_order', { order_id: order.id }))
      if (row?.id) orderStore.upsertLocal([row])
      state = { now, made, item }
    },
    { retry: false, onFail: refreshFlow }
  )
  if (result.error) return result
  if (state.changed) {
    showToast({ message: changedMeanwhileMessage(order), tone: 'error' })
    await refreshFlow()
    return { error: null, changed: true }
  }
  const { now, made, item } = state
  await restoreArrivalPack(now)
  if (packColumnsReady(order) && (Number(now.pack_size) || null) !== (Number(order.pack_size) || null)) {
    await followUp('the pack size', async () => orderStore.upsertLocal(must(await supabase.from('orders').update({ pack_size: order.pack_size ?? null }).eq('id', order.id).select())))
  }
  const gone = made ? await deleteMadeItem(made) : false
  await refreshFlow()
  await syncListFor(order, gone ? made.group_id : now.arrived_item_id ?? madeId)
  const qty = Number(now.stock_added) > 0 ? `${Number(now.stock_added)} ${item?.unit ?? made?.unit ?? ''}`.trim() : ''
  const taken = takenOutText({ qty, item, made: madeId ? made ?? item : null, gone })
  showToast({ message: `"${order.item_name}" is on the way again${taken ? ` — ${taken}` : ''}` })
  return { error: null }
}

// After Arrived (plan 9H), once the stock is in: the order keeps the pack
// size typed there (orders.pack_size), and a first-time size becomes the
// item's usual size — only while the item still has none (the other phone
// may have given it one meanwhile), and only with the usual size it had
// before kept on the order (orders.arrival_pack_before, with `saved`: what
// this arrival wrote), so "Put back on the way" can undo exactly that.
// Before supabase/027 nothing is written here: the stock is right already,
// and with nothing saved the undo stays exact. A failure here leaves the
// arrival as it is (toast with Retry).
async function rememberArrivalPack(order, item, pack) {
  if (!(pack?.value > 0) || !packColumnsReady(order)) return true
  const first = Boolean(pack.firstTime && item && !item.is_group)
  const before = first ? { packaging_unit: item.packaging_unit ?? null, quantity_per_pack: item.quantity_per_pack ?? null } : null
  const saved = { packaging_unit: pack.unit, quantity_per_pack: pack.value }
  return followUp('the pack size', async () => {
    orderStore.upsertLocal(must(await supabase.from('orders').update({ pack_size: pack.value, ...(first ? { arrival_pack_before: { ...before, saved } } : {}) }).eq('id', order.id).select()))
    if (!first) return
    let update = supabase.from('pantry_items').update(saved).eq('id', item.id).is('quantity_per_pack', null)
    update = before.packaging_unit ? update.eq('packaging_unit', before.packaging_unit) : update.is('packaging_unit', null)
    if (must(await update.select()).length) return
    // Nothing was saved: the item has a usual size now. (Unless a first
    // try already saved this one, and only its answer was lost.)
    const now = must(await supabase.from('pantry_items').select('packaging_unit, quantity_per_pack').eq('id', item.id).maybeSingle())
    if (now && now.packaging_unit === saved.packaging_unit && Number(now.quantity_per_pack) === saved.quantity_per_pack) return
    orderStore.upsertLocal(must(await supabase.from('orders').update({ arrival_pack_before: null }).eq('id', order.id).select()))
  })
}

// "Back on the way" days later (plan 9J, K3 / K4): the new item or variant
// this arrival made, when it would go with it (madeByArrival), or null —
// also when it can't be read now (then it is simply kept).
export async function itemMadeByArrival(order) {
  if (!(Number(order.stock_added) > 0) || !order.arrived_item_id || !order.arrived_log_id || isOffline()) return null
  try {
    return await madeByArrival(order)
  } catch (error) {
    console.error(error)
    return null
  }
}

// An arrived order goes back on the way — any arrived order (plan 9J,
// K10), so its SHOP entry is on the way again too: the stock its arrival
// added comes out of HOME again (unarrive_order, supabase/021), exactly
// `stock_added`, whatever pack size was typed; a usual size that arrival
// saved the first time is undone (restoreArrivalPack); `made` (from
// itemMadeByArrival) is deleted again; the SHOP list is judged again for
// the item. The pack size stays (the next Arrived starts with it).
export async function unarriveOrder(order, { made = null } = {}) {
  const result = await attempt(
    async () => {
      const row = must(await supabase.rpc('unarrive_order', { order_id: order.id }))
      if (row?.id) orderStore.upsertLocal([row])
    },
    { onFail: refreshFlow }
  )
  if (!result.error) {
    await restoreArrivalPack(order)
    const gone = made ? await deleteMadeItem(made) : false
    await refreshFlow()
    await syncListFor(order, gone ? made.group_id : order.arrived_item_id)
  }
  return result
}

// The item gets back the usual size it had before the arrival
// (orders.arrival_pack_before) — only while it still has exactly what that
// arrival saved; changed meanwhile (e.g. in the HOME editor), it is left as
// it is. Either way the order forgets it, so a later Arrived follows the
// first-time rule again. `order` is the order as it was arrived (its item).
async function restoreArrivalPack(order) {
  const before = order.arrival_pack_before
  if (!before) return true
  return followUp('the usual pack size', async () => {
    const saved = before.saved
    if (order.arrived_item_id && saved?.packaging_unit && Number(saved.quantity_per_pack) > 0) {
      must(
        await supabase
          .from('pantry_items')
          .update({ packaging_unit: before.packaging_unit ?? null, quantity_per_pack: before.quantity_per_pack ?? null })
          .eq('id', order.arrived_item_id)
          .eq('packaging_unit', saved.packaging_unit)
          .eq('quantity_per_pack', saved.quantity_per_pack)
          .select()
      )
    }
    orderStore.upsertLocal(must(await supabase.from('orders').update({ arrival_pack_before: null }).eq('id', order.id).select()))
  })
}

// Cancelled or returned, as of `today`: the order goes to History, and its
// expense is kept or deleted. Said with "Order moved to History" and Undo,
// which puts everything back exactly (the order on the way, and the
// expense, if it was deleted, with its links). `outcomeKnown`: the database
// has "Returned" and the expense outcome (supabase/020); before that a
// returned order is saved as cancelled and no outcome is stored.
export function markCancelled(order, { kind = 'cancelled', deleteExpense, today, outcomeKnown }) {
  const removing = Boolean(deleteExpense && order.expense_id)
  const status = kind === 'returned' && outcomeKnown ? 'returned' : 'cancelled'
  const patch = {
    status,
    arrived_date: today,
    ...(outcomeKnown ? { expense_outcome: order.expense_id ? (removing ? 'deleted' : 'kept') : null } : {}),
  }
  const before = { ...originalOf(order, patch), expense_id: order.expense_id ?? null }
  return deleteWithUndo({
    message: 'Order moved to History',
    duration: 8000,
    remove: () =>
      inSteps(async (onFail) => {
        const rows = must(await supabase.from('orders').update(patch).eq('id', order.id).select())
        onFail(async () => must(await supabase.from('orders').update(before).eq('id', order.id)))
        let expense = null
        let links = []
        if (removing) {
          links = must(await supabase.from('grocery_items').select('id, expense_id').eq('expense_id', order.expense_id))
          expense = must(await supabase.from('expenses').delete().eq('id', order.expense_id).select())[0] ?? null
          allExpenseStores().forEach((s) => s.removeLocal([order.expense_id]))
        }
        // The database unlinks an order from an expense that is deleted.
        orderStore.upsertLocal(rows.map((row) => (removing ? { ...row, expense_id: null } : row)))
        return { expense, links }
      }),
    restore: async ({ expense, links }) => {
      if (expense) must(await supabase.from('expenses').upsert(expense))
      for (const link of links) must(await supabase.from('grocery_items').update({ expense_id: link.expense_id }).eq('id', link.id))
      must(await supabase.from('orders').update(before).eq('id', order.id))
      await refreshOrdersAndExpenses()
    },
    onFail: refreshOrdersAndExpenses,
  })
}

// A finished order goes back on the way. If its expense was deleted, a
// new one can be made (one only: the order is linked to it).
export function putBackOnTheWay(order, { createExpense, expenseId = crypto.randomUUID() }) {
  const makeExpense = createExpense && !order.expense_id
  return attempt(
    () =>
      inSteps(async (onFail) => {
        if (makeExpense) {
          const rows = must(
            await supabase.from('expenses').upsert([{ id: expenseId, ...expenseRowForOrder(order, shopsAvailable(shopStore.getSnapshot())) }], { onConflict: 'id', ignoreDuplicates: true }).select()
          )
          onFail(async () => must(await supabase.from('expenses').delete().eq('id', expenseId)))
          showExpenses(rows)
        }
        const patch = { status: 'on_the_way', arrived_date: null, ...('expense_outcome' in order ? { expense_outcome: null } : {}), ...(makeExpense ? { expense_id: expenseId } : {}) }
        orderStore.upsertLocal(must(await supabase.from('orders').update(patch).eq('id', order.id).select()))
      }),
    { onFail: refreshOrdersAndExpenses }
  )
}

// Deletes right away; Undo puts the order (and its expense, if that was
// deleted too) back exactly.
export function removeOrder(order, { alsoExpense }) {
  if (order.group_id) return removeGroupMember(order, { alsoExpense })
  return deleteWithUndo({
    message: alsoExpense && order.expense_id ? 'Order and its expense deleted' : 'Order deleted',
    remove: async () => {
      const [row] = must(await supabase.from('orders').delete().eq('id', order.id).select())
      orderStore.removeLocal([order.id])
      let expense = null
      if (alsoExpense && order.expense_id) {
        expense = must(await supabase.from('expenses').delete().eq('id', order.expense_id).select())[0] ?? null
        allExpenseStores().forEach((s) => s.removeLocal([order.expense_id]))
      }
      return { row, expense }
    },
    restore: async ({ row, expense }) => {
      if (expense) must(await supabase.from('expenses').upsert(expense))
      if (row) must(await supabase.from('orders').upsert(row))
      await refreshOrdersAndExpenses()
    },
    onFail: refreshOrdersAndExpenses,
  })
}

// Deleting an order of an order group (plan 9I, K5): first it leaves the
// group — its share back to 0, its price (and its expense, if it still has
// the old amount) back to before the discount, the discount spread again
// over the others; the last one out removes the group — then it is
// deleted (with its expense, if asked). Undo puts back the order, its
// expense, and every share of the group exactly.
function removeGroupMember(order, { alsoExpense }) {
  const { group, members } = groupOf(order)
  return deleteWithUndo({
    message: alsoExpense && order.expense_id ? 'Order and its expense deleted' : 'Order deleted',
    remove: () =>
      inSteps(async (onFail) => {
        if (!group) throw Object.assign(new Error('That order group is still loading — try again in a moment.'), { rolledBack: true })
        const rest = members.filter((o) => o.id !== order.id)
        const answer = sayKept(await saveOrderGroup(groupPayload({ id: group.id, place: placeOf(group), discount: groupDiscount(group), members: rest, leaving: [order] })))
        onFail(() => saveOrderGroup(undoGroupPayload({ id: group.id, groupBefore: group, before: members, now: answer.orders })))
        const out = answer.orders.find((o) => o.id === order.id) ?? order
        const [row] = must(await supabase.from('orders').delete().eq('id', order.id).select())
        orderStore.removeLocal([order.id])
        let expense = null
        if (alsoExpense && out.expense_id) {
          expense = must(await supabase.from('expenses').delete().eq('id', out.expense_id).select())[0] ?? null
          allExpenseStores().forEach((s) => s.removeLocal([out.expense_id]))
        }
        return { row, expense, now: answer.orders }
      }),
    restore: async ({ row, expense, now }) => {
      if (expense) must(await supabase.from('expenses').upsert(expense))
      if (row) must(await supabase.from('orders').upsert(row))
      const current = now.map((o) => (o.id === order.id && row ? row : o))
      await saveOrderGroup(undoGroupPayload({ id: group.id, groupBefore: group, before: members, now: current }))
      await refreshOrdersAndExpenses()
    },
    onFail: () => Promise.all([refreshOrdersAndExpenses(), orderGroupStore.refresh()]),
  })
}

// The orders. `ready` once they are loaded and the database has them and
// the stores (supabase/019); `missing` while it hasn't been run.
export function useOrders() {
  const { rows: orders, loaded, missing } = orderStore.useRows()
  const shops = shopStore.useRows()
  return useMemo(
    () => ({ orders, loaded, missing: Boolean(missing) || Boolean(shops.missing), ready: loaded && !missing && shopsAvailable(shops) }),
    [orders, loaded, missing, shops]
  )
}

