import { useEffect, useMemo, useState } from 'react'
import { fetchTripLines, lastPriceFor } from '../lib/lastPrice'
import { normName } from '../lib/grocery'
import { orderStore, pantryStore } from '../lib/stores'
import { TYPING_PAUSE_MS } from './useTypingPause'

// The last normal price and purchase unit for a typed name (see
// lib/lastPrice.js), or null. HOME items and orders come from the phone's
// copy at once; earlier purchase lines are asked from the database a moment
// after the typing stops.
export function useLastPrice(name) {
  const key = normName(name)
  const { rows: pantryItems } = pantryStore.useRows()
  const { rows: orders } = orderStore.useRows()
  const [trip, setTrip] = useState({ key: '', lines: [] })

  useEffect(() => {
    if (!key) return undefined
    let stale = false
    const timer = setTimeout(async () => {
      const lines = await fetchTripLines(name)
      if (!stale) setTrip({ key, lines })
    }, TYPING_PAUSE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [key, name])

  return useMemo(
    () => (key ? lastPriceFor(name, { tripLines: trip.key === key ? trip.lines : [], orders, pantryItems }) : null),
    [key, name, trip, orders, pantryItems]
  )
}
