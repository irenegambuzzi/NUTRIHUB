import { useSyncExternalStore } from 'react'

// Toasts and the in-app confirmation dialog live in one small store, so
// hooks and helpers can report problems without a React context. The
// <Feedback /> component in the layout renders them.

let toasts = []
let dialog = null
let nextId = 1
const timers = new Map()
const listeners = new Set()

const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// tone: 'info' | 'error'. action: { label, onClick }. A toast with the
// same `key` replaces the previous one (e.g. repeated load failures).
// duration 0 keeps it until dismissed.
export function showToast({ message, detail = null, tone = 'info', action = null, duration = 5000, key = null }) {
  if (key) toasts.filter((t) => t.key === key).forEach((t) => dismissToast(t.id))
  const id = nextId++
  toasts = [...toasts, { id, key, message, detail, tone, action }]
  if (duration) timers.set(id, setTimeout(() => dismissToast(id), duration))
  emit()
  return id
}

export function dismissToast(id) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  const next = toasts.filter((t) => t.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

// Runs a toast's action once and closes the toast.
export function runToastAction(id) {
  const toast = toasts.find((t) => t.id === id)
  dismissToast(id)
  return toast?.action?.onClick()
}

export const getToasts = () => toasts
export const useToasts = () => useSyncExternalStore(subscribe, getToasts)

export const SAVE_ERROR = "Couldn't save — check your connection."
export const LOAD_ERROR = "Couldn't load — check your connection."

export function toastSaveError(error, retry = null, message = SAVE_ERROR) {
  console.error(error)
  return showToast({
    message,
    detail: error?.message ?? null,
    tone: 'error',
    duration: 8000,
    action: retry ? { label: 'Retry', onClick: retry } : null,
  })
}

// One toast per data source, however often a realtime update retries.
export function toastLoadError(error, retry, source) {
  console.error(error)
  return showToast({
    message: LOAD_ERROR,
    detail: error?.message ?? null,
    tone: 'error',
    duration: 8000,
    key: `load:${source}`,
    action: { label: 'Retry', onClick: retry },
  })
}

// In-app dialog that asks for values. fields: [{ name, type, label, ... }]
//   choice – options: [{ value, label, hint }], value: the default
//   date   – optional unless required: true
//   number – min (exclusive lower bound), unit shown after the input
// Resolves to { name: value } when confirmed, or null when cancelled.
export function askDialog({ title, message, fields = [], confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    dialog?.resolve(null)
    dialog = { id: nextId++, title, message, fields, confirmLabel, resolve }
    emit()
  })
}

// In-app confirmation; resolves to true (confirmed) or false.
export async function confirmDialog({ title, message, confirmLabel = 'Confirm' }) {
  return (await askDialog({ title, message, confirmLabel })) !== null
}

export function initialDialogValues(fields) {
  return Object.fromEntries(fields.map((f) => [f.name, f.value ?? '']))
}

// What's wrong with the entered values, by field name (empty when fine).
export function dialogErrors(fields, values) {
  const errors = {}
  for (const f of fields) {
    const raw = String(values[f.name] ?? '').trim()
    if (f.type === 'number' && (raw || f.required)) {
      const n = parseNumber(raw)
      if (!(n > (f.min ?? -Infinity))) errors[f.name] = f.min === 0 ? 'Enter a number above 0.' : 'Enter a valid number.'
    }
    if (f.type === 'date' && f.required && !raw) errors[f.name] = 'Pick a date.'
    if (f.type === 'choice' && !f.options.some((o) => o.value === values[f.name])) errors[f.name] = 'Pick one.'
  }
  return errors
}

// "1,5" or "1.5" → 1.5; anything else → NaN.
export function parseNumber(text) {
  const s = String(text ?? '').trim().replace(',', '.')
  return s && /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN
}

// The dialog's answer: values (numbers parsed, empty dates as null), or
// null to cancel.
export function closeDialog(values) {
  const current = dialog
  dialog = null
  emit()
  if (!current) return
  if (values === null || values === false) return current.resolve(null)
  const out = {}
  for (const f of current.fields) {
    const v = values?.[f.name]
    out[f.name] = f.type === 'number' ? (String(v ?? '').trim() ? parseNumber(v) : null) : f.type === 'date' ? v || null : v
  }
  current.resolve(out)
}

export const getDialog = () => dialog
export const useDialog = () => useSyncExternalStore(subscribe, getDialog)
