import { useSyncExternalStore } from 'react'
import { isNetworkError, isOffline, onConnectionChange } from './connection'
import { toastSaveError } from './feedback'

// Changes made without signal, kept on the phone and sent in order once
// it's back online. Only changes that are safe to send later are queued
// (see offlineActions.js); everything else needs a connection.

const KEY = 'nutrihub-offline-queue'
const handlers = new Map()
const listeners = new Set()
let queue = load()
let syncing = false
let afterSync = () => {}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue))
  } catch {
    // Storage full or blocked: the queue still works until the app closes.
  }
}

const emit = () => listeners.forEach((l) => l())
let snapshot = { pending: queue.length, syncing }
function update() {
  snapshot = { pending: queue.length, syncing }
  save()
  emit()
}

// type → async (payload) => void. Throws to report a failure; a network
// failure keeps the change for the next try.
export function registerHandler(type, handler) {
  handlers.set(type, handler)
}

// What to do once the queue is sent (reload the shared lists).
export function setAfterSync(fn) {
  afterSync = fn
}

// Adds a change. `key` replaces an earlier queued change with the same
// type and key (e.g. only the last quantity of an item matters).
export function enqueue(type, payload, { key = null, label = type } = {}) {
  if (key != null) queue = queue.filter((op) => !(op.type === type && op.key === key))
  queue = [...queue, { id: crypto.randomUUID(), type, key, label, payload, at: Date.now() }]
  update()
}

export const getQueue = () => queue

// Sends the queued changes in order. Stops at a network failure (tried
// again when back online); a change Supabase refuses is dropped with a
// toast saying which one.
export async function flush() {
  if (syncing || isOffline()) return
  if (queue.length === 0) return afterSync()
  syncing = true
  update()
  while (queue.length && !isOffline()) {
    const op = queue[0]
    try {
      const handler = handlers.get(op.type)
      if (!handler) throw new Error(`Unknown offline change "${op.type}".`)
      await handler(op.payload)
    } catch (error) {
      if (isNetworkError(error)) break
      toastSaveError(error, null, `A change made offline couldn't be saved: ${op.label}.`)
    }
    queue = queue.filter((o) => o.id !== op.id)
    update()
  }
  syncing = false
  update()
  await afterSync()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useQueueState = () => useSyncExternalStore(subscribe, () => snapshot)

// Back online: send what's waiting.
onConnectionChange(() => {
  if (!isOffline()) flush()
})

// Used by tests to start from a clean queue.
export function resetQueueForTest({ keepHandlers = false } = {}) {
  queue = []
  syncing = false
  if (!keepHandlers) {
    handlers.clear()
    afterSync = () => {}
  }
  update()
}
