import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { IncomeForm } from './IncomeForm'
import { CategoryManager } from './CategoryManager'
import { MoneyExplorer } from './MoneyExplorer'
import { IncomeRow } from './EntryRows'
import { PersonSelector } from './PersonSelector'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { categoryTree } from '../../lib/moneyList'
import { incomeUsageStore } from '../../lib/stores'
import { parseLocalDate } from '../../lib/week'

const receivedByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const incomeDate = (entry) => entry.income_date

// Adding income (a card that opens on demand), its categories, and the
// income received in the period on screen with the same charts, filters
// and sorting as the expenses. Each entry is editable and deletable.
export function IncomeSection({
  entries,
  total,
  missing,
  categories,
  categoriesMissing,
  styleFor,
  period,
  offset,
  person,
  onPerson,
  addIncome,
  updateIncome,
  deleteIncome,
  addCategory,
  deleteCategory,
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [managing, setManaging] = useState(false)
  const tree = useMemo(() => categoryTree(categories), [categories])
  const onManage = categoriesMissing ? undefined : () => setManaging(true)

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Income</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-[#7FDB92] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
            €{total.toFixed(2)}
          </span>
          {!adding && (
            <Button variant="ghost" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs">
              <Plus size={14} /> Add income
            </Button>
          )}
        </div>
      </div>

      <PersonSelector value={person} onChange={onPerson} label="Received by" />

      {missing && (
        <Card className="text-xs text-yellow-300">Income needs a one-time database update (supabase/016_income_and_category_colors.sql) before it can be saved.</Card>
      )}
      {!missing && categoriesMissing && (
        <Card className="text-xs text-yellow-300">
          Income categories need a one-time database update (supabase/017_income_categories.sql). Until then income is sorted as Salary or Other and the categories can't be changed.
        </Card>
      )}

      {adding && (
        <Card className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add income</p>
            <button onClick={() => setAdding(false)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
              <X size={16} />
            </button>
          </div>
          <IncomeForm submitLabel="Add income" onSubmit={addIncome} tree={tree} onManage={onManage} />
        </Card>
      )}

      <MoneyExplorer
        entries={entries}
        dateOf={incomeDate}
        categoryOf={tree.mainOf}
        period={period}
        offset={offset}
        scope={person}
        styleFor={styleFor}
        plural="income entries"
        renderDefault={(visible) =>
          visible.map((entry) => {
            const { main, sub } = tree.namesOf(entry.category_id)
            const style = styleFor(tree.mainOf(entry.category_id)?.id)
            return (
              <div
                key={entry.id}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs p-3 flex justify-between items-center gap-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0" style={{ background: style.tint, borderColor: style.border, color: style.text }}>
                      {main || 'Uncategorized'}
                      {sub ? ` › ${sub}` : ''}
                    </span>
                    {entry.source && <span className="font-bold text-[var(--color-text)] truncate">{entry.source}</span>}
                  </p>
                  <span className="text-[10px] text-[var(--color-text-muted)] block truncate mt-0.5">
                    {parseLocalDate(entry.income_date).toLocaleDateString('en-GB')} · {receivedByLabel(entry.received_by)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono font-bold text-[#7FDB92] mr-1">+€{Number(entry.amount).toFixed(2)}</span>
                  <button onClick={() => setEditing(entry)} className="text-[var(--color-icon-muted)] hover:text-[var(--color-primary)] transition w-9 h-9 flex items-center justify-center" title="Edit income" aria-label="Edit income">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => deleteIncome(entry.id)} className="text-[var(--color-icon-muted)] hover:text-red-400 transition w-9 h-9 flex items-center justify-center" title="Delete income" aria-label="Delete income">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })
        }
        renderEntry={(entry) => <IncomeRow key={entry.id} entry={entry} names={tree.namesOf} onEdit={setEditing} onDelete={deleteIncome} />}
      />

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
              tree={tree}
              onManage={onManage}
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

      {managing && (
        <CategoryManager
          categories={categories}
          styleFor={styleFor}
          onAdd={addCategory}
          onDelete={deleteCategory}
          onClose={() => setManaging(false)}
          title="Income categories"
          noun="income entry"
          plural="income entries"
          usageStore={incomeUsageStore}
          protectedNames={['Salary', 'Other']}
        />
      )}
    </section>
  )
}
