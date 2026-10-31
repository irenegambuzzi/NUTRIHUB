import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must, OFFLINE_MESSAGE } from '../lib/db'
import { isOffline } from '../lib/connection'
import { showToast, toastSaveError } from '../lib/feedback'
import { budgetMapStore, categoryMemoryStore, groceryStore, inventoryCategoryStore, pantryStore } from '../lib/stores'
import { sortCategories } from '../lib/categoryOrder'
import { CATEGORY_NAME_OVERRIDES, CATEGORY_ORIGINAL_NAMES, DURABLE_CATEGORY_IDS, HIDDEN_CATEGORY_IDS } from '../data/constants'
import {
  isUnused,
  mergeProblem,
  mergeSummary,
  moveProblem,
  moveSummary,
  nameProblem,
  pathOf,
  plainError,
  renameProblem,
  usageOf,
  visibleInventoryCategories,
} from '../lib/inventoryCategoryEdit'

// "Gluten free!" → "gluten-free".
export function categoryIdFor(name) {
  return (
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'category'
  )
}

// Same list (and names) everywhere the app offers categories.
function visibleCategories(rows) {
  return visibleInventoryCategories(rows, { hiddenIds: HIDDEN_CATEGORY_IDS, displayNames: CATEGORY_NAME_OVERRIDES, originalNames: CATEGORY_ORIGINAL_NAMES })
}

// A name that is already used is refused with the reason, before anything
// is sent (no database rule: the live data still has one duplicate).
const refused = (message) => ({ data: null, error: Object.assign(new Error(message), { nameProblem: true }) })

// Everything a category change can touch, reloaded so the screen shows
// what is really saved.
const refreshAll = () =>
  Promise.all([inventoryCategoryStore.refresh(), pantryStore.refresh(), groceryStore.refresh(), categoryMemoryStore.refresh(), budgetMapStore.refresh()])

// Runs one of the database's category functions. Its refusals are already
// in plain English, so they are shown as they are. Returns { data, error }.
async function callCategoryFunction(name, args) {
  if (isOffline()) {
    showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
    return { data: null, error: { message: OFFLINE_MESSAGE, offline: true } }
  }
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    await refreshAll()
    const message = plainError(error)
    toastSaveError(error, null, message)
    return { data: null, error: { ...error, message } }
  }
  await refreshAll()
  return { data, error: null }
}

// Whether anything in the database still points at a category, asked live
// (not from the phone's copy), so a plain delete can never cascade away a
// remembered name or an item another phone just added.
async function usedInDatabase(id) {
  for (const table of ['pantry_items', 'grocery_items', 'category_memory']) {
    const { data, error } = await supabase.from(table).select('id').or(`category_id.eq."${id}",subcategory_id.eq."${id}"`).limit(1)
    if (error) throw error
    if (data.length > 0) return true
  }
  const { data, error } = await supabase.from('inventory_categories').select('id').eq('parent_id', id).limit(1)
  if (error) throw error
  return data.length > 0
}

export function useInventoryCategories() {
  const { rows } = inventoryCategoryStore.useRows()
  const categories = useMemo(() => visibleCategories(rows), [rows])

  const { parents, pantryParents, subsByParent, byId, shopOrder } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    // sort_order is the shop's default route, used only by Shop mode
    // (shopOrder). Every list and picker gets the categories A–Z, with the
    // catch-alls last.
    const mains = categories.filter((c) => c.type === 'parent')
    const shopOrder = [...mains].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)).map((p) => p.id)
    const parents = sortCategories(mains)
    const subsByParent = new Map(parents.map((p) => [p.id, []]))
    for (const c of categories) {
      if (c.type === 'sub' && subsByParent.has(c.parent_id)) subsByParent.get(c.parent_id).push(c)
    }
    for (const [id, subs] of subsByParent) subsByParent.set(id, sortCategories(subs))
    // The pantry only tracks consumables, so durable categories are left out there.
    const pantryParents = parents.filter((p) => !DURABLE_CATEGORY_IDS.includes(p.id))
    return { parents, pantryParents, subsByParent, byId, shopOrder }
  }, [categories])

  const addSubcategory = useCallback(
    async (parentId, name) => {
      const problem = nameProblem(categories, name)
      if (problem) return refused(problem)
      const sortOrder = (subsByParent.get(parentId)?.length || 0) + 1
      const { data, error } = await attempt(
        async () =>
          must(
            await supabase
              .from('inventory_categories')
              .insert([{ name: name.trim(), parent_id: parentId, type: 'sub', sort_order: sortOrder }])
              .select()
              .single()
          ),
        { retry: false }
      )
      if (!error) inventoryCategoryStore.upsertLocal([data])
      return { data, error }
    },
    [categories, subsByParent]
  )

  // A new main category, at the end of the shop order. Its id is made from
  // the name ("Gluten free" → "gluten-free"), numbered if taken. A hidden
  // id counts as taken, so "Automotive" becomes "automotive-2" and is
  // shown (with the id "automotive" it would be saved but never shown).
  const addCategory = useCallback(
    async (name) => {
      const problem = nameProblem(categories, name)
      if (problem) return refused(problem)
      const ids = new Set([...rows.map((c) => c.id), ...HIDDEN_CATEGORY_IDS])
      const base = categoryIdFor(name)
      let id = base
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
      const sortOrder = Math.max(0, ...rows.filter((c) => c.type === 'parent').map((c) => c.sort_order ?? 0)) + 1
      const { data, error } = await attempt(
        async () =>
          must(
            await supabase
              .from('inventory_categories')
              .insert([{ id, name: name.trim(), parent_id: null, type: 'parent', sort_order: sortOrder }])
              .select()
              .single()
          ),
        { retry: false }
      )
      if (!error) inventoryCategoryStore.upsertLocal([data])
      return { data, error }
    },
    [categories, rows]
  )

  // Same category, new name: its id stays, so its items, colours, icon,
  // budget category and place in the shop order are untouched (Home &
  // Appliances can be renamed too: the code finds it by its id).
  const renameCategory = useCallback(
    async (id, name) => {
      const problem = renameProblem(categories, id, name)
      if (problem) return refused(problem)
      const { data, error } = await attempt(
        async () => must(await supabase.from('inventory_categories').update({ name: name.trim() }).eq('id', id).select())[0],
        { retry: false, onFail: () => inventoryCategoryStore.refresh() }
      )
      if (!error && data) inventoryCategoryStore.upsertLocal([data])
      return { data, error }
    },
    [categories]
  )

  // A sub-category under another main category (or as a main one, with
  // parentId null), its items following. Done by the database in one go.
  const moveSubcategory = useCallback(
    async (id, parentId) => {
      const problem = moveProblem(categories, id, parentId)
      if (problem) return refused(problem)
      const result = await callCategoryFunction('move_inventory_subcategory', { sub_id: id, parent_id: parentId })
      if (result.error) return result
      const name = byId.get(id)?.name ?? 'Category'
      const message = moveSummary(result.data, name, parentId ? byId.get(parentId)?.name : 'main categories')
      showToast({ message })
      return { ...result, message }
    },
    [categories, byId]
  )

  // Deletes a category. With nothing in it: deleted right away, with Undo.
  // With items, SHOP entries, remembered names or sub-categories: every one
  // of them is moved to `targetId` first, in one go by the database (a plain
  // delete would lose the remembered names).
  const deleteCategory = useCallback(
    async (id, targetId = null) => {
      const category = byId.get(id)
      if (!category) return refused('This category no longer exists.')
      if (!targetId) {
        const usage = usageOf(categories, category, pantryStore.getSnapshot().rows, groceryStore.getSnapshot().rows, categoryMemoryStore.getSnapshot().rows)
        if (!isUnused(usage)) return refused(`"${category.name}" is still in use. Choose where to move its items.`)
        if (isOffline()) {
          showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
          return { data: null, error: { message: OFFLINE_MESSAGE, offline: true } }
        }
        try {
          if (await usedInDatabase(id)) {
            await refreshAll()
            return refused(`"${category.name}" is still in use. Choose where to move its items.`)
          }
        } catch (error) {
          toastSaveError(error)
          return { data: null, error }
        }
        return deleteWithUndo({
          message: `"${category.name}" deleted`,
          remove: async () => {
            const removed = must(await supabase.from('inventory_categories').delete().eq('id', id).select())
            inventoryCategoryStore.removeLocal([id])
            return removed
          },
          restore: async (removed) => {
            must(await supabase.from('inventory_categories').upsert(removed))
            inventoryCategoryStore.upsertLocal(removed)
          },
          onFail: () => inventoryCategoryStore.refresh(),
        })
      }
      const problem = mergeProblem(categories, id, targetId)
      if (problem) return refused(problem)
      const result = await callCategoryFunction('merge_inventory_category', { from_id: id, to_id: targetId })
      if (result.error) return result
      const message = `${mergeSummary(result.data, pathOf(categories, byId.get(targetId)))}. "${category.name}" deleted.`
      showToast({ message })
      return { ...result, message }
    },
    [categories, byId]
  )

  const categoryName = useCallback((id) => byId.get(id)?.name ?? 'Uncategorized', [byId])

  return { categories, parents, pantryParents, subsByParent, shopOrder, byId, categoryName, addCategory, addSubcategory, renameCategory, moveSubcategory, deleteCategory }
}
