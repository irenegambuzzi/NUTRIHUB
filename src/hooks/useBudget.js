import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// One shared budget row for the household (no per-user accounts).
// grocery_budget = null means "No budget limit".
export function useBudget() {
  const [settings, setSettings] = useState(null)

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('budget_settings').select('*').order('created_at').limit(1)
    setSettings(data?.[0] ?? null)
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const saveGroceryBudget = useCallback(
    async (amount) => {
      const grocery_budget = amount > 0 ? amount : null
      const query = settings
        ? supabase.from('budget_settings').update({ grocery_budget }).eq('id', settings.id)
        : supabase.from('budget_settings').insert([{ grocery_budget, currency: 'EUR' }])
      const { data, error } = await query.select().single()
      if (!error && data) setSettings(data)
      return { error }
    },
    [settings]
  )

  const groceryBudget = settings?.grocery_budget != null ? Number(settings.grocery_budget) : null
  return { groceryBudget, currency: settings?.currency || 'EUR', saveGroceryBudget }
}
