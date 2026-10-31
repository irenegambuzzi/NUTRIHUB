import { useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { OFFLINE_MESSAGE } from '../lib/db'
import { isOffline } from '../lib/connection'
import { showToast, toastSaveError } from '../lib/feedback'
import { allExpenseStores, orderGroupStore, orderStore } from '../lib/stores'
import { groupDiscount, groupErrorMessage, groupLabel, groupMembers, groupPayload, keptNote, placeOf, undoGroupPayload } from '../lib/orderGroups'

// Order groups (plan 9I, supabase/028): several online orders that were one
// order at the store, with one discount for the whole order spread over
// them. Every change goes through one database function
// (save_order_group), which writes the group, its orders and their
// expenses together or not at all, and refuses when the other phone
// changed one of them meanwhile. Each change has Undo, which puts every
// order, share and expense back exactly.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const reload = () => Promise.all([orderStore.refresh(), orderGroupStore.refresh(), ...allExpenseStores().map((s) => s.refresh())])

// The groups, and the orders they are made of. `ready` once they are
// loaded and the database has them (supabase/028); before that nothing of
// the group feature shows.
export function useOrderGroups() {
  const { rows: groups, loaded, missing } = orderGroupStore.useRows()
  const { rows: orders } = orderStore.useRows()
  return useMemo(() => ({ groups, orders, byId: new Map(groups.map((g) => [g.id, g])), ready: Boolean(loaded) && !missing }), [groups, orders, loaded, missing])
}

// What the database answered, shown at once (without waiting for realtime).
function show(id, data) {
  if (data?.orders?.length) orderStore.upsertLocal(data.orders)
  if (data?.expenses?.length) allExpenseStores().forEach((s) => s.upsertLocal(data.expenses))
  if (data?.group) orderGroupStore.upsertLocal([data.group])
  else orderGroupStore.removeLocal([id])
}

// Runs save_order_group and shows the result; throws a plain error when it
// is refused (for a change made in steps: the earlier steps are undone).
export async function saveOrderGroup(payload) {
  const { data, error } = await supabase.rpc('save_order_group', { payload })
  if (error) throw Object.assign(new Error(groupErrorMessage(error)), { code: error.code, rolledBack: true })
  show(payload.id, data)
  return data
}

// After a change made with an order (a new order joining, a member edited
// or deleted): an expense edited by hand that was left alone is named.
export function sayKept(data) {
  if (data?.kept?.length) showToast({ message: 'Saved — an expense edited by hand was left as it is', detail: keptNote(data.kept) })
  return data
}

// One group change from a button: refused while offline (it needs a
// connection, like merging), and said plainly when refused. → { data, error }
async function run(payload) {
  if (isOffline()) {
    showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
    return { data: null, error: { message: OFFLINE_MESSAGE, offline: true } }
  }
  try {
    return { data: await saveOrderGroup(payload), error: null }
  } catch (error) {
    await reload()
    toastSaveError(error, null, error.message)
    return { data: null, error }
  }
}

// A change, then a toast with Undo that puts back exactly what was there:
// `before` the orders it touched as they were, `groupBefore` the group
// (null when it didn't exist).
async function changeWithUndo(payload, { before, groupBefore, message }) {
  const result = await run(payload)
  if (result.error) return result
  const undo = async () => {
    const now = orderStore.getSnapshot().rows.filter((o) => before.some((b) => b.id === o.id))
    await run(undoGroupPayload({ id: payload.id, groupBefore, before, now }))
  }
  showToast({ message, detail: keptNote(result.data.kept) || null, action: { label: 'Undo', onClick: undo } })
  return result
}

// "Group orders": `singles` (orders in no group, same store, date and
// payer) become one order — a new group (`id` made once per selection, so
// pressing again saves it once), or they join `target` ({ groupId,
// members }) and its discount is spread again over all of them.
export function groupOrders({ id, singles, target = null, groups = orderGroupStore.getSnapshot().rows, shopName = () => null }) {
  if (target) {
    const group = groups.find((g) => g.id === target.groupId)
    // Its discount isn't on the phone yet: nothing is sent.
    if (!group) {
      const error = { message: 'That order group is still loading — try again in a moment.' }
      showToast({ message: error.message, tone: 'error' })
      return Promise.resolve({ data: null, error })
    }
    const members = [...target.members, ...singles]
    return changeWithUndo(groupPayload({ id: group.id, place: placeOf(group), discount: groupDiscount(group), members }), {
      before: members,
      groupBefore: group,
      message: `${plural(singles.length, 'order')} added to the order ${groupLabel(target.members, shopName)}`,
    })
  }
  return changeWithUndo(groupPayload({ id, place: placeOf(singles[0]), members: singles }), {
    before: singles,
    groupBefore: null,
    message: `${singles.length} orders grouped as one order`,
  })
}

// "Save" in the "Order group" sheet: the discount (`discount` { kind,
// value } or null) spread again over every order of the group, and its
// store, order date and payer (`place`) — for all its orders and their
// expenses.
export function saveGroupDetails(group, members, { discount, place }) {
  return changeWithUndo(groupPayload({ id: group.id, place, discount, members }), { before: members, groupBefore: group, message: 'Order group saved' })
}

// "Take out of the group": that order's share goes to 0, its price (and
// its expense, if it still has the old amount) back to what it was before
// the discount, and the discount is spread again over the others. The
// last order taken out removes the group.
export function takeOutOfGroup(group, members, order) {
  const rest = members.filter((o) => o.id !== order.id)
  return changeWithUndo(groupPayload({ id: group.id, place: placeOf(group), discount: groupDiscount(group), members: rest, leaving: [order] }), {
    before: members,
    groupBefore: group,
    message: `"${order.item_name}" taken out of the order group`,
  })
}

// "Ungroup": every order on its own again, every share 0, every price
// and expense back to before the discount; the group is removed.
export function ungroupOrders(group, members) {
  return changeWithUndo(groupPayload({ id: group.id, place: placeOf(group), members: [], leaving: members }), {
    before: members,
    groupBefore: group,
    message: `Ungrouped — the ${plural(members.length, 'order')} are on their own again`,
  })
}

// The group of an order and its orders, as the phone has them.
export function groupOf(order) {
  const group = orderGroupStore.getSnapshot().rows.find((g) => g.id === order?.group_id) ?? null
  return { group, members: groupMembers(order?.group_id, orderStore.getSnapshot().rows) }
}
