import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isOffline, useOnline } from '../lib/connection'
import { monthNumber } from '../lib/expensePeriods'

// The earliest date of a table: one normal select (oldest first, one
// row). → 'YYYY-MM-DD', null for an empty table, undefined when it could
// not be read (offline, an error, a table that isn't there).
async function earliestDate(table, column) {
  if (isOffline()) return undefined
  try {
    const { data, error } = await supabase.from(table).select(column).order(column, { ascending: true }).limit(1)
    if (error) return undefined
    return data?.[0]?.[column] ?? null
  } catch {
    return undefined
  }
}

const earliestOf = (rows, dateOf) => {
  let first = null
  for (const row of rows) {
    const d = dateOf(row)
    if (d && (!first || d < first)) first = d
  }
  return first
}

// The first month with data for the period pickers (plan 9O K160c), as a
// month number (year × 12 + month): the earliest expense_date or
// income_date. Read once per visit to Money (again when the connection
// comes back, for a read that failed). Offline or a failed read: the
// earliest of the rows already loaded, else this month.
export function useFirstMoneyMonth(expenses, income) {
  const online = useOnline()
  const [read, setRead] = useState({ expenses: undefined, income: undefined })
  const missing = read.expenses === undefined || read.income === undefined
  useEffect(() => {
    if (!online || !missing) return undefined
    let live = true
    Promise.all([earliestDate('expenses', 'expense_date'), earliestDate('income', 'income_date')]).then(([e, i]) => {
      if (live) setRead((r) => ({ expenses: r.expenses ?? e, income: r.income ?? i }))
    })
    return () => {
      live = false
    }
    // Read again only when the connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  const loadedFirst = useMemo(
    () => [earliestOf(expenses, (e) => e.expense_date), earliestOf(income, (i) => i.income_date)].filter(Boolean).sort()[0] ?? null,
    [expenses, income]
  )
  const first = [read.expenses, read.income, loadedFirst].filter(Boolean).sort()[0]
  const now = new Date()
  return first ? Math.min(monthNumber(new Date(`${first}T00:00:00`)), monthNumber(now)) : monthNumber(now)
}
