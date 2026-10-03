import { useSyncExternalStore } from 'react'
import { getQueue, isSyncing } from './offlineQueue'
import { getDialog, getToasts } from './feedback'

// "New version available": the state of the app's own update, and when
// it's safe to apply it without asking. Wired to the service worker in
// pwa.js.

let state = { available: false }
let apply = () => window.location.reload()
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export function setUpdateAvailable(applyUpdate) {
  apply = applyUpdate
  state = { available: true }
  emit()
}

export const getUpdateState = () => state
export const useUpdateState = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state
  )

// Loads the new version. Changes made offline stay queued on the phone and
// are sent by the new version.
export function applyUpdate() {
  return apply()
}

// Safe to reload without asking: nothing waiting to be sent, no dialog,
// no toast still offering Undo (or Retry), nothing being typed, and no
// screen with unsaved input (marked with data-unsaved, e.g. the
// confirm-purchase screen or an open form).
export function isSafeToReload({
  queue = getQueue(),
  syncing = isSyncing(),
  dialog = getDialog(),
  toasts = getToasts(),
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  if (queue.length || syncing || dialog || toasts.some((t) => t.action)) return false
  if (!doc) return true
  if (doc.querySelector('[data-unsaved]')) return false
  const active = doc.activeElement
  return !(active && (/^(input|textarea|select)$/i.test(active.tagName) || active.isContentEditable))
}

// Whether to update without the banner: only when it's safe and nobody is
// looking at the screen (in the background) or the app was only just
// opened.
export function shouldAutoUpdate({ hidden, justOpened, safe }) {
  return safe && (hidden || justOpened)
}
