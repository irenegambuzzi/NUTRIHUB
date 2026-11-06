import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOffline, useOnline } from '../lib/connection'
import { NAMES_COLUMN, missingNamesColumn, namesColumnReady } from '../lib/itemNames'

// Whether the database has supabase/032 (plan 9N): the column
// pantry_items.names, which comes in one transaction with the functions
// that write it. true, false, or null while it can't be told yet (offline,
// or the read failed) — the same three answers as hooks/useNewItemUnits.js.
// `rows`: HOME items already loaded, read with all their columns, so they
// tell by themselves; without them one small read of that column tells,
// made again as soon as the connection comes back. A save that would need
// 032 while it is still null asks first (`checkItemNames`). Once seen, it
// stays known for this app start, on every screen.
let seen = false
const listeners = new Set()
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const learn = () => {
  if (seen) return
  seen = true
  listeners.forEach((l) => l())
}

// true: the column answered; false: the database said it doesn't exist;
// null: no answer (offline, another error).
async function probe() {
  if (isOffline()) return null
  try {
    const { error } = await supabase.from('pantry_items').select(NAMES_COLUMN).limit(1)
    if (!error) return true
    return missingNamesColumn(error) ? false : null
  } catch {
    return null
  }
}

// One small read to tell, e.g. when a save needs 032 while it isn't known
// yet. Every screen asking learns the answer.
export async function checkItemNames() {
  if (seen) return true
  const found = await probe()
  if (found) learn()
  return found
}

export function useItemNamesReady(rows) {
  const known = useSyncExternalStore(subscribe, () => seen, () => seen)
  const online = useOnline()
  const [probed, setProbed] = useState(null)
  const shown = namesColumnReady(rows)
  useEffect(() => {
    if (shown) learn()
  }, [shown])
  useEffect(() => {
    if (known || shown || probed === false || !online) return undefined
    let live = true
    checkItemNames().then((found) => {
      if (live) setProbed(found)
    })
    return () => {
      live = false
    }
  }, [known, shown, probed, online])
  return known || shown ? true : probed
}

// Used to test: forget what was seen.
export function forgetNamesForTest() {
  seen = false
}
