import { useMemo, useState } from 'react'
import { Plus, Trash2, Wallet, Settings2, ChevronDown } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Label, Input, Select } from '../components/ui/Field'
import { useExpenses } from '../hooks/useExpenses'
import { CategoryManager } from '../components/expenses/CategoryManager'
import { PAID_BY_OPTIONS, EXPENSE_PERIODS, EXPENSE_PERIOD_LABELS } from '../data/constants'
import { colorForIndex, hexForIndex } from '../lib/categoryColors'
import { isInPeriod, getPeriodBuckets, bucketKeyForDate, localDateString } from '../lib/expensePeriods'
import { parseLocalDate } from '../lib/week'
import { cn } from '../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const AXIS_COLOR = 'var(--color-text-muted)'

export function ExpensesPage() {
  const { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense } = useExpenses()

  const [mainId, setMainId] = useState('')
  const [subId, setSubId] = useState('')
  const [managingCategories, setManagingCategories] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState('shared')
  const [expenseDate, setExpenseDate] = useState(() => localDateString())

  const [period, setPeriod] = useState('month')
  const [paidByFilter, setPaidByFilter] = useState('all')

  // Everything is shown by main category; sub-categories only appear
  // when a main category is opened.
  const { mainCategories, subsOf, mainOf } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const mains = categories.filter((c) => !c.parent_id)
    return {
      mainCategories: mains,
      subsOf: (id) => categories.filter((c) => c.parent_id === id),
      mainOf: (categoryId) => {
        const c = byId.get(categoryId)
        return c?.parent_id ? byId.get(c.parent_id) || c : c || null
      },
    }
  }, [categories])

  const colorForCategory = useMemo(() => {
    const map = new Map()
    mainCategories.forEach((c, i) => map.set(c.name, { chip: colorForIndex(i), hex: hexForIndex(i) }))
    return (name) => map.get(name) || { chip: colorForIndex(mainCategories.length), hex: hexForIndex(mainCategories.length) }
  }, [mainCategories])

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
      const label = mainOf(e.category_id)?.name || 'Uncategorized'
      map.set(label, (map.get(label) || 0) + Number(e.amount || 0))
    }
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [filteredExpenses, mainOf])

  // One row per main category per day (e.g. one "Groceries" row for a
  // shopping trip), newest day first, biggest total first within a day.
  const groups = useMemo(() => {
    const map = new Map()
    for (const e of filteredExpenses) {
      const main = mainOf(e.category_id)
      const key = `${e.expense_date}|${main?.id ?? 'none'}`
      if (!map.has(key)) map.set(key, { key, date: e.expense_date, main, items: [], total: 0 })
      const g = map.get(key)
      g.items.push(e)
      g.total += Number(e.amount || 0)
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total)
  }, [filteredExpenses, mainOf])

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
    <div className="space-y-4">
      {managingCategories && (
        <CategoryManager
          categories={categories}
          expenses={expenses}
          onAdd={addCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setManagingCategories(false)}
        />
      )}

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
        {groups.length === 0 ? (
          <Card className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">No expenses match this filter.</p>
          </Card>
        ) : (
          groups.map((g) => (
            <ExpenseGroup
              key={g.key}
              group={g}
              color={colorForCategory(g.main?.name)}
              subName={(categoryId) => (categoryId && categoryId !== g.main?.id ? categories.find((c) => c.id === categoryId)?.name : null)}
              onDelete={deleteExpense}
            />
          ))
        )}
      </div>
    </div>
  )
}

// A main category's expenses for one day. Collapsed: one line with the
// total. Opened: the expenses grouped by sub-category.
function ExpenseGroup({ group, color, subName, onDelete }) {
  const [open, setOpen] = useState(false)
  const { date, main, items, total } = group
  const payers = [...new Set(items.map((e) => paidByLabel(e.paid_by)))]
  const single = items.length === 1 ? items[0] : null
  const subtitle = single?.description || `${items.length} expense${items.length === 1 ? '' : 's'}`

  // Sub-category sections, with expenses filed directly under the main
  // category first (no header).
  const sections = []
  for (const e of items) {
    const name = subName(e.category_id)
    let section = sections.find((s) => s.name === name)
    if (!section) sections.push((section = { name, items: [], total: 0 }))
    section.items.push(e)
    section.total += Number(e.amount || 0)
  }
  sections.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : b.total - a.total))

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full p-3 flex justify-between items-center gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', color.chip.solid)} />
          <div className="min-w-0">
            <p className="font-bold text-[var(--color-text)]">{main?.name || 'Uncategorized'}</p>
            <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
              {parseLocalDate(date).toLocaleDateString('en-GB')} · {subtitle} · {payers.join(', ')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
          <ChevronDown size={14} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-3 pb-2">
          {sections.map((section) => (
            <div key={section.name ?? '_main'} className="pt-2">
              {section.name && (
                <p className="flex justify-between text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">
                  <span>{section.name}</span>
                  <span className="font-mono">€{section.total.toFixed(2)}</span>
                </p>
              )}
              {section.items.map((e) => (
                <div key={e.id} className="flex justify-between items-center gap-2 py-1 pl-2 border-l-2 border-[var(--color-border)]">
                  <div className="min-w-0">
                    <p className="text-[var(--color-text)] truncate">{e.description || section.name || main?.name || 'Expense'}</p>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{paidByLabel(e.paid_by)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[var(--color-text-soft)]">€{Number(e.amount).toFixed(2)}</span>
                    <button
                      onClick={() => onDelete(e.id)}
                      className="text-[var(--color-icon-muted)] hover:text-red-400 transition"
                      title="Delete expense"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
