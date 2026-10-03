import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'

// One shared budget row for the household (no per-user accounts).
// grocery_budget = null means "No budget limit". Changes made on another
// phone arrive through realtime.
export function useBudget() {
  const [settings, setSettings] = useState(null)

  const fetchSettings = useCallback(async function fetchSettings() {
    const { data, error } = await supabase.from('budget_settings').select('*').order('created_at').limit(1)
    if (error) return toastLoadError(error, fetchSettings, 'budget_settings')
    setSettings(data[0] ?? null)
  }, [])

  useEffect(() => {
    fetchSettings()
    const channel = supabase
      .channel(`budget_settings-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_settings' }, fetchSettings)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchSettings])

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
      if (!error) setSettings(data)
      return { error }
    },
    [settings, fetchSettings]
  )

  const groceryBudget = settings?.grocery_budget != null ? Number(settings.grocery_budget) : null
  return { groceryBudget, currency: settings?.currency || 'EUR', saveGroceryBudget }
}
