import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../../lib/supabaseClient', () => client)
const { AuthGate } = await import('./AuthGate')
const { LoginScreen } = await import('./LoginScreen')
const auth = await import('../../lib/auth')

describe('login screen', () => {
  it('has a form a password manager can save and fill', () => {
    const html = renderToStaticMarkup(<LoginScreen />)
    const inputs = html.match(/<input[^>]*>/g)
    const has = (input, ...parts) => parts.every((p) => input.toLowerCase().includes(p.toLowerCase()))
    // The username: hidden from view but present, with the household email.
    expect(inputs.some((i) => has(i, 'type="email"', 'name="username"', 'autocomplete="username"', 'value="aihome.nutrihub@example.com"'))).toBe(true)
    expect(inputs.some((i) => has(i, 'type="password"', 'name="password"', 'autocomplete="current-password"'))).toBe(true)
    expect(html.toLowerCase()).not.toContain('autocomplete="off"')
    expect(html).toContain('>Unlock</button>')
  })
})

describe('before login', () => {
  it('shows only the login screen, none of the app', async () => {
    client.supabase = { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} } }
    await auth.startAuth()
    const html = renderToStaticMarkup(
      <AuthGate>
        <p>Pantry items</p>
      </AuthGate>
    )
    expect(html).toContain('Unlock')
    expect(html).not.toContain('Pantry items')
  })

  it('opens the app once logged in', async () => {
    client.supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }), onAuthStateChange: () => {} } }
    await auth.startAuth()
    expect(auth.isSignedIn()).toBe(true)
    expect(renderToStaticMarkup(<AuthGate><p>Pantry items</p></AuthGate>)).toContain('Pantry items')
  })
})
