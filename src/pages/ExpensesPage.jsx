import { useMemo, useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Label, Input, Select } from '../components/ui/Field'
import { useExpenses } from '../hooks/useExpenses'
import { PAID_BY_OPTIONS } from '../data/constants'
import { colorForIndex } from '../lib/categoryColors'
import { cn } from '../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value

export function ExpensesPage() {
  const { expenses, categories, addExpense, addCategory, deleteExpense } = useExpenses()

  const [categoryId, setCategoryId] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState('shared')
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10))

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)

  const categoryColorMap = useMemo(() => {
    const map = new Map()
    categories.forEach((c, i) => map.set(c.name, colorForIndex(i)))
    return map
  }, [categories])
  const colorForCategory = (name) => categoryColorMap.get(name) || colorForIndex(categories.length)

  const totalsByCategory = useMemo(() => {
    const map = new Map()
    for (const e of expenses) {
      const label = e.expense_categories?.name || 'Uncategorized'
      map.set(label, (map.get(label) || 0) + Number(e.amount || 0))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [expenses])

  const totalsByMonth = useMemo(() => {
    const map = new Map()
    for (const e of expenses) {
      const month = e.expense_date?.slice(0, 7)
      map.set(month, (map.get(month) || 0) + Number(e.amount || 0))
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
  }, [expenses])

  const handleAddExpense = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    const { error } = await addExpense({
      categoryId: categoryId || null,
      amount: Number(amount),
      description,
      paidBy,
      expenseDate,
    })
    if (error) {
      alert('Could not save the expense: ' + error.message)
      return
    }
    setAmount('')
    setDescription('')
  }

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return
    const { data, error } = await addCategory(newCategoryName.trim())
    if (error) {
      alert('Could not add the category: ' + error.message)
      return
    }
    if (data) {
      setCategoryId(data.id)
      setNewCategoryName('')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Expenses</h2>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
          €{total.toFixed(2)}
        </span>
      </div>

      <form onSubmit={handleAddExpense}>
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
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex-1">
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="New category name…"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="ghost" onClick={handleAddCategory} className="px-3">
                Add
              </Button>
            </div>
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

      {totalsByCategory.length > 0 && (
        <Card className="space-y-2">
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
            <Wallet size={14} /> By category
          </p>
          {totalsByCategory.map(([label, sum]) => {
            const c = colorForCategory(label)
            return (
              <div key={label} className="flex justify-between items-center text-xs">
                <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold', c.bg, c.text)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', c.solid)} />
                  {label}
                </span>
                <span className="font-mono font-bold text-[var(--color-accent)]">€{sum.toFixed(2)}</span>
              </div>
            )
          })}
        </Card>
      )}

      {totalsByMonth.length > 0 && (
        <Card className="space-y-2">
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">By month</p>
          {totalsByMonth.map(([month, sum]) => (
            <div key={month} className="flex justify-between text-xs">
              <span className="text-[var(--color-text)]">{month}</span>
              <span className="font-mono font-bold text-[var(--color-accent)]">€{sum.toFixed(2)}</span>
            </div>
          ))}
        </Card>
      )}

      <div className="space-y-2">
        {expenses.map((e) => {
          const c = colorForCategory(e.expense_categories?.name)
          return (
            <div
              key={e.id}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] p-3 rounded-2xl flex justify-between items-center text-xs shadow-sm transition-all duration-200 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', c.solid)} />
                <div>
                  <p className="font-bold text-[var(--color-text)]">{e.description || e.expense_categories?.name || 'Expense'}</p>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {new Date(e.expense_date).toLocaleDateString('en-GB')} · {e.expense_categories?.name || 'Uncategorized'} · {paidByLabel(e.paid_by)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-[var(--color-accent)]">€{Number(e.amount).toFixed(2)}</span>
                <button
                  onClick={() => window.confirm('Delete this expense?') && deleteExpense(e.id)}
                  className="text-[var(--color-icon-muted)] hover:text-rose-400 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
