import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { followUp, must } from '../lib/db'
import { isOffline } from '../lib/connection'
import { normName } from '../lib/grocery'
import { normalizeName } from '../lib/categoryGuess'
import { suggestCategory, worthRemembering } from '../lib/categorySuggest'
import { categoryMemoryStore, pantryStore } from '../lib/stores'

// Category suggestions for item names among `parents` (the categories a
// form offers), and remembering what the user picks by hand — shared by
// both phones and tried first next time.
export function useCategorySuggestions({ parents, subsByParent }) {
  const { rows: memoryRows } = categoryMemoryStore.useRows()
  const { rows: pantryItems } = pantryStore.useRows()
  const memory = useMemo(() => new Map(memoryRows.map((r) => [r.id, r])), [memoryRows])
  const pantryByName = useMemo(() => new Map(pantryItems.map((p) => [normName(p.name), p])), [pantryItems])

  const suggest = useCallback(
    (name) => suggestCategory(name, { memory, pantryByName, parents, subsByParent }),
    [memory, pantryByName, parents, subsByParent]
  )

  const remember = useCallback(
    async (name, categoryId, subcategoryId = null) => {
      if (isOffline() || !worthRemembering(name, categoryId, subcategoryId, memory)) return
      await followUp('the remembered category', async () => {
        const row = must(
          await supabase
            .from('category_memory')
            .upsert({ id: normalizeName(name), name: name.trim(), category_id: categoryId, subcategory_id: subcategoryId || null, updated_at: new Date().toISOString() })
            .select()
            .single()
        )
        categoryMemoryStore.upsertLocal([row])
      })
    },
    [memory]
  )

  return { suggest, remember }
}
