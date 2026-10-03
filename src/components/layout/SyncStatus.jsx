import { CloudOff, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useOnline } from '../../lib/connection'
import { useQueueState } from '../../lib/offlineQueue'

// A small pill while there's no signal or offline changes are waiting:
// "Offline · 3 waiting", then "Syncing 3…" once back online.
export function SyncStatus({ className }) {
  const online = useOnline()
  const { pending, syncing } = useQueueState()
  if (online && !pending && !syncing) return null

  const label = !online
    ? `Offline${pending ? ` · ${pending} waiting to sync` : ''}`
    : `Syncing${pending ? ` ${pending}` : ''}…`

  return (
    <div
      role="status"
      title={
        online
          ? 'Sending the changes made offline.'
          : 'No connection. Checking off, quantities and stock − / + are saved on this phone and sync when you\'re back online; other changes need a connection.'
      }
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border shadow-sm',
        online ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] text-[var(--color-text-soft)]' : 'bg-amber-500/15 border-amber-400/40 text-amber-300',
        className
      )}
    >
      {online ? <RefreshCw size={12} className="animate-spin" /> : <CloudOff size={12} />}
      {label}
    </div>
  )
}
