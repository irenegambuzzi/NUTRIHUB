import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { followUp, must } from '../lib/db'
import { isOffline } from '../lib/connection'
import { normName } from '../lib/grocery'
import { normalizeName } from '../lib/categoryGuess'
import { differsFromFirst, suggestBudgetCategories, suggestCategories, suggestCategory, worthRemembering } from '../lib/categorySuggest'
import { categoryMemoryStore, pantryStore } from '../lib/stores'

// Category suggestions for item names among `parents` (the categories a
// form offers), and remembering what the user picks by hand — shared by
// both phones and tried first next time. A form that also offers budget
// categories (a MONEY row with "Add to HOME" off) passes `expenseCategories`
// and `budgetFor` ({ categoryId, subcategoryId } → budget category id).
export function useCategorySuggestions({ parents, subsByParent, expenseCategories = [], budgetFor = () => null }) {
  const { rows: memoryRows } = categoryMemoryStore.useRows()
  const { rows: pantryItems } = pantryStore.useRows()
  const memory = useMemo(() => new Map(memoryRows.map((r) => [r.id, r])), [memoryRows])
  const pantryByName = useMemo(() => new Map(pantryItems.map((p) => [normName(p.name), p])), [pantryItems])
  const context = useMemo(
    () => ({ memory, pantryByName, parents, subsByParent, expenseCategories, budgetFor }),
    [memory, pantryByName, parents, subsByParent, expenseCategories, budgetFor]
  )

  const suggest = useCallback((name) => suggestCategory(name, context), [context])
  // 1–3 chips: memory → pantry → keywords → a similar existing name.
  const suggestions = useCallback((name, options) => suggestCategories(name, context, options), [context])
  const budgetSuggestions = useCallback((name, options) => suggestBudgetCategories(name, context, options), [context])

  // Saves what was picked by hand for a name (source 'user'); one row per
  // name. A write to the HOME category leaves the remembered budget
  // category alone and the other way round.
  const save = useCallback(async (name, fields) => {
    await followUp('the remembered category', async () => {
      const row = must(
        await supabase
          .from('category_memory')
          .upsert({ id: normalizeName(name), name: name.trim(), ...fields, source: 'user', updated_at: new Date().toISOString() })
          .select()
          .single()
      )
      categoryMemoryStore.upsertLocal([row])
    })
  }, [])

  // `chips` (what was on offer for the name) says whether the pick is
  // worth keeping: only a pick other than the first chip is. Without
  // `chips` the keyword list decides (the HOME item editor).
  const remember = useCallback(
    async (name, categoryId, subcategoryId = null, { chips } = {}) => {
      if (isOffline() || !normalizeName(name) || !categoryId) return
      const worth = chips ? differsFromFirst({ categoryId, subcategoryId: subcategoryId || null, expenseCategoryId: null }, chips) : worthRemembering(name, categoryId, subcategoryId, memory, { parents, subsByParent })
      // A name whose memory holds another HOME category is corrected even by the first chip.
      const existing = memory.get(normalizeName(name))
      const changes = existing?.category_id && (existing.category_id !== categoryId || (existing.subcategory_id ?? null) !== (subcategoryId ?? null))
      if (!worth && !changes) return
      await save(name, { category_id: categoryId, subcategory_id: subcategoryId || null })
    },
    [memory, parents, subsByParent, save]
  )

  // A budget category picked for a name whose row isn't added to HOME.
  const rememberBudget = useCallback(
    async (name, expenseCategoryId, { chips } = {}) => {
      if (isOffline() || !normalizeName(name) || !expenseCategoryId) return
      const existing = memory.get(normalizeName(name))
      const changes = existing && existing.expense_category_id !== expenseCategoryId
      const worth = chips ? differsFromFirst({ categoryId: null, subcategoryId: null, expenseCategoryId }, chips) : true
      if (!worth && !changes) return
      await save(name, { expense_category_id: expenseCategoryId })
    },
    [memory, save]
  )

  return { suggest, suggestions, budgetSuggestions, remember, rememberBudget }
}
