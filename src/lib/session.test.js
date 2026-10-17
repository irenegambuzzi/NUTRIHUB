import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)

// A token as the server issues it: only the issue time matters here.
const tokenIssuedAt = (ms) => `x.${btoa(JSON.stringify({ iat: Math.floor(ms / 1000) }))}.y`

let session
let feedback
let auth
beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  feedback = await import('./feedback')
  auth = await import('./auth')
  session = await import('./session')
  session.startSession()
})
afterEach(() => {
  feedback.getToasts().forEach((t) => feedback.dismissToast(t.id))
  vi.restoreAllMocks()
})

const expiredError = { message: 'JWT expired', code: 'PGRST303' }
const sessionToasts = () => feedback.getToasts().filter((t) => t.key === 'session')

describe('a session that can be renewed', () => {
  it('is renewed once however many requests ask at the same moment', async () => {
    const refreshSession = vi.fn(async () => ({ data: { session: { access_token: tokenIssuedAt(Date.now()) } }, error: null }))
    client.supabase = { auth: { refreshSession } }
    const results = await Promise.all(Array.from({ length: 12 }, () => session.renewSession()))
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.token)).toBe(true)
    expect(feedback.getToasts()).toHaveLength(0)
  })

  it('shows no message when an expired-token error reaches a list after a renewal', async () => {
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: { access_token: tokenIssuedAt(Date.now()) } }, error: null }) } }
    await session.renewSession()
    feedback.toastLoadError(expiredError, vi.fn(), 'expenses')
    // The session reports it (once); it never becomes a connection error.
    expect(feedback.getToasts().every((t) => t.message !== feedback.LOAD_ERROR)).toBe(true)
  })
})

describe('a session that cannot be renewed', () => {
  beforeEach(() => {
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: null }, error: { status: 400, name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found' } }) } }
  })

  it('shows one clear message with a Log in button, however many lists fail', async () => {
    await session.renewSession()
    for (const source of ['expenses', 'income', 'orders', 'grocery_items', 'pantry_items', 'shops', 'trips', 'photos', 'budget', 'meal_plan', 'recipes', 'profiles']) {
      feedback.toastLoadError(expiredError, vi.fn(), source)
    }
    feedback.toastSaveError(expiredError, vi.fn())
    const toasts = feedback.getToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ message: 'Your session has ended. Log in again.', tone: 'error', action: { label: 'Log in' }, detail: null })
  })

  it('opens the login with the message, without logging out', async () => {
    await session.renewSession()
    feedback.runToastAction(sessionToasts()[0].id)
    expect(auth.getAuth()).toMatchObject({ status: 'out', notice: 'Your session has ended. Log in again.' })
    expect(feedback.getToasts()).toHaveLength(0)
  })

  it('says so when the device clock looks wrong', async () => {
    // First a good renewal: the token was issued an hour before the device thinks it is.
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: { access_token: tokenIssuedAt(Date.now() - 3600_000) } }, error: null }) } }
    await session.renewSession()
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: null }, error: { status: 400, message: 'Invalid Refresh Token' } }) } }
    await session.renewSession()
    expect(sessionToasts()).toHaveLength(1)
    expect(sessionToasts()[0].detail).toBe("Your device's clock seems to be wrong. Check the date and time settings.")
  })

  it('does not blame the clock when it is right', async () => {
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: { access_token: tokenIssuedAt(Date.now() - 20_000) } }, error: null }) } }
    await session.renewSession()
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: null }, error: { status: 400, message: 'Invalid Refresh Token' } }) } }
    await session.renewSession()
    expect(sessionToasts()[0].detail).toBeNull()
  })
})

describe('no signal', () => {
  it('is a connection problem, not an ended session', async () => {
    client.supabase = { auth: { refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }) }) } }
    await session.renewSession()
    expect(sessionToasts()).toHaveLength(0)
    feedback.toastLoadError(expiredError, vi.fn(), 'expenses')
    expect(feedback.getToasts()[0].message).toBe(feedback.LOAD_ERROR)
  })
})

describe('the device clock', () => {
  it('is off by more than five minutes either way, not by a little', () => {
    expect(session.clockIsOff(6 * 60_000)).toBe(true)
    expect(session.clockIsOff(-6 * 60_000)).toBe(true)
    expect(session.clockIsOff(30_000)).toBe(false)
  })
})
