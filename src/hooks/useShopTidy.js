import { useEffect } from 'react'
import { followUp } from '../lib/db'
import { isOffline } from '../lib/connection'
import { getQueue } from '../lib/offlineQueue'
import { groupsToTidy } from '../lib/groupShop'
import { syncShoppingForItem } from '../lib/inventory'
import { groceryStore } from '../lib/stores'

// Groups already tidied since the app was opened: each at most once, so
// two phones (or an older version of the app on the other one) never keep
// rewriting the list back and forth.
const tidied = new Set()

// Tidies the SHOP list of the groups whose entries are not as they should
// be (lib/groupShop.js groupsToTidy): old group-level entries still "to
// buy" become one entry per variant at 0, and a second entry for the same
// variant goes. Entries in a cart, ordered online or bought are never
// touched. Worked out from the rows already on the phone, so nothing is
// read or written when the list is already right. `ready`: everything is
// loaded.
export function useShopTidy({ entries, pantryRows, ordered, ready }) {
  useEffect(() => {
    if (!ready || isOffline() || getQueue().length) return
    const ids = groupsToTidy({ entries, pantryRows, ordered }).filter((id) => !tidied.has(id))
    if (!ids.length) return
    ids.forEach((id) => tidied.add(id))
    const groups = pantryRows.filter((p) => ids.includes(p.id))
    followUp('the shopping list', async () => {
      for (const group of groups) await syncShoppingForItem(group)
      await groceryStore.refresh()
    })
  }, [entries, pantryRows, ordered, ready])
}

// Used by tests.
export const resetShopTidyForTest = () => tidied.clear()
