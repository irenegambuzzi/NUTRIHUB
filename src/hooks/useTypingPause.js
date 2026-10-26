import { useEffect, useState } from 'react'

// How long typing has to pause before a name is looked at again (also the
// pause before useLastPrice asks for earlier purchases).
export const TYPING_PAUSE_MS = 400

// `value` once the typing has paused for that moment (the MONEY rows'
// similar-name check, plan 9G).
export function useTypingPause(value) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), TYPING_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return settled
}
