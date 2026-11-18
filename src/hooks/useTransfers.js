import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { useOnline } from '../lib/connection'
import { showToast } from '../lib/feedback'
import { isMissingTable } from '../lib/tableStore'
import { transferStore } from '../lib/stores'
import { TRANSFERS_NOTICE, savedMessage } from '../lib/transfers'

// Whether the database has the transfers table (supabase/033): true (read,
// it is there) / false (missing) / null (not known yet: not read, offline,
// a failed read). Once true it stays true for this app start.
let seenReady = false
export function transfersReadyOf(state) {
  if (state.missing) return false
  if (state.loaded) seenReady = true
  return seenReady ? true : null
}

// The transfers (plan 9P K221–K231):
//   rows   – every transfer read so far (for the list and the one
//            starting balance)
//   ready  – see transfersReadyOf
//   known  – the rows the money may count: every transfer once read and
//            online; [] while the table is missing (before 033); null
//            while they can't be trusted (not read yet, offline, a failed
//            read): then no transfer number, no leftover line, no bar (K196)
// Read again when the connection comes back.
export function useTransfers() {
  const online = useOnline()
  const state = transferStore.useRows()
  const ready = transfersReadyOf(state)

  const wasOnline = useRef(online)
  useEffect(() => {
    const cameBack = online && !wasOnline.current
    wasOnline.current = online
    if (cameBack && !transferStore.getSnapshot().loaded) transferStore.refresh()
  }, [online])

  const known = state.missing ? [] : state.loaded && online ? state.rows : null
  return { rows: state.rows, ready, known }
}

// Just whether supabase/033 has run: true / false / null (see above).
export const useTransfersReady = () => useTransfers().ready

// A save that meets a database without the table says so (the form keeps
// what was typed).
const messageOf = (error) => (isMissingTable(error) ? TRANSFERS_NOTICE : undefined)
const refresh = () => transferStore.refresh()

const removeRow = async (id) => {
  must(await supabase.from('transfers').delete().eq('id', id))
  transferStore.removeLocal([id])
}

// Saves a new transfer with the form's own id (upsert: a second press, or
// Retry after a dropped connection, saves it once). Toast with Undo (20 s),
// which deletes it.
export function addTransfer(id, row) {
  return attempt(
    async () => {
      const saved = must(await supabase.from('transfers').upsert([{ id, ...row }]).select())
      transferStore.upsertLocal(saved)
      showToast({
        message: savedMessage(saved[0] ?? { id, ...row }),
        action: { label: 'Undo', onClick: () => attempt(() => removeRow(id), { onFail: refresh }) },
      })
      return saved[0]
    },
    { messageOf, onFail: refresh }
  )
}

// Changes a transfer. Toast "Transfer changed" with Undo (20 s), which puts
// the old values back.
export function updateTransfer(before, row) {
  const put = async (values, toast) => {
    const saved = must(await supabase.from('transfers').update(values).eq('id', before.id).select())
    transferStore.upsertLocal(saved)
    if (toast) showToast({ message: 'Transfer changed', action: { label: 'Undo', onClick: () => attempt(() => put(oldValues, false), { onFail: refresh }) } })
    return saved[0]
  }
  const oldValues = { transfer_date: before.transfer_date, from_code: before.from_code ?? null, to_code: before.to_code, amount: before.amount, note: before.note ?? null }
  return attempt(() => put(row, true), { messageOf, onFail: refresh })
}

// Deletes right away; Undo puts the same row back (same id).
export function deleteTransfer(id) {
  return deleteWithUndo({
    message: 'Transfer deleted',
    remove: async () => {
      const rows = must(await supabase.from('transfers').delete().eq('id', id).select())
      transferStore.removeLocal([id])
      return rows
    },
    restore: async (rows) => {
      if (!rows.length) return
      const saved = must(await supabase.from('transfers').upsert(rows).select())
      transferStore.upsertLocal(saved)
    },
    onFail: refresh,
  })
}
