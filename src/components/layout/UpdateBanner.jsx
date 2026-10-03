import { RefreshCw } from 'lucide-react'
import { applyUpdate, useUpdateState } from '../../lib/appUpdate'

// "New version available" with Update, until the new version is loaded.
export function UpdateBanner() {
  const { available } = useUpdateState()
  if (!available) return null
  return (
    <div role="status" className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--color-primary)] bg-[var(--color-surface)] shadow-lg px-4 py-2.5">
        <RefreshCw size={15} className="text-[var(--color-primary)]" />
        <span className="text-xs font-bold text-[var(--color-text)]">New version available</span>
        <button onClick={applyUpdate} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-[var(--color-primary)] text-white">
          Update
        </button>
      </div>
    </div>
  )
}
