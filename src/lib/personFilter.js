import { useState } from 'react'
import { PAID_BY_OPTIONS } from '../data/constants'

export const PERSON_OPTIONS = [{ value: 'all', label: 'Everyone' }, ...PAID_BY_OPTIONS]

export const personLabel = (value) => PERSON_OPTIONS.find((o) => o.value === value)?.label

// A person selection ('all', 'irene', ...) remembered on this device
// under `key`. Anything unknown falls back to everyone.
export function usePersonFilter(key) {
  const [person, setPerson] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return PERSON_OPTIONS.some((o) => o.value === saved) ? saved : 'all'
    } catch {
      return 'all'
    }
  })
  const choose = (value) => {
    setPerson(value)
    try {
      localStorage.setItem(key, value)
    } catch {
      // Not remembered (private window, blocked storage): still applies now.
    }
  }
  return [person, choose]
}
