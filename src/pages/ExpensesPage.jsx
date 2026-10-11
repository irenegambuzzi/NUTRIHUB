import { useMemo, useState } from 'react'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { MoneyExplorer } from '../components/expenses/MoneyExplorer'
import { ExpenseRow } from '../components/expenses/EntryRows'
import { ExpenseGroup } from '../components/expenses/ExpenseGroup'
import { CategoryTotals } from '../components/expenses/CategoryTotals'
import { IncomeSection } from '../components/expenses/IncomeSection'
import { MoneySummary } from '../components/expenses/MoneySummary'
import { PeriodPicker } from '../components/expenses/PeriodPicker'
import { useExpenses } from '../hooks/useExpenses'
import { useIncome } from '../hooks/useIncome'
import { useCategoryColors } from '../hooks/useCategoryColors'
import { incomeCategoryColorStore } from '../lib/stores'
import { categoryTree } from '../lib/moneyList'
import { reopenTrip } from '../hooks/usePurchase'
import { askDialog } from '../lib/feedback'
import { PersonSelector } from '../components/expenses/PersonSelector'
import { Button } from '../components/ui/Button'
import { usePersonFilter } from '../lib/personFilter'
import { getPeriodRange, localDateString } from '../lib/expensePeriods'
import { currentExpensesSince } from '../lib/stores'
import { categoryTotals, sumAmounts } from '../lib/moneySummary'
import { Plus, X } from 'lucide-react'

const expenseDate = (expense) => expense.expense_date

export function ExpensesPage() {
  // Data is loaded from `since`; looking further back moves it earlier.
  const [since, setSince] = useState(currentExpensesSince)
  const { expenses, categories, addExpense, updateExpense, addCategory, renameCategory, moveCategory, deleteCategory, deleteExpense } = useExpenses(since)
  const {
    income,
    missing: incomeMissing,
    categories: incomeCategories,
    categoriesMissing: incomeCategoriesMissing,
    addIncome,
    updateIncome,
    deleteIncome,
    addCategory: addIncomeCategory,
    renameCategory: renameIncomeCategory,
    moveCategory: moveIncomeCategory,
    deleteCategory: deleteIncomeCategory,
  } = useIncome(since)
  const styleFor = useCategoryColors(categories)
  const incomeStyleFor = useCategoryColors(incomeCategories, { store: incomeCategoryColorStore, table: 'income_category_colors' })

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
  const [paidByFilter, setPaidByFilter] = usePersonFilter('money.expensePerson')
  const [receivedByFilter, setReceivedByFilter] = usePersonFilter('money.incomePerson')
  const [addingExpense, setAddingExpense] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)

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
  const { mainCategories, subsOf, mainOf, namesOf } = useMemo(() => categoryTree(categories), [categories])

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
    () => income.filter((i) => i.income_date >= startDate && i.income_date < endDate && (receivedByFilter === 'all' || i.received_by === receivedByFilter)),
    [income, startDate, endDate, receivedByFilter]
  )

  const total = sumAmounts(filteredExpenses)
  const incomeTotal = sumAmounts(filteredIncome)

  const totals = useMemo(() => categoryTotals(filteredExpenses, mainOf), [filteredExpenses, mainOf])
  // One row per main category per day (e.g. one "Groceries" row for a
  // shopping trip), newest day first, biggest total first within a day.
  const expenseGroups = (entries) => {
    const map = new Map()
    for (const e of entries) {
      const main = mainOf(e.category_id)
      const key = `${e.expense_date}|${main?.id ?? 'none'}`
      if (!map.has(key)) map.set(key, { key, date: e.expense_date, main, items: [], total: 0 })
      const g = map.get(key)
      g.items.push(e)
      g.total += Number(e.amount || 0)
    }
    return [...map.values()]
      .sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total)
      .map((g) => (
        <ExpenseGroup
          key={g.key}
          group={g}
          color={styleFor(g.main?.id)}
          styleFor={styleFor}
          subName={(categoryId) => (categoryId && categoryId !== g.main?.id ? categories.find((c) => c.id === categoryId)?.name : null)}
          onEdit={setEditingExpense}
          onDelete={removeExpense}
        />
      ))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PeriodPicker period={period} offset={offset} onPeriod={(p) => showPeriod(p, 0)} onOffset={(o) => showPeriod(period, o)} />

        <MoneySummary income={incomeTotal} expenses={total} incomePerson={receivedByFilter} expensesPerson={paidByFilter} />
      </div>

      <IncomeSection
        entries={filteredIncome}
        total={incomeTotal}
        missing={incomeMissing}
        categories={incomeCategories}
        categoriesMissing={incomeCategoriesMissing}
        styleFor={incomeStyleFor}
        period={period}
        offset={offset}
        person={receivedByFilter}
        onPerson={setReceivedByFilter}
        addIncome={addIncome}
        updateIncome={updateIncome}
        deleteIncome={deleteIncome}
        addCategory={addIncomeCategory}
        renameCategory={renameIncomeCategory}
        moveCategory={moveIncomeCategory}
        deleteCategory={deleteIncomeCategory}
      />

      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Expenses</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
              €{total.toFixed(2)}
            </span>
            {!addingExpense && (
              <Button variant="ghost" onClick={() => setAddingExpense(true)} className="px-3 py-1.5 text-xs">
                <Plus size={14} /> Add expense
              </Button>
            )}
          </div>
        </div>

        <PersonSelector value={paidByFilter} onChange={setPaidByFilter} label="Paid by" />

        {addingExpense && (
          <ExpenseForm
            categories={categories}
            mainCategories={mainCategories}
            subsOf={subsOf}
            onSubmit={addExpense}
            addCategory={addCategory}
            renameCategory={renameCategory}
            moveCategory={moveCategory}
            deleteCategory={deleteCategory}
            styleFor={styleFor}
            onClose={() => setAddingExpense(false)}
          />
        )}

        <CategoryTotals totals={totals} total={total} styleFor={styleFor} />

        <MoneyExplorer
          entries={filteredExpenses}
          dateOf={expenseDate}
          categoryOf={mainOf}
          period={period}
          offset={offset}
          scope={paidByFilter}
          styleFor={styleFor}
          plural="expenses"
          renderDefault={expenseGroups}
          renderEntry={(e) => <ExpenseRow key={e.id} expense={e} names={namesOf} onEdit={setEditingExpense} onDelete={removeExpense} />}
        />

        {editingExpense && (
          <div data-unsaved className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditingExpense(null)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
            >
              <div className="flex justify-between items-center">
                <p className="text-sm font-extrabold text-[var(--color-primary)]">Edit expense</p>
                <button onClick={() => setEditingExpense(null)} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                  <X size={18} />
                </button>
              </div>
              <ExpenseForm
                initial={editingExpense}
                submitLabel="Save"
                categories={categories}
                mainCategories={mainCategories}
                subsOf={subsOf}
                addCategory={addCategory}
                renameCategory={renameCategory}
                moveCategory={moveCategory}
                deleteCategory={deleteCategory}
                styleFor={styleFor}
                onCancel={() => setEditingExpense(null)}
                onClose={() => setEditingExpense(null)}
                onSubmit={(values) => updateExpense(editingExpense.id, values)}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
