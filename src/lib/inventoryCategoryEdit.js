// Rules for HOME item categories (Manage, "+ New category…" in the item
// editor and the SHOP add form), as pure checks so the screen can explain
// a refusal before anything is saved. `categories` is the flat list the
// app shows ({ id, name, parent_id, type }); hidden categories are not in
// it, so they never count. MONEY categories have their own rules
// (categoryEdit.js) and the two never check each other.

// Home & Appliances: code looks it up by id, so it keeps its place (it can
// still be renamed). Its items never have stock, so nothing moves into or
// out of its tree either.
export const APPLIANCES_ID = 'appliances'

// "Frozen  Vegetables " and "frozen vegetables" are the same name. Accents
// don't make a different name either ("Cafè" = "Cafe").
export function homeNameKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const byId = (categories, id) => categories.find((c) => c.id === id) ?? null
const parentOf = (categories, c) => (c?.parent_id ? byId(categories, c.parent_id) : null)
const subsOf = (categories, id) => categories.filter((c) => c.parent_id === id)
const inAppliancesTree = (c) => c?.id === APPLIANCES_ID || c?.parent_id === APPLIANCES_ID

// "Frozen Food › Frozen Vegetables" for a sub, "Snacks" for a main.
export function pathOf(categories, c) {
  const parent = parentOf(categories, c)
  return parent ? `${parent.name} › ${c.name}` : c.name
}

// The category already using `name` (any level, any main), or null.
// `exceptId` is the category being renamed: its own name never clashes
// with itself, so "parfume" → "Parfume" is a different spelling of the
// same category, not a duplicate.
export function homeNameTaken(categories, name, exceptId = null) {
  const key = homeNameKey(name)
  if (!key) return null
  return categories.find((c) => c.id !== exceptId && homeNameKey(c.name) === key) ?? null
}

// Why `name` can't be used for a new or renamed category, or null.
export function nameProblem(categories, name, exceptId = null) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Type a name.'
  const other = homeNameTaken(categories, trimmed, exceptId)
  if (!other) return null
  const parent = parentOf(categories, other)
  return parent ? `"${other.name}" already exists in ${parent.name}.` : `"${other.name}" already exists as a main category.`
}

// Why `id` can't be renamed to `name`, or null. Renaming is always allowed
// otherwise, Home & Appliances included.
export function renameProblem(categories, id, name) {
  if (!byId(categories, id)) return 'This category no longer exists.'
  return nameProblem(categories, name, id)
}

// Why `id` can't be moved under `parentId` (null = made a main category),
// or null when it can.
export function moveProblem(categories, id, parentId) {
  const category = byId(categories, id)
  if (!category) return 'This category no longer exists.'
  if (id === APPLIANCES_ID) return `"${category.name}" can't be moved (it can be renamed).`
  if ((category.parent_id ?? null) === (parentId ?? null)) return 'It is already there.'
  const target = parentId ? byId(categories, parentId) : null
  if (parentId) {
    if (!target || target.parent_id) return 'Choose a main category.'
    if (target.id === id) return "A category can't go inside itself."
    if (subsOf(categories, id).length > 0) {
      return `"${category.name}" has sub-categories, so it can't become a sub-category. Move or merge those first.`
    }
  }
  if (inAppliancesTree(category) !== (parentId ? parentId === APPLIANCES_ID : false)) {
    return 'Home & Appliances items never have stock, so nothing moves into or out of it.'
  }
  return null
}

// The main categories `id` can be moved under (and "make it a main" when it
// is a sub is offered by the screen itself).
export function moveTargets(categories, id) {
  return categories.filter((p) => !p.parent_id && !moveProblem(categories, id, p.id))
}

// Why `id` can't be deleted at all, or null.
export function deleteProblem(categories, id) {
  const category = byId(categories, id)
  if (!category) return 'This category no longer exists.'
  if (id === APPLIANCES_ID) return `"${category.name}" can't be deleted (it can be renamed).`
  return null
}

// What uses a category: HOME items (a main counts the items of its subs too,
// since an item in a sub always has its main set), SHOP entries, remembered
// names, and its sub-categories.
export function usageOf(categories, category, items = [], entries = [], memory = []) {
  const isSub = Boolean(category.parent_id)
  const mine = (row) => (isSub ? row.subcategory_id === category.id : row.category_id === category.id)
  return {
    items: items.filter(mine).length,
    entries: entries.filter(mine).length,
    memory: memory.filter(mine).length,
    subs: isSub ? 0 : subsOf(categories, category.id).length,
  }
}

// A category nothing points to can simply be deleted. Otherwise it must be
// merged into another one, so no item, SHOP entry or remembered name is
// lost (deleting a category cascades to its remembered names and subs).
export const isUnused = (usage) => usage.items + usage.entries + usage.memory + usage.subs === 0

// The sub-categories of `fromId` that would clash by name with one already
// under `toId`, when a main is merged into another main (its subs move
// along). Empty when there is no such clash.
export function subNameClashes(categories, fromId, toId) {
  const from = byId(categories, fromId)
  const to = byId(categories, toId)
  if (!from || !to || from.parent_id || to.parent_id) return []
  const taken = new Map(subsOf(categories, toId).map((s) => [homeNameKey(s.name), s]))
  const clashes = new Map()
  for (const s of subsOf(categories, fromId)) {
    const key = homeNameKey(s.name)
    if (taken.has(key) && !clashes.has(key)) clashes.set(key, { name: taken.get(key).name, intoName: to.name })
  }
  return [...clashes.values()]
}

// Why everything in `fromId` can't be moved into `toId` (the "Move items
// to…" of Delete), or null. Mirrors what the database function refuses, and
// adds the sub-name clash it can't see.
export function mergeProblem(categories, fromId, toId) {
  const from = byId(categories, fromId)
  const to = byId(categories, toId)
  if (!from) return 'This category no longer exists.'
  const blocked = deleteProblem(categories, fromId)
  if (blocked) return blocked
  if (!toId) return 'Choose where to move the items.'
  if (!to) return 'The category to move everything to no longer exists.'
  if (fromId === toId) return 'Pick another category to move everything to.'
  if (inAppliancesTree(from) !== inAppliancesTree(to)) {
    return 'Home & Appliances items never have stock, so nothing moves into or out of it.'
  }
  if (to.parent_id === fromId) return `"${to.name}" is inside "${from.name}". Pick a category outside it.`
  if (!from.parent_id && to.parent_id && subsOf(categories, fromId).length > 0) {
    return `"${from.name}" has sub-categories. Move it to a main category, so they can go along.`
  }
  const clashes = subNameClashes(categories, fromId, toId)
  if (clashes.length > 0) {
    return clashes.map((c) => `"${c.name}" already exists in ${c.intoName}`).join('; ') + ' — merge or rename that sub first.'
  }
  return null
}

// The categories offered by "Move items to…" for `fromId`: a main with
// sub-categories can only go to a main category.
export function mergeTargets(categories, fromId) {
  const from = byId(categories, fromId)
  if (!from) return []
  const mainsOnly = !from.parent_id && subsOf(categories, fromId).length > 0
  const ordered = categories.filter((c) => !c.parent_id).flatMap((m) => [m, ...subsOf(categories, m.id)])
  return ordered
    .filter((c) => c.id !== fromId && !(mainsOnly && c.parent_id))
    .filter((c) => inAppliancesTree(c) === inAppliancesTree(from) && c.parent_id !== fromId)
    .map((c) => ({ id: c.id, label: pathOf(categories, c), isSub: Boolean(c.parent_id) }))
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What a merge moved, from the database function's counts:
// "4 items moved to Frozen Food › Frozen Vegetables".
export function mergeSummary(result, targetLabel) {
  const parts = []
  const items = Number(result?.items) || 0
  const entries = Number(result?.list_entries) || 0
  const subs = Number(result?.subcategories) || 0
  if (items) parts.push(plural(items, 'item'))
  if (entries) parts.push(plural(entries, 'SHOP entry', 'SHOP entries'))
  if (subs) parts.push(plural(subs, 'sub-category', 'sub-categories'))
  return parts.length ? `${parts.join(', ')} moved to ${targetLabel}` : `Moved to ${targetLabel}`
}

// What a move changed: "4 items follow it".
export function moveSummary(result, name, destination) {
  const items = Number(result?.items) || 0
  return items ? `"${name}" moved to ${destination} · ${plural(items, 'item')} followed` : `"${name}" moved to ${destination}`
}

// A database refusal in plain words. The functions already raise readable
// messages; this only keeps the technical ones out of sight.
export function plainError(error) {
  const message = String(error?.message ?? error ?? '')
  if (error?.code === '42501') return 'Not allowed: log in with the household account.'
  if (/does not exist|could not find the function|PGRST202/i.test(message)) return 'This needs the database update supabase/023_oct_2026_features.sql.'
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "Couldn't reach the server — check your connection."
  return message || "Couldn't save — check your connection."
}

// The categories as the app shows them: hidden ones left out, and the
// built-in display name used only while the stored name is still the
// original one — once someone renames it in Manage, their name shows.
export function visibleInventoryCategories(rows, { hiddenIds = [], displayNames = {}, originalNames = {} } = {}) {
  const hidden = new Set(hiddenIds)
  return rows
    .filter((c) => !hidden.has(c.id) && !hidden.has(c.parent_id))
    .map((c) => (displayNames[c.id] && c.name === originalNames[c.id] ? { ...c, name: displayNames[c.id] } : c))
}
