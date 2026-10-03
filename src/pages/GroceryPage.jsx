import { useState } from 'react'
import { Receipt, ShoppingCart, Sparkles, Wallet, X, Users, Microwave } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { AddItemForm } from '../components/grocery/AddItemForm'
import { BudgetCard } from '../components/grocery/BudgetCard'
import { GroceryItemTile } from '../components/grocery/GroceryItemTile'
import { ReceiptsView } from '../components/grocery/ReceiptsView'
import { QuickAdd } from '../components/grocery/QuickAdd'
import { ShoppingMode } from '../components/grocery/ShoppingMode'
import { cn } from '../lib/cn'
import { useGroceryList } from '../hooks/useGroceryList'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { PAID_BY_OPTIONS } from '../data/constants'
import { inventoryCategoryColor } from '../lib/categoryColors'
import { restockReason, syncShoppingForItem } from '../lib/inventory'
import { attempt } from '../lib/db'
import { money } from '../lib/pricing'

// List or shopping mode, remembered on this phone (Receipts isn't).
const VIEW_KEY = 'nutrihub-grocery-view'
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'shop' ? 'shop' : 'list'
  } catch {
    return 'list'
  }
}
function rememberView(view) {
  if (view === 'receipts') return
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Not remembered; nothing else changes.
  }
}

const GROCERY_SORTS = {
  priority: 'Priority: Out → Low → Expired → New',
  low: 'Low stock first',
  new: 'New items first',
  az: 'Name A–Z',
  price: 'Price: highest first',
  recent: 'Recently added',
}

export function GroceryPage() {
  const {
    items,
    addItem,
    updatePricing,
    updatePayer,
    deleteItem,
    clearCompleted,
    pantryItems,
    pantryByName,
    pantryFor,
    reasonOf,
    totalOf,
    costOf,
    sortItems,
    groceryItems,
    durableItems,
    listTotal,
    boughtTotal,
    payerTotals,
    unpricedCount,
    unknownTotalCount,
    groceryBudget,
    saveGroceryBudget,
    budgetActive,
    overBudget,
    budgetPlan,
    checkOff,
  } = useGroceryList()
  const { parents, subsByParent, categoryName } = useInventoryCategories()

  const [view, setViewState] = useState(readView)
  const [fullForm, setFullForm] = useState(null) // null | name to start the full form with
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [sortMode, setSortMode] = useState('priority')
  const [bulkScope, setBulkScope] = useState('restock')
  const [syncing, setSyncing] = useState(false)

  const inCategory = (i) => selectedCategory === 'All' || i.category_id === selectedCategory
  const filteredItems = budgetPlan
    ? [...budgetPlan.order, ...sortItems(groceryItems.filter((i) => i.completed), 'recent')].filter(inCategory)
    : sortItems(groceryItems.filter(inCategory), sortMode)
  const filteredDurables = sortItems(durableItems.filter(inCategory), budgetPlan ? 'recent' : sortMode)
  const durableTotal = durableItems.filter((i) => !i.completed).reduce((sum, i) => sum + costOf(i), 0)
  // Only show chips for categories that actually have items on the list.
  const listCategories = parents.filter((p) => items.some((i) => i.category_id === p.id))
  const needsBuying = pantryItems.filter((p) => restockReason(p))
  const filteredTotal = [...filteredItems, ...filteredDurables].reduce((sum, item) => sum + costOf(item), 0)
  const completedCount = items.filter((i) => i.completed).length

  // Targets for "Paid by for all …".
  const bulkTargets = items.filter(
    (i) => !i.completed && (bulkScope === 'all' || (bulkScope === 'new' ? reasonOf(i) === 'new' : ['out', 'low', 'expired'].includes(reasonOf(i))))
  )

  const setView = (next) => {
    setViewState(next)
    rememberView(next)
  }

  const handleAddNeeded = async () => {
    setSyncing(true)
    // Safe to repeat: items already on the list are skipped.
    await attempt(async () => {
      for (const item of needsBuying) await syncShoppingForItem(item)
    })
    setSyncing(false)
  }

  const quickAdd = (
    <QuickAdd
      items={items}
      pantryItems={pantryItems}
      parents={parents}
      subsByParent={subsByParent}
      categoryName={categoryName}
      addItem={addItem}
      updatePricing={updatePricing}
      totalFor={totalOf}
      onMoreOptions={setFullForm}
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Grocery List</h2>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
          {money(filteredTotal)}
        </span>
      </div>

      <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 w-fit text-xs font-bold">
        <button
          onClick={() => setView('list')}
          className={cn('px-4 py-1.5 rounded-full transition-all duration-200', view === 'list' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]')}
        >
          List
        </button>
        <button
          onClick={() => setView('shop')}
          className={cn(
            'px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5',
            view === 'shop' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          <ShoppingCart size={13} /> Shop
        </button>
        <button
          onClick={() => setView('receipts')}
          className={cn(
            'px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5',
            view === 'receipts' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          <Receipt size={13} /> Receipts
        </button>
      </div>

      {view === 'list' ? (
        <>
          <BudgetCard
            budget={groceryBudget}
            listTotal={listTotal}
            boughtTotal={boughtTotal}
            payerTotals={payerTotals}
            overBudget={overBudget}
            unpricedCount={unpricedCount}
            unknownTotalCount={unknownTotalCount}
            onSave={saveGroceryBudget}
          />

          <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
            <button
              onClick={() => setSelectedCategory('All')}
              className={cn(
                'px-4 py-2 rounded-full border whitespace-nowrap font-bold transition-all duration-200',
                selectedCategory === 'All'
                  ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white shadow-sm'
                  : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)]'
              )}
            >
              All
            </button>
            {listCategories.map(({ id: cat, name: catName }) => {
              const c = inventoryCategoryColor(cat)
              const active = selectedCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'px-4 py-2 rounded-full border whitespace-nowrap font-bold transition-all duration-200 flex items-center gap-1.5',
                    active ? cn(c.solid, 'border-transparent text-white shadow-sm') : cn(c.bg, c.border, c.text)
                  )}
                >
                  <CategoryIcon category={cat} size={14} />
                  {catName}
                </button>
              )
            })}
          </div>

          {quickAdd}
          {fullForm !== null && (
            <div className="space-y-1">
              <div className="flex justify-between items-center px-1">
                <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add with all options</p>
                <button onClick={() => setFullForm(null)} aria-label="Close the full form" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                  <X size={14} />
                </button>
              </div>
              <AddItemForm
                key={fullForm}
                initialName={fullForm}
                parents={parents}
                subsByParent={subsByParent}
                categoryName={categoryName}
                pantryByName={pantryByName}
                onAdd={addItem}
                onAdded={() => setFullForm(null)}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {budgetActive ? (
              <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Wallet size={12} /> Budget on: sorted by priority (Out → Low → Expired → New), what fits first.
              </p>
            ) : (
              <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className="text-xs w-auto" aria-label="Sort">
                {Object.entries(GROCERY_SORTS).map(([key, label]) => (
                  <option key={key} value={key}>
                    Sort: {label}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex flex-wrap gap-3">
              {needsBuying.length > 0 && (
                <button
                  onClick={handleAddNeeded}
                  disabled={syncing}
                  className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)] disabled:opacity-50"
                >
                  <Sparkles size={13} /> {syncing ? 'Adding…' : `Add all ${needsBuying.length} low / out / expired pantry items`}
                </button>
              )}
              {completedCount > 0 && (
                <button
                  onClick={clearCompleted}
                  className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-muted)] hover:text-red-400 transition"
                >
                  <X size={13} /> Clear {completedCount} checked item{completedCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>

          {items.some((i) => !i.completed) && (
            <div className="flex flex-wrap items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl px-3 py-2">
              <Users size={13} className="text-[var(--color-text-muted)]" />
              <span className="text-[11px] text-[var(--color-text-muted)]">Paid by for</span>
              <Select value={bulkScope} onChange={(e) => setBulkScope(e.target.value)} className="text-[11px] w-auto py-1" aria-label="Paid by scope">
                <option value="restock">Out / Low / Expired items</option>
                <option value="new">New items</option>
                <option value="all">All open items</option>
              </Select>
              <span className="text-[11px] text-[var(--color-text-muted)]">({bulkTargets.length}) →</span>
              <div className="flex gap-1">
                {PAID_BY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={bulkTargets.length === 0}
                    onClick={() => updatePayer(bulkTargets, o.value)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-bold border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-accent)] hover:text-white hover:border-transparent disabled:opacity-40"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredItems.length === 0 && filteredDurables.length === 0 ? (
            <Card className="text-center rounded-3xl">
              <p className="text-xs text-[var(--color-text-muted)]">Nothing here yet — add your first item above.</p>
            </Card>
          ) : filteredItems.length === 0 ? null : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredItems.map((item) => (
                <GroceryItemTile
                  key={item.id}
                  item={item}
                  reason={reasonOf(item)}
                  pack={pantryFor(item)}
                  total={totalOf(item)}
                  budgetMark={overBudget ? budgetPlan?.marks.get(item.id) : undefined}
                  categoryName={categoryName}
                  onToggle={checkOff}
                  onDelete={deleteItem}
                  onUpdatePricing={updatePricing}
                  onUpdatePayer={updatePayer}
                />
              ))}
            </div>
          )}

          {filteredDurables.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-border)] pt-3">
                <p className="text-xs font-bold text-[var(--color-primary)] uppercase flex items-center gap-1.5">
                  <Microwave size={13} /> Home & Appliances
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {money(durableTotal)} to buy · not in the grocery budget · logged under Home & Appliances, not added to the pantry
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredDurables.map((item) => (
                  <GroceryItemTile
                    key={item.id}
                    item={item}
                    reason={reasonOf(item)}
                    pack={pantryFor(item)}
                    total={totalOf(item)}
                    categoryName={categoryName}
                    onToggle={checkOff}
                    onDelete={deleteItem}
                    onUpdatePricing={updatePricing}
                    onUpdatePayer={updatePayer}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : view === 'shop' ? (
        <>
          {quickAdd}
          <ShoppingMode
            items={items}
            parents={parents}
            categoryName={categoryName}
            totalOf={totalOf}
            costOf={costOf}
            budget={groceryBudget}
            onCheck={checkOff}
          />
        </>
      ) : (
        <ReceiptsView />
      )}
    </div>
  )
}
