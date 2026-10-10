import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { allIncomeStores, incomeSince } from '../lib/stores'

const refreshIncome = () => Promise.all(allIncomeStores().map((s) => s.refresh()))

// Deletes right away; Undo puts the entry back exactly.
export function deleteIncome(id) {
  return deleteWithUndo({
    message: 'Income deleted',
    remove: async () => {
      const rows = must(await supabase.from('income').delete().eq('id', id).select())
      allIncomeStores().forEach((s) => s.removeLocal([id]))
      return rows
    },
    restore: async (rows) => {
      if (rows.length) must(await supabase.from('income').upsert(rows))
      await refreshIncome()
    },
    onFail: refreshIncome,
  })
}

// Income entries from `since` (YYYY-MM-DD) on, and adding, editing and
// deleting them. Income is its own record type: nothing here touches
// expenses.
export function useIncome(since) {
  const { rows: income, loaded, missing } = incomeSince(since).useRows()

  const addIncome = useCallback(
    ({ amount, incomeDate, incomeType, receivedBy, source }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('income')
              .insert([{ amount, income_date: incomeDate, income_type: incomeType, received_by: receivedBy, source: source || null }])
              .select()
          )
          allIncomeStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false }
      ),
    []
  )

  const updateIncome = useCallback(
    (id, { amount, incomeDate, incomeType, receivedBy, source }) =>
      attempt(
        async () => {
          const rows = must(
            await supabase
              .from('income')
              .update({ amount, income_date: incomeDate, income_type: incomeType, received_by: receivedBy, source: source || null })
              .eq('id', id)
              .select()
          )
          allIncomeStores().forEach((s) => s.upsertLocal(rows))
        },
        { retry: false, onFail: refreshIncome }
      ),
    []
  )

  return { income, loaded, missing: !!missing, addIncome, updateIncome, deleteIncome }
}
