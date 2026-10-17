import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSessionError, isTokenExpiredText, setSessionRecovery, withSessionRecovery } from './authFetch'

const expired = () => new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), { status: 401 })
const ok = () => new Response('[]', { status: 200 })
const REST = 'https://x.supabase.co/rest/v1/expenses?select=*'
const withHeaders = (token) => ({ headers: new Headers({ apikey: 'anon', Authorization: `Bearer ${token}` }) })

let refresh
let rejected
beforeEach(() => {
  refresh = vi.fn(async () => 'new-token')
  rejected = vi.fn()
  setSessionRecovery({ refresh, rejected, serverTime: () => {} })
})

describe('recognising an expired login', () => {
  it('knows the messages Supabase gives for it', () => {
    expect(isTokenExpiredText('{"message":"JWT expired"}')).toBe(true)
    expect(isTokenExpiredText('"exp" claim timestamp check failed')).toBe(true)
    expect(isTokenExpiredText('Invalid JWT')).toBe(true)
    expect(isTokenExpiredText('duplicate key value')).toBe(false)
    expect(isSessionError({ message: 'JWT expired', code: 'PGRST303' })).toBe(true)
    expect(isSessionError({ message: 'x', code: 'PGRST301' })).toBe(true)
    expect(isSessionError({ message: 'Failed to fetch' })).toBe(false)
    expect(isSessionError(null)).toBe(false)
  })
})

describe('a request refused for an expired token', () => {
  it('refreshes the session and is sent once more with the new token', async () => {
    const base = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok())
    const response = await withSessionRecovery(base)(REST, withHeaders('old-token'))
    expect(response.status).toBe(200)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(base).toHaveBeenCalledTimes(2)
    expect(base.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer old-token')
    expect(base.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer new-token')
    expect(base.mock.calls[1][1].headers.get('apikey')).toBe('anon')
    expect(rejected).not.toHaveBeenCalled()
  })

  it('is tried only once: a second refusal is reported, not retried again', async () => {
    const base = vi.fn().mockImplementation(async () => expired())
    const response = await withSessionRecovery(base)(REST, withHeaders('old-token'))
    expect(response.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(2)
    expect(rejected).toHaveBeenCalledTimes(1)
  })

  it('comes back as it was when the session cannot be refreshed', async () => {
    refresh.mockResolvedValue(null)
    const base = vi.fn().mockImplementation(async () => expired())
    const response = await withSessionRecovery(base)(REST, withHeaders('old-token'))
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('JWT expired')
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('leaves other errors and login requests alone', async () => {
    const other = vi.fn().mockResolvedValue(new Response('{"message":"duplicate key"}', { status: 409 }))
    await withSessionRecovery(other)(REST, withHeaders('t'))
    const forbidden = vi.fn().mockResolvedValue(new Response('{"message":"permission denied"}', { status: 403 }))
    await withSessionRecovery(forbidden)(REST, withHeaders('t'))
    const login = vi.fn().mockImplementation(async () => expired())
    await withSessionRecovery(login)('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', {})
    expect(refresh).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledTimes(1)
    expect(forbidden).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledTimes(1)
  })

  it('does not touch a request that went through', async () => {
    const base = vi.fn().mockResolvedValue(ok())
    expect((await withSessionRecovery(base)(REST, withHeaders('t'))).status).toBe(200)
    expect(refresh).not.toHaveBeenCalled()
  })
})
