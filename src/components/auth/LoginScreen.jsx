import { useState } from 'react'
import { Lock } from 'lucide-react'
import { HOUSEHOLD_EMAIL, unlock } from '../../lib/auth'

// Only a password and "Unlock". The household email is in a username field
// that's hidden from view but present, so the phone's or browser's password
// manager (iCloud Keychain, Google Password Manager) can save the login and
// fill it in with Face ID / a fingerprint next time.
export function LoginScreen() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const problem = await unlock(password)
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center p-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <form onSubmit={submit} action="#" method="post" className="w-full max-w-xs space-y-4 text-center">
        <div className="mx-auto w-14 h-14 rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
          <Lock size={24} className="text-[var(--color-primary)]" />
        </div>
        <h1 className="text-lg font-extrabold text-[var(--color-primary)]">Home & Nutri Hub</h1>

        <input
          type="email"
          name="username"
          autoComplete="username"
          value={HOUSEHOLD_EMAIL}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="absolute w-px h-px -m-px overflow-hidden opacity-0 pointer-events-none"
          style={{ clip: 'rect(0 0 0 0)' }}
        />
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError('')
          }}
          className="w-full bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-2xl p-3 text-base text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
        />
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full py-3 rounded-2xl bg-[var(--color-primary)] text-white font-bold disabled:opacity-50">
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
