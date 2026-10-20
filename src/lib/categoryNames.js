import { CATEGORY_SYNONYMS } from '../data/categorySynonyms'
import { singular } from './categoryGuess'

// Names of categories, compared the way a person would: "Gifts", "gift ",
// "GIFTS" and "Gift" are one name; "Dairy & Eggs" and "dairy and eggs" too.
// Pure helpers for the "new category" row (NOTE 5); the real uniqueness
// rules stay where they were (HOME: inventoryCategoryEdit, MONEY:
// categoryEdit) and the two never check each other.

// "  Dairy & Eggs " → "dairy and egg": lower case, no accents, "&" = "and",
// punctuation and extra spaces gone, every word singular.
export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ')
}

// The same name, ignoring the small differences above.
export const similarName = (a, b) => {
  const key = nameKey(a)
  return Boolean(key) && key === nameKey(b)
}

// The same name only ignoring capitals, accents and spaces: the names the
// rules refuse (the plural "Gifts" / "Gift" is similar, not the same).
export const sameName = (a, b) => {
  const clean = (n) => String(n ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return Boolean(clean(a)) && clean(a) === clean(b)
}

// "Dairy & Eggs › Yogurt" for a sub, "Dairy & Eggs" for a main.
export function categoryPath(categories, category) {
  const parent = category?.parent_id ? categories.find((c) => c.id === category.parent_id) : null
  return parent ? `${parent.name} › ${category.name}` : category?.name ?? ''
}

// The existing category (any level) whose name is the same or similar to
// `name`, or null. `categories`: [{ id, name, parent_id }]. An exact match
// wins over a similar one.
export function findExisting(name, categories) {
  if (!nameKey(name)) return null
  return categories.find((c) => sameName(c.name, name)) ?? categories.find((c) => similarName(c.name, name)) ?? null
}

// "Gifts already exists in Shopping" / "Gifts already exists as a main category".
export function takenMessage(name, other, categories) {
  const parent = other?.parent_id ? categories.find((c) => c.id === other.parent_id) : null
  const shown = String(name).trim()
  return parent ? `${shown} already exists in ${parent.name}` : `${shown} already exists as a main category`
}

// Synonyms of a name from the built-in list, best first.
export function synonymsOf(name, synonyms = CATEGORY_SYNONYMS) {
  const key = nameKey(name)
  const found = Object.entries(synonyms).find(([word]) => nameKey(word) === key)
  return found ? found[1] : []
}

// Up to two names that are free, for a name that is taken:
//   "<main name> <name>"   ("Holiday Gifts"), only for a new sub-category
//   a synonym from the list ("Souvenirs")
// `isTaken(candidate)` is the uniqueness rule in use; a candidate that is
// taken is never offered. The app never renames by itself: these are only
// chips to tap.
export function freeNameSuggestions(name, mainName, isTaken, synonyms = CATEGORY_SYNONYMS) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return []
  const out = []
  const offer = (candidate) => {
    const text = candidate.trim()
    if (text && !isTaken(text) && !out.some((o) => sameName(o, text))) out.push(text)
  }
  if (mainName && !nameKey(trimmed).startsWith(nameKey(mainName))) offer(`${mainName.trim()} ${trimmed}`)
  for (const synonym of synonymsOf(trimmed, synonyms)) {
    offer(synonym)
    if (out.length >= 2) break
  }
  return out.slice(0, 2)
}
