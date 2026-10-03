import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { isNetworkError } from './connection'

// Login with the household's one shared Supabase account. The email is
// fixed (not a real address); only the password is asked for.
//
// The session is kept on the device (supabase-js stores it and refreshes
// it on its own), so logging in once per device is enough. Every Supabase
// call — tables, realtime, Storage, RPC — goes out with that session.
export const HOUSEHOLD_EMAIL = 'aihome.nutrihub@example.com'
export const MIN_PASSWORD_LENGTH = 12

// Set after a login on this device, cleared on Log out: lets the app open
// with its offline copy when there's no connection to check the session.
const UNLOCKED_KEY = 'nutrihub-unlocked'
const PREFIX = 'nutrihub-'

let state = { status: 'checking', session: null } // checking | in | out
const listeners = new Set()
const set = (next) => {
  state = next
  listeners.forEach((l) => l())
}
let onSignIn = () => {}

const storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      // Not remembered; logging in again works.
    }
  },
}

export const getAuth = () => state
export const useAuth = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state
  )

// Whether requests go out logged in (offline changes wait until they do).
export const isSignedIn = () => state.status === 'in' && Boolean(state.session)

// What to do each time a session starts (e.g. send offline changes).
export function whenSignedIn(fn) {
  onSignIn = fn
}

export async function startAuth() {
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    set({ status: 'in', session: data.session })
    onSignIn()
  } else if (storage.get(UNLOCKED_KEY) && typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Logged in before, no connection to check: open with the offline copy.
    set({ status: 'in', session: null })
  } else {
    set({ status: 'out', session: null })
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      const wasIn = isSignedIn()
      set({ status: 'in', session })
      storage.set(UNLOCKED_KEY, '1')
      // Never call Supabase from inside this callback: it runs while the
      // session is locked, and requests made here would wait on that lock
      // (supabase-js docs). Start them just after it instead.
      if (!wasIn) setTimeout(onSignIn, 0)
    } else if (event === 'SIGNED_OUT') {
      set({ status: 'out', session: null })
    }
  })
}

// A friendly message for a failed login or password check.
export function authErrorMessage(error) {
  if (!error) return null
  const code = error.code || ''
  const message = (error.message || '').toLowerCase()
  if (isNetworkError(error) || error.name === 'AuthRetryableFetchError' || error.status === 0) return 'No connection — connect to the internet to log in.'
  if (error.status === 429 || code.includes('rate_limit') || message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts — wait a few minutes and try again.'
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'Wrong password.'
  if (code === 'weak_password' || message.includes('weak')) return 'That password is too weak — use a longer one.'
  if (code === 'same_password' || message.includes('different from the old')) return 'The new password must be different from the current one.'
  return error.message || 'Something went wrong — try again.'
}

// Logs in with the household account. Returns an error message or null.
export async function unlock(password) {
  if (!password) return 'Enter the password.'
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: HOUSEHOLD_EMAIL, password })
    return authErrorMessage(error)
  } catch (error) {
    return authErrorMessage(error)
  }
}

// What's wrong with a new password (null when it's fine).
export function newPasswordProblem(current, next, repeat) {
  if (!current) return 'Enter the current password.'
  if (next.length < MIN_PASSWORD_LENGTH) return `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`
  if (next !== repeat) return "The new passwords don't match."
  if (next === current) return 'The new password must be different from the current one.'
  return null
}

// Checks the current password, then sets the new one. Returns an error
// message or null.
export async function changePassword(current, next, repeat) {
  const problem = newPasswordProblem(current, next, repeat)
  if (problem) return problem
  try {
    const check = await supabase.auth.signInWithPassword({ email: HOUSEHOLD_EMAIL, password: current })
    if (check.error) return check.error.code === 'invalid_credentials' ? 'The current password is wrong.' : authErrorMessage(check.error)
    const { error } = await supabase.auth.updateUser({ password: next })
    return authErrorMessage(error)
  } catch (error) {
    return authErrorMessage(error)
  }
}

// Everything the app keeps on this device: offline copies of the lists,
// the offline queue, remembered choices.
export function clearLocalData() {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    if (!store) continue
    try {
      for (const key of Object.keys(store)) if (key.startsWith(PREFIX) || key.startsWith('sb-')) store.removeItem(key)
    } catch {
      // Nothing more to clear.
    }
  }
}

// Logs this device out (the other phone stays logged in), deletes the
// app's data kept on it, and reloads into the login screen.
export async function logOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Offline: the session is dropped locally all the same.
  }
  clearLocalData()
  window.location.reload()
}
