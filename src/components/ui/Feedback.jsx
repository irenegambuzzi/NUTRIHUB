import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../lib/cn'
import { closeDialog, dismissToast, runToastAction, useDialog, useToasts } from '../../lib/feedback'

// Toasts sit above the mobile tab bar; the dialog covers everything.
export function Feedback() {
  return (
    <>
      <Toasts />
      <ConfirmDialog />
    </>
  )
}

function Toasts() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-20 md:bottom-6 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto w-full max-w-sm flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 shadow-lg bg-[var(--color-surface-soft)]',
            t.tone === 'error' ? 'border-rose-400/50' : 'border-[var(--color-border)]'
          )}
        >
          {t.tone === 'error' && <AlertTriangle size={15} className="text-rose-400 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--color-text)]">{t.message}</p>
            {t.detail && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 break-words">{t.detail}</p>}
          </div>
          {t.action && (
            <button
              onClick={() => runToastAction(t.id)}
              className="text-xs font-bold text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] px-1 shrink-0"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function ConfirmDialog() {
  const dialog = useDialog()

  useEffect(() => {
    if (!dialog) return
    const onKey = (e) => e.key === 'Escape' && closeDialog(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  if (!dialog) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => closeDialog(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-5 space-y-4"
      >
        <div className="space-y-1.5">
          <p id="confirm-title" className="text-sm font-extrabold text-[var(--color-primary)]">
            {dialog.title}
          </p>
          <p className="text-xs text-[var(--color-text-soft)]">{dialog.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => closeDialog(false)}>
            Cancel
          </Button>
          <Button className="flex-1" autoFocus onClick={() => closeDialog(true)}>
            {dialog.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
