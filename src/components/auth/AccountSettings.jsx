import { useState } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input, Label } from '../ui/Field'
import { HOUSEHOLD_EMAIL, MIN_PASSWORD_LENGTH, changePassword, logOut } from '../../lib/auth'
import { confirmDialog, showToast } from '../../lib/feedback'
import { flush, getQueue } from '../../lib/offlineQueue'
import { isOffline } from '../../lib/connection'

// Account: change the shared password, and log this device out.
export function AccountSettings() {
  const [form, setForm] = useState({ current: '', next: '', repeat: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const problem = await changePassword(form.current, form.next, form.repeat)
    setBusy(false)
    if (problem) return setError(problem)
    setForm({ current: '', next: '', repeat: '' })
    showToast({ message: 'Password changed. Use the new one on the other phone too.' })
  }

  // Changes made offline that haven't reached Supabase would be lost:
  // try to send them first, and warn if some are still waiting.
  const handleLogOut = async () => {
    if (getQueue().length && !isOffline()) await flush()
    const waiting = getQueue().length
    if (waiting) {
      const anyway = await confirmDialog({
        title: 'Changes not sent yet',
        message: `${waiting} change${waiting === 1 ? '' : 's'} made offline ${waiting === 1 ? "hasn't" : "haven't"} reached the other phone yet. Logging out deletes ${waiting === 1 ? 'it' : 'them'} from this device. Wait until you're online and the "waiting" pill is gone, or log out anyway.`,
        confirmLabel: 'Log out anyway',
      })
      if (!anyway) return
    } else {
      const ok = await confirmDialog({
        title: 'Log out of this device?',
        message: 'The data kept on this device (offline copies, photos, remembered choices) is deleted. The other phone stays logged in.',
        confirmLabel: 'Log out',
      })
      if (!ok) return
    }
    await logOut()
  }

  return (
    <Card className="space-y-4">
      <h3 className="text-base font-bold text-[var(--color-primary)]">Account</h3>

      <form onSubmit={submit} className="space-y-2" data-unsaved={form.current || form.next || form.repeat ? '' : undefined}>
        <p className="text-xs font-bold text-[var(--color-text-soft)] flex items-center gap-1.5">
          <KeyRound size={13} /> Change password
        </p>
        {/* For the password manager: which account this password is for. */}
        <input type="email" name="username" autoComplete="username" value={HOUSEHOLD_EMAIL} readOnly hidden />
        <div>
          <Label htmlFor="current-password">Current password</Label>
          <Input id="current-password" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} />
        </div>
        <div>
          <Label htmlFor="new-password">New password (at least {MIN_PASSWORD_LENGTH} characters)</Label>
          <Input id="new-password" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} minLength={MIN_PASSWORD_LENGTH} />
        </div>
        <div>
          <Label htmlFor="repeat-password">Repeat the new password</Label>
          <Input id="repeat-password" type="password" autoComplete="new-password" value={form.repeat} onChange={set('repeat')} />
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full py-2.5 rounded-2xl bg-[var(--color-primary)] text-white text-sm font-bold disabled:opacity-50">
          {busy ? 'Checking…' : 'Change password'}
        </button>
      </form>

      <div className="border-t border-[var(--color-border)] pt-3 space-y-1.5">
        <button onClick={handleLogOut} className="flex items-center gap-1.5 text-sm font-bold text-rose-400">
          <LogOut size={15} /> Log out
        </button>
        <p className="text-[11px] text-[var(--color-text-muted)]">Logs out this device only and deletes the app's data kept on it.</p>
      </div>
    </Card>
  )
}
