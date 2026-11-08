import { useMemo } from 'react'
import { restockLogStore } from '../lib/stores'
import { isNewItem } from '../lib/newItems'

// The ids of the HOME items that are still "New Item" (see newItems.js).
export function useNewItemIds(items) {
  const { rows: restocks } = restockLogStore.useRows()
  return useMemo(() => new Set(items.filter((i) => isNewItem(i, restocks)).map((i) => i.id)), [items, restocks])
}
