import { useSyncExternalStore } from 'react'

// Whether the phone has a connection, as the browser reports it.

const listeners = new Set()
const hasWindow = typeof window !== 'undefined'
let online = hasWindow ? navigator.onLine !== false : true

if (hasWindow) {
  const update = () => {
    online = navigator.onLine !== false
    listeners.forEach((l) => l())
  }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
}

export const isOffline = () => !online

export function onConnectionChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useOnline = () => useSyncExternalStore(onConnectionChange, () => online, () => online)

// A request that never reached Supabase (no signal), as opposed to one it
// answered with an error.
export function isNetworkError(error) {
  if (!error) return false
  if (error instanceof TypeError) return true
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(error.message ?? '')
}

// Used to test the offline behaviour.
export function setOnlineForTest(value) {
  online = value
  listeners.forEach((l) => l())
}
