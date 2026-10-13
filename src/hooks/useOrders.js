import { useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { normalizeItem, syncShoppingForItem } from '../lib/inventory'
import { allExpenseStores, groceryStore, orderStore, pantryStore, shopStore } from '../lib/stores'
import { expensePatchForOrder, expenseRowForOrder, normalizeUrl } from '../lib/orders'
import { shopsAvailable } from '../lib/shops'

const refreshOrdersAndExpenses = () => Promise.all([orderStore.refresh(), ...allExpenseStores().map((s) => s.refresh())])
const showExpenses = (rows) => rows.length && allExpenseStores().forEach((s) => s.upsertLocal(rows))

// The order's own columns from the form's values. Dates are YYYY-MM-DD,
// '' means none; a last expected date only makes sense with a first one.
// The quantity and unit are only there for an order linked to a HOME item
// (supabase/021), and only sent then.
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
    ...(values.quantity !== undefined ? { quantity: Number(values.quantity) > 0 ? Number(values.quantity) : null, unit: values.unit || null } : {}),
  }
}

// The database refused a second order on the way for one SHOP list entry
// (orders_open_grocery_key): said in words.
const ALREADY_ORDERED = 'This item already has an order on the way — open it in the SHOP list or in Orders.'
const friendly = (error) => (error?.code === '23505' && String(error.message).includes('orders_open_grocery_key') ? Object.assign(new Error(ALREADY_ORDERED), { rolledBack: true }) : error)

const originalOf = (order, row) => Object.fromEntries(Object.keys(row).map((k) => [k, order[k] ?? null]))

// A new order and the expense it creates (the money is spent when
// ordering), saved together or not at all. `ids` ({ orderId, expenseId })
// are made once per form, so pressing Save again after a dropped
// connection can't make a second expense or order. `link` ({ pantryItemId,
// groceryItemId }), for "Order online" from the SHOP list: the order is
// linked to the HOME item and the list entry, and the entry leaves the
// cart. The database allows one order on the way per entry.
export function createOrder(values, { orderId, expenseId }, link = null) {
  const row = {
    id: orderId,
    ...orderRowFrom(values),
    status: 'on_the_way',
    expense_id: expenseId,
    ...(link ? { pantry_item_id: link.pantryItemId ?? null, grocery_item_id: link.groceryItemId ?? null } : {}),
  }
  const expense = { id: expenseId, ...expenseRowForOrder(row, shopsAvailable(shopStore.getSnapshot())) }
  return attempt(
    () =>
      inSteps(async (onFail) => {
        try {
          if (link?.groceryItemId) {
            const open = must(await supabase.from('orders').select('id').eq('grocery_item_id', link.groceryItemId).eq('status', 'on_the_way').neq('id', orderId))
            if (open.length) throw Object.assign(new Error(ALREADY_ORDERED), { rolledBack: true })
          }
          const expenseRows = must(await supabase.from('expenses').upsert([expense], { onConflict: 'id', ignoreDuplicates: true }).select())
          onFail(async () => must(await supabase.from('expenses').delete().eq('id', expenseId)))
          const orderRows = must(await supabase.from('orders').upsert([row], { onConflict: 'id' }).select())
          // A retry finds the expense already there: nothing new to show.
          if (expenseRows.length) showExpenses(expenseRows)
          else await Promise.all(allExpenseStores().map((s) => s.refresh()))
          orderStore.upsertLocal(orderRows)
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

// Saves an edited order. The linked expense follows what changed in its
// price, date, category, payer or store (and the name, when the expense
// still carries the old one); nothing else of it is touched.
export function editOrder(order, values) {
  const row = orderRowFrom(values)
  const patch = order.expense_id ? expensePatchForOrder(order, { ...order, ...row }, shopsAvailable(shopStore.getSnapshot())) : {}
  return attempt(
    () =>
      inSteps(async (onFail) => {
        const orderRows = must(await supabase.from('orders').update(row).eq('id', order.id).select())
        onFail(async () => must(await supabase.from('orders').update(originalOf(order, row)).eq('id', order.id)))
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

// The order arrived. Only the order (and its SHOP list entry) changes: its
// expense was made when ordering and is never made again.
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
    },
    { onFail: () => Promise.all([orderStore.refresh(), groceryStore.refresh()]) }
  )
}

// The HOME item (or group) an order is linked to, if it is still there.
export const linkedItemOf = (order, items) => (order.pantry_item_id ? items.find((i) => i.id === order.pantry_item_id) ?? null : null)

const refreshFlow = () => Promise.all([orderStore.refresh(), pantryStore.refresh(), groceryStore.refresh(), ...allExpenseStores().map((s) => s.refresh())])

// The SHOP list follows the HOME item of a linked order: back to "to
// buy" if it is still low, gone if it isn't (automatic entries only).
export function syncListFor(order) {
  if (!order.pantry_item_id) return Promise.resolve(true)
  return followUp('the shopping list', async () => {
    const item = must(await supabase.from('pantry_items').select('*').eq('id', order.pantry_item_id).maybeSingle())
    if (item) await syncShoppingForItem(normalizeItem(item))
    await groceryStore.refresh()
  })
}

// A linked order arrived: the stock (`delta`, in the item's own unit) goes
// to `itemId` — the item, or a variant of its group — in one step with
// marking it arrived (arrive_order, supabase/021). Only the first Arrived
// adds anything, whichever phone presses it. `newVariant` ({ id, fields }):
// a new variant of the group to make first, with an id fixed by the
// dialog so pressing again never makes a second one. Never an expense.
// Returns { error, added }.
export async function arriveLinkedOrder(order, { itemId, delta, newVariant = null, date }) {
  let added = false
  const result = await attempt(
    async () => {
      if (newVariant) must(await supabase.from('pantry_items').upsert([{ id: newVariant.id, ...newVariant.fields, current_stock: 0 }], { onConflict: 'id', ignoreDuplicates: true }))
      const answer = must(await supabase.rpc('arrive_order', { order_id: order.id, item_id: newVariant?.id ?? itemId ?? null, add_qty: delta || 0, arrived_on: date }))
      added = Boolean(answer?.added)
      if (!added && newVariant) await supabase.from('pantry_items').delete().eq('id', newVariant.id).eq('current_stock', 0)
      if (answer?.order) orderStore.upsertLocal([answer.order])
    },
    { retry: false, onFail: refreshFlow }
  )
  if (result.error) return { ...result, added: false }
  await refreshFlow()
  await syncListFor(order)
  return { ...result, added }
}

// An arrived linked order goes back on the way: the stock its arrival
// added comes out of HOME again (unarrive_order, supabase/021).
export async function unarriveOrder(order) {
  const result = await attempt(
    async () => {
      const row = must(await supabase.rpc('unarrive_order', { order_id: order.id }))
      if (row?.id) orderStore.upsertLocal([row])
    },
    { onFail: refreshFlow }
  )
  if (!result.error) await refreshFlow()
  return result
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

