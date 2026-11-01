import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOffline, useOnline } from '../lib/connection'
import { OFFLINE_MESSAGE } from '../lib/db'
import { SAVE_ERROR, showToast } from '../lib/feedback'
import { PART_COLUMNS, missingPartsColumn, partsColumnsReady } from '../lib/sharedParts'

// Whether the database has the part columns of supabase/029 (plan 9K):
// true, false, or null while it can't be told yet (offline, or the read
// failed). `rows`: expenses already loaded (Money), read with all their
// columns, so they tell; without them (SHOP "Confirm purchase", or Money
// with nothing loaded) the two columns are read once. While it is null
// the fields stay hidden, and it is read again as soon as the connection
// comes back, so the fields appear without reopening the screen (K18). A
// save with Shared lines while it is still null asks first
// (`checkExpenseParts`). Once seen, it stays known for this app start.
let seen = false
const listeners = new Set()
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// true: the columns answered; false: the database said they don't exist;
// null: no answer (offline, another error).
async function probe() {
  if (isOffline()) return null
  try {
    const { error } = await supabase.from('expenses').select(PART_COLUMNS.join(', ')).limit(1)
    if (!error) return true
    return missingPartsColumn(error) ? false : null
  } catch {
    return null
  }
}

// One small read to tell, e.g. when "Confirm purchase" is pressed while it
// isn't known yet. Every screen asking learns the answer.
export async function checkExpenseParts() {
  if (seen) return true
  const found = await probe()
  if (found && !seen) {
    seen = true
    listeners.forEach((l) => l())
  }
  return found
}

// A save that couldn't tell whether 029 has run saves nothing and says so
// with the usual messages (offline, or the usual save error).
export function refuseUnknownParts() {
  if (isOffline()) showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
  else showToast({ message: SAVE_ERROR, tone: 'error' })
}

export function useExpensePartsReady(rows) {
  const given = rows !== undefined
  const known = useSyncExternalStore(subscribe, () => seen, () => seen)
  const online = useOnline()
  const [probed, setProbed] = useState(null)
  useEffect(() => {
    if (given || known || probed === false || !online) return undefined
    let live = true
    checkExpenseParts().then((found) => {
      if (live) setProbed(found)
    })
    return () => {
      live = false
    }
  }, [given, known, probed, online])
  if (known || (given && partsColumnsReady(rows))) return true
  return given ? false : probed
}

// Used to test: forget what was seen.
export function forgetPartsForTest() {
  seen = false
}
