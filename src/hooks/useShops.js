import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { allExpenseStores, orderStore, shopStore } from '../lib/stores'
import { shopsAvailable } from '../lib/shops'

const refreshAffected = () => Promise.all([...allExpenseStores().map((s) => s.refresh()), orderStore.isStarted() ? orderStore.refresh() : null])

// The stores ("Bought at") and adding, renaming and removing them. Until
// supabase/019 has been run there are none to manage: `missing` is true.
// Removing a store never removes an expense: the database empties the
// store of the expenses (and orders) that had it.
export function useShops() {
  const state = shopStore.useRows()
  const { rows: shops, loaded, missing } = state
  const byId = useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops])

  const addShop = useCallback(async (name, isOnline) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('shops').insert([{ name: name.trim(), is_online: Boolean(isOnline) }]).select())[0],
      { retry: false }
    )
    if (!error) shopStore.upsertLocal([data])
    return { data, error }
  }, [])

  // Same store, new name and/or online flag: its id (so its expenses) is untouched.
  const updateShop = useCallback(async (id, fields) => {
    const patch = {}
    if (fields.name !== undefined) patch.name = fields.name.trim()
    if (fields.isOnline !== undefined) patch.is_online = Boolean(fields.isOnline)
    const { data, error } = await attempt(async () => must(await supabase.from('shops').update(patch).eq('id', id).select())[0], {
      retry: false,
      onFail: () => shopStore.refresh(),
    })
    if (!error && data) shopStore.upsertLocal([data])
    return { data, error }
  }, [])

  const deleteShop = useCallback(async (id) => {
    const result = await attempt(async () => must(await supabase.from('shops').delete().eq('id', id)), {
      retry: false,
      onFail: () => Promise.all([shopStore.refresh(), refreshAffected()]),
    })
    if (!result.error) {
      shopStore.removeLocal([id])
      await refreshAffected()
    }
    return result
  }, [])

  return { shops, byId, loaded, missing: Boolean(missing), ready: shopsAvailable(state), addShop, updateShop, deleteShop }
}
