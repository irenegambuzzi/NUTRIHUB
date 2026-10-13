import { budgetMapStore, shopStore } from '../lib/stores'
import { shopsAvailable } from '../lib/shops'

export const FLOW_NOTICE =
  'This needs a one-time database update (supabase/021_connected_flow.sql). Until then everything works exactly as before.'

// Whether HOME, SHOP, Orders and MONEY work as one flow: supabase/021 has
// been run (its mapping table loads) and the stores exist (019).
// `missing`: the update hasn't been run, so the new features show
// FLOW_NOTICE instead.
export function useFlow() {
  const map = budgetMapStore.useRows()
  const shops = shopStore.useRows()
  return {
    ready: Boolean(map.loaded) && !map.missing && shopsAvailable(shops),
    missing: Boolean(map.missing) || Boolean(shops.missing),
    mapRows: map.rows,
  }
}
