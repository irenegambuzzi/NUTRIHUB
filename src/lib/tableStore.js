import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { toastLoadError } from './feedback'

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
export function createTableStore({ name, table, columns = '*', query = (q) => q, ...options }) {
  const keep = columns === '*' ? null : columns.split(',').map((c) => c.trim())
  const pick = keep ? (row) => Object.fromEntries(keep.map((c) => [c, row[c]])) : (row) => row
  const normalize = options.normalize ?? ((r) => r)
  const opts = { ...options, normalize: (row) => normalize(pick(row)) }
  let state = { rows: [], loaded: false }
  let started = false
  let buffered = null // realtime changes that arrive while loading
  let disconnected = false
  const listeners = new Set()

  const emit = () => listeners.forEach((l) => l())
  const setRows = (rows) => {
    state = { rows, loaded: true }
    emit()
  }

  async function refresh() {
    buffered = buffered ?? []
    const { data, error } = await query(supabase.from(table).select(columns))
    const pending = buffered
    buffered = null
    if (error) return toastLoadError(error, refresh, name)
    let rows = data.map(opts.normalize)
    if (opts.compare) rows.sort(opts.compare)
    for (const change of pending) rows = applyChange(rows, change, opts)
    setRows(rows)
  }

  function onChange(change) {
    if (buffered) buffered.push(change)
    else setRows(applyChange(state.rows, change, opts))
  }

  function start() {
    if (started) return
    started = true
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
    if (typeof window !== 'undefined') window.addEventListener('online', refresh)
  }

  function subscribe(listener) {
    listeners.add(listener)
    start()
    return () => listeners.delete(listener)
  }

  const getSnapshot = () => state

  return {
    refresh,
    getSnapshot,
    isStarted: () => started,
    subscribe,
    useRows: () => useSyncExternalStore(subscribe, getSnapshot),
    // Rows just saved by this phone: shown at once, without waiting for
    // realtime (which then changes nothing).
    upsertLocal: (rows) => setRows(rows.reduce((acc, row) => applyChange(acc, { eventType: 'UPDATE', new: row }, opts), state.rows)),
    removeLocal: (ids) => setRows(state.rows.filter((r) => !ids.includes(r.id))),
    patchLocal: (ids, fields) =>
      setRows(
        state.rows.reduce((acc, row) => (ids.includes(row.id) ? applyChange(acc, { eventType: 'UPDATE', new: { ...row, ...fields } }, opts) : acc), state.rows)
      ),
  }
}

// A stand-in store with no rows, for when there's nothing to load yet
// (same hooks as a real one, so components can switch between them).
const EMPTY_STATE = { rows: [], loaded: false }
const noSubscription = () => () => {}
export const emptyStore = { useRows: () => useSyncExternalStore(noSubscription, () => EMPTY_STATE) }

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
