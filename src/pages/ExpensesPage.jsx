import { useMemo, useState } from 'react'
import { Card } from '../components/ui/Card'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { ExpenseCharts } from '../components/expenses/ExpenseCharts'
import { ExpenseGroup } from '../components/expenses/ExpenseGroup'
import { useExpenses } from '../hooks/useExpenses'
import { PAID_BY_OPTIONS, EXPENSE_PERIODS, EXPENSE_PERIOD_LABELS } from '../data/constants'
import { colorForIndex, hexForIndex } from '../lib/categoryColors'
import { isInPeriod, getPeriodBuckets, bucketKeyForDate } from '../lib/expensePeriods'
import { cn } from '../lib/cn'

export function ExpensesPage() {
  const { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense } = useExpenses()

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Expenses</h2>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
          €{total.toFixed(2)}
        </span>
      </div>

      <ExpenseForm
        categories={categories}
        mainCategories={mainCategories}
        subsOf={subsOf}
        addExpense={addExpense}
        addCategory={addCategory}
        deleteCategory={deleteCategory}
      />

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

      <ExpenseCharts pieData={pieData} barData={barData} colorForCategory={colorForCategory} />

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
