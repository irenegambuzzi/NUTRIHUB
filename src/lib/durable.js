import { CHOSEN_ON_PURPOSE_IDS, DURABLE_MONEY_CATEGORY_IDS, PURPOSE_BUDGET_IDS } from '../data/constants'
import { guessCategory } from './categoryGuess'
import { isDurable } from './inventory'

// The durable lock (plan 9F): HOME stock is only for consumables, things
// bought again. A durable — bought once and kept — is a MONEY expense
// only: never HOME stock, never 1×. Something is durable when its HOME
// category is in the Durables tree (lib/inventory.js isDurable), or when
// its budget category is one of DURABLE_MONEY_CATEGORY_IDS. Pure, so every
// rule can be tested.

// A MONEY category id and its main (a main in a list covers its subs,
// also ones made later). `expenseCategories`: [{ id, parent_id }].
const withMain = (id, expenseCategories) => [id, expenseCategories.find((c) => c.id === id)?.parent_id].filter(Boolean)
const inList = (list) => (id, expenseCategories = []) => Boolean(id) && withMain(id, expenseCategories).some((x) => list.includes(x))

// A budget category that makes what is bought durable.
export const isDurableBudget = inList(DURABLE_MONEY_CATEGORY_IDS)

// A budget category that says what the money was FOR (family, work, a
// gift): filled in from the name even when "Add to HOME" is on.
export const isPurposeBudget = inList(PURPOSE_BUDGET_IDS)

// An expense put there on purpose (Work, Family Support, Trips &
// Holidays): "Apply the mapping to past purchases" leaves it alone.
export const isChosenOnPurpose = inList(CHOSEN_ON_PURPOSE_IDS)

// Why something can't go into HOME, or null when it can. `item`: {
// categoryId, subcategoryId, budgetId }; `ctx`: { expenseCategories,
// inventoryCategories } (as stored). → { source: 'home' | 'money', name }:
// the name of the HOME sub-category (or main) when the HOME category is
// durable, else of the budget category, as it is called now.
export function durableLock({ categoryId, subcategoryId, budgetId }, { expenseCategories = [], inventoryCategories = [] } = {}) {
  if (isDurable({ category_id: categoryId })) {
    const id = subcategoryId || categoryId
    return { source: 'home', name: inventoryCategories.find((c) => c.id === id)?.name ?? '' }
  }
  if (isDurableBudget(budgetId, expenseCategories)) return { source: 'money', name: expenseCategories.find((c) => c.id === budgetId)?.name ?? '' }
  return null
}

// What a row says when it is locked.
export const lockNote = (lock) => `Durable item${lock?.name ? ` (${lock.name})` : ''} — expense only, never in HOME stock.`

// For the HOME editor: the path ("Durables › Home Textiles") when the
// name's keyword guess, on ALL HOME categories (`available`: { parents,
// subsByParent } with names), is durable; else ''.
export function durableLookalike(name, available) {
  const pick = guessCategory(name, available)
  if (!pick || !isDurable({ category_id: pick.categoryId })) return ''
  const main = available?.parents?.find((p) => p.id === pick.categoryId)
  const sub = pick.subcategoryId ? (available?.subsByParent?.get(pick.categoryId) || []).find((s) => s.id === pick.subcategoryId) : null
  return [main?.name, sub?.name].filter(Boolean).join(' › ')
}

// An order of something durable: its budget category is durable, or the
// SHOP entry it was ordered from is in the Durables tree. "Arrived" then
// adds nothing to HOME and asks nothing.
export function isDurableOrder(order, { expenseCategories = [], groceryItems = [] } = {}) {
  if (isDurableBudget(order.category_id, expenseCategories)) return true
  const entry = order.grocery_item_id ? groceryItems.find((g) => g.id === order.grocery_item_id) : null
  return isDurable(entry)
}
