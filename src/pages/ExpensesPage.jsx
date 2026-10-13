import { useMemo, useState } from 'react'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { MoneyExplorer } from '../components/expenses/MoneyExplorer'
import { ExpenseRow, TripRow } from '../components/expenses/EntryRows'
import { BulkStoreDialog, TripStoreDialog } from '../components/expenses/StoreDialogs'
import { useFlow } from '../hooks/useFlow'
import { ExpenseGroup } from '../components/expenses/ExpenseGroup'
import { CategoryTotals } from '../components/expenses/CategoryTotals'
import { IncomeSection } from '../components/expenses/IncomeSection'
import { MoneySummary } from '../components/expenses/MoneySummary'
import { OrdersSection } from '../components/expenses/OrdersSection'
import { PeriodPicker } from '../components/expenses/PeriodPicker'
import { useExpenses } from '../hooks/useExpenses'
import { useIncome } from '../hooks/useIncome'
import { useCategoryColors } from '../hooks/useCategoryColors'
import { useShops } from '../hooks/useShops'
import { incomeCategoryColorStore, tripStore } from '../lib/stores'
import { bundleTrips, categoryTree, tripShopId } from '../lib/moneyList'
import { reopenTrip } from '../hooks/usePurchase'
import { askDialog } from '../lib/feedback'
import { PersonSelector } from '../components/expenses/PersonSelector'
import { Button } from '../components/ui/Button'
import { usePersonFilter } from '../lib/personFilter'
import { getPeriodRange, localDateString } from '../lib/expensePeriods'
import { currentExpensesSince } from '../lib/stores'
import { newestFirst, newestGroupFirst } from '../lib/recency'
import { categoryTotals, sumAmounts } from '../lib/moneySummary'
import { Plus, Store, X } from 'lucide-react'

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
  const { byId: shopById, missing: shopsMissing } = useShops()
  const shopOf = (shopId) => (shopId ? shopById.get(shopId) : undefined)
  const incomeStyleFor = useCategoryColors(incomeCategories, { store: incomeCategoryColorStore, table: 'income_category_colors' })
  // Shopping trips (supabase/014): with supabase/021 an expense list shows
  // each trip's expenses as one row per budget category.
  const flow = useFlow()
  const { rows: trips } = tripStore.useRows()
  const tripById = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips])
  const [tripStoreFor, setTripStoreFor] = useState(null) // a trip
  const [bulkStore, setBulkStore] = useState(false)
  const tripOf = (tripId, items) => tripById.get(tripId) ?? { id: tripId, trip_date: items[0].expense_date, shop_id: null }

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

  const renderExpense = (e) => <ExpenseRow key={e.id} expense={e} names={namesOf} shopOf={shopOf} onEdit={setEditingExpense} onDelete={removeExpense} />

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
  // shopping trip). The group with the most recent entry comes first (the
  // newest day, and within a day the one entered last), and the expenses
  // inside a group are newest first too. With supabase/021 a shopping
  // trip is its own row in each budget category it touches ("Conad ·
  // 16/10 · 10 items"), so every category total stays right.
  const expenseGroups = (entries) => {
    const map = new Map()
    for (const e of [...entries].sort(newestFirst(expenseDate))) {
      const main = mainOf(e.category_id)
      const tripId = flow.ready && e.trip_id ? e.trip_id : null
      const key = tripId ? `trip|${tripId}|${main?.id ?? 'none'}` : `${e.expense_date}|${main?.id ?? 'none'}`
      if (!map.has(key)) map.set(key, { key, date: e.expense_date, main, items: [], total: 0, tripId })
      const g = map.get(key)
      g.items.push(e)
      g.total += Number(e.amount || 0)
    }
    return [...map.values()]
      .sort(newestGroupFirst(expenseDate, (g) => g.items))
      .map((g) => (
        <ExpenseGroup
          key={g.key}
          group={g}
          trip={g.tripId ? tripOf(g.tripId, g.items) : null}
          tripShop={g.tripId ? shopOf(tripShopId(g.items, tripById.get(g.tripId))) : null}
          onChangeTripStore={setTripStoreFor}
          color={styleFor(g.main?.id)}
          styleFor={styleFor}
          shopOf={shopOf}
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

      <OrdersSection
        person={paidByFilter}
        onPerson={setPaidByFilter}
        shopById={shopById}
        categories={categories}
        mainCategories={mainCategories}
        subsOf={subsOf}
        namesOf={namesOf}
        addCategory={addCategory}
        renameCategory={renameCategory}
        moveCategory={moveCategory}
        deleteCategory={deleteCategory}
        styleFor={styleFor}
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

        {flow.ready && (
          <button type="button" onClick={() => setBulkStore(true)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
            <Store size={12} /> Set the store of several expenses…
          </button>
        )}

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
          shopById={shopById}
          shopsMissing={shopsMissing}
          renderDefault={expenseGroups}
          renderEntry={renderExpense}
          renderEntries={
            flow.ready
              ? (items) =>
                  bundleTrips(items).map((part) =>
                    part.entry ? (
                      renderExpense(part.entry)
                    ) : (
                      <TripRow
                        key={part.key}
                        part={part}
                        trip={tripOf(part.tripId, part.items)}
                        shop={shopOf(tripShopId(part.items, tripById.get(part.tripId)))}
                        renderEntry={renderExpense}
                        onChangeTripStore={setTripStoreFor}
                      />
                    )
                  )
              : null
          }
        />

        {tripStoreFor && (
          <TripStoreDialog
            trip={tripStoreFor}
            count={expenses.filter((e) => e.trip_id === tripStoreFor.id).length}
            current={tripShopId(expenses.filter((e) => e.trip_id === tripStoreFor.id), tripStoreFor)}
            flowReady={flow.ready}
            onClose={() => setTripStoreFor(null)}
          />
        )}
        {bulkStore && <BulkStoreDialog expenses={filteredExpenses} shopOf={shopOf} names={namesOf} onClose={() => setBulkStore(false)} />}

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
