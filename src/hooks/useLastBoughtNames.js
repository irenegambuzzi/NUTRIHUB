import { useEffect, useState } from 'react'
import { fetchItemLineNames } from '../lib/lastPrice'

// The names `itemId` was last bought under, newest first (plan 9N, K56);
// read once per item when `enabled` (it has other names), [] until then.
export function useLastBoughtNames(itemId, enabled) {
  const [read, setRead] = useState({ id: null, names: [] })
  useEffect(() => {
    if (!enabled || !itemId) return undefined
    let stale = false
    fetchItemLineNames(itemId).then((names) => {
      if (!stale) setRead({ id: itemId, names })
    })
    return () => {
      stale = true
    }
  }, [itemId, enabled])
  return read.id === itemId ? read.names : []
}
