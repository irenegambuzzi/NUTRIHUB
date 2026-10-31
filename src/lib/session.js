import { supabase } from './supabaseClient'
import { getAuth, isSignedIn, SESSION_ENDED, showLogin } from './auth'
import { setSessionRecovery, isSessionError } from './authFetch'
import { isNetworkError } from './connection'
import { dismissToastsByKey, getToasts, setSessionErrorHandler, showToast } from './feedback'

// Keeps the login session alive and says so, once, when it can't be.
//
// supabase-js renews the token by the device's clock. When the clock is
// wrong, or the tab slept, it can think a token is still good while the
// server has already expired it — every request then fails with "JWT
// expired". So the session is renewed by force when the page comes back,
// after sleep, and when a request is refused for an expired token (that
// request is then sent once more, see authFetch.js). Only a session that
// truly can't be renewed shows a message, with a button to log in.

export const CLOCK_MESSAGE = "Your device's clock seems to be wrong. Check the date and time settings."
const CLOCK_LIMIT = 5 * 60 * 1000 // more off than this is "wrong"
const RECHECK_AFTER = 5 * 60 * 1000 // a woken page renews if it hasn't for this long
const HIDDEN_FOR = 30 * 1000
const SLEEP_GAP = 30 * 1000

// When the server issued an access token (ms), or null.
export function tokenIssuedAt(token) {
  try {
    const payload = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return Number.isFinite(payload.iat) ? payload.iat * 1000 : null
  } catch {
    return null
  }
}

// Whether the device's clock is clearly off, from when the server issued a
// token (a fresh one was issued "now") and from the server's own time.
export const clockIsOff = (skewMs) => Math.abs(skewMs) > CLOCK_LIMIT

let clockOff = false
let transient = false // the last renewal failed for lack of signal
let lastRenewed = Date.now()
let onRenewed = () => {}

const noteClock = (serverMs) => {
  if (Number.isFinite(serverMs)) clockOff = clockIsOff(Date.now() - serverMs)
}

// Called after a renewal outside a failed request (waking up, coming
// back to the page), e.g. to reload what was missed meanwhile.
export const whenRenewed = (fn) => {
  onRenewed = fn
}

// A session the server won't renew (as opposed to no signal).
function isFinalFailure(error) {
  if (isNetworkError(error) || error.name === 'AuthRetryableFetchError') return false
  return !(error.status === 0 || error.status >= 500)
}

let renewing = null

// Renews the session now (one renewal at a time, however many requests ask).
// Resolves to { token }, or { token: null } when it can't be renewed (and,
// unless there is simply no signal, the session-ended message is shown).
export function renewSession() {
  renewing ??= (async () => {
    // A token issued in the future: the device's clock is behind.
    const before = tokenIssuedAt(getAuth().session?.access_token)
    if (before && before - Date.now() > CLOCK_LIMIT) clockOff = true
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data?.session) {
        transient = error ? !isFinalFailure(error) : false
        if (!transient) endSession()
        return { token: null }
      }
      transient = false
      lastRenewed = Date.now()
      dismissToastsByKey('session')
      const issued = tokenIssuedAt(data.session.access_token)
      if (issued) noteClock(issued)
      return { token: data.session.access_token }
    } catch {
      transient = true
      return { token: null }
    } finally {
      renewing = null
    }
  })()
  return renewing
}

// The one message for a session that has ended. It stays until it is
// closed (× or "Log in") or the session comes back (`untilClosed`, see
// feedback.js); shown again only after it was closed and something else
// fails.
export function endSession() {
  if (getAuth().status === 'out' || getToasts().some((t) => t.key === 'session')) return
  showToast({
    key: 'session',
    message: SESSION_ENDED,
    detail: clockOff ? CLOCK_MESSAGE : null,
    tone: 'error',
    untilClosed: true,
    action: { label: 'Log in', onClick: () => showLogin(clockOff ? `${SESSION_ENDED} ${CLOCK_MESSAGE}` : SESSION_ENDED) },
  })
}

// Errors on screen: an expired login is the session's to report. With no
// signal (renewal couldn't even be tried) it is a connection problem like
// any other.
function handleSessionError(error) {
  if (!isSessionError(error)) return false
  if (transient) return false
  endSession()
  return true
}

async function renewIfStale() {
  if (!isSignedIn() || Date.now() - lastRenewed < RECHECK_AFTER) return
  const { token } = await renewSession()
  if (token) onRenewed()
}

// Starts watching: the page coming back, the device waking up, the
// connection returning.
export function startSession() {
  setSessionErrorHandler(handleSessionError)
  setSessionRecovery({
    refresh: async () => (await renewSession()).token,
    rejected: () => endSession(),
    serverTime: noteClock,
  })
  if (typeof document === 'undefined') return
  let hiddenAt = null
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_FOR) {
      hiddenAt = null
      renewIfStale()
    }
  })
  window.addEventListener('online', renewIfStale)
  // A timer that was due much earlier means the device was asleep.
  let tick = Date.now()
  setInterval(() => {
    const now = Date.now()
    if (now - tick > SLEEP_GAP) renewIfStale()
    tick = now
  }, 5000)
}
