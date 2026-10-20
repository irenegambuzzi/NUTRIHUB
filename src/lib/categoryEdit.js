// Rules for renaming and moving categories (expense and income alike), as
// pure checks so the screen can explain a refusal before anything is saved.
// `categories` is the flat list ({ id, name, parent_id }); `locked` is a
// list of names that code looks up by name, which must keep them.

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Why `id` can't be renamed to `name`, or null when it can.
export function renameProblem(categories, id, name, locked = []) {
  const category = categories.find((c) => c.id === id)
  const trimmed = name.trim()
  if (!category) return 'This category no longer exists.'
  if (!category.parent_id && locked.includes(category.name)) return `"${category.name}" can't be renamed.`
  if (!trimmed) return 'Type a name.'
  if (categories.some((c) => c.id !== id && same(c.name, trimmed))) return `"${trimmed}" already exists.`
  return null
}

// Why `id` can't be moved under `parentId` (null = made a main category),
// or null when it can.
export function moveProblem(categories, id, parentId, locked = []) {
  const category = categories.find((c) => c.id === id)
  if (!category) return 'This category no longer exists.'
  if (!category.parent_id && locked.includes(category.name)) return `"${category.name}" can't be moved.`
  if ((category.parent_id ?? null) === (parentId ?? null)) return 'It is already there.'
  if (parentId) {
    const target = categories.find((c) => c.id === parentId)
    if (!target || target.parent_id) return 'Choose a main category.'
    if (target.id === id) return "A category can't go inside itself."
    if (categories.some((c) => c.parent_id === id)) {
      return `"${category.name}" still has sub-categories. Move those first, then it can become a sub-category.`
    }
  }
  return null
}

// Why `id` can't be deleted, or null when it can. `locked` is the list of
// main category names that code needs (Other, Groceries, Home &
// Appliances): they can't be deleted.
export function deleteProblem(categories, id, locked = []) {
  const category = categories.find((c) => c.id === id)
  if (!category) return 'This category no longer exists.'
  if (!category.parent_id && locked.includes(category.name)) return `"${category.name}" can't be deleted.`
  return null
}
