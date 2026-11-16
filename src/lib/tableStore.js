import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { toastLoadError } from './feedback'
import { isOffline } from './connection'

// One shared copy of a table (or a slice of it) for the whole app: loaded
// once, kept live through one realtime channel, and updated row by row.
// Every page that shows the table reads the same rows.

// Applies one realtime change ({ eventType, new, old }) to `rows`. The row
// is removed, then put back if it still belongs here (`accept`), keeping
// the order (`compare`) and the size limit.
export function applyChange(rows, { eventType, new: next, old }, { accept = () => true, normalize = (r) => r, compare, limit } = {}) {
  const id = next?.id ?? old?.id
  if (id == null) return rows
  let out = rows.filter((r) => r.id !== id)
  if (eventType !== 'DELETE' && next && accept(next)) out.push(normalize(next))
  if (compare) out.sort(compare)
  if (limit) out = out.slice(0, limit)
  return out
}

// Newest first by a timestamp/date column, then by created_at.
export const newestFirst =
  (field = 'created_at') =>
  (a, b) =>
    String(b[field] ?? '').localeCompare(String(a[field] ?? '')) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))

const PAGE_SIZE = 1000

// Postgres "undefined table", or PostgREST not knowing the table.
export const isMissingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205'

const DISCONNECTED = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']

// options:
//   name       – shown in load-error toasts; also the channel name
//   table      – the Supabase table
//   columns    – what to load (default all); realtime rows are cut to these
//   query      – (q) => q with the filters/order/limit of the slice
//   accept     – (row) => whether a realtime row belongs in the slice
//   normalize  – (row) => row as the app uses it
//   compare    – sort order kept after each change
//   limit      – keep at most this many rows
//   persist    – keep a copy on the phone under this key, shown at once
//                and when there's no signal
//   paginate   – load in pages of 1000 (the most one request returns);
//                `query` must then end with a unique order (e.g. id)
//   optional   – the table may not exist yet (a migration not run): that
//                is not an error, the store stays empty and `missing`
export function createTableStore({ name, table, columns = '*', query = (q) => q, ...options }) {
  const keep = columns === '*' ? null : columns.split(',').map((c) => c.trim())
  const pick = keep ? (row) => Object.fromEntries(keep.map((c) => [c, row[c]])) : (row) => row
  const normalize = options.normalize ?? ((r) => r)
  const opts = { ...options, normalize: (row) => normalize(pick(row)) }
  let state = { rows: [], loaded: false }
  let started = false
  // One buffer per reload in progress: every change that arrives while it
  // reads (from realtime, or saved by this device) goes into each of them,
  // so each reload puts them on top of its own read.
  const buffers = new Set()
  // Each reload is numbered when it starts; `applied` is the number of the
  // newest one whose read is on screen. A read from a reload that started
  // before it is older, so it is dropped (plan 9P, report A2.9 part 2).
  let reloadsStarted = 0
  let applied = 0
  let disconnected = false
  const listeners = new Set()

  const emit = () => listeners.forEach((l) => l())
  const setRows = (rows) => {
    state = { rows, loaded: true }
    writeCache(options.persist, rows)
    emit()
  }
  const applyAll = (rows, changes) => changes.reduce((acc, change) => applyChange(acc, change, opts), rows)

  // A change to the rows on screen: shown at once once the list has been
  // read (before that, only the reloads in progress keep it, for their
  // read), and kept by every reload still reading.
  function change(changes) {
    buffers.forEach((buffer) => buffer.push(...changes))
    if (state.loaded || !buffers.size) setRows(applyAll(state.rows, changes))
  }

  async function load() {
    if (!options.paginate) return query(supabase.from(table).select(columns))
    const all = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await query(supabase.from(table).select(columns)).range(from, from + PAGE_SIZE - 1)
      if (error) return { data: null, error }
      all.push(...data)
      if (data.length < PAGE_SIZE) return { data: all, error: null }
    }
  }

  async function refresh() {
    // No signal, or offline changes still to send: keep showing the copy
    // we have (it includes those changes); reloaded once they're sent.
    if (isOffline() || !canRefresh()) return
    const number = ++reloadsStarted
    const buffer = []
    buffers.add(buffer)
    let result
    try {
      result = await load()
    } catch (error) {
      result = { data: null, error }
    } finally {
      buffers.delete(buffer)
    }
    const { data, error } = result
    // A reload that started later is already on screen: this read is older.
    if (number < applied) return
    if (error && options.optional && isMissingTable(error)) {
      applied = number
      state = { rows: [], loaded: true, missing: true }
      return emit()
    }
    if (error) {
      // The changes that came in meanwhile are not thrown away: once the
      // list was read they are on screen already; before that, they go on
      // the rows shown (the copy kept here, if any), still "not read".
      if (!state.loaded && buffer.length) {
        state = { ...state, rows: applyAll(state.rows, buffer) }
        emit()
      }
      return toastLoadError(error, refresh, name)
    }
    applied = number
    let rows = data.map(opts.normalize)
    if (opts.compare) rows.sort(opts.compare)
    setRows(applyAll(rows, buffer))
  }

  const onChange = (one) => change([one])

  function start() {
    if (started) return
    started = true
    // The copy kept on the phone is read only now — once the list is used,
    // which is only after login.
    const cached = readCache(options.persist)
    if (cached && !state.loaded) state = cached
    supabase
      .channel(`${name}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
      .subscribe((status) => {
        if (DISCONNECTED.includes(status)) disconnected = true
        // Back after a drop: changes may have been missed, so reload once.
        if (status === 'SUBSCRIBED' && disconnected) {
          disconnected = false
          refresh()
        }
      })
    refresh()
  }

  function subscribe(listener) {
    listeners.add(listener)
    start()
    return () => listeners.delete(listener)
  }

  const getSnapshot = () => state

  const store = {
    refresh,
    getSnapshot,
    isStarted: () => started,
    subscribe,
    useRows: () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    // Rows just saved or read by this device: shown at once, without
    // waiting for realtime (which then changes nothing). Like a realtime
    // change, they also go into every reload still reading, so a read that
    // started before them can't put the older copy back.
    upsertLocal: (rows) => change(rows.map((row) => ({ eventType: 'UPDATE', new: row }))),
    removeLocal: (ids) => change(state.rows.filter((r) => ids.includes(r.id)).map((r) => ({ eventType: 'DELETE', old: { id: r.id } }))),
    patchLocal: (ids, fields) => change(state.rows.filter((r) => ids.includes(r.id)).map((r) => ({ eventType: 'UPDATE', new: { ...r, ...fields } }))),
  }
  registry.add(store)
  return store
}

const registry = new Set()
let canRefresh = () => true

// Lets the offline queue hold reloads back while it has changes to send.
export function setRefreshGate(fn) {
  canRefresh = fn
}

// Reloads every store in use, e.g. once offline changes have been sent.
export function refreshStartedStores() {
  return Promise.all([...registry].filter((s) => s.isStarted()).map((s) => s.refresh()))
}

const CACHE_PREFIX = 'nutrihub-cache:'
const cacheTimers = new Map()

function readCache(key) {
  if (!key) return null
  try {
    const rows = JSON.parse(localStorage.getItem(CACHE_PREFIX + key))
    return Array.isArray(rows) ? { rows, loaded: true } : null
  } catch {
    return null
  }
}

// Saved a moment later, so a burst of changes is written once.
function writeCache(key, rows) {
  if (!key || typeof localStorage === 'undefined') return
  clearTimeout(cacheTimers.get(key))
  cacheTimers.set(
    key,
    setTimeout(() => {
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(rows))
      } catch {
        // Storage full or blocked: the app still works, just not offline.
      }
    }, 300)
  )
}

// A stand-in store with no rows, for when there's nothing to load yet
// (same hooks as a real one, so components can switch between them).
const EMPTY_STATE = { rows: [], loaded: false }
const noSubscription = () => () => {}
export const emptyStore = { useRows: () => useSyncExternalStore(noSubscription, () => EMPTY_STATE, () => EMPTY_STATE) }

// Stores made on demand for a slice (e.g. one week's meal plan), shared
// by everything that asks for the same key.
export function storeFamily(make) {
  const stores = new Map()
  const get = (key) => {
    if (!stores.has(key)) stores.set(key, make(key))
    return stores.get(key)
  }
  // Every store made so far, e.g. to update all slices after a write.
  get.all = () => [...stores.values()]
  return get
}
