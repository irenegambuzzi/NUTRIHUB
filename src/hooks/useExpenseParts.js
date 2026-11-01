import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { partsColumnsReady } from '../lib/sharedParts'

// Whether the database has the part columns of supabase/029 (plan 9K), the
// way 9H finds its columns: an expense read with all its columns carries
// them. `rows`: expenses already loaded (Money); without them (SHOP
// "Confirm purchase") one expense is read once to see. Until it is known
// — offline, or no expense at all — the answer is no, so "Shared" works
// exactly as before 029. Once seen, it stays known for this app start.
let seen = false

async function probe() {
  try {
    const { data, error } = await supabase.from('expenses').select('*').limit(1)
    return !error && Array.isArray(data) && partsColumnsReady(data)
  } catch {
    return false
  }
}

export function useExpensePartsReady(rows) {
  const given = rows !== undefined
  const [probed, setProbed] = useState(seen)
  useEffect(() => {
    if (given || seen) return undefined
    let live = true
    probe().then((ok) => {
      if (ok) seen = true
      if (live) setProbed(ok)
    })
    return () => {
      live = false
    }
  }, [given])
  return given ? partsColumnsReady(rows) : probed || seen
}
