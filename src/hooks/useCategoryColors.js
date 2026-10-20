import { useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOffline } from '../lib/connection'
import { categoryColorStore } from '../lib/stores'
import { assignCategoryColors, categoryStyle, UNCATEGORIZED_COLOR } from '../lib/expenseColors'

// Each category's fixed color. Saved colors are used as they are; new
// categories (and the ones from before colors existed) get theirs worked
// out the same way on every phone, then saved so they never change. If
// the table isn't there yet, the worked-out colors are simply not saved.
// Expense colors by default; income passes its own table. For expenses a
// sub-category shows its main category's color (`subsFollowMain`); income
// keeps a color of its own for each sub-category.
export function useCategoryColors(categories, { store = categoryColorStore, table = 'expense_category_colors', subsFollowMain = false } = {}) {
  const { rows: stored, loaded, missing } = store.useRows()
  const { colors, fresh } = useMemo(() => assignCategoryColors(categories, stored, { subsFollowMain }), [categories, stored, subsFollowMain])

  useEffect(() => {
    if (!loaded || missing || fresh.length === 0 || categories.length === 0 || isOffline()) return
    // Another phone saving the same ones meanwhile is fine: first wins.
    supabase
      .from(table)
      .upsert(fresh, { onConflict: 'category_id', ignoreDuplicates: true })
      .select()
      .then(({ data, error }) => {
        if (error) return console.error(error)
        if (data?.length) store.upsertLocal(data)
      })
  }, [loaded, missing, fresh, categories.length, store, table])

  return useMemo(() => {
    const styles = new Map([...colors].map(([id, hex]) => [id, categoryStyle(hex)]))
    const neutral = categoryStyle(UNCATEGORIZED_COLOR)
    return (categoryId) => styles.get(categoryId) ?? neutral
  }, [colors])
}
