import { useSyncExternalStore } from 'react'

// How the Trend charts are drawn ('bars' or 'line'), remembered on this
// device and shared by the income and expense charts.
const KEY = 'money.trendStyle'
const listeners = new Set()

function read() {
  try {
    return localStorage.getItem(KEY) === 'line' ? 'line' : 'bars'
  } catch {
    return 'bars'
  }
}

let current = read()

export function setTrendStyle(style) {
  current = style === 'line' ? 'line' : 'bars'
  try {
    localStorage.setItem(KEY, current)
  } catch {
    // Not remembered (private window, blocked storage): still applies now.
  }
  listeners.forEach((l) => l())
}

export const useTrendStyle = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => 'bars'
  )
