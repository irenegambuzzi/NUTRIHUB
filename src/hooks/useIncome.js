import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { allIncomeStores, incomeCategoryStore, incomeSince } from '../lib/stores'
import { incomeCategoriesOrLegacy, incomeTypeFor, resolveIncomeCategories } from '../lib/incomeCategories'

const refreshIncome = () => Promise.all(allIncomeStores().map((s) => s.refresh()))

// Deletes right away; Undo puts the entry back exactly.
export function deleteIncome(id) {
  return deleteWithUndo({
    message: 'Income deleted',
    remove: async () => {
      const rows = must(await supabase.from('income').delete().eq('id', id).select())
      allIncomeStores().forEach((s) => s.removeLocal([id]))
      return rows
    },
    restore: async (rows) => {
      if (rows.length) must(await supabase.from('income').upsert(rows))
      await refreshIncome()
    },
    onFail: refreshIncome,
  })
}

// Income categories, and adding/removing them. Until supabase/017 has
// been run there are none to manage: `missing` is true and `categories`
// holds the two stand-ins (Salary / Other).
export function useIncomeCategories() {
  const { rows: saved, missing } = incomeCategoryStore.useRows()
  const categories = useMemo(() => incomeCategoriesOrLegacy(saved, !!missing), [saved, missing])

  const addCategory = useCallback(async (name, parentId = null) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('income_categories').insert([{ name, parent_id: parentId, type: parentId ? 'sub' : 'parent' }]).select())[0],
      { retry: false }
    )
    if (!error) incomeCategoryStore.upsertLocal([data])
    return { data, error }
  }, [])

  const renameCategory = useCallback(async (id, name) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('income_categories').update({ name }).eq('id', id).select())[0],
      { retry: false, onFail: () => incomeCategoryStore.refresh() }
    )
    if (!error && data) incomeCategoryStore.upsertLocal([data])
    return { data, error }
  }, [])

  // Under another main category (parentId) or as a main category (null).
  // The entries stay on the category; their old Salary / Other type is
  // brought in step with where the category now sits.
  const moveCategory = useCallback(
    async (id, parentId) => {
      const { data, error } = await attempt(
        async () => {
          const moved = must(
            await supabase.from('income_categories').update({ parent_id: parentId, type: parentId ? 'sub' : 'parent' }).eq('id', id).select()
          )[0]
          const next = saved.map((c) => (c.id === id ? moved : c))
          must(await supabase.from('income').update({ income_type: incomeTypeFor(id, next) }).eq('category_id', id))
          return moved
        },
        { retry: false, onFail: () => Promise.all([incomeCategoryStore.refresh(), refreshIncome()]) }
      )
      if (!error && data) {
        incomeCategoryStore.upsertLocal([data])
        await refreshIncome()
      }
      return { data, error }
    },
    [saved]
  )

  // Deleting a category never loses income: its entries (and those in its
  // sub-categories) move to "Other" first, which is created if missing.
  const deleteCategory = useCallback(
    async (id) => {
      const other = saved.find((c) => c.name === 'Other' && !c.parent_id)
      if (other?.id === id) return { error: { message: '"Other" holds moved income and can\'t be deleted.' } }
      const ids = [id, ...saved.filter((c) => c.parent_id === id).map((c) => c.id)]
      const refreshAll = () => Promise.all([incomeCategoryStore.refresh(), refreshIncome()])
      const result = await attempt(
        async () => {
          const target = other ?? must(await supabase.from('income_categories').insert([{ name: 'Other', type: 'parent' }]).select().single())
          must(await supabase.from('income').update({ category_id: target.id, income_type: 'other' }).in('category_id', ids))
          must(await supabase.from('income_categories').delete().in('id', ids))
        },
        { retry: false, onFail: refreshAll }
      )
      if (!result.error) await refreshAll()
      return result
    },
    [saved]
  )

  return { categories, missing: !!missing, addCategory, renameCategory, moveCategory, deleteCategory }
}

// Income entries from `since` (YYYY-MM-DD) on, with their categories, and
// adding, editing and deleting them. Income is its own record type:
// nothing here touches expenses.
export function useIncome(since) {
  const { rows, loaded, missing } = incomeSince(since).useRows()
  const { categories, missing: categoriesMissing, addCategory, renameCategory, moveCategory, deleteCategory } = useIncomeCategories()
  const income = useMemo(() => resolveIncomeCategories(rows, categories, categoriesMissing), [rows, categories, categoriesMissing])

  // category_id is only sent once the column exists; the old type always
  // goes along, matching the category.
  const toRow = useCallback(
    ({ amount, incomeDate, categoryId, receivedBy, source }) => ({
      amount,
      income_date: incomeDate,
      income_type: incomeTypeFor(categoryId, categories),
      ...(categoriesMissing ? {} : { category_id: categoryId || null }),
      received_by: receivedBy,
      source: source || null,
    }),
    [categories, categoriesMissing]
  )

  const addIncome = useCallback(
    (values) =>
      attempt(
        async () => {
          const rows = must(await supabase.from('income').insert([toRow(values)]).select())
          allIncomeStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false }
      ),
    [toRow]
  )

  const updateIncome = useCallback(
    (id, values) =>
      attempt(
        async () => {
          const rows = must(await supabase.from('income').update(toRow(values)).eq('id', id).select())
          allIncomeStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false, onFail: refreshIncome }
      ),
    [toRow]
  )

  return { income, loaded, missing: !!missing, categories, categoriesMissing, addCategory, renameCategory, moveCategory, deleteCategory, addIncome, updateIncome, deleteIncome }
}
