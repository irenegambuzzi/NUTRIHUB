// Income categories (supabase/017). Until that has been run, income has
// only the old type (Salary / Other), shown here as two stand-in
// categories so everything on screen works the same.

export const LEGACY_INCOME_CATEGORIES = [
  { id: 'legacy-salary', name: 'Salary', parent_id: null, created_at: '1' },
  { id: 'legacy-other', name: 'Other', parent_id: null, created_at: '2' },
]

const LEGACY_ID = { salary: 'legacy-salary', other: 'legacy-other' }

// The saved categories, or the stand-ins when the table isn't there yet.
export const incomeCategoriesOrLegacy = (categories, missing) => (missing ? LEGACY_INCOME_CATEGORIES : categories)

// Every entry with a category_id that exists: the one it was given, else
// the main category matching its old type (e.g. an entry saved by a phone
// that still has the previous version).
export function resolveIncomeCategories(income, categories, missing) {
  const known = new Set(categories.map((c) => c.id))
  const byName = (name) => categories.find((c) => !c.parent_id && c.name === name)?.id ?? null
  return income.map((entry) => {
    if (!missing && entry.category_id && known.has(entry.category_id)) return entry
    const id = missing ? LEGACY_ID[entry.income_type] ?? LEGACY_ID.other : byName(entry.income_type === 'salary' ? 'Salary' : 'Other')
    return { ...entry, category_id: id }
  })
}

// The old type kept in step with the category, so the old column stays
// valid: "Salary" (or under it) is 'salary', everything else 'other'.
export function incomeTypeFor(categoryId, categories) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const c = byId.get(categoryId)
  const main = c?.parent_id ? byId.get(c.parent_id) : c
  return main?.name === 'Salary' ? 'salary' : 'other'
}
