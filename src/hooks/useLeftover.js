import { useEffect, useMemo, useRef } from 'react'
import { useOnline } from '../lib/connection'
import { emptyStore } from '../lib/tableStore'
import { expensesBefore, incomeBefore } from '../lib/stores'

// The rows the leftover of the top card needs (plan 9O K164–K172): every
// expense and income entry dated before `before` (the first day of the
// period on screen), read with only their date, amount and person (and
// the parts of a Shared expense). Live: kept up to date by realtime and by
// this device's own saves, like the lists. Money reads them for every
// period kind, Week too: Joint's money before the period (plan 9P K233,
// K234) needs them even where no leftover is shown.
//   needed      – false: nothing read
//   partsReady  – whether the part columns exist (true / false), or
//                 null / undefined while that isn't known yet (nothing
//                 read yet)
// → { expenses, income } once both are read, else null (not read yet,
// offline, a failed read): then the card shows no leftover and no bar,
// never a guess.
export function useLeftoverRows(before, { needed = true, partsReady } = {}) {
  const online = useOnline()
  const ready = needed && typeof partsReady === 'boolean'
  const expenseStore = ready ? expensesBefore(`${before}|${partsReady ? 1 : 0}`) : emptyStore
  const incomeStore = ready ? incomeBefore(before) : emptyStore
  const expenses = expenseStore.useRows()
  const income = incomeStore.useRows()

  // Back online after a read that couldn't be made offline: read now
  // (only then — the first read is made by the store itself).
  const missingRead = ready && (!expenses.loaded || !income.loaded)
  const wasOnline = useRef(online)
  useEffect(() => {
    const cameBack = online && !wasOnline.current
    wasOnline.current = online
    if (!cameBack || !missingRead) return
    if (!expenseStore.getSnapshot().loaded) expenseStore.refresh()
    if (!incomeStore.getSnapshot().loaded) incomeStore.refresh()
  }, [online, missingRead, expenseStore, incomeStore])

  return useMemo(() => {
    if (!ready || !online || !expenses.loaded || !income.loaded) return null
    return { expenses: expenses.rows, income: income.rows }
  }, [ready, online, expenses, income])
}
