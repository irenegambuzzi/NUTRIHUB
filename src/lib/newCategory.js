import { effectiveBudget, GROCERIES } from './budgetMap'
import { homeNameTaken } from './inventoryCategoryEdit'
import { findExisting, freeNameSuggestions, sameName, takenMessage } from './categoryNames'

// The small "+ New category" row in the forms (NOTE 5), as pure rules so
// every one can be tested. It only ever adds: a name that is taken is
// explained and left for the user to change.

// "test kefir" → "Test Kefir".
export const titleCase = (name) =>
  String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toUpperCase())

// What the typed name means for a new category.
//   kind        'home' (HOME item categories, the round-2 rule: unique across
//               all levels) or 'money' (budget categories: unique across all
//               levels, ignoring capitals); the two never check each other
//   categories  the flat list of that kind [{ id, name, parent_id }]
//   mainName    the name of the main it goes under (null for a new main)
// → { problem, suggestions, similar }
//   problem      why the name can't be used ('' when it can)
//   suggestions  1–2 names that are free (only when the name is taken)
//   similar      an existing category with a similar (not the same) name:
//                the row offers it instead of a near-duplicate
export function checkNewName({ kind, name, categories, mainName = null }) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return { problem: 'Type a name.', suggestions: [], similar: null }
  const clash = (candidate) => (kind === 'home' ? homeNameTaken(categories, candidate) : categories.find((c) => sameName(c.name, candidate))) ?? null
  const other = clash(trimmed)
  if (other) {
    return { problem: takenMessage(trimmed, other, categories), suggestions: freeNameSuggestions(trimmed, mainName, (c) => Boolean(clash(c))), similar: null }
  }
  return { problem: '', suggestions: [], similar: findExisting(trimmed, categories) }
}

// The budget category a new HOME category starts with (shown in the row,
// changeable): a MONEY main category with exactly the same name (capitals
// and surrounding spaces ignored), else — for a sub-category — what its main
// category is booked to, else Groceries. No guessing from similar names.
// `ctx`: { expenseCategories, inventoryCategories, mapRows } as for
// lib/budgetMap.js. null when there is no Groceries category either.
export function defaultNewBudget({ name, parentId = null, ctx }) {
  const exact = ctx.expenseCategories.find((c) => !c.parent_id && sameName(c.name, name))
  if (exact) return exact.id
  return budgetWithoutRow({ parentId, ctx })
}

// Where a new HOME category is booked when nothing is stored for it: its
// main category's choice for a sub-category, else Groceries.
export function budgetWithoutRow({ parentId = null, ctx }) {
  const parent = parentId ? ctx.inventoryCategories.find((c) => c.id === parentId) : null
  if (parent) return effectiveBudget(parent, ctx).target ?? groceriesId(ctx)
  return groceriesId(ctx)
}

const groceriesId = (ctx) => ctx.expenseCategories.find((c) => c.name === GROCERIES)?.id ?? null

// The mapping row to store for a new HOME category, or null: only a choice
// that differs from what the category gets without a row is stored (like
// the mapping screen).
export function mappingToStore({ chosenId, parentId = null, ctx }) {
  if (!chosenId) return null
  return chosenId === budgetWithoutRow({ parentId, ctx }) ? null : chosenId
}
