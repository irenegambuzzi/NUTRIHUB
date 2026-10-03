import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { budgetStore } from '../lib/stores'

// One shared budget row for the household (no per-user accounts).
// grocery_budget = null means "No budget limit". Changes made on another
// phone arrive through realtime (budgetStore).
export function useBudget() {
  const { rows } = budgetStore.useRows()
  const settings = rows[0] ?? null
  const fetchSettings = budgetStore.refresh

  const saveGroceryBudget = useCallback(
    async (amount) => {
      const grocery_budget = amount > 0 ? amount : null
      const { data, error } = await attempt(
        async () => {
          const query = settings
            ? supabase.from('budget_settings').update({ grocery_budget }).eq('id', settings.id)
            : supabase.from('budget_settings').insert([{ grocery_budget, currency: 'EUR' }])
          return must(await query.select().single())
        },
        { retry: false, onFail: fetchSettings }
      )
      if (!error) budgetStore.upsertLocal([data])
      return { error }
    },
    [settings, fetchSettings]
  )

  const groceryBudget = settings?.grocery_budget != null ? Number(settings.grocery_budget) : null
  return { groceryBudget, currency: settings?.currency || 'EUR', saveGroceryBudget }
}
