import { useCallback, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { isOffline } from '../lib/connection'
import { shopOrderStore } from '../lib/stores'
import { categoryKey, forgetOldCategoryOrder, positionsFrom, readOldCategoryOrder } from '../lib/shopMode'

const save = async (rows) => {
  const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }))
  must(await supabase.from('shop_order').upsert(stamped))
  shopOrderStore.upsertLocal(stamped)
}

// The shared order of the shop: positions by key, and saving moves.
export function useShopOrder() {
  const { rows, loaded } = shopOrderStore.useRows()
  const positions = useMemo(() => positionsFrom(rows), [rows])

  // Once: a category order arranged on this phone before it was shared.
  useEffect(() => {
    if (!loaded || isOffline() || rows.some((r) => r.id.startsWith('category:'))) return
    const old = readOldCategoryOrder()
    if (!old.length) return
    attempt(() => save(old.map((id, i) => ({ id: categoryKey(id), position: (i + 1) * 100 })))).then(({ error }) => {
      if (!error) forgetOldCategoryOrder()
    })
  }, [loaded, rows])

  // Saves positions; the screen follows at once.
  const savePositions = useCallback((writes) => (writes.length ? attempt(() => save(writes), { onFail: shopOrderStore.refresh }) : { error: null }), [])

  return { positions, savePositions }
}
