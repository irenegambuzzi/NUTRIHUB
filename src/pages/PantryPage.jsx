import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Layers, Boxes, AlertTriangle, PackageX, CalendarClock, CalendarX, ShoppingCart, Download, History, Wallet } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Field'
import { SearchBox } from '../components/ui/SearchBox'
import { ItemEditor } from '../components/inventory/ItemEditor'
import { ItemTile } from '../components/inventory/ItemTile'
import { GroupTile } from '../components/inventory/GroupTile'
import { StatTile } from '../components/inventory/StatTile'
import { HistoryView } from '../components/inventory/HistoryView'
import { DataView } from '../components/inventory/DataView'
import { BudgetMappingView } from '../components/inventory/BudgetMappingView'
import { WhereToRecord } from '../components/ui/WhereToRecord'
import { EXPIRY_STYLES } from '../lib/inventoryStyles'
import { cn } from '../lib/cn'
import { SORTS, matchesExpiryDeep, matchesStatus, searchRank } from '../lib/pantryFilters'
import { groupsReady, newVariantFields, variantOrder } from '../lib/groups'
import { variantPurchase } from '../lib/groupShop'
import { showToast } from '../lib/feedback'
import { usePantryItems } from '../hooks/usePantryItems'
import { useNewItemIds } from '../hooks/useNewItemIds'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { daysUntil, expiryLabel, expiryState, restockReason, shownStatus, suggestedPurchase } from '../lib/inventory'
import { isFinished, isOneTime, splitFinished } from '../lib/oneTime'
import { FinishedItems } from '../components/inventory/FinishedItems'

export function PantryPage() {
  const { items, addItem, updateItem, adjustStock, discardExpired, deleteItem, importItems } = usePantryItems()
  const { items: groceryItems, addItem: addGroceryItem } = useGroceryItems()
  const { categories, pantryParents: parents, subsByParent, byId, categoryName, addCategory, addSubcategory } = useInventoryCategories()
  const navigate = useNavigate()
  const newIds = useNewItemIds(items)
  // Finished one-time items are listed apart, at the bottom (the group of
  // a finished variant stays in the grid).
  const { active: shownItems, finished: finishedItems } = useMemo(() => splitFinished(items), [items])
  const topLevel = useMemo(() => shownItems.filter((i) => !i.group_id), [shownItems])
  const groupRows = useMemo(() => items.filter((i) => i.is_group), [items])
  const ready = groupsReady(items)
  const groupById = useMemo(() => new Map(groupRows.map((g) => [g.id, g])), [groupRows])
  const variantsOfGroup = useMemo(() => (g) => items.filter((i) => i.group_id === g.id).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const shownVariantsOf = (g) => variantsOfGroup(g).filter((v) => !isFinished(v))
  const [groupNotice, setGroupNotice] = useState(false)

  const [view, setView] = useState('items')
  const [editor, setEditor] = useState(null) // null | { item } (item undefined = new)
  const [search, setSearch] = useState('')
  const [parentFilter, setParentFilter] = useState('all')
  const [subFilter, setSubFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [sort, setSort] = useState('az')

  const stats = useMemo(() => {
    const count = (fn) => shownItems.filter(fn).length
    return {
      // Finished one-time items aren't counted; one-time items are never
      // Low or Out.
      total: topLevel.length,
      // A variant has no threshold of its own: only items and groups count.
      low: topLevel.filter((i) => !isOneTime(i) && shownStatus(i) === 'low').length,
      out: topLevel.filter((i) => !isOneTime(i) && shownStatus(i) === 'out').length,
      expired: count((i) => expiryState(i) === 'expired'),
      expiringWeek: count((i) => expiryState(i) === 'week'),
      expiringMonth: count((i) => ['week', 'month'].includes(expiryState(i))),
      needBuying: count((i) => restockReason(i)),
    }
  }, [shownItems, topLevel])

  const expiryAlerts = useMemo(
    () =>
      shownItems
        .filter((i) => ['expired', 'week', 'month'].includes(expiryState(i)))
        .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date)),
    [shownItems]
  )

  const openShoppingCount = groceryItems.filter((g) => !g.completed).length

  const subOptions = parentFilter === 'all' ? [] : subsByParent.get(parentFilter) || []
  const query = search.trim().toLowerCase()

  // Searching scans every item across all categories (filters are set
  // aside), exact name matches first, then partial matches.
  const filteredItems = useMemo(() => {
    const sortFn = SORTS[sort].fn
    if (query) {
      return shownItems
        .map((i) => ({ item: i, rank: searchRank(i, query, categoryName, groupById.get(i.group_id)?.name) }))
        .filter((r) => r.rank >= 0)
        .sort((a, b) => a.rank - b.rank || sortFn(a.item, b.item))
        .map((r) => r.item)
    }
    return topLevel
      .filter((i) => {
        if (parentFilter !== 'all' && i.category_id !== parentFilter) return false
        if (subFilter !== 'all' && i.subcategory_id !== subFilter) return false
        return matchesStatus(i, statusFilter) && matchesExpiryDeep(i, expiryFilter)
      })
      .sort(sortFn)
  }, [shownItems, topLevel, groupById, query, parentFilter, subFilter, statusFilter, expiryFilter, sort, categoryName])

  const filtersActive = parentFilter !== 'all' || statusFilter !== 'all' || expiryFilter !== 'all'

  const applyQuickFilter = (status, expiry) => {
    setStatusFilter(status)
    setExpiryFilter(expiry)
    setSearch('')
    setView('items')
  }

  const clearFilters = () => {
    setParentFilter('all')
    setSubFilter('all')
    applyQuickFilter('all', 'all')
  }

  // A group never goes on the SHOP list itself: its variant that needs it
  // most (at 0 first, then the lowest stock) and isn't listed yet does.
  const sendToGrocery = async (item) => {
    if (item.is_group) {
      const listed = new Set(groceryItems.map((g) => g.pantry_item_id).filter(Boolean))
      const variants = variantOrder(items.filter((i) => i.group_id === item.id && !isFinished(i)))
      const variant = variants.find((v) => !listed.has(v.id))
      if (!variant) {
        showToast({ message: variants.length ? `Every variant of "${item.name}" is already on the SHOP list.` : `"${item.name}" has no variants yet — add one first.` })
        if (variants.length) navigate('/grocery')
        return
      }
      const { quantity, unit } = variantPurchase(variant)
      const { error } = await addGroceryItem({
        name: variant.name,
        categoryId: variant.category_id,
        subcategoryId: variant.subcategory_id,
        price: Number(variant.price) || 0,
        priceQty: Number(variant.price) > 0 ? variant.price_qty ?? null : null,
        priceUnit: Number(variant.price) > 0 ? variant.price_unit ?? null : null,
        payer: variant.payer || 'shared',
        quantity,
        unit,
        pantryItemId: variant.id,
      })
      if (!error) navigate('/grocery')
      return
    }
    const { quantity, unit } = suggestedPurchase(item)
    await addGroceryItem({
      name: item.name,
      categoryId: item.category_id,
      subcategoryId: item.subcategory_id,
      price: Number(item.price) || 0,
      payer: item.payer || 'shared',
      quantity,
      unit,
      pantryItemId: item.id,
    })
    navigate('/grocery')
  }

  const restockGroup = async (group, { delta, variantId, newName }) => {
    if (variantId) return adjustStock(items.find((i) => i.id === variantId), delta, 'restocked')
    return addItem(newVariantFields(group, newName, { current_stock: delta, packaging_unit: group.packaging_unit, quantity_per_pack: group.quantity_per_pack }))
  }

  // A variant becomes a normal item again, with its stock; Undo puts it back.
  const takeOut = async (variant) => {
    const groupId = variant.group_id
    const { error } = await updateItem(variant, { group_id: null })
    if (error) return
    showToast({
      message: `"${variant.name}" is a normal item again`,
      action: { label: 'Undo', onClick: () => updateItem({ ...variant, group_id: null }, { group_id: groupId }) },
    })
  }

  const openGroupEditor = (next) => (ready ? setEditor(next) : setGroupNotice(true))

  const handleSave = (fields) => (editor?.item ? updateItem(editor.item, fields) : addItem(fields))

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Home Inventory</h2>
        <div className="flex gap-2">
          <Button onClick={() => openGroupEditor({ asGroup: true })} className="rounded-full py-2 bg-[var(--color-surface-soft)] text-[var(--color-text)]">
            <Layers size={14} /> Add group
          </Button>
          <Button onClick={() => setEditor({})} className="rounded-full py-2">
            <Plus size={14} /> Add item
          </Button>
        </div>
      </div>

      {groupNotice && (
        <Card className="space-y-1">
          <p className="text-xs font-bold text-amber-300">Item groups need a one-time update of the database</p>
          <p className="text-xs text-[var(--color-text-soft)]">
            Run supabase/018_item_groups.sql in Supabase (SQL Editor), then reload the app. Until then everything else works exactly as before.
          </p>
          <button onClick={() => setGroupNotice(false)} className="text-[11px] font-bold text-[var(--color-accent)]">
            OK
          </button>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { icon: Boxes, label: 'Total items', value: stats.total, status: 'all', expiry: 'all' },
          { icon: AlertTriangle, label: 'Low stock', value: stats.low, tone: 'amber', status: 'low', expiry: 'all' },
          { icon: PackageX, label: 'Out of stock', value: stats.out, tone: 'rose', status: 'out', expiry: 'all' },
          { icon: CalendarX, label: 'Expired', value: stats.expired, tone: 'purple', status: 'all', expiry: 'expired' },
          { icon: CalendarClock, label: 'Expiring ≤7 days', value: stats.expiringWeek, tone: 'amber', status: 'all', expiry: 'week' },
          { icon: CalendarClock, label: 'Expiring ≤30 days', value: stats.expiringMonth, tone: 'sky', status: 'all', expiry: 'month' },
        ].map((t) => (
          <StatTile
            key={t.label}
            {...t}
            active={view === 'items' && statusFilter === t.status && expiryFilter === t.expiry}
            onClick={() => applyQuickFilter(t.status, t.expiry)}
          />
        ))}
      </div>

      {(stats.needBuying > 0 || openShoppingCount > 0) && (
        <button
          onClick={() => navigate('/grocery')}
          className="w-full flex items-center gap-3 rounded-3xl border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] p-3 text-left"
        >
          <ShoppingCart size={18} className="text-[var(--color-accent)] shrink-0" />
          <span className="text-xs text-[var(--color-text)] flex-1">
            <b>{stats.needBuying}</b> item{stats.needBuying === 1 ? '' : 's'} need buying (low, out or expired) ·{' '}
            <b>{openShoppingCount}</b> on the grocery list
          </span>
          <span className="text-xs font-bold text-[var(--color-accent)]">Open list →</span>
        </button>
      )}

      <WhereToRecord />

      {expiryAlerts.length > 0 && (
        <Card className="space-y-2">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Expiry reminders</p>
          {expiryAlerts.slice(0, 6).map((i) => (
            <button key={i.id} onClick={() => setEditor({ item: i })} className="w-full flex justify-between items-center gap-2 text-left">
              <span className="text-xs text-[var(--color-text)] truncate">{i.name}</span>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0', EXPIRY_STYLES[expiryState(i)])}>{expiryLabel(i)}</span>
            </button>
          ))}
          {expiryAlerts.length > 6 && (
            <button onClick={() => applyQuickFilter('all', 'month')} className="text-[11px] font-bold text-[var(--color-accent)]">
              +{expiryAlerts.length - 6} more
            </button>
          )}
        </Card>
      )}

      <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 w-fit max-w-full overflow-x-auto text-xs font-bold">
        {[
          ['items', 'Items', Boxes],
          ['history', 'History', History],
          ['budget', 'Categories', Wallet],
          ['data', 'Import / Export', Download],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={cn(
              'px-3 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap shrink-0',
              view === key ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === 'items' && (
        <>
          <Card className="space-y-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search all items…" />
            {query && filtersActive && <p className="text-[10px] text-[var(--color-text-muted)]">Searching all categories — filters are ignored while searching.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Select
                value={parentFilter}
                onChange={(e) => {
                  setParentFilter(e.target.value)
                  setSubFilter('all')
                }}
                className="text-xs"
                aria-label="Category"
              >
                <option value="all">All</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {subOptions.length > 0 && (
                <Select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} className="text-xs" aria-label="Subcategory">
                  <option value="all">All subcategories</option>
                  {subOptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-xs" aria-label="Stock status">
                <option value="all">Any stock status</option>
                <option value="attention">Low or out</option>
                <option value="ok">OK</option>
                <option value="low">Low</option>
                <option value="out">Out</option>
              </Select>
              <Select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} className="text-xs" aria-label="Expiry">
                <option value="all">Any expiry</option>
                <option value="expired">Expired</option>
                <option value="week">Within 7 days</option>
                <option value="month">Within 30 days</option>
                <option value="none">No expiry date</option>
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="text-xs" aria-label="Sort">
                {Object.entries(SORTS).map(([key, { label }]) => (
                  <option key={key} value={key}>
                    Sort: {label}
                  </option>
                ))}
              </Select>
            </div>
            {!query && filtersActive && (
              <button onClick={clearFilters} className="text-[11px] font-bold text-[var(--color-accent)]">
                Clear filters
              </button>
            )}
          </Card>

          {filteredItems.length === 0 ? (
            <Card className="text-center">
              <p className="text-xs text-[var(--color-text-muted)]">
                {query
                  ? `Item not found — nothing matches "${search.trim()}".`
                  : items.length === 0
                    ? 'No items yet — tap "Add item" to start your inventory.'
                    : 'No items match these filters.'}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredItems.map((item) =>
                item.is_group ? (
                  <GroupTile
                    key={item.id}
                    group={item}
                    variants={shownVariantsOf(item)}
                    newIds={newIds}
                    isNew={newIds.has(item.id)}
                    subcategoryName={item.subcategory_id ? byId.get(item.subcategory_id)?.name : null}
                    onAdjust={adjustStock}
                    onDiscard={discardExpired}
                    onEdit={(i) => setEditor({ item: i })}
                    onDelete={deleteItem}
                    onSendToGrocery={sendToGrocery}
                    onAddVariant={(g) => setEditor({ group: g })}
                    onTakeOut={takeOut}
                    onRestock={restockGroup}
                  />
                ) : (
                  <ItemTile
                    key={item.id}
                    item={item}
                    isNew={newIds.has(item.id)}
                    groupName={groupById.get(item.group_id)?.name}
                    subcategoryName={item.subcategory_id ? byId.get(item.subcategory_id)?.name : null}
                    onAdjust={adjustStock}
                    onDiscard={discardExpired}
                    onEdit={(i) => setEditor({ item: i })}
                    onDelete={deleteItem}
                    onSendToGrocery={sendToGrocery}
                  />
                )
              )}
            </div>
          )}
        </>
      )}

      {view === 'items' && (
        <FinishedItems
          items={query ? finishedItems.filter((i) => i.name.toLowerCase().includes(query)) : finishedItems}
          groupName={(id) => groupById.get(id)?.name}
          onNotOneTime={(item) => updateItem(item, { one_time: false })}
          onEdit={(i) => setEditor({ item: i })}
          onDelete={deleteItem}
        />
      )}

      {view === 'history' && <HistoryView />}

      {view === 'budget' && <BudgetMappingView parents={categories.filter((c) => c.type === 'parent')} subsByParent={subsByParent} />}

      {view === 'data' && <DataView items={items} categories={categories} categoryName={categoryName} importItems={importItems} />}

      {editor && (
        <ItemEditor
          item={editor.item}
          asGroup={Boolean(editor.asGroup)}
          group={editor.group}
          groups={ready ? groupRows : []}
          variantCount={editor.item?.is_group ? variantsOfGroup(editor.item).length : 0}
          parents={parents}
          subsByParent={subsByParent}
          onAddCategory={addCategory}
          onAddSubcategory={addSubcategory}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
