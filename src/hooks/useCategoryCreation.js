import { useCallback, useMemo } from 'react'
import { APPLIANCES_ID } from '../lib/inventoryCategoryEdit'
import { mappingToStore } from '../lib/newCategory'
import { budgetMapStore, inventoryCategoryStore } from '../lib/stores'
import { useInventoryCategories } from './useInventoryCategories'
import { useExpenseCategories } from './useExpenses'
import { setBudgetMapping } from './useBudgetMap'

// Everything the "+ New category" row needs: the categories it checks the
// name against, the budget mapping it starts from, and the two ways to add
// one — a HOME category (with its budget mapping) or a MONEY category only.
// Both only ever add.
export function useCategoryCreation() {
  const { categories: homeCategories, parents, addCategory, addSubcategory } = useInventoryCategories()
  const { categories: expenseCategories, addCategory: addExpenseCategory } = useExpenseCategories()
  const { rows: inventoryRows } = inventoryCategoryStore.useRows()
  const { rows: mapRows } = budgetMapStore.useRows()
  const ctx = useMemo(() => ({ expenseCategories, inventoryCategories: inventoryRows, mapRows }), [expenseCategories, inventoryRows, mapRows])
  // Main categories a new sub-category can go under (Home & Appliances
  // keeps its own tree).
  const homeMains = useMemo(() => parents.filter((p) => p.id !== APPLIANCES_ID), [parents])
  const moneyMains = useMemo(() => expenseCategories.filter((c) => !c.parent_id), [expenseCategories])

  // → { error, pick: { categoryId, subcategoryId, expenseCategoryId } }
  const createHome = useCallback(
    async ({ name, parentId, budgetId }) => {
      const { data, error } = parentId ? await addSubcategory(parentId, name) : await addCategory(name)
      if (error) return { error }
      const store = mappingToStore({ chosenId: budgetId, parentId, ctx })
      if (store) await setBudgetMapping(data.id, store)
      return { error: null, pick: { categoryId: parentId || data.id, subcategoryId: parentId ? data.id : null, expenseCategoryId: null } }
    },
    [addCategory, addSubcategory, ctx]
  )

  const createMoney = useCallback(
    async ({ name, parentId }) => {
      const { data, error } = await addExpenseCategory(name, parentId || null)
      return error ? { error } : { error: null, pick: { categoryId: null, subcategoryId: null, expenseCategoryId: data.id } }
    },
    [addExpenseCategory]
  )

  return { homeCategories, homeMains, expenseCategories, moneyMains, ctx, createHome, createMoney }
}
