import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { profileStore } from '../lib/stores'

export function useProfiles() {
  const { rows: profiles, loaded } = profileStore.useRows()
  const loading = !loaded

  const saveProfile = useCallback(async (id, updates) => {
    const { data, error } = await attempt(
      async () =>
        must(
          await supabase
            .from('profiles')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()
        ),
      { retry: false }
    )
    if (!error) profileStore.upsertLocal([data])
    return { error }
  }, [])

  return { profiles, loading, saveProfile }
}
