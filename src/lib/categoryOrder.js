import { sameName } from './categoryNames'

// The order of categories wherever one is searched or picked (HOME, SHOP,
// MONEY and Income): main categories A–Z, sub-categories A–Z under their
// main, and the catch-alls last at both levels. Not used for Shop mode
// (the shop route, `sort_order` and saved positions), the MONEY charts (by
// amount) or the suggestion chips (best match first).

// Catch-all categories: always last, whatever their letter. HOME
// "Miscellaneous / Seasonal" is found by its id too, so it stays last
// after a rename.
export const CATCH_ALL_IDS = ['misc']
export const CATCH_ALL_NAMES = ['Other', 'Others', 'Miscellaneous / Seasonal']

// Ignores capitals and accents ("éclair" sorts with "e"); numbers sort
// naturally ("Size 2" before "Size 10").
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export const isCatchAll = (c) => CATCH_ALL_IDS.includes(c?.id) || CATCH_ALL_NAMES.some((n) => sameName(n, c?.name))

// Catch-alls last, then A–Z; the same name is ordered by id, so the order
// never jumps between two renders.
export const compareCategories = (a, b) =>
  isCatchAll(a) - isCatchAll(b) || collator.compare(a?.name ?? '', b?.name ?? '') || String(a?.id ?? '').localeCompare(String(b?.id ?? ''))

// A sorted copy; the list itself is not changed.
export const sortCategories = (list) => [...(list ?? [])].sort(compareCategories)

// A flat list ({ id, name, parent_id }) → each main A–Z, followed by its
// subs A–Z. A sub whose main is not in the list goes at the end.
export function sortCategoryTree(categories) {
  const list = categories ?? []
  const mains = sortCategories(list.filter((c) => !c.parent_id))
  const mainIds = new Set(mains.map((m) => m.id))
  const out = mains.flatMap((m) => [m, ...sortCategories(list.filter((c) => c.parent_id === m.id))])
  return [...out, ...sortCategories(list.filter((c) => c.parent_id && !mainIds.has(c.parent_id)))]
}
