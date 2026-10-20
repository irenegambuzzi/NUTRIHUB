import { useState } from 'react'
import { Receipt, ShoppingCart, Sparkles, Wallet, X, Users, Microwave } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { SearchBox } from '../components/ui/SearchBox'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { AddItemForm } from '../components/grocery/AddItemForm'
import { BudgetCard } from '../components/grocery/BudgetCard'
import { GroceryItemTile } from '../components/grocery/GroceryItemTile'
import { GroupShopCard } from '../components/grocery/GroupShopCard'
import { ReceiptsView } from '../components/grocery/ReceiptsView'
import { QuickAdd } from '../components/grocery/QuickAdd'
import { ShoppingMode } from '../components/grocery/ShoppingMode'
import { ConfirmPurchase } from '../components/grocery/ConfirmPurchase'
import { cn } from '../lib/cn'
import { useGroceryList } from '../hooks/useGroceryList'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { PAID_BY_OPTIONS } from '../data/constants'
import { inventoryCategoryColor } from '../lib/categoryColors'
import { shopReason, syncShoppingForItem } from '../lib/inventory'
import { addableVariants, shopUnits } from '../lib/groupShop'
import { entryIsOneTime } from '../lib/oneTime'
import { attempt } from '../lib/db'
import { money } from '../lib/pricing'
import { matchesGrocerySearch, variantHint } from '../lib/grocerySearch'
import { OnTheWay } from '../components/grocery/OnTheWay'
import { OrderOnlineDialog } from '../components/grocery/OrderOnlineDialog'
import { LinkedArrivedDialog } from '../components/expenses/LinkedArrivedDialog'
import { ArrivedDialog } from '../components/expenses/ArrivedDialog'
import { WhereToRecord } from '../components/ui/WhereToRecord'
import { FLOW_NOTICE, useFlow } from '../hooks/useFlow'
import { useShops } from '../hooks/useShops'
import { markArrived } from '../hooks/useOrders'
import { askCancelOrder } from '../hooks/orderActions'
import { askDialog, showToast } from '../lib/feedback'
import { expectedLabel } from '../lib/orders'
import { orderStore } from '../lib/stores'
import { localDateString, parseLocalDate } from '../lib/week'

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
    updateCategory,
    deleteItem,
    addVariant,
    cartItems,
    pantryItems,
    pantryByName,
    pantryFor,
    groupOf,
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
    checkOff: toggleCart,
    onTheWay,
    openOrderOf,
  } = useGroceryList()
  const flow = useFlow()
  const { byId: shopById } = useShops()
  const { rows: orders } = orderStore.useRows()
  const [ordering, setOrdering] = useState(null) // a list entry
  const [arriving, setArriving] = useState(null) // { order, item } | { order }
  const today = localDateString()
  const { parents, subsByParent, categoryName, addCategory, addSubcategory } = useInventoryCategories()

  const [view, setViewState] = useState(readView)
  const [fullForm, setFullForm] = useState(null) // null | name to start the full form with
  const [confirming, setConfirming] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [sortMode, setSortMode] = useState('priority')
  const [bulkScope, setBulkScope] = useState('restock')
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')

  // An entry ordered online can't go in the cart without a clear warning:
  // buying it here too would record it twice. Cancelling the order (with
  // its expense question) lets it be bought after all.
  const checkOff = async (item) => {
    const order = openOrderOf(item)
    if (!order || item.in_cart) return toggleCart(item)
    const answer = await askDialog({
      title: `"${item.name}" is already ordered`,
      message: `Already ordered on ${parseLocalDate(order.order_date).toLocaleDateString('en-GB')}, ${expectedLabel(order, today)}. Buying it here too would record it twice.`,
      fields: [
        {
          name: 'how',
          type: 'choice',
          value: 'keep',
          options: [
            { value: 'keep', label: 'Keep the order', hint: "Don't buy it here; it stays under On the way." },
            { value: 'cancel', label: 'Cancel the order and buy it here', hint: 'You choose what happens to its expense next.' },
          ],
        },
      ],
      confirmLabel: 'Continue',
    })
    if (answer?.how !== 'cancel') return
    const result = await askCancelOrder(order, { orders, today })
    if (result && !result.error) toggleCart({ ...item, in_cart: false })
  }

  // An ordered entry stays until its order arrives or is cancelled.
  const removeItem = (item) => {
    if (openOrderOf(item)) return showToast({ message: `"${item.name}" is on the way — cancel the order first (On the way → Cancel / Return).`, tone: 'error' })
    return deleteItem(item)
  }

  // The HOME items already on the list (to buy, in the cart or on the
  // way): "+ Add another variant" offers only the others.
  const listedIds = new Set([...items, ...onTheWay].map((e) => pantryFor(e)?.id).filter(Boolean))

  const arrive = async (order, pantry) => {
    if (pantry) return setArriving({ order, item: pantry })
    const { error } = await markArrived(order, today)
    if (!error) setArriving({ order })
  }

  const shopOf = (item) => {
    const id = pantryFor(item)?.usual_shop_id
    return id ? shopById.get(id) ?? null : null
  }
  const onTheWayEntries = onTheWay.map((entry) => ({ entry, order: openOrderOf(entry), pantry: pantryFor(entry) ?? null }))
  const onTheWaySection = flow.ready ? (
    <OnTheWay
      entries={onTheWayEntries}
      shopById={shopById}
      today={today}
      onArrived={arrive}
      onCancel={(order) => askCancelOrder(order, { orders, today })}
    />
  ) : null
  const orderProps = (item) =>
    flow.ready ? { onOrderOnline: () => setOrdering(item), orderFirst: Boolean(shopOf(item)?.is_online), usualShop: shopOf(item) } : {}

  const query = search.trim().toLowerCase()
  // The names of a group's variants, so searching "Lays" finds a
  // group-level line; a variant's row is also found by its group's name.
  const variantNamesOf = (g) => pantryFor(g)?.variants?.map((v) => v.name) ?? []
  const searchNamesOf = (g) => [...variantNamesOf(g), groupOf(g)?.name].filter(Boolean)
  // Searching looks through every category, to buy and in the cart alike.
  const inCategory = query
    ? (i) => matchesGrocerySearch(i, query, categoryName, searchNamesOf(i))
    : (i) => selectedCategory === 'All' || i.category_id === selectedCategory
  const filteredItems = budgetPlan
    ? [...budgetPlan.order, ...sortItems(groceryItems.filter((i) => i.in_cart), 'recent')].filter(inCategory)
    : sortItems(groceryItems.filter(inCategory), sortMode)
  const filteredDurables = sortItems(durableItems.filter(inCategory), budgetPlan ? 'recent' : sortMode)
  const durableTotal = durableItems.filter((i) => !i.in_cart).reduce((sum, i) => sum + costOf(i), 0)
  // Only show chips for categories that actually have items on the list.
  const listCategories = parents.filter((p) => items.some((i) => i.category_id === p.id))
  // Also a group with a variant at 0 ("Not urgent").
  const needsBuying = pantryItems.filter((p) => shopReason(p))
  const filteredTotal = [...filteredItems, ...filteredDurables].reduce((sum, item) => sum + costOf(item), 0)
  const cartCount = cartItems.length

  // Targets for "Paid by for all …".
  const bulkTargets = items.filter(
    (i) => !i.in_cart && (bulkScope === 'all' || (bulkScope === 'new' ? reasonOf(i) === 'new' : ['out', 'low', 'expired'].includes(reasonOf(i))))
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

  // One entry's tile, or a group's card with a row per variant.
  const renderUnit = (unit, { budget = false } = {}) => {
    const budgetMarkOf = (e) => (budget && overBudget ? budgetPlan?.marks.get(e.id) : undefined)
    if (unit.kind === 'group') {
      return (
        <GroupShopCard
          key={unit.key}
          card={unit}
          reason={reasonOf(unit.entries[0])}
          pantryFor={pantryFor}
          totalOf={totalOf}
          budgetMarkOf={budgetMarkOf}
          categoryName={categoryName}
          onToggle={checkOff}
          onRemove={removeItem}
          onUpdatePricing={updatePricing}
          onUpdatePayer={updatePayer}
          orderPropsOf={orderProps}
          addable={addableVariants(unit.group, listedIds)}
          onAddVariant={addVariant}
          showList={Boolean(query)}
        />
      )
    }
    const item = unit.entry
    return (
      <GroceryItemTile
        key={item.id}
        item={item}
        showList={Boolean(query)}
        hint={variantHint(item, query, variantNamesOf(item))}
        reason={reasonOf(item)}
        pack={pantryFor(item)}
        total={totalOf(item)}
        budgetMark={budgetMarkOf(item)}
        categoryName={categoryName}
        onToggle={checkOff}
        onDelete={removeItem}
        onUpdatePricing={updatePricing}
        onUpdatePayer={updatePayer}
        onUpdateCategory={updateCategory}
        oneTime={entryIsOneTime(item, pantryFor(item))}
        {...orderProps(item)}
      />
    )
  }

  const quickAdd = (
    <QuickAdd
      items={items}
      pantryItems={pantryItems.filter((p) => !p.group_id)}
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

      {view !== 'receipts' && (
        <SearchBox value={search} onChange={setSearch} placeholder="Search the list and the cart…" />
      )}

      {view === 'list' && <WhereToRecord here="shop" />}
      {view === 'list' && flow.missing && (
        <Card className="text-xs text-yellow-300">"Order online", "On the way", one store per shopping trip and budget categories by item category: {FLOW_NOTICE}</Card>
      )}

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
                onAddCategory={addCategory}
                onAddSubcategory={addSubcategory}
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
                  <Sparkles size={13} /> {syncing ? 'Adding…' : `Add all ${needsBuying.length} pantry items that need buying`}
                </button>
              )}
              {cartCount > 0 && (
                <button
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--color-primary)] text-white"
                >
                  <ShoppingCart size={13} /> Confirm purchase ({cartCount} in the cart)
                </button>
              )}
            </div>
          </div>

          {items.some((i) => !i.in_cart) && (
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
              <p className="text-xs text-[var(--color-text-muted)]">
                {query ? `Nothing matches "${search.trim()}" — not on the list and not in the cart.` : 'Nothing here yet — add your first item above.'}
              </p>
            </Card>
          ) : filteredItems.length === 0 ? null : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {shopUnits(filteredItems, groupOf, pantryFor).map((unit) => renderUnit(unit, { budget: true }))}
            </div>
          )}

          {onTheWaySection}

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
                {shopUnits(filteredDurables, groupOf, pantryFor).map((unit) => renderUnit(unit))}
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
            search={search}
            pantryFor={pantryFor}
            groupOf={groupOf}
            variantNamesOf={variantNamesOf}
            searchNamesOf={searchNamesOf}
            onCheck={checkOff}
            onConfirm={() => setConfirming(true)}
          />
          {onTheWaySection}
        </>
      ) : (
        <ReceiptsView />
      )}
      {confirming && (
        <ConfirmPurchase
          cartItems={cartItems}
          pantryItems={pantryItems}
          categoryName={categoryName}
          totalOf={totalOf}
          updatePricing={updatePricing}
          updatePayer={updatePayer}
          updateCategory={updateCategory}
          toggleCart={toggleCart}
          openOrderOf={flow.ready ? openOrderOf : () => null}
          onCancelOrder={(order) => askCancelOrder(order, { orders, today })}
          splitTrips={flow.ready}
          onClose={() => setConfirming(false)}
        />
      )}
      {ordering && <OrderOnlineDialog entry={ordering} pantry={pantryFor(ordering) ?? null} total={totalOf(ordering)} onClose={() => setOrdering(null)} />}
      {arriving?.item && <LinkedArrivedDialog order={arriving.order} item={arriving.item} onClose={() => setArriving(null)} />}
      {arriving && !arriving.item && <ArrivedDialog order={arriving.order} onClose={() => setArriving(null)} />}
    </div>
  )
}
