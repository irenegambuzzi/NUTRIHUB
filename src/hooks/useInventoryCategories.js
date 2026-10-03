import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { inventoryCategoryStore } from '../lib/stores'
import { CATEGORY_NAME_OVERRIDES, DURABLE_CATEGORY_IDS, HIDDEN_CATEGORY_IDS } from '../data/constants'

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
  const hidden = new Set(HIDDEN_CATEGORY_IDS)
  return rows
    .filter((c) => !hidden.has(c.id) && !hidden.has(c.parent_id))
    .map((c) => (CATEGORY_NAME_OVERRIDES[c.id] ? { ...c, name: CATEGORY_NAME_OVERRIDES[c.id] } : c))
}

export function useInventoryCategories() {
  const { rows } = inventoryCategoryStore.useRows()
  const categories = useMemo(() => visibleCategories(rows), [rows])

  const { parents, pantryParents, subsByParent, byId } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const parents = categories.filter((c) => c.type === 'parent')
    const subsByParent = new Map(parents.map((p) => [p.id, []]))
    for (const c of categories) {
      if (c.type === 'sub' && subsByParent.has(c.parent_id)) subsByParent.get(c.parent_id).push(c)
    }
    // The pantry only tracks consumables, so durable categories are left out there.
    const pantryParents = parents.filter((p) => !DURABLE_CATEGORY_IDS.includes(p.id))
    return { parents, pantryParents, subsByParent, byId }
  }, [categories])

  const addSubcategory = useCallback(async (parentId, name) => {
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
  }, [subsByParent])

  // A new main category, at the end of the shop order. Its id is made from
  // the name ("Gluten free" → "gluten-free"), numbered if taken.
  const addCategory = useCallback(
    async (name) => {
      const ids = new Set(rows.map((c) => c.id))
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
    [rows]
  )

  const categoryName = useCallback((id) => byId.get(id)?.name ?? 'Uncategorized', [byId])

  return { categories, parents, pantryParents, subsByParent, byId, categoryName, addCategory, addSubcategory }
}
