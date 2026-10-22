import { createGuesser, guessCategories, guessCategory, normalizeName } from './categoryGuess'
import { BUDGET_RULES } from '../data/budgetKeywords'
import { findExisting } from './categoryNames'
import { normName } from './grocery'

// Where a category suggestion for an item name comes from, tried in order;
// the first answer that fits the categories on offer wins:
//   memory   – what someone picked by hand for this name before (shared,
//              supabase/011)
//   pantry   – the pantry item with the same name
//   keywords – the keyword list (lib/categoryGuess.js), only for categories
//              that exist right now
// Each layer: { source, suggest(name, context) → { categoryId,
// subcategoryId } | null }. context: { memory (Map id → row),
// pantryByName (Map), parents, subsByParent }.
export const SUGGESTERS = [
  {
    source: 'memory',
    suggest: (name, { memory }) => {
      const row = memory?.get(normalizeName(name))
      return row ? { categoryId: row.category_id, subcategoryId: row.subcategory_id } : null
    },
  },
  {
    source: 'pantry',
    suggest: (name, { pantryByName }) => {
      const item = pantryByName?.get(normName(name))
      return item?.category_id ? { categoryId: item.category_id, subcategoryId: item.subcategory_id } : null
    },
  },
  { source: 'keywords', suggest: (name, { parents, subsByParent } = {}) => guessCategory(name, { parents, subsByParent }) },
]

// Slower layers, tried only when the ones above have no answer — the place
// for a later AI suggestion (e.g. a Supabase Edge Function):
//   { source: 'ai', suggest: async (name, context) => ({ categoryId, subcategoryId }) }
export const ASYNC_SUGGESTERS = []

// Keeps a suggestion only if its category is on offer; a sub-category that
// doesn't belong to it is dropped.
function fit(result, { parents, subsByParent }) {
  if (!result?.categoryId || !parents?.some((p) => p.id === result.categoryId)) return null
  const subOk = (subsByParent?.get(result.categoryId) || []).some((s) => s.id === result.subcategoryId)
  return { categoryId: result.categoryId, subcategoryId: subOk ? result.subcategoryId : null }
}

// { categoryId, subcategoryId, source } or null — never a made-up default.
export function suggestCategory(name, context) {
  if (!normalizeName(name)) return null
  for (const layer of SUGGESTERS) {
    const result = fit(layer.suggest(name, context), context)
    if (result) return { ...result, source: layer.source }
  }
  return null
}

// The same, then the slower layers.
export async function suggestCategoryAsync(name, context) {
  const quick = suggestCategory(name, context)
  if (quick || !normalizeName(name)) return quick
  for (const layer of ASYNC_SUGGESTERS) {
    const result = fit(await layer.suggest(name, context), context)
    if (result) return { ...result, source: layer.source }
  }
  return null
}

// Whether a hand-picked category is worth remembering: not when it's what
// the keywords already say and nothing else was remembered for the name.
// `available` is { parents, subsByParent }, as for the suggestion itself.
export function worthRemembering(name, categoryId, subcategoryId, memory, available = null) {
  const key = normalizeName(name)
  if (!key || !categoryId) return false
  const existing = memory?.get(key)
  if (existing) return existing.category_id !== categoryId || (existing.subcategory_id ?? null) !== (subcategoryId ?? null)
  const keywords = guessCategory(name, available)
  return !(keywords && keywords.categoryId === categoryId && (keywords.subcategoryId ?? null) === (subcategoryId ?? null))
}

// ── Chips: a few suggestions at once ────────────────────────────────
//
// ONE door for every form (SHOP add, QuickAdd, MONEY purchase rows). Same
// result shape always, whoever answered:
//   { categoryId, subcategoryId, expenseCategoryId, source, label }
// HOME mode (a HOME category, the budget category follows its mapping):
// expenseCategoryId is null. Budget mode (a MONEY row with "Add to HOME"
// off): categoryId / subcategoryId are null and expenseCategoryId is the
// budget category. `source`: memory, pantry, keywords, name (an existing
// category with a similar name) or, from round 8, ai.
// Layers, in order: memory → pantry → keywords → a similar name; only
// categories that really exist are ever offered.

const DEFAULT_LIMIT = 3

const pathName = (list, c) => {
  const parent = c?.parent_id ? list.find((x) => x.id === c.parent_id) : null
  return parent ? `${parent.name} › ${c.name}` : c?.name ?? ''
}

// Every HOME category on offer as a flat list [{ id, name, parent_id }].
function flatHome({ parents = [], subsByParent }) {
  const out = []
  for (const p of parents) {
    out.push({ id: p.id, name: p.name ?? p.id, parent_id: null })
    for (const s of subsByParent?.get(p.id) || []) out.push({ id: s.id, name: s.name ?? s.id, parent_id: p.id })
  }
  return out
}

const homeChip = (pick, source, flat) => {
  const main = flat.find((c) => c.id === pick.categoryId)
  const sub = pick.subcategoryId ? flat.find((c) => c.id === pick.subcategoryId) : null
  const label = sub ? `${main.name} › ${sub.name}` : main.name
  return { categoryId: pick.categoryId, subcategoryId: pick.subcategoryId ?? null, expenseCategoryId: null, source, label }
}

// The HOME-category chips for a name (see above). `context`: { memory,
// pantryByName, parents, subsByParent }.
export function suggestCategories(name, context, { limit = DEFAULT_LIMIT } = {}) {
  if (!normalizeName(name)) return []
  const flat = flatHome(context)
  const chips = []
  const add = (pick, source) => {
    const fitted = fit(pick, context)
    if (!fitted || chips.length >= limit) return
    if (chips.some((c) => c.categoryId === fitted.categoryId && c.subcategoryId === fitted.subcategoryId)) return
    chips.push(homeChip(fitted, source, flat))
  }
  for (const layer of SUGGESTERS) {
    if (layer.source === 'keywords') for (const pick of guessCategories(name, context, limit)) add(pick, 'keywords')
    else add(layer.suggest(name, context), layer.source)
  }
  const similar = findExisting(name, flat)
  if (similar) add(similar.parent_id ? { categoryId: similar.parent_id, subcategoryId: similar.id } : { categoryId: similar.id, subcategoryId: null }, 'name')
  return chips
}

// The MONEY keyword list (data/budgetKeywords.js), by id. Only MONEY
// categories that exist now count: a rule for a missing main is ignored,
// a missing sub falls back to its main.
const budgetGuesser = createGuesser(BUDGET_RULES)

// The budget categories the MONEY keywords suggest for a name, best first:
// [budget category id] (the sub when it exists, else the main).
export function budgetKeywordPicks(name, expenseCategories = [], limit = DEFAULT_LIMIT) {
  const parents = expenseCategories.filter((c) => !c.parent_id)
  const subsByParent = new Map(parents.map((p) => [p.id, expenseCategories.filter((c) => c.parent_id === p.id)]))
  return budgetGuesser.guessCategories(name, { parents, subsByParent }, limit).map((pick) => pick.subcategoryId ?? pick.categoryId)
}

// The budget-category chips for a name, for a MONEY row that isn't added
// to HOME. `context` is the same plus { expenseCategories [{ id, name,
// parent_id }], budgetFor({ categoryId, subcategoryId }) → budget category
// id (the mapping) }. What was remembered for the name as a budget
// category comes first, then the MONEY keywords; the HOME suggestions
// follow through the mapping, then a MONEY category with a similar name.
export function suggestBudgetCategories(name, context, { limit = DEFAULT_LIMIT } = {}) {
  if (!normalizeName(name)) return []
  const { expenseCategories = [], budgetFor = () => null } = context
  const chips = []
  const add = (id, source) => {
    if (!id || chips.length >= limit || chips.some((c) => c.expenseCategoryId === id)) return
    const category = expenseCategories.find((c) => c.id === id)
    if (category) chips.push({ categoryId: null, subcategoryId: null, expenseCategoryId: id, source, label: pathName(expenseCategories, category) })
  }
  add(context.memory?.get(normalizeName(name))?.expense_category_id, 'memory')
  for (const id of budgetKeywordPicks(name, expenseCategories, limit)) add(id, 'keywords')
  for (const chip of suggestCategories(name, context, { limit })) add(budgetFor(chip), chip.source)
  const similar = findExisting(name, expenseCategories)
  if (similar) add(similar.id, 'name')
  return chips
}

// The budget chip a MONEY row not added to HOME fills in by itself (shown
// selected, until a budget category is chosen by hand): the first chip,
// from the same kinds of sources the HOME category fills itself from
// (memory, the HOME item, keywords — here also the MONEY keywords).
// Never a chip that only has a similar name: suggestCategory doesn't
// fill a similar name in either, it is only offered.
export function budgetAutoFill(chips) {
  const first = chips?.[0]
  return first && first.source !== 'name' ? first : null
}

// The same, then the slower layers (AI, round 8) when the quick ones gave
// nothing. A slower layer answers { categoryId, subcategoryId }.
export async function suggestCategoriesAsync(name, context, options = {}) {
  const quick = suggestCategories(name, context, options)
  if (quick.length || !normalizeName(name)) return quick
  const flat = flatHome(context)
  for (const layer of ASYNC_SUGGESTERS) {
    const result = fit(await layer.suggest(name, context), context)
    if (result) return [homeChip(result, layer.source, flat)]
  }
  return []
}

// Whether the pick differs from the first suggestion: only then is it
// worth remembering as "what I want for this name" (the first chip would
// have been given anyway). `pick`: { categoryId, subcategoryId,
// expenseCategoryId } as in a chip; `chips`: what was on offer.
export function differsFromFirst(pick, chips) {
  const first = chips?.[0]
  if (!first) return true
  return (
    (first.categoryId ?? null) !== (pick.categoryId ?? null) ||
    (first.subcategoryId ?? null) !== (pick.subcategoryId ?? null) ||
    (first.expenseCategoryId ?? null) !== (pick.expenseCategoryId ?? null)
  )
}
