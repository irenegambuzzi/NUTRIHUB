import { askDialog, confirmDialog } from '../lib/feedback'
import { outcomeSupported } from '../lib/orders'
import { markCancelled, putBackOnTheWay, removeOrder, syncListFor, unarriveOrder } from './useOrders'

// The questions asked before an order changes, shared by Orders in MONEY
// and the "On the way" part of the SHOP list, so both behave the same.

const money = (value) => `€${Number(value).toFixed(2)}`
const day = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB')

// Cancel / Return: nothing happens until the question is answered. It
// says where the order goes, what becomes of its expense, and offers
// Undo afterwards. "Returned" is only offered once the database knows it.
// `orders`: all orders (to tell whether it does). A linked order's item
// goes back to "to buy" on the SHOP list if it is still low. Resolves to
// the result, or null when nothing was done.
export async function askCancelOrder(order, { orders, today }) {
  const returnedKnown = outcomeSupported(orders)
  const fields = []
  if (returnedKnown) {
    fields.push({
      name: 'kind',
      type: 'choice',
      label: 'Mark it as',
      value: 'cancelled',
      options: [
        { value: 'cancelled', label: 'Cancelled', hint: 'It never arrived, or the order was called off.' },
        { value: 'returned', label: 'Returned', hint: 'It arrived and was sent back.' },
      ],
    })
  }
  if (order.expense_id) {
    fields.push({
      name: 'how',
      type: 'choice',
      label: `What about the expense? (${money(order.price)}, ${day(order.order_date)})`,
      value: 'keep',
      options: [
        { value: 'delete', label: 'Delete the expense (I got my money back / was never charged)', hint: 'It is taken out of your expenses.' },
        { value: 'keep', label: 'Keep the expense', hint: 'The money stays in your expenses, e.g. a refund has not arrived yet.' },
      ],
    })
  }
  const answer = await askDialog({
    title: `Cancel or return "${order.item_name}"?`,
    message: `${order.expense_id ? '' : 'It has no expense linked, so no money changes. '}It moves to History under the orders on the way, and no longer shows in the reminders.${order.grocery_item_id ? ' On the SHOP list it goes back to "to buy" if it is still needed.' : ''} Nothing changes until you confirm, and you can Undo afterwards.${returnedKnown ? '' : ' (Returned needs a one-time database update, supabase/020_order_returned.sql; until then it is saved as Cancelled.)'}`,
    fields,
    confirmLabel: 'Move to History',
  })
  if (!answer) return null
  const result = await markCancelled(order, { kind: answer.kind ?? 'cancelled', deleteExpense: answer.how === 'delete', today, outcomeKnown: returnedKnown })
  if (!result?.error) await syncListFor(order)
  return result
}

// A finished order goes back on the way. An arrived linked order takes the
// stock its arrival added back out of HOME (after asking); one whose
// expense was deleted can get it again.
export async function askBackOnTheWay(order, { unit = '' } = {}) {
  if (order.status === 'arrived' && Number(order.stock_added) > 0) {
    const ok = await confirmDialog({
      title: `Put "${order.item_name}" back on the way?`,
      message: `Its arrival added ${Number(order.stock_added)}${unit ? ` ${unit}` : ''} to HOME. That stock is taken out again, so it isn't counted twice when it really arrives.`,
      confirmLabel: 'Put back on the way',
    })
    return ok ? unarriveOrder(order) : null
  }
  if (order.status === 'arrived' && order.pantry_item_id) return unarriveOrder(order)
  if (order.expense_id) return putBackOnTheWay(order, { createExpense: false })
  const answer = await askDialog({
    title: `Put "${order.item_name}" back on the way?`,
    message: 'Its expense was deleted. Add the expense again (one, for the order date and price)?',
    fields: [
      {
        name: 'how',
        type: 'choice',
        value: 'add',
        options: [
          { value: 'add', label: 'Add the expense again', hint: `${money(order.price)} on ${day(order.order_date)}.` },
          { value: 'none', label: 'Without an expense' },
        ],
      },
    ],
    confirmLabel: 'Put back on the way',
  })
  return answer ? putBackOnTheWay(order, { createExpense: answer.how === 'add' }) : null
}

// What deleting an order of an order group (plan 9I) does to the group.
function leavesGroupNote(order) {
  if (!order.group_id) return ''
  const share = Number(order.group_share) || 0
  return share > 0
    ? ` It leaves its order group: its part of the order discount (${money(share)}) is spread again over the other orders.`
    : ' It leaves its order group.'
}

// Deleting an order, asking about its expense. A linked order's item goes
// back to "to buy" if it is still low. An order of an order group leaves
// the group first (its share is spread again over the others).
export async function askRemoveOrder(order) {
  let result
  if (!order.expense_id && !(order.group_id && Number(order.group_share) > 0)) result = await removeOrder(order, { alsoExpense: false })
  else if (!order.expense_id) {
    const ok = await confirmDialog({ title: `Delete "${order.item_name}"?`, message: leavesGroupNote(order).trim(), confirmLabel: 'Delete' })
    if (!ok) return null
    result = await removeOrder(order, { alsoExpense: false })
  } else {
    const answer = await askDialog({
      title: `Delete "${order.item_name}"?`,
      message: `This order has an expense. Delete that too?${leavesGroupNote(order)}`,
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: 'order',
          options: [
            { value: 'order', label: 'Delete the order only', hint: 'The expense stays in your expenses.' },
            { value: 'both', label: 'Delete the order and its expense', hint: `The ${money(order.group_id ? Number(order.price) + (Number(order.group_share) || 0) : order.price)} is taken out of your expenses.` },
          ],
        },
      ],
      confirmLabel: 'Delete',
    })
    if (!answer) return null
    result = await removeOrder(order, { alsoExpense: answer.how === 'both' })
  }
  if (!result?.error && order.status === 'on_the_way') await syncListFor(order)
  return result
}
