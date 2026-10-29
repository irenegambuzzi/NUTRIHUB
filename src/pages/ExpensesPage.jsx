import { useMemo, useState } from 'react'
import { ExpenseForm } from '../components/expenses/ExpenseForm'
import { PurchaseForm } from '../components/expenses/PurchaseForm'
import { SelectExpenses } from '../components/expenses/MergeDialog'
import { MoneyExplorer } from '../components/expenses/MoneyExplorer'
import { ExpenseRow, TripRow } from '../components/expenses/EntryRows'
import { BulkStoreDialog, TripStoreDialog } from '../components/expenses/StoreDialogs'
import { useFlow } from '../hooks/useFlow'
import { ExpenseGroup, PurchaseGroup } from '../components/expenses/ExpenseGroup'
import { CategoryTotals } from '../components/expenses/CategoryTotals'
import { IncomeSection } from '../components/expenses/IncomeSection'
import { MoneySummary } from '../components/expenses/MoneySummary'
import { OrdersSection } from '../components/expenses/OrdersSection'
import { OrderGroupSheet } from '../components/expenses/OrderGroupSheet'
import { PeriodPicker } from '../components/expenses/PeriodPicker'
import { useExpenses } from '../hooks/useExpenses'
import { useIncome } from '../hooks/useIncome'
import { useCategoryColors } from '../hooks/useCategoryColors'
import { useShops } from '../hooks/useShops'
import { incomeCategoryColorStore, orderStore, pantryStore, tripItemStore, tripStore } from '../lib/stores'
import { bundleTrips, categoryTree, groupPurchases, purchasePart, tripShopId } from '../lib/moneyList'
import { askUndoPurchase, reopenTrip } from '../hooks/usePurchase'
import { splitPurchase } from '../hooks/useMerge'
import { askDialog } from '../lib/feedback'
import { expenseDiscountNote, ordersByExpense } from '../lib/orders'
import { groupDiscountNote, groupMembers } from '../lib/orderGroups'
import { PersonSelector } from '../components/expenses/PersonSelector'
import { Button } from '../components/ui/Button'
import { usePersonFilter } from '../lib/personFilter'
import { getPeriodRange, localDateString } from '../lib/expensePeriods'
import { currentExpensesSince } from '../lib/stores'
import { sortNewestFirst } from '../lib/recency'
import { categoryTotals, sumAmounts } from '../lib/moneySummary'
import { Layers, ListChecks, Plus, Store, X } from 'lucide-react'

const expenseDate = (expense) => expense.expense_date

export function ExpensesPage() {
  // Data is loaded from `since`; looking further back moves it earlier.
  const [since, setSince] = useState(currentExpensesSince)
  const { expenses, categories, updateExpense, addCategory, renameCategory, moveCategory, deleteCategory, deleteExpense } = useExpenses(since)
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
  const styleFor = useCategoryColors(categories, { subsFollowMain: true })
  const { byId: shopById, missing: shopsMissing } = useShops()
  const shopOf = (shopId) => (shopId ? shopById.get(shopId) : undefined)
  const incomeStyleFor = useCategoryColors(incomeCategories, { store: incomeCategoryColorStore, table: 'income_category_colors' })
  // Purchases (supabase/014; with supabase/021 and 023): a SHOP trip, a
  // MONEY purchase or merged expenses — one row each in the expense list.
  const flow = useFlow()
  const { rows: trips } = tripStore.useRows()
  const { rows: tripLines } = tripItemStore.useRows()
  const { rows: orders } = orderStore.useRows()
  const tripById = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips])
  const lineByExpense = useMemo(() => new Map(tripLines.filter((l) => l.expense_id).map((l) => [l.expense_id, l])), [tripLines])
  // The HOME item a purchase line went into: its stock unit says "2 box ·
  // 30 pcs each · 60 pcs" (plan 9H).
  const { rows: pantryRows } = pantryStore.useRows()
  const pantryById = useMemo(() => new Map(pantryRows.map((p) => [p.id, p])), [pantryRows])
  const orderByExpense = useMemo(() => ordersByExpense(orders), [orders])
  const discountNote = (expense) => expenseDiscountNote(expense, (id) => orderByExpense.get(id))
  const orderExpenseIds = useMemo(() => new Set(orders.map((o) => o.expense_id).filter(Boolean)), [orders])
  // The expenses of an order group (plan 9I, supabase/028) are one row,
  // like a purchase; its "Order group" sheet opens from there too.
  const orderGroupOf = (expense) => orderByExpense.get(expense.id)?.group_id ?? null
  const orderGroupExpenses = (groupId) => expenses.filter((e) => orderGroupOf(e) === groupId)
  const [groupSheet, setGroupSheet] = useState(null)
  const openGroupButton = (groupId) => (
    <button type="button" onClick={() => setGroupSheet(groupId)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
      <Layers size={12} /> Open the order group
    </button>
  )
  const [tripStoreFor, setTripStoreFor] = useState(null) // a trip
  const [bulkStore, setBulkStore] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const tripOf = (tripId, items) => tripById.get(tripId) ?? { id: tripId, trip_date: items[0].expense_date, shop_id: null, source: 'shop' }
  // Every loaded expense of a purchase (the whole purchase, whatever the
  // filters show).
  const tripExpenses = (tripId) => expenses.filter((e) => e.trip_id === tripId)

  // An expense of a purchase: deleting it alone would leave the rest of
  // the purchase as it is, so undoing the purchase the way it was made is
  // offered first — Reopen (SHOP), Undo the whole purchase (MONEY), or
  // for a merged expense taking it out of the purchase (Split), which
  // never deletes it.
  const removeExpense = async (expense) => {
    if (!expense.trip_id) return deleteExpense(expense.id)
    const source = expense.merged_at ? 'merged' : tripById.get(expense.trip_id)?.source ?? 'shop'
    const name = `"${expense.description || 'This expense'}"`
    const ask = {
      shop: {
        message: `${name} was recorded when a purchase was confirmed. Deleting only the expense leaves that purchase's stock and history as they are.`,
        first: { value: 'reopen', label: 'Reopen purchase', hint: 'Undoes its stock, history and expenses; the items go back to the cart.' },
      },
      money: {
        message: `${name} is part of a purchase entered in MONEY. Deleting only the expense leaves the rest of the purchase (and its HOME stock) as it is.`,
        first: { value: 'undo', label: 'Undo the whole purchase', hint: 'Deletes all its expenses and takes back the stock it added to HOME.' },
      },
      merged: {
        message: `${name} was merged into a purchase. Taking it out keeps it as a single expense, with the store it had before.`,
        first: { value: 'split', label: 'Take it out of the purchase (Split)', hint: 'Nothing is deleted.' },
      },
    }[source]
    const answer = await askDialog({
      title: 'Part of a purchase',
      message: ask.message,
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: ask.first.value,
          options: [ask.first, { value: 'expense', label: 'Delete expense only', hint: source === 'merged' ? 'The expense is deleted; the rest of the purchase stays.' : 'The purchase stays, marked incomplete in Receipts.' }],
        },
      ],
      confirmLabel: 'Continue',
    })
    if (answer?.how === 'reopen') await reopenTrip(expense.trip_id)
    else if (answer?.how === 'undo') await reopenTrip(expense.trip_id, null, 'money')
    else if (answer?.how === 'split') await splitPurchase(expense.trip_id, [expense.id])
    else if (answer?.how === 'expense') await deleteExpense(expense.id)
  }

  // Reopen / Undo purchase / Split for a whole purchase, from its row.
  const undoPurchase = (trip) => {
    const all = tripExpenses(trip.id)
    return askUndoPurchase(trip, { count: all.length, total: purchasePart(all, all).fullTotal })
  }

  const renderExpense = (e) => <ExpenseRow key={e.id} expense={e} names={namesOf} shopOf={shopOf} noteOf={discountNote} onEdit={setEditingExpense} onDelete={removeExpense} />

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
  // One row per purchase (SHOP trip, MONEY purchase or merged expenses,
  // with supabase/021), and the other expenses one row per main category
  // per day. The group with the most recent entry comes first (the newest
  // day, and within a day the one entered last), and the expenses inside a
  // group are newest first too. With a category filter on, a purchase row
  // shows only that category's part "of total €80".
  const subNameOf = (main) => (categoryId) => (categoryId && categoryId !== main?.id ? categories.find((c) => c.id === categoryId)?.name : null)
  const expenseGroups = (entries) =>
    groupPurchases(entries, { mainOf, tripsOn: flow.ready, orderGroupOf }).map((g) => {
      if (g.orderGroupId) {
        const members = groupMembers(g.orderGroupId, orders)
        return (
          <PurchaseGroup
            key={g.key}
            group={g}
            trip={null}
            shop={shopOf(members[0]?.shop_id ?? g.items[0].shop_id)}
            fullTotal={purchasePart(g.items, orderGroupExpenses(g.orderGroupId)).fullTotal}
            mainOf={mainOf}
            subName={(categoryId) => (categoryId && mainOf(categoryId)?.id !== categoryId ? categories.find((c) => c.id === categoryId)?.name : null)}
            styleFor={styleFor}
            onEdit={setEditingExpense}
            onDelete={removeExpense}
            icon={Layers}
            note={groupDiscountNote(members) || null}
            noteOf={discountNote}
            extra={openGroupButton(g.orderGroupId)}
          />
        )
      }
      if (!g.tripId) {
        return (
          <ExpenseGroup
            key={g.key}
            group={g}
            color={styleFor(g.main?.id)}
            styleFor={styleFor}
            shopOf={shopOf}
            subName={subNameOf(g.main)}
            noteOf={discountNote}
            onEdit={setEditingExpense}
            onDelete={removeExpense}
          />
        )
      }
      const trip = tripOf(g.tripId, g.items)
      const all = tripExpenses(g.tripId)
      return (
        <PurchaseGroup
          key={g.key}
          group={g}
          trip={trip}
          shop={shopOf(tripShopId(all.length ? all : g.items, tripById.get(g.tripId)))}
          fullTotal={purchasePart(g.items, all).fullTotal}
          mainOf={mainOf}
          subName={(categoryId) => (categoryId && mainOf(categoryId)?.id !== categoryId ? categories.find((c) => c.id === categoryId)?.name : null)}
          styleFor={styleFor}
          lineOf={(e) => lineByExpense.get(e.id) ?? null}
          itemOf={(line) => pantryById.get(line.pantry_item_id) ?? null}
          onEdit={setEditingExpense}
          onDelete={removeExpense}
          onChangeStore={setTripStoreFor}
          onUndo={undoPurchase}
          onSplitMerged={(t) => splitPurchase(t.id)}
        />
      )
    })

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
            {!addingExpense && !selecting && flow.ready && (
              <Button variant="ghost" onClick={() => setSelecting(true)} className="px-3 py-1.5 text-xs">
                <ListChecks size={14} /> Select
              </Button>
            )}
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
          <PurchaseForm
            expenseCategories={categories}
            mainCategories={mainCategories}
            subsOf={subsOf}
            addCategory={addCategory}
            renameCategory={renameCategory}
            moveCategory={moveCategory}
            deleteCategory={deleteCategory}
            styleFor={styleFor}
            onClose={() => setAddingExpense(false)}
          />
        )}

        <CategoryTotals totals={totals} total={total} styleFor={styleFor} />

        {selecting ? (
          <SelectExpenses
            expenses={sortNewestFirst(filteredExpenses, expenseDate)}
            orderExpenseIds={orderExpenseIds}
            names={namesOf}
            shopOf={shopOf}
            trips={trips}
            allExpenses={expenses}
            onDone={() => setSelecting(false)}
          />
        ) : (
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
                    bundleTrips(items, orderGroupOf).map((part) =>
                      part.entry ? (
                        renderExpense(part.entry)
                      ) : part.orderGroupId ? (
                        <TripRow
                          key={part.key}
                          part={part}
                          trip={null}
                          shop={shopOf(groupMembers(part.orderGroupId, orders)[0]?.shop_id ?? part.items[0].shop_id)}
                          fullTotal={purchasePart(part.items, orderGroupExpenses(part.orderGroupId)).fullTotal}
                          renderEntry={renderExpense}
                          icon={Layers}
                          note={groupDiscountNote(groupMembers(part.orderGroupId, orders)) || null}
                          extra={openGroupButton(part.orderGroupId)}
                        />
                      ) : (
                        <TripRow
                          key={part.key}
                          part={part}
                          trip={tripOf(part.tripId, part.items)}
                          shop={shopOf(tripShopId(part.items, tripById.get(part.tripId)))}
                          fullTotal={purchasePart(part.items, tripExpenses(part.tripId)).fullTotal}
                          renderEntry={renderExpense}
                          onChangeTripStore={setTripStoreFor}
                        />
                      )
                    )
                : null
            }
          />
        )}

        {tripStoreFor && (
          <TripStoreDialog
            trip={tripStoreFor}
            count={expenses.filter((e) => e.trip_id === tripStoreFor.id).length}
            current={tripShopId(expenses.filter((e) => e.trip_id === tripStoreFor.id), tripStoreFor)}
            flowReady={flow.ready}
            onClose={() => setTripStoreFor(null)}
          />
        )}
        {groupSheet && <OrderGroupSheet groupId={groupSheet} shopById={shopById} onClose={() => setGroupSheet(null)} />}
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
