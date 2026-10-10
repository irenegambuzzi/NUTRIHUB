import { useState } from 'react'
import { Plus, Pencil, Trash2, X, TrendingUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { IncomeForm } from './IncomeForm'
import { INCOME_TYPES, PAID_BY_OPTIONS } from '../../data/constants'
import { parseLocalDate } from '../../lib/week'
import { cn } from '../../lib/cn'

const typeLabel = (value) => INCOME_TYPES.find((t) => t.value === value)?.label || value
const receivedByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value

// Adding income (a card that opens on demand) and the income received in
// the period on screen, each entry editable and deletable.
export function IncomeSection({ entries, missing, addIncome, updateIncome, deleteIncome }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp size={14} /> Income
        </p>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs">
            <Plus size={14} /> Add income
          </Button>
        )}
      </div>

      {missing && (
        <Card className="text-xs text-yellow-300">Income needs a one-time database update (supabase/016_income_and_category_colors.sql) before it can be saved.</Card>
      )}

      {adding && (
        <Card className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add income</p>
            <button onClick={() => setAdding(false)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
              <X size={16} />
            </button>
          </div>
          <IncomeForm submitLabel="Add income" onSubmit={addIncome} />
        </Card>
      )}

      {entries.length === 0 ? (
        <Card className="text-center">
          <p className="text-xs text-[var(--color-text-muted)]">No income in this period.</p>
        </Card>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs p-3 flex justify-between items-center gap-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                    entry.income_type === 'salary'
                      ? 'bg-[var(--color-primary)]/15 text-[#7FDB92] border-[var(--color-primary)]/30'
                      : 'bg-[var(--color-surface-soft)] text-[var(--color-text-soft)] border-[var(--color-border)]'
                  )}
                >
                  {typeLabel(entry.income_type)}
                </span>
                {entry.source && <span className="font-bold text-[var(--color-text)] truncate">{entry.source}</span>}
              </p>
              <span className="text-[10px] text-[var(--color-text-muted)] block truncate mt-0.5">
                {parseLocalDate(entry.income_date).toLocaleDateString('en-GB')} · {receivedByLabel(entry.received_by)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono font-bold text-[#7FDB92]">+€{Number(entry.amount).toFixed(2)}</span>
              <button onClick={() => setEditing(entry)} className="text-[var(--color-icon-muted)] hover:text-[var(--color-primary)] transition p-1" title="Edit income">
                <Pencil size={13} />
              </button>
              <button onClick={() => deleteIncome(entry.id)} className="text-[var(--color-icon-muted)] hover:text-red-400 transition p-1" title="Delete income">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))
      )}

      {editing && (
        <div data-unsaved className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
          >
            <div className="flex justify-between items-center">
              <p className="text-sm font-extrabold text-[var(--color-primary)]">Edit income</p>
              <button onClick={() => setEditing(null)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                <X size={18} />
              </button>
            </div>
            <IncomeForm
              initial={editing}
              submitLabel="Save"
              onCancel={() => setEditing(null)}
              onSubmit={async (values) => {
                const result = await updateIncome(editing.id, values)
                if (!result.error) setEditing(null)
                return result
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
