import { useMemo, useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Label, Input, Select } from '../components/ui/Field'
import { useExpenses } from '../hooks/useExpenses'
import { PAID_BY_OPTIONS, EXPENSE_PERIODS, EXPENSE_PERIOD_LABELS } from '../data/constants'
import { colorForIndex, hexForIndex } from '../lib/categoryColors'
import { isInPeriod, getPeriodBuckets, bucketKeyForDate } from '../lib/expensePeriods'
import { cn } from '../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const AXIS_COLOR = 'var(--color-text-muted)'

export function ExpensesPage() {
  const { expenses, categories, addExpense, addCategory, deleteExpense } = useExpenses()

  const [categoryId, setCategoryId] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState('shared')
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10))

  const [period, setPeriod] = useState('month')
  const [paidByFilter, setPaidByFilter] = useState('all')

  const colorForCategory = useMemo(() => {
    const map = new Map()
    categories.forEach((c, i) => map.set(c.name, { chip: colorForIndex(i), hex: hexForIndex(i) }))
    return (name) => map.get(name) || { chip: colorForIndex(categories.length), hex: hexForIndex(categories.length) }
  }, [categories])

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((e) => {
        if (!isInPeriod(e.expense_date, period)) return false
        if (paidByFilter !== 'all' && e.paid_by !== paidByFilter) return false
        return true
      }),
    [expenses, period, paidByFilter]
  )

  const total = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)

  const pieData = useMemo(() => {
    const map = new Map()
    for (const e of filteredExpenses) {
      const label = e.expense_categories?.name || 'Uncategorized'
      map.set(label, (map.get(label) || 0) + Number(e.amount || 0))
    }
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [filteredExpenses])

  const barData = useMemo(() => {
    const buckets = getPeriodBuckets(period)
    const totals = new Map(buckets.map((b) => [b.key, 0]))
    for (const e of filteredExpenses) {
      const key = bucketKeyForDate(e.expense_date, period)
      if (totals.has(key)) totals.set(key, totals.get(key) + Number(e.amount || 0))
    }
    return buckets.map((b) => ({ label: b.label, amount: Math.round((totals.get(b.key) || 0) * 100) / 100 }))
  }, [filteredExpenses, period])

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

      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1">
          {EXPENSE_PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
                period === p ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
              )}
            >
              {EXPENSE_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1">
          {[{ value: 'all', label: 'Everyone' }, ...PAID_BY_OPTIONS].map((o) => (
            <button
              key={o.value}
              onClick={() => setPaidByFilter(o.value)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
                paidByFilter === o.value ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Wallet size={14} /> By category
          </p>
          {pieData.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">No expenses in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={colorForCategory(entry.name).hex} stroke="var(--color-surface)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => `€${Number(value).toFixed(2)}`}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Trend</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} />
              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                formatter={(value) => `€${Number(value).toFixed(2)}`}
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}
              />
              <Bar dataKey="amount" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="space-y-2">
        {filteredExpenses.length === 0 ? (
          <Card className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">No expenses match this filter.</p>
          </Card>
        ) : (
          filteredExpenses.map((e) => {
            const c = colorForCategory(e.expense_categories?.name)
            return (
              <div
                key={e.id}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] p-3 rounded-2xl flex justify-between items-center text-xs shadow-sm transition-all duration-200 hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', c.chip.solid)} />
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
          })
        )}
      </div>
    </div>
  )
}
