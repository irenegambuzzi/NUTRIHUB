import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'
import { CATEGORY_NAME_OVERRIDES, DURABLE_CATEGORY_IDS, HIDDEN_CATEGORY_IDS } from '../data/constants'

// Same list (and names) everywhere the app offers categories.
function visibleCategories(rows) {
  const hidden = new Set(HIDDEN_CATEGORY_IDS)
  return rows
    .filter((c) => !hidden.has(c.id) && !hidden.has(c.parent_id))
    .map((c) => (CATEGORY_NAME_OVERRIDES[c.id] ? { ...c, name: CATEGORY_NAME_OVERRIDES[c.id] } : c))
}

export function useInventoryCategories() {
  const [categories, setCategories] = useState([])

  const fetchCategories = useCallback(async function fetchCategories() {
    const { data, error } = await supabase.from('inventory_categories').select('*').order('sort_order').order('name')
    if (error) return toastLoadError(error, fetchCategories, 'inventory_categories')
    setCategories(visibleCategories(data))
  }, [])

  useEffect(() => {
    fetchCategories()
    const channel = supabase
      .channel(`inventory_categories-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_categories' }, fetchCategories)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchCategories])

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
    if (!error) setCategories((prev) => [...prev, data])
    return { data, error }
  }, [subsByParent])

  const categoryName = useCallback((id) => byId.get(id)?.name ?? 'Uncategorized', [byId])

  return { categories, parents, pantryParents, subsByParent, byId, categoryName, addSubcategory }
}
