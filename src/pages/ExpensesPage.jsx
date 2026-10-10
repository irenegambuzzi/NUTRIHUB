import { useMemo, useState } from 'react'
import { Card } from '../components/ui/Card'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { ExpenseCharts } from '../components/expenses/ExpenseCharts'
import { ExpenseGroup } from '../components/expenses/ExpenseGroup'
import { CategoryTotals } from '../components/expenses/CategoryTotals'
import { IncomeSection } from '../components/expenses/IncomeSection'
import { MoneySummary } from '../components/expenses/MoneySummary'
import { PeriodPicker } from '../components/expenses/PeriodPicker'
import { useExpenses } from '../hooks/useExpenses'
import { useIncome } from '../hooks/useIncome'
import { useCategoryColors } from '../hooks/useCategoryColors'
import { reopenTrip } from '../hooks/usePurchase'
import { askDialog } from '../lib/feedback'
import { PAID_BY_OPTIONS } from '../data/constants'
import { getPeriodRange, getPeriodBuckets, bucketKeyForDate, localDateString } from '../lib/expensePeriods'
import { currentExpensesSince } from '../lib/stores'
import { categoryTotals, sumAmounts } from '../lib/moneySummary'
import { cn } from '../lib/cn'

export function ExpensesPage() {
  // Data is loaded from `since`; looking further back moves it earlier.
  const [since, setSince] = useState(currentExpensesSince)
  const { expenses, categories, addExpense, addCategory, deleteCategory, deleteExpense } = useExpenses(since)
  const { income, missing: incomeMissing, addIncome, updateIncome, deleteIncome } = useIncome(since)
  const styleFor = useCategoryColors(categories)

  // An expense from a confirmed purchase: deleting it alone would leave the
  // purchase's stock and history behind, so reopening the purchase (which
  // undoes all of it) is offered first.
  const removeExpense = async (expense) => {
    if (!expense.trip_id) return deleteExpense(expense.id)
    const answer = await askDialog({
      title: 'Part of a confirmed purchase',
      message: `"${expense.description || 'This expense'}" was recorded when a purchase was confirmed. Deleting only the expense leaves that purchase's stock and history as they are.`,
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: 'reopen',
          options: [
            { value: 'reopen', label: 'Reopen purchase', hint: 'Undoes its stock, history and expenses; the items go back to the cart.' },
            { value: 'expense', label: 'Delete expense only', hint: 'The purchase stays, marked incomplete in Receipts.' },
          ],
        },
      ],
      confirmLabel: 'Continue',
    })
    if (answer?.how === 'reopen') await reopenTrip(expense.trip_id)
    else if (answer?.how === 'expense') await deleteExpense(expense.id)
  }

  const [period, setPeriod] = useState('month')
  const [offset, setOffset] = useState(0)
  const [paidByFilter, setPaidByFilter] = useState('all')

  const showPeriod = (nextPeriod, nextOffset) => {
    const start = localDateString(getPeriodRange(nextPeriod, new Date(), nextOffset).start)
    setSince((current) => (start < current ? start : current))
    setPeriod(nextPeriod)
    setOffset(nextOffset)
  }
  const { startDate, endDate } = useMemo(() => {
    const { start, end } = getPeriodRange(period, new Date(), offset)
    return { startDate: localDateString(start), endDate: localDateString(end) }
  }, [period, offset])

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

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((e) => {
        if (e.expense_date < startDate || e.expense_date >= endDate) return false
        if (paidByFilter !== 'all' && e.paid_by !== paidByFilter) return false
        return true
      }),
    [expenses, startDate, endDate, paidByFilter]
  )

  const filteredIncome = useMemo(
    () => income.filter((i) => i.income_date >= startDate && i.income_date < endDate && (paidByFilter === 'all' || i.received_by === paidByFilter)),
    [income, startDate, endDate, paidByFilter]
  )

  const total = sumAmounts(filteredExpenses)
  const incomeTotal = sumAmounts(filteredIncome)

  const totals = useMemo(() => categoryTotals(filteredExpenses, mainOf), [filteredExpenses, mainOf])
  const pieData = useMemo(
    () => totals.map((c) => ({ name: c.name, value: c.total, hex: styleFor(c.id).hex })),
    [totals, styleFor]
  )

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
    const buckets = getPeriodBuckets(period, new Date(), offset)
    const totals = new Map(buckets.map((b) => [b.key, 0]))
    for (const e of filteredExpenses) {
      const key = bucketKeyForDate(e.expense_date, period)
      if (totals.has(key)) totals.set(key, totals.get(key) + Number(e.amount || 0))
    }
    return buckets.map((b) => ({ label: b.label, amount: Math.round((totals.get(b.key) || 0) * 100) / 100 }))
  }, [filteredExpenses, period, offset])

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
        styleFor={styleFor}
      />

      <PeriodPicker period={period} offset={offset} onPeriod={(p) => showPeriod(p, 0)} onOffset={(o) => showPeriod(period, o)} />

      <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 self-start w-fit">
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

      <MoneySummary income={incomeTotal} expenses={total} />

      <CategoryTotals totals={totals} total={total} styleFor={styleFor} />

      <ExpenseCharts pieData={pieData} barData={barData} />

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
              color={styleFor(g.main?.id)}
              styleFor={styleFor}
              subName={(categoryId) => (categoryId && categoryId !== g.main?.id ? categories.find((c) => c.id === categoryId)?.name : null)}
              onDelete={removeExpense}
            />
          ))
        )}
      </div>

      <IncomeSection entries={filteredIncome} missing={incomeMissing} addIncome={addIncome} updateIncome={updateIncome} deleteIncome={deleteIncome} />
    </div>
  )
}
