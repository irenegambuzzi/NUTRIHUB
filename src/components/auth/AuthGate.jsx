import { useAuth } from '../../lib/auth'
import { LoginScreen } from './LoginScreen'

// Nothing of the app — not even its offline copy — is shown or loaded
// before the login succeeds.
export function AuthGate({ children }) {
  const { status } = useAuth()
  if (status === 'checking') return <div className="min-h-screen bg-[var(--color-bg)]" />
  if (status === 'out') return <LoginScreen />
  return children
}
