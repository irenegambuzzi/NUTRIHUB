import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useInventoryCategories() {
  const [categories, setCategories] = useState([])

  const fetchCategories = useCallback(async () => {
    const { data } = await supabase.from('inventory_categories').select('*').order('sort_order').order('name')
    if (data) setCategories(data)
  }, [])

  useEffect(() => {
    fetchCategories()
    const channel = supabase
      .channel(`inventory_categories-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_categories' }, fetchCategories)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchCategories])

  const { parents, subsByParent, byId } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const parents = categories.filter((c) => c.type === 'parent')
    const subsByParent = new Map(parents.map((p) => [p.id, []]))
    for (const c of categories) {
      if (c.type === 'sub' && subsByParent.has(c.parent_id)) subsByParent.get(c.parent_id).push(c)
    }
    return { parents, subsByParent, byId }
  }, [categories])

  const addSubcategory = useCallback(async (parentId, name) => {
    const sortOrder = (subsByParent.get(parentId)?.length || 0) + 1
    const { data, error } = await supabase
      .from('inventory_categories')
      .insert([{ name: name.trim(), parent_id: parentId, type: 'sub', sort_order: sortOrder }])
      .select()
      .single()
    if (!error && data) setCategories((prev) => [...prev, data])
    return { data, error }
  }, [subsByParent])

  const categoryName = useCallback((id) => byId.get(id)?.name ?? 'Uncategorized', [byId])

  return { categories, parents, subsByParent, byId, categoryName, addSubcategory }
}
