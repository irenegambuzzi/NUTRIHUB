import { useSyncExternalStore } from 'react'
import { parseDecimal } from './decimal'

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

// How long a toast stays, the same on every screen: one with a button
// (Undo, Retry, Log in…) 20 seconds, so there is time to read it and
// still press it; any other 15 seconds. × closes any toast at once.
export const TOAST_WITH_ACTION_MS = 20000
export const TOAST_MS = 15000

// tone: 'info' | 'error'. action: { label, onClick }. A toast with the
// same `key` replaces the previous one (e.g. repeated load failures).
// How long it stays follows from whether it has a button (above).
export function showToast({ message, detail = null, tone = 'info', action = null, key = null }) {
  if (key) toasts.filter((t) => t.key === key).forEach((t) => dismissToast(t.id))
  // The same message is never shown twice at once — except a toast with
  // Undo or Retry: each one undoes (or saves again) only its own change, so
  // two equal ones (e.g. two groups made one after the other, two saves
  // that failed on a weak signal) are both shown.
  const own = action?.label === 'Undo' || action?.label === 'Retry'
  const same = !own && toasts.find((t) => t.message === message && t.detail === detail && t.tone === tone)
  if (same) return same.id
  const id = nextId++
  toasts = [...toasts, { id, key, message, detail, tone, action }]
  timers.set(id, setTimeout(() => dismissToast(id), action ? TOAST_WITH_ACTION_MS : TOAST_MS))
  emit()
  return id
}

// Closes every toast shown with this key.
export function dismissToastsByKey(key) {
  toasts.filter((t) => t.key === key).forEach((t) => dismissToast(t.id))
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
export const useToasts = () => useSyncExternalStore(subscribe, getToasts, getToasts)

export const SAVE_ERROR = "Couldn't save — check your connection."
export const LOAD_ERROR = "Couldn't load — check your connection."

// An expired or refused login is reported once, by the session (see
// session.js), not as a connection problem on every list and save.
let sessionErrorHandler = () => false
export const setSessionErrorHandler = (fn) => {
  sessionErrorHandler = fn
}

export function toastSaveError(error, retry = null, message = SAVE_ERROR) {
  if (sessionErrorHandler(error)) return null
  console.error(error)
  return showToast({
    message,
    // Not repeated when the message already says it.
    detail: error?.message && error.message !== message ? error.message : null,
    tone: 'error',
    action: retry ? { label: 'Retry', onClick: retry } : null,
  })
}

// One toast per kind of failure, however many lists hit it or how often a
// realtime update retries. Its Retry reloads every list that failed.
const loadRetries = new Map()
export function toastLoadError(error, retry, source) {
  if (sessionErrorHandler(error)) return null
  console.error(error)
  loadRetries.set(source, retry)
  return showToast({
    message: LOAD_ERROR,
    detail: error?.message ?? null,
    tone: 'error',
    key: `load:${error?.message ?? ''}`,
    action: {
      label: 'Retry',
      onClick: () => {
        const all = [...loadRetries.values()]
        loadRetries.clear()
        all.forEach((again) => again())
      },
    },
  })
}

// In-app dialog that asks for values. fields: [{ name, type, label, ... }]
//   choice – options: [{ value, label, hint }], value: the default
//   select – a drop-down: options [{ value, label }], required: true to insist
//   date   – optional unless required: true
//   number – min (exclusive lower bound), unit shown after the input
// Resolves to { name: value } when confirmed, or null when cancelled.
// `opener`: what had the keyboard focus when it was asked (kept when one
// question replaces another), so the focus can go back there afterwards.
export function askDialog({ title, message, fields = [], confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const opener = dialog ? dialog.opener : typeof document === 'undefined' ? null : document.activeElement
    dialog?.resolve(null)
    dialog = { id: nextId++, title, message, fields, confirmLabel, resolve, opener }
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
    if (f.type === 'select' && f.required && !raw) errors[f.name] = 'Pick one.'
  }
  return errors
}

// "1,5" or "1.5" → 1.5; anything else → NaN.
export const parseNumber = (text) => parseDecimal(text, { negative: true })

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
export const useDialog = () => useSyncExternalStore(subscribe, getDialog, getDialog)
