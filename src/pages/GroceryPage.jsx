import { useCallback, useMemo, useState } from 'react'
import { Plus, Check, Trash2, X, Pencil, Receipt, Sparkles, Wallet, AlertTriangle, Wand2, Users, Microwave } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { useExpenses } from '../hooks/useExpenses'
import { usePantryItems } from '../hooks/usePantryItems'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { useBudget } from '../hooks/useBudget'
import { DEFAULT_UNIT, PACKAGING_UNITS, PAID_BY_OPTIONS, SUGGESTED_UNITS, UNIT_GROUPS, UNIT_VALUES } from '../data/constants'
import { inventoryCategoryColor } from '../lib/categoryColors'
import { isDurable, restockReason, roundHalf, syncShoppingForItem } from '../lib/inventory'
import { RESTOCK_LABELS, STATUS_STYLES } from '../lib/inventoryStyles'
import { guessCategory } from '../lib/categoryGuess'
import { formatUnitPrice, lineTotal, money, priceUnitOptions } from '../lib/pricing'
import { PriceFields } from '../components/inventory/PriceFields'

const EXTRA_PACKAGING_UNITS = PACKAGING_UNITS.filter((u) => !UNIT_VALUES.includes(u))

function UnitOptions() {
  return (
    <>
      {UNIT_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.value}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Packaging">
        {EXTRA_PACKAGING_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </optgroup>
    </>
  )
}

const normName = (s) => (s || '').trim().toLowerCase()
const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || 'Shared'

// Reason order for each sort; 'stocked' = in the pantry and fine.
// Budget planning always uses PRIORITY, whatever the chosen sort.
const PRIORITY = ['out', 'low', 'expired', 'new', 'stocked']
const REASON_ORDERS = {
  priority: PRIORITY,
  low: ['low', 'out', 'expired', 'new', 'stocked'],
  new: ['new', 'out', 'low', 'expired', 'stocked'],
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
  const { items, addItem, toggleComplete, updatePricing, updatePayer, deleteItem, clearCompleted } = useGroceryItems()
  const { expenses, deleteExpenses } = useExpenses()
  const { items: pantryItems } = usePantryItems()
  const { parents, subsByParent, categoryName } = useInventoryCategories()
  const { groceryBudget, saveGroceryBudget } = useBudget()

  const [view, setView] = useState('list')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [sortMode, setSortMode] = useState('priority')
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [priceDraft, setPriceDraft] = useState({ price: '', price_qty: '1', price_unit: '' })
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(DEFAULT_UNIT)
  const [payer, setPayer] = useState('shared')
  const [bulkScope, setBulkScope] = useState('restock')
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  const pantryById = useMemo(() => new Map(pantryItems.map((p) => [p.id, p])), [pantryItems])
  const pantryByName = useMemo(() => new Map(pantryItems.map((p) => [normName(p.name), p])), [pantryItems])

  const pantryFor = useCallback((g) => pantryById.get(g.pantry_item_id) || pantryByName.get(normName(g.name)), [pantryById, pantryByName])

  // Why each entry is on the list, worked out live from its pantry item.
  const reasonOf = useMemo(() => {
    const cache = new Map()
    for (const g of items) {
      const p = pantryFor(g)
      cache.set(g.id, isDurable(g) ? 'durable' : p ? restockReason(p) || 'stocked' : 'new')
    }
    return (g) => cache.get(g.id) || 'new'
  }, [items, pantryFor])

  // What each line really costs: unit price × quantity bought.
  const totalOf = useCallback((g) => lineTotal(g, pantryFor(g)), [pantryFor])

  const sortItems = useCallback(
    (list, mode) => {
      const order = REASON_ORDERS[mode]
      const rank = (g) => (order ? order.indexOf(reasonOf(g)) : 0)
      const tie =
        {
          az: (a, b) => a.name.localeCompare(b.name),
          price: (a, b) => totalOf(b) - totalOf(a),
        }[mode] || ((a, b) => b.created_at.localeCompare(a.created_at))
      // Checked-off items always sink to the bottom.
      return [...list].sort((a, b) => Number(a.completed) - Number(b.completed) || rank(a) - rank(b) || tie(a, b))
    },
    [reasonOf, totalOf]
  )

  // Durable purchases (Home & Appliances) get their own section and stay
  // out of the grocery totals and budget.
  const groceryItems = useMemo(() => items.filter((i) => !isDurable(i)), [items])
  const durableItems = useMemo(() => items.filter(isDurable), [items])

  const listTotal = groceryItems.reduce((sum, i) => sum + totalOf(i), 0)
  const boughtTotal = groceryItems.filter((i) => i.completed).reduce((sum, i) => sum + totalOf(i), 0)
  const payerTotals = PAID_BY_OPTIONS.map((o) => ({
    ...o,
    total: groceryItems.filter((i) => (i.payer || 'shared') === o.value).reduce((sum, i) => sum + totalOf(i), 0),
  }))
  const unpricedCount = groceryItems.filter((i) => !i.completed && !(Number(i.price) > 0)).length

  // Budget planning ignores the chosen sort: open items are taken by need
  // (Out → Low → Expired → New; cheaper first within the same need, so
  // more essentials fit) and each one is kept if it still fits in what's
  // left of the budget after what's already been bought.
  const budgetActive = groceryBudget != null
  const overBudget = budgetActive && listTotal > groceryBudget
  const budgetPlan = useMemo(() => {
    if (!budgetActive) return null
    const open = groceryItems
      .filter((i) => !i.completed)
      .sort((a, b) => PRIORITY.indexOf(reasonOf(a)) - PRIORITY.indexOf(reasonOf(b)) || totalOf(a) - totalOf(b))
    let remaining = groceryBudget - boughtTotal
    const marks = new Map()
    for (const g of open) {
      const cost = totalOf(g)
      if (cost <= remaining) {
        remaining -= cost
        marks.set(g.id, 'fits')
      } else marks.set(g.id, 'over')
    }
    // Display order while a budget is set: what fits first, then the rest,
    // each in priority order; checked-off items last.
    const order = [...open.filter((g) => marks.get(g.id) === 'fits'), ...open.filter((g) => marks.get(g.id) === 'over')]
    return { marks, order, remaining }
  }, [budgetActive, groceryBudget, boughtTotal, groceryItems, reasonOf, totalOf])

  const inCategory = (i) => selectedCategory === 'All' || i.category_id === selectedCategory
  const filteredItems = budgetPlan
    ? [...budgetPlan.order, ...sortItems(groceryItems.filter((i) => i.completed), 'recent')].filter(inCategory)
    : sortItems(groceryItems.filter(inCategory), sortMode)
  const filteredDurables = sortItems(durableItems.filter(inCategory), budgetPlan ? 'recent' : sortMode)
  const durableTotal = durableItems.filter((i) => !i.completed).reduce((sum, i) => sum + totalOf(i), 0)
  // Only show chips for categories that actually have items on the list.
  const listCategories = parents.filter((p) => items.some((i) => i.category_id === p.id))
  const needsBuying = pantryItems.filter((p) => restockReason(p))
  const filteredTotal = [...filteredItems, ...filteredDurables].reduce((sum, item) => sum + totalOf(item), 0)
  const completedCount = items.filter((i) => i.completed).length

  // Targets for "Paid by for all …".
  const bulkTargets = items.filter(
    (i) => !i.completed && (bulkScope === 'all' || (bulkScope === 'new' ? reasonOf(i) === 'new' : ['out', 'low', 'expired'].includes(reasonOf(i))))
  )

  // Every checked-off grocery item logs a "Groceries" expense — reuse
  // that history both to remember prices and to build receipts.
  const groceryExpenses = useMemo(() => expenses.filter((e) => e.expense_categories?.name === 'Groceries'), [expenses])

  const receipts = useMemo(() => {
    const map = new Map()
    for (const e of groceryExpenses) {
      const list = map.get(e.expense_date) || []
      list.push(e)
      map.set(e.expense_date, list)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, list, total: list.reduce((sum, e) => sum + Number(e.amount || 0), 0) }))
  }, [groceryExpenses])

  const handleClearCompleted = () => {
    if (window.confirm(`Remove ${completedCount} checked item${completedCount === 1 ? '' : 's'} from the list?`)) {
      clearCompleted()
    }
  }

  const handleAddNeeded = async () => {
    setSyncing(true)
    for (const item of needsBuying) await syncShoppingForItem(item)
    setSyncing(false)
  }

  // Manual add only: guess category/subcategory from the name (or take
  // them from the pantry item of the same name) until the user picks one.
  const handleNameChange = (value) => {
    setName(value)
    if (categoryTouched) return
    const known = pantryByName.get(normName(value))
    const guess = known ? { categoryId: known.category_id, subcategoryId: known.subcategory_id } : guessCategory(value)
    if (guess?.categoryId && parents.some((p) => p.id === guess.categoryId)) {
      // Only use a sub-category that actually exists in the database.
      const subExists = (subsByParent.get(guess.categoryId) || []).some((sub) => sub.id === guess.subcategoryId)
      setCategoryId(guess.categoryId)
      setSubcategoryId(subExists ? guess.subcategoryId : '')
      setSuggested(true)
      if (known) {
        setUnit(known.unit)
        if (Number(known.price) > 0 && !priceDraft.price) {
          setPriceDraft({ price: String(known.price), price_qty: String(known.price_qty || 1), price_unit: known.price_unit || known.unit })
        }
      }
    } else {
      setSuggested(false)
    }
  }

  const formCategory = categoryId || parents[0]?.id || ''
  const formSubs = subsByParent.get(formCategory) || []
  const suggestedUnits = SUGGESTED_UNITS[formCategory] || []
  const formQuantity = roundHalf(quantity) || 1
  const formPack = pantryByName.get(normName(name))
  const formPriceUnits = priceUnitOptions({ unit }, formPack)
  const formPriceUnit = formPriceUnits.includes(priceDraft.price_unit) ? priceDraft.price_unit : unit

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const known = pantryByName.get(normName(name))
    const { error } = await addItem({
      name: name.trim(),
      categoryId: formCategory || null,
      subcategoryId: subcategoryId || null,
      price: parseFloat(priceDraft.price) || 0,
      priceQty: parseFloat(priceDraft.price) > 0 ? parseFloat(priceDraft.price_qty) || 1 : null,
      priceUnit: parseFloat(priceDraft.price) > 0 ? formPriceUnit : null,
      quantity: formQuantity,
      unit,
      payer,
      pantryItemId: known?.id ?? null,
    })
    if (error) {
      setMessage('Could not save the item: ' + error.message)
      return
    }
    setMessage('')
    setName('')
    setPriceDraft({ price: '', price_qty: '1', price_unit: '' })
    setQuantity('1')
    setCategoryTouched(false)
    setSuggested(false)
  }

  const handleSaveBudget = async (amount) => {
    const { error } = await saveGroceryBudget(amount)
    setMessage(error ? 'Could not save the budget: ' + error.message : '')
  }

  const handlePayer = async (targets, value) => {
    const { error } = await updatePayer(targets, value)
    if (error) setMessage('Could not save who pays — run supabase/006_backfill_inventory_data.sql in Supabase first. (' + error.message + ')')
  }

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
            onSave={handleSaveBudget}
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

          <form onSubmit={handleAdd}>
            <Card className="space-y-3 rounded-3xl">
              <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => handleNameChange(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={formCategory}
                  onChange={(e) => {
                    setCategoryId(e.target.value)
                    setSubcategoryId('')
                    setCategoryTouched(true)
                    setSuggested(false)
                  }}
                  aria-label="Category"
                >
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={subcategoryId}
                  onChange={(e) => {
                    setSubcategoryId(e.target.value)
                    setCategoryTouched(true)
                    setSuggested(false)
                  }}
                  aria-label="Subcategory"
                >
                  <option value="">No subcategory</option>
                  {formSubs.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </Select>
              </div>
              {suggested && (
                <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5 -mt-1">
                  <Wand2 size={12} className="text-[var(--color-accent)]" /> Category suggested from the name — change it if it's wrong.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="Qty to buy"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  onBlur={() => setQuantity(String(roundHalf(quantity) || 1))}
                  aria-label="Quantity"
                />
                <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
                  <UnitOptions />
                </Select>
              </div>
              <PriceFields
                value={{ ...priceDraft, price_unit: formPriceUnit }}
                onChange={(patch) => setPriceDraft((d) => ({ ...d, ...patch }))}
                unitOptions={formPriceUnits}
                line={{ quantity: formQuantity, unit }}
                pack={formPack}
              />
              {suggestedUnits.length > 0 && !suggestedUnits.includes(unit) && !EXTRA_PACKAGING_UNITS.includes(unit) && (
                <p className={cn('text-[11px] flex items-center gap-1.5 -mt-1', STATUS_STYLES.low.text)}>
                  <AlertTriangle size={12} /> "{unit}" is unusual for {categoryName(formCategory)} (usually {suggestedUnits.join(', ')}).
                </p>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">Paid by</span>
                <PayerPicker value={payer} onChange={setPayer} />
              </div>
              <Button type="submit" className="w-full rounded-2xl">
                <Plus size={16} /> Add to list
              </Button>
            </Card>
          </form>

          {message && <p className="text-xs text-red-400">{message}</p>}

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
                  onClick={handleClearCompleted}
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
                    onClick={() => handlePayer(bulkTargets, o.value)}
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
                  onToggle={(i) => toggleComplete(i, totalOf(i))}
                  onDelete={deleteItem}
                  onUpdatePricing={updatePricing}
                  onUpdatePayer={handlePayer}
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
                    onToggle={(i) => toggleComplete(i, totalOf(i))}
                    onDelete={deleteItem}
                    onUpdatePricing={updatePricing}
                    onUpdatePayer={handlePayer}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <ReceiptsView receipts={receipts} onDeleteReceipt={deleteExpenses} />
      )}
    </div>
  )
}

function PayerPicker({ value, onChange, size = 'md' }) {
  return (
    <div className="flex gap-1 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-full p-0.5">
      {PAID_BY_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onChange(o.value)
          }}
          className={cn(
            'rounded-full font-bold transition-all',
            size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-3 py-1 text-[11px]',
            value === o.value ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Budget limit for the whole list (stored in budget_settings), with the
// total split by who pays.
function BudgetCard({ budget, listTotal, boughtTotal, payerTotals, overBudget, unpricedCount, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const pct = budget ? Math.min(listTotal / budget, 1) : 0

  const save = (amount) => {
    onSave(amount)
    setEditing(false)
  }

  return (
    <Card className="space-y-2.5">
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase flex items-center gap-1.5">
          <Wallet size={13} /> Budget
        </p>
        {!editing && (
          <button
            onClick={() => {
              setDraft(budget ? String(budget) : '')
              setEditing(true)
            }}
            className="text-[11px] font-bold text-[var(--color-accent)] flex items-center gap-1"
          >
            <Pencil size={10} /> {budget ? 'Change' : 'Set a budget'}
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save(parseFloat(draft) || 0)
          }}
          className="flex flex-wrap gap-2"
        >
          <Input type="number" min="0" step="1" autoFocus placeholder="e.g. 100" value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 min-w-24" />
          <Button type="submit" className="px-3">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => save(0)} className="px-3">
            No budget limit
          </Button>
        </form>
      ) : (
        <>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-[var(--color-text-soft)]">
              List total <b className="font-mono text-[var(--color-text)]">{money(listTotal)}</b>
              {boughtTotal > 0 && <span className="text-[var(--color-text-muted)]"> · bought {money(boughtTotal)}</span>}
            </span>
            <span className="text-[var(--color-text-muted)]">{budget ? `of ${money(budget)}` : 'No budget limit'}</span>
          </div>
          {budget != null && (
            <div className="h-1.5 rounded-full bg-[var(--color-surface-soft)] overflow-hidden">
              <div
                className={cn('h-full rounded-full', overBudget ? STATUS_STYLES.out.bar : pct > 0.85 ? STATUS_STYLES.low.bar : STATUS_STYLES.ok.bar)}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          )}
          {overBudget && (
            <p className={cn('text-[11px] flex items-start gap-1.5', STATUS_STYLES.out.text)}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Over budget by {money(listTotal - budget)}. Items marked "Buy first" fit the budget, chosen by need: Out of stock, then Low stock, Expired,
              and New items last.
            </p>
          )}
          {budget != null && unpricedCount > 0 && (
            <p className={cn('text-[11px] flex items-start gap-1.5', STATUS_STYLES.low.text)}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {unpricedCount} item{unpricedCount === 1 ? ' has' : 's have'} no price yet, so the budget can't count {unpricedCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-2">
        {payerTotals.map((p) => (
          <span key={p.value}>
            {p.label} <b className="font-mono text-[var(--color-text-soft)]">{money(p.total)}</b>
          </span>
        ))}
      </div>
    </Card>
  )
}

function ReceiptsView({ receipts, onDeleteReceipt }) {
  if (receipts.length === 0) {
    return (
      <Card className="text-center rounded-3xl">
        <p className="text-xs text-[var(--color-text-muted)]">No receipts yet — they appear here as you check off priced items.</p>
      </Card>
    )
  }

  const handleDelete = (date, list) => {
    if (window.confirm(`Delete the receipt from ${new Date(date).toLocaleDateString('en-GB')} (${list.length} item${list.length === 1 ? '' : 's'})?`)) {
      onDeleteReceipt(list.map((e) => e.id))
    }
  }

  return (
    <div className="space-y-3">
      {receipts.map(({ date, list, total }) => (
        <Card key={date} className="rounded-3xl">
          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 mb-2">
            <span className="text-xs font-bold text-[var(--color-text)]">
              {new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
              <button onClick={() => handleDelete(date, list)} className="text-[var(--color-icon-muted)] hover:text-red-400 transition">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {list.map((e) => (
              <div key={e.id} className="flex justify-between text-xs text-[var(--color-text-soft)]">
                <span>{e.description || 'Item'}</span>
                <span className="font-mono">€{Number(e.amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function GroceryItemTile({ item, reason, pack, total, budgetMark, categoryName, onToggle, onDelete, onUpdatePricing, onUpdatePayer }) {
  const c = inventoryCategoryColor(item.category_id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const label = RESTOCK_LABELS[reason]
  const unitPrice = formatUnitPrice(item)
  const priceUnits = priceUnitOptions(item, pack)

  const startEditing = () => {
    setDraft({
      quantity: String(item.quantity ?? 1),
      price: Number(item.price) > 0 ? String(item.price) : '',
      price_qty: String(item.price_qty || 1),
      price_unit: item.price_unit || item.unit,
    })
    setEditing(true)
  }

  const save = async () => {
    const price = parseFloat(draft.price) || 0
    const patch = {
      quantity: roundHalf(draft.quantity) || 1,
      price,
      price_qty: price > 0 ? parseFloat(draft.price_qty) || 1 : null,
      price_unit: price > 0 ? draft.price_unit : null,
    }
    setEditing(false)
    await onUpdatePricing(item, patch, lineTotal({ ...item, ...patch }, pack))
  }

  // Background follows why the item is here: red Out, yellow Low,
  // purple Expired, blue New; items already in stock keep their
  // category colour.
  const tone = STATUS_STYLES[reason]?.tile ?? cn(c.bg, c.border)

  return (
    <div
      className={cn(
        'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
        item.completed ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : tone,
        budgetMark === 'over' && 'opacity-60'
      )}
    >
      <button
        onClick={() => window.confirm(`Remove "${item.name}" from the list?`) && onDelete(item.id)}
        className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-red-400 transition p-1 z-10"
      >
        <Trash2 size={13} />
      </button>

      <button onClick={() => onToggle(item)} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
        <div
          className={cn(
            'w-9 h-9 rounded-2xl flex items-center justify-center mb-2 transition-all duration-200',
            item.completed ? 'bg-[var(--color-primary)] text-white' : cn(c.solid, 'text-white')
          )}
        >
          {item.completed ? <Check size={18} /> : <CategoryIcon category={item.category_id} size={18} />}
        </div>

        <p className={cn('text-sm font-bold leading-tight pr-4', item.completed ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          {item.quantity} {item.unit} · {categoryName(item.category_id)}
        </p>
      </button>

      {!item.completed && (label || budgetMark) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {label && <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full', label.className)}>{label.label}</span>}
          {budgetMark === 'fits' && <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full', STATUS_STYLES.ok.badge)}>Buy first</span>}
          {budgetMark === 'over' && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[var(--color-surface-soft)] text-[var(--color-text-muted)]">Over budget</span>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">Qty</span>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={draft.quantity}
              onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              className="text-xs p-2"
              aria-label="Quantity"
            />
            <span className="text-[10px] text-[var(--color-text-muted)]">{item.unit}</span>
          </div>
          <PriceFields
            compact
            value={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            unitOptions={priceUnits}
            line={{ quantity: roundHalf(draft.quantity) || 1, unit: item.unit }}
            pack={pack}
          />
          <div className="flex gap-1.5">
            <button onClick={save} className="flex-1 py-1 rounded-xl bg-[var(--color-primary)] text-white text-[11px] font-bold">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-1 rounded-xl text-[11px] font-bold text-[var(--color-text-muted)]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startEditing} className="flex flex-col items-start mt-1.5 hover:opacity-80 transition text-left" title="Edit quantity and price">
          {unitPrice ? (
            <>
              <span className="text-sm font-mono font-bold text-[var(--color-accent)] flex items-center gap-1">
                {money(total)} <Pencil size={10} className="text-[var(--color-icon-muted)]" />
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{unitPrice}</span>
            </>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)] font-semibold flex items-center gap-1">
              + Add price <Pencil size={10} className="text-[var(--color-icon-muted)]" />
            </span>
          )}
        </button>
      )}

      <div className="mt-1.5" title={`Paid by ${payerLabel(item.payer)}`}>
        <PayerPicker value={item.payer || 'shared'} onChange={(value) => onUpdatePayer(item, value)} size="sm" />
      </div>
    </div>
  )
}
