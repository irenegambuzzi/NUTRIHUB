import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)
const auth = await import('./auth')

// A stand-in for localStorage.
function fakeStorage(entries) {
  const data = new Map(Object.entries(entries))
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    keys: () => [...data.keys()],
  }
  return new Proxy(store, { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) })
}

describe('login messages', () => {
  it('are friendly for a wrong password, too many attempts and no connection', () => {
    expect(auth.authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong password.')
    expect(auth.authErrorMessage({ status: 429, message: 'Request rate limit reached' })).toBe('Too many attempts — wait a few minutes and try again.')
    expect(auth.authErrorMessage(new TypeError('Failed to fetch'))).toBe('No connection — connect to the internet to log in.')
    expect(auth.authErrorMessage({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' })).toBe('No connection — connect to the internet to log in.')
  })
})

describe('changing the password', () => {
  it('checks the new password first: long enough, repeated, different', () => {
    expect(auth.newPasswordProblem('', 'abcdefghijklm', 'abcdefghijklm')).toBe('Enter the current password.')
    expect(auth.newPasswordProblem('old-password!', 'short', 'short')).toBe('The new password needs at least 12 characters.')
    expect(auth.newPasswordProblem('old-password!', 'abcdefghijklm', 'abcdefghijklX')).toBe("The new passwords don't match.")
    expect(auth.newPasswordProblem('abcdefghijklm', 'abcdefghijklm', 'abcdefghijklm')).toBe('The new password must be different from the current one.')
    expect(auth.newPasswordProblem('old-password!', 'abcdefghijklm', 'abcdefghijklm')).toBeNull()
  })

  it('verifies the current password before setting the new one', async () => {
    const calls = []
    client.supabase = {
      auth: {
        signInWithPassword: async (creds) => (calls.push(['check', creds]), { error: creds.password === 'right-password' ? null : { code: 'invalid_credentials' } }),
        updateUser: async (attrs) => (calls.push(['update', attrs]), { error: null }),
      },
    }
    expect(await auth.changePassword('wrong-password', 'a-new-password', 'a-new-password')).toBe('The current password is wrong.')
    expect(calls).toEqual([['check', { email: 'aihome.nutrihub@example.com', password: 'wrong-password' }]])
    expect(await auth.changePassword('right-password', 'a-new-password', 'a-new-password')).toBeNull()
    expect(calls.at(-1)).toEqual(['update', { password: 'a-new-password' }])
  })
})

describe('logging in', () => {
  it('uses the household email with the typed password', async () => {
    const sent = []
    client.supabase = { auth: { signInWithPassword: async (creds) => (sent.push(creds), { error: null }) } }
    expect(await auth.unlock('secret-secret')).toBeNull()
    expect(sent).toEqual([{ email: 'aihome.nutrihub@example.com', password: 'secret-secret' }])
    expect(await auth.unlock('')).toBe('Enter the password.')
  })
})

describe('logging out', () => {
  let saved
  beforeEach(() => {
    saved = globalThis.localStorage
  })
  afterEach(() => {
    globalThis.localStorage = saved
  })

  it("deletes the app's data on the device, and nothing else", () => {
    globalThis.localStorage = fakeStorage({
      'nutrihub-cache:pantry_items': '[]',
      'nutrihub-offline-queue': '[]',
      'nutrihub-unlocked': '1',
      'sb-xyz-auth-token': '{}',
      'other-site': 'keep',
    })
    auth.clearLocalData()
    expect(Reflect.ownKeys(globalThis.localStorage)).toEqual(['other-site'])
  })
})
