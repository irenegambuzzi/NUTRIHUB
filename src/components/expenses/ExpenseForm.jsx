import { useState } from 'react'
import { Plus, Check, Settings2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Label, Input, Select } from '../ui/Field'
import { CategoryManager } from './CategoryManager'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'
import { categoryTree } from '../../lib/moneyList'

// The expense fields, for adding an expense by hand or editing one
// (`initial`), plus the category manager they open. onSubmit resolves to
// { error }; on failure the form keeps what was typed.
export function ExpenseForm({
  initial,
  submitLabel = 'Add expense',
  onSubmit,
  onCancel,
  categories,
  mainCategories,
  subsOf,
  addCategory,
  renameCategory,
  moveCategory,
  deleteCategory,
  styleFor,
  onClose,
}) {
  const initialMain = initial ? categoryTree(categories).mainOf(initial.category_id) : null
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(initial && initial.category_id !== initialMain?.id ? initial.category_id ?? '' : '')
  const [managingCategories, setManagingCategories] = useState(false)
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? 'shared')
  const [expenseDate, setExpenseDate] = useState(initial?.expense_date ?? localDateString())

  const handleAddExpense = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    const { error } = await onSubmit({
      categoryId: subId || mainId || null,
      amount: Number(amount),
      description,
      paidBy,
      expenseDate,
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    if (!initial) {
      setAmount('')
      setDescription('')
    }
    onClose?.()
  }

  const handleDeleteCategory = async (id) => {
    const result = await deleteCategory(id)
    if (!result.error && (mainId === id || subId === id)) {
      setMainId('')
      setSubId('')
    }
    return result
  }

  // Moving the category on screen takes it (or its parent) out of the picker.
  const handleMoveCategory = async (id, parentId) => {
    const result = await moveCategory(id, parentId)
    if (!result.error && (mainId === id || subId === id)) {
      setMainId('')
      setSubId('')
    }
    return result
  }

  return (
    <>
      {managingCategories && (
        <CategoryManager
          categories={categories}
          styleFor={styleFor}
          onAdd={addCategory}
          onDelete={handleDeleteCategory}
          onRename={renameCategory}
          onMove={handleMoveCategory}
          onClose={() => setManagingCategories(false)}
        />
      )}

      <form onSubmit={handleAddExpense} data-unsaved={amount || description ? '' : undefined}>
        <Card className={initial ? 'space-y-3 border-0 shadow-none p-0 bg-transparent' : 'space-y-3'}>
          <div className="flex justify-between items-center">
            {!initial && <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add an expense</p>}
            {!initial && onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Amount (€)</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Category</Label>
            <div className="flex gap-2">
              <Select
                value={mainId}
                onChange={(e) => {
                  setMainId(e.target.value)
                  setSubId('')
                }}
                className="flex-1"
                aria-label="Category"
              >
                <option value="">Uncategorized</option>
                {mainCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="ghost" onClick={() => setManagingCategories(true)} className="px-3" title="Add or delete categories">
                <Settings2 size={14} /> Manage
              </Button>
            </div>
            {mainId && subsOf(mainId).length > 0 && (
              <Select value={subId} onChange={(e) => setSubId(e.target.value)} className="mt-2" aria-label="Subcategory">
                <option value="">No subcategory</option>
                {subsOf(mainId).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label>Description</Label>
            <Input placeholder="e.g. Cigarettes, dinner out…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <Label>Paid by</Label>
            <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {PAID_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
            )}
            <Button type="submit" className="flex-1">
              {initial ? <Check size={16} /> : <Plus size={16} />} {submitLabel}
            </Button>
          </div>
        </Card>
      </form>
    </>
  )
}
