import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'
import { Input, Label, Select } from './Field'
import { cn } from '../../lib/cn'
import { closeDialog, dialogErrors, dismissToast, initialDialogValues, runToastAction, useDialog, useToasts } from '../../lib/feedback'

// Toasts sit above the mobile tab bar; the dialog covers everything.
export function Feedback() {
  return (
    <>
      <Toasts />
      <Dialog />
    </>
  )
}

function Toasts() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] md:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
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

function Dialog() {
  const dialog = useDialog()

  useEffect(() => {
    if (!dialog) return
    const onKey = (e) => e.key === 'Escape' && closeDialog(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  if (!dialog) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => closeDialog(null)}>
      {/* Keyed by dialog, so each one starts with its own default values. */}
      <DialogForm key={dialog.id} dialog={dialog} />
    </div>
  )
}

function DialogForm({ dialog }) {
  const [values, setValues] = useState(() => initialDialogValues(dialog.fields))
  const [showErrors, setShowErrors] = useState(false)
  const errors = dialogErrors(dialog.fields, values)
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }))

  const submit = (e) => {
    e.preventDefault()
    if (Object.keys(errors).length) return setShowErrors(true)
    closeDialog(values)
  }

  return (
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
    >
      <div className="space-y-1.5">
        <p id="dialog-title" className="text-sm font-extrabold text-[var(--color-primary)]">
          {dialog.title}
        </p>
        {dialog.message && <p className="text-xs text-[var(--color-text-soft)]">{dialog.message}</p>}
      </div>

      {dialog.fields.map((f, i) => (
        <div key={f.name} className="space-y-1.5">
          {f.label && <Label htmlFor={`dialog-${f.name}`}>{f.label}</Label>}
          {f.type === 'choice' ? (
            <div className="space-y-1.5" role="radiogroup">
              {f.options.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    'flex items-start gap-2.5 rounded-2xl border px-3 py-2 cursor-pointer',
                    values[f.name] === o.value ? 'border-[var(--color-primary)] bg-[var(--color-surface-soft)]' : 'border-[var(--color-border)]'
                  )}
                >
                  <input
                    type="radio"
                    name={`dialog-${f.name}`}
                    checked={values[f.name] === o.value}
                    onChange={() => set(f.name, o.value)}
                    className="mt-0.5 accent-[var(--color-primary)]"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-[var(--color-text)]">{o.label}</span>
                    {o.hint && <span className="block text-[10px] text-[var(--color-text-muted)]">{o.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          ) : f.type === 'select' ? (
            <Select id={`dialog-${f.name}`} autoFocus={i === 0} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
              <option value="" disabled={f.required}>
                {f.placeholder ?? 'Choose…'}
              </option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id={`dialog-${f.name}`}
                type={f.type === 'number' ? 'text' : 'date'}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={values[f.name]}
                onChange={(e) => set(f.name, e.target.value)}
                className="flex-1"
              />
              {f.unit && <span className="text-xs text-[var(--color-text-muted)] shrink-0">{f.unit}</span>}
            </div>
          )}
          {f.help && <p className="text-[10px] text-[var(--color-text-muted)]">{f.help}</p>}
          {showErrors && errors[f.name] && <p className="text-[11px] text-rose-400">{errors[f.name]}</p>}
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => closeDialog(null)}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" autoFocus={dialog.fields.length === 0}>
          {dialog.confirmLabel}
        </Button>
      </div>
    </form>
  )
}
