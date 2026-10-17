import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// The real Supabase client, a stand-in server: a token that looks valid to
// the device (its expiry is in the future) but that the server has expired,
// as with a wrong clock or a tab that slept.
const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (name) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u', role: 'authenticated', name, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`
const OLD = jwt('old')
const NEW = jwt('new')

const server = { rest: [], refresh: 0, refreshOk: true }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
async function fakeFetch(input, init) {
  const url = String(input?.url ?? input)
  const headers = new Headers(init?.headers)
  if (url.includes('/auth/v1/token')) {
    server.refresh += 1
    if (!server.refreshOk) return json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found' }, 400)
    return json({ access_token: NEW, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r2', user: { id: 'u', aud: 'authenticated' } })
  }
  if (url.includes('/auth/v1/user')) return json({ id: 'u', aud: 'authenticated' })
  server.rest.push(headers.get('Authorization'))
  if (headers.get('Authorization') === `Bearer ${OLD}`) return json({ code: 'PGRST303', details: null, hint: null, message: 'JWT expired' }, 401)
  return json([{ id: 1 }])
}

const client = vi.hoisted(() => ({ supabase: null }))
vi.mock('./supabaseClient', () => client)

let feedback
let session
let auth
beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.assign(server, { rest: [], refresh: 0, refreshOk: true })
  const { withSessionRecovery } = await import('./authFetch')
  client.supabase = createClient('https://x.supabase.co', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withSessionRecovery(fakeFetch) },
  })
  feedback = await import('./feedback')
  auth = await import('./auth')
  session = await import('./session')
  session.startSession()
  const { error } = await client.supabase.auth.setSession({ access_token: OLD, refresh_token: 'r1' })
  expect(error).toBeNull()
  server.refresh = 0
  server.rest = []
})
afterEach(() => {
  feedback.getToasts().forEach((t) => feedback.dismissToast(t.id))
  vi.restoreAllMocks()
})

describe('an expired token the device thinks is fine', () => {
  it('recovers by itself: the session is renewed and the request sent again', async () => {
    const { data, error } = await client.supabase.from('expenses').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 1 }])
    expect(server.refresh).toBe(1)
    expect(server.rest).toEqual([`Bearer ${OLD}`, `Bearer ${NEW}`])
    expect(feedback.getToasts()).toHaveLength(0)
  })

  it('renews once when a dozen lists load at the same time, and all of them load', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => client.supabase.from('expenses').select('*')))
    expect(results.every((r) => !r.error && r.data.length === 1)).toBe(true)
    expect(server.refresh).toBe(1)
    expect(feedback.getToasts()).toHaveLength(0)
  })

  it('uses the new token for the requests after it', async () => {
    await client.supabase.from('expenses').select('*')
    server.rest = []
    await client.supabase.from('income').select('*')
    expect(server.rest).toEqual([`Bearer ${NEW}`])
    expect(server.refresh).toBe(1)
  })
})

describe('a session that cannot be renewed', () => {
  it('shows one message instead of a dozen "JWT expired" connection errors', async () => {
    server.refreshOk = false
    const results = await Promise.all(Array.from({ length: 12 }, () => client.supabase.from('expenses').select('*')))
    for (const [i, { error }] of results.entries()) {
      expect(error.message).toBe('JWT expired')
      feedback.toastLoadError(error, vi.fn(), `source-${i}`)
    }
    expect(server.refresh).toBe(1)
    const toasts = feedback.getToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ message: 'Your session has ended. Log in again.', action: { label: 'Log in' } })
    feedback.runToastAction(toasts[0].id)
    expect(auth.getAuth().status).toBe('out')
  })
})
