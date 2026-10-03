import { useState } from 'react'
import { Plus, Settings2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Label, Input, Select } from '../ui/Field'
import { CategoryManager } from './CategoryManager'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'

// Adding an expense by hand, plus the category manager it opens.
export function ExpenseForm({ categories, mainCategories, subsOf, addExpense, addCategory, deleteCategory }) {
  const [mainId, setMainId] = useState('')
  const [subId, setSubId] = useState('')
  const [managingCategories, setManagingCategories] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState('shared')
  const [expenseDate, setExpenseDate] = useState(() => localDateString())

  const handleAddExpense = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    const { error } = await addExpense({
      categoryId: subId || mainId || null,
      amount: Number(amount),
      description,
      paidBy,
      expenseDate,
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    setAmount('')
    setDescription('')
  }

  const handleDeleteCategory = async (id) => {
    const result = await deleteCategory(id)
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
          onAdd={addCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setManagingCategories(false)}
        />
      )}

      <form onSubmit={handleAddExpense} data-unsaved={amount || description ? '' : undefined}>
        <Card className="space-y-3">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add an expense</p>

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

          <Button type="submit" className="w-full">
            <Plus size={16} /> Add expense
          </Button>
        </Card>
      </form>
    </>
  )
}
