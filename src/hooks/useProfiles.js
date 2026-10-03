import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'

export function useProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchProfiles = useCallback(async function fetchProfiles() {
    const { data, error } = await supabase.from('profiles').select('*').order('id')
    setLoading(false)
    if (error) return toastLoadError(error, fetchProfiles, 'profiles')
    setProfiles(data)
  }, [])

  useEffect(() => {
    fetchProfiles()
    const channel = supabase
      .channel(`profiles-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchProfiles)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchProfiles])

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
    if (!error) setProfiles((prev) => prev.map((p) => (p.id === id ? data : p)))
    return { error }
  }, [])

  return { profiles, loading, saveProfile }
}
