import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'
import { DateField } from './DateField'
import { Input, Label, Select } from './Field'
import { cn } from '../../lib/cn'
import { closeDialog, dialogErrors, dismissToast, getDialog, initialDialogValues, runToastAction, useDialog, useToasts } from '../../lib/feedback'

// Toasts sit above the mobile tab bar; the dialog covers everything.
//
// Layers, bottom to top: a page's own forms and editors (z-30 / z-40), the
// sheets put on document.body with createPortal (z-50, e.g. "Order group"),
// this dialog (z-[60]), toasts (z-[70]). The dialog is often asked from
// inside one of those sheets ("Take out of the group"), so it goes on
// document.body too, on a layer above all of them: it is always in front,
// whichever was opened first and wherever <Feedback /> is in the page.
export function Feedback() {
  return (
    <>
      <Toasts />
      <Dialog />
    </>
  )
}

// The toasts stack upwards; many at once (e.g. several saves that failed
// on a weak signal, each with its own Retry) never cover more than about
// half the screen: the column scrolls inside, the newest in view. Nothing
// is hidden or merged.
function Toasts() {
  const toasts = useToasts()
  const column = useRef(null)
  useEffect(() => {
    if (column.current) column.current.scrollTop = column.current.scrollHeight
  }, [toasts.length])
  if (toasts.length === 0) return null
  return (
    <div
      ref={column}
      data-toasts
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] md:bottom-6 z-[70] max-h-[45vh] overflow-y-auto overflow-x-hidden overscroll-contain flex flex-col items-center gap-2 px-4 pointer-events-none"
      aria-live="polite"
    >
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

// What Tab can reach in the question, in order: a group of radio buttons
// counts once (its checked one), as in the browser.
function tabStops(root) {
  const all = [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0)
  return all.filter((el) => {
    if (el.type !== 'radio') return true
    const group = all.filter((o) => o.type === 'radio' && o.name === el.name)
    return el === (group.find((o) => o.checked) ?? group[0])
  })
}

// Where the focus may go back to when a question closes: a button or a
// drop-down still on the page — never a text field, which would open the
// keyboard on a phone.
const canRefocus = (el) => Boolean(el?.isConnected) && !el.disabled && (el.tagName === 'BUTTON' || el.tagName === 'SELECT')

// The question (askDialog / confirmDialog), in front of everything. With a
// keyboard: Escape = Cancel, Tab and Shift+Tab stay inside it (from the
// last to the first and back), so nothing behind it — e.g. an editor's
// "Save changes" — can be reached. When it closes, the focus goes back to
// the button it came from (a drop-down only when it was answered with the
// keyboard: on a phone, focusing it after a tap could open its list).
function Dialog() {
  const dialog = useDialog()
  const box = useRef(null)
  const byKeyboard = useRef(false)

  useEffect(() => {
    if (!dialog) return
    byKeyboard.current = false
    const onKey = (e) => {
      byKeyboard.current = true
      if (e.key === 'Escape') return closeDialog(null)
      if (e.key !== 'Tab' || !box.current) return
      const stops = tabStops(box.current)
      if (!stops.length) return
      e.preventDefault()
      const at = stops.indexOf(document.activeElement)
      const next = at === -1 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length
      stops[next].focus()
    }
    const onPointer = () => (byKeyboard.current = false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    const opener = dialog.opener
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
      // Another question took its place: that one returns the focus.
      if (getDialog()) return
      if (canRefocus(opener) && (opener.tagName === 'BUTTON' || byKeyboard.current)) opener.focus({ preventScroll: true })
    }
  }, [dialog])

  if (!dialog) return null
  return createPortal(
    <div ref={box} className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => closeDialog(null)}>
      {/* Keyed by dialog, so each one starts with its own default values. */}
      <DialogForm key={dialog.id} dialog={dialog} />
    </div>,
    document.body
  )
}

function DialogForm({ dialog }) {
  const [values, setValues] = useState(() => initialDialogValues(dialog.fields))
  const [showErrors, setShowErrors] = useState(false)
  // Date fields whose typed text isn't a real date yet, and how often a
  // refused submit asked them to say so.
  const [badDates, setBadDates] = useState(() => new Set())
  const [dateChecks, setDateChecks] = useState(0)
  const reportDate = (name, ok) =>
    setBadDates((prev) => {
      if (prev.has(name) === !ok) return prev
      const next = new Set(prev)
      if (ok) next.delete(name)
      else next.add(name)
      return next
    })
  const errors = dialogErrors(dialog.fields, values)
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }))

  const submit = (e) => {
    e.preventDefault()
    if (badDates.size) return setDateChecks((n) => n + 1)
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
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
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
          ) : f.type === 'date' ? (
            <DateField
              id={`dialog-${f.name}`}
              label={f.label ?? 'Date'}
              required={f.required}
              autoFocus={i === 0}
              value={values[f.name]}
              onChange={(iso) => set(f.name, iso)}
              onValidity={(ok) => reportDate(f.name, ok)}
              checkSignal={dateChecks}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id={`dialog-${f.name}`}
                inputMode="decimal"
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
        {/* The confirm button has the focus, unless the first field is a
            drop-down, a date or a number, which takes it itself. */}
        <Button type="submit" className="flex-1" autoFocus={!dialog.fields.length || dialog.fields[0].type === 'choice'}>
          {dialog.confirmLabel}
        </Button>
      </div>
    </form>
  )
}
