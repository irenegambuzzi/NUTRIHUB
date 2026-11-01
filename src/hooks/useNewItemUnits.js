import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOffline, useOnline } from '../lib/connection'
import { STOCK_UNIT_COLUMN, missingStockUnitColumn } from '../lib/newItemUnit'

// Whether the database has supabase/030 (plan 9L): the column
// shopping_trip_items.stock_unit, which comes with the confirm_shopping_trip
// that makes a new item in the unit chosen at the purchase. true, false, or
// null while it can't be told yet (offline, or the read failed) — the same
// three answers as the parts of 029 (hooks/useExpenseParts.js, K18). One
// small read of that column tells; while it is null the question "Count it
// at home in" stays hidden, and it is read again as soon as the connection
// comes back. A save with a line that would get the question while it is
// still null asks first (`checkNewItemUnits`). Once seen, it stays known
// for this app start, on every screen.
let seen = false
const listeners = new Set()
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// true: the column answered; false: the database said it doesn't exist;
// null: no answer (offline, another error).
async function probe() {
  if (isOffline()) return null
  try {
    const { error } = await supabase.from('shopping_trip_items').select(STOCK_UNIT_COLUMN).limit(1)
    if (!error) return true
    return missingStockUnitColumn(error) ? false : null
  } catch {
    return null
  }
}

// One small read to tell, e.g. when "Confirm purchase" is pressed while it
// isn't known yet. Every screen asking learns the answer.
export async function checkNewItemUnits() {
  if (seen) return true
  const found = await probe()
  if (found && !seen) {
    seen = true
    listeners.forEach((l) => l())
  }
  return found
}

export function useNewItemUnitsReady() {
  const known = useSyncExternalStore(subscribe, () => seen, () => seen)
  const online = useOnline()
  const [probed, setProbed] = useState(null)
  useEffect(() => {
    if (known || probed === false || !online) return undefined
    let live = true
    checkNewItemUnits().then((found) => {
      if (live) setProbed(found)
    })
    return () => {
      live = false
    }
  }, [known, probed, online])
  return known ? true : probed
}

// Used to test: forget what was seen.
export function forgetUnitsForTest() {
  seen = false
}
