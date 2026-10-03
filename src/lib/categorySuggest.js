import { guessCategory, normalizeName } from './categoryGuess'
import { normName } from './grocery'

// Where a category suggestion for an item name comes from, tried in order;
// the first answer that fits the categories on offer wins:
//   memory   – what someone picked by hand for this name before (shared,
//              supabase/011)
//   pantry   – the pantry item with the same name
//   keywords – the keyword list (lib/categoryGuess.js)
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
  { source: 'keywords', suggest: (name) => guessCategory(name) },
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
export function worthRemembering(name, categoryId, subcategoryId, memory) {
  const key = normalizeName(name)
  if (!key || !categoryId) return false
  const existing = memory?.get(key)
  if (existing) return existing.category_id !== categoryId || (existing.subcategory_id ?? null) !== (subcategoryId ?? null)
  const keywords = guessCategory(name)
  return !(keywords && keywords.categoryId === categoryId && (keywords.subcategoryId ?? null) === (subcategoryId ?? null))
}
