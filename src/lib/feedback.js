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

// In-app confirmation; resolves to true (confirmed) or false.
export function confirmDialog({ title, message, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    dialog?.resolve(false)
    dialog = { title, message, confirmLabel, resolve }
    emit()
  })
}

export function closeDialog(confirmed) {
  const current = dialog
  dialog = null
  emit()
  current?.resolve(confirmed)
}

export const getDialog = () => dialog
export const useDialog = () => useSyncExternalStore(subscribe, getDialog)
