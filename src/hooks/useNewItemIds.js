import { useMemo } from 'react'
import { restockLogStore } from '../lib/stores'
import { isNewItem } from '../lib/newItems'

// The ids of the HOME items that are still "New Item" (see newItems.js).
// A group is restocked when any of its variants is.
export function useNewItemIds(items) {
  const { rows: restocks } = restockLogStore.useRows()
  return useMemo(() => {
    const groupOf = new Map(items.filter((i) => i.group_id).map((i) => [i.id, i.group_id]))
    const all = groupOf.size ? [...restocks, ...restocks.filter((r) => groupOf.has(r.item_id)).map((r) => ({ ...r, item_id: groupOf.get(r.item_id) }))] : restocks
    return new Set(items.filter((i) => isNewItem(i, all)).map((i) => i.id))
  }, [items, restocks])
}
