import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Boxes, AlertTriangle, PackageX, CalendarClock, CalendarX, ShoppingCart, Download, Upload, History, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { ItemEditor } from '../components/inventory/ItemEditor'
import { ItemTile } from '../components/inventory/ItemTile'
import { EXPIRY_STYLES, STATUS_STYLES } from '../lib/inventoryStyles'
import { cn } from '../lib/cn'
import { localDateString } from '../lib/expensePeriods'
import { usePantryItems } from '../hooks/usePantryItems'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { daysUntil, expiryLabel, expiryState, restockReason, stockFill, stockStatus, suggestedPurchase } from '../lib/inventory'
import {
  buildBackup,
  csvRowsToItems,
  downloadFile,
  itemsToCsv,
  itemsToXlsx,
  parseCsv,
  parseXlsx,
  restoreCategories,
  restoreLogs,
} from '../lib/inventoryBackup'

const STATUS_ORDER = { out: 0, low: 1, ok: 2 }

const byName = (a, b) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' })

// Sorting works the same for one category or for "All" (every item
// together, regardless of category).
const SORTS = {
  az: { label: 'A–Z', fn: byName },
  za: { label: 'Z–A', fn: (a, b) => byName(b, a) },
  stockDesc: { label: 'Stock: highest first', fn: (a, b) => Number(b.current_stock) - Number(a.current_stock) || byName(a, b) },
  stockAsc: { label: 'Stock: lowest first', fn: (a, b) => Number(a.current_stock) - Number(b.current_stock) || byName(a, b) },
  restock: {
    label: 'Needs restock first',
    fn: (a, b) => STATUS_ORDER[stockStatus(a)] - STATUS_ORDER[stockStatus(b)] || stockFill(a) - stockFill(b),
  },
  expiry: { label: 'Expiry date', fn: (a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') },
  recent: { label: 'Newest', fn: (a, b) => b.created_at.localeCompare(a.created_at) },
}

// 0 = exact name, 1 = name starts with, 2 = name contains, 3 = other
// fields contain, -1 = no match.
function searchRank(item, q, categoryName) {
  const name = item.name.trim().toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  const other = [item.notes, item.batch_lot, categoryName(item.category_id), item.subcategory_id && categoryName(item.subcategory_id)]
  return other.some((s) => s && s.toLowerCase().includes(q)) ? 3 : -1
}

function matchesExpiry(item, filter) {
  const state = expiryState(item)
  if (filter === 'all') return true
  if (filter === 'month') return state === 'week' || state === 'month'
  return state === filter
}

function matchesStatus(item, filter) {
  const status = stockStatus(item)
  if (filter === 'all') return true
  if (filter === 'attention') return status !== 'ok'
  return status === filter
}

export function PantryPage() {
  const { items, logs, addItem, updateItem, adjustStock, deleteItem, importItems } = usePantryItems()
  const { items: groceryItems, addItem: addGroceryItem } = useGroceryItems()
  const { categories, pantryParents: parents, subsByParent, byId, categoryName, addSubcategory } = useInventoryCategories()
  const navigate = useNavigate()

  const [view, setView] = useState('items')
  const [editor, setEditor] = useState(null) // null | { item } (item undefined = new)
  const [search, setSearch] = useState('')
  const [parentFilter, setParentFilter] = useState('all')
  const [subFilter, setSubFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [sort, setSort] = useState('az')

  const stats = useMemo(() => {
    const count = (fn) => items.filter(fn).length
    return {
      total: items.length,
      low: count((i) => stockStatus(i) === 'low'),
      out: count((i) => stockStatus(i) === 'out'),
      expired: count((i) => expiryState(i) === 'expired'),
      expiringWeek: count((i) => expiryState(i) === 'week'),
      expiringMonth: count((i) => ['week', 'month'].includes(expiryState(i))),
      needBuying: count((i) => restockReason(i)),
    }
  }, [items])

  const expiryAlerts = useMemo(
    () =>
      items
        .filter((i) => ['expired', 'week', 'month'].includes(expiryState(i)))
        .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date)),
    [items]
  )

  const openShoppingCount = groceryItems.filter((g) => !g.completed).length

  const subOptions = parentFilter === 'all' ? [] : subsByParent.get(parentFilter) || []
  const query = search.trim().toLowerCase()

  // Searching scans every item across all categories (filters are set
  // aside), exact name matches first, then partial matches.
  const filteredItems = useMemo(() => {
    const sortFn = SORTS[sort].fn
    if (query) {
      return items
        .map((i) => ({ item: i, rank: searchRank(i, query, categoryName) }))
        .filter((r) => r.rank >= 0)
        .sort((a, b) => a.rank - b.rank || sortFn(a.item, b.item))
        .map((r) => r.item)
    }
    return items
      .filter((i) => {
        if (parentFilter !== 'all' && i.category_id !== parentFilter) return false
        if (subFilter !== 'all' && i.subcategory_id !== subFilter) return false
        return matchesStatus(i, statusFilter) && matchesExpiry(i, expiryFilter)
      })
      .sort(sortFn)
  }, [items, query, parentFilter, subFilter, statusFilter, expiryFilter, sort, categoryName])

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

  const sendToGrocery = async (item) => {
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

  const handleSave = (fields) => (editor?.item ? updateItem(editor.item, fields) : addItem(fields))

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Home Inventory</h2>
        <Button onClick={() => setEditor({})} className="rounded-full py-2">
          <Plus size={14} /> Add item
        </Button>
      </div>

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

      <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 w-fit text-xs font-bold">
        {[
          ['items', 'Items', Boxes],
          ['history', 'History', History],
          ['data', 'Import / Export', Download],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={cn(
              'px-3 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5',
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
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]" />
              <Input placeholder="Search all items…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-8" />
              {search && (
                <button onClick={() => setSearch('')} title="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]">
                  <X size={14} />
                </button>
              )}
            </div>
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
              {filteredItems.map((item) => (
                <ItemTile
                  key={item.id}
                  item={item}
                  subcategoryName={item.subcategory_id ? byId.get(item.subcategory_id)?.name : null}
                  onAdjust={adjustStock}
                  onEdit={(i) => setEditor({ item: i })}
                  onDelete={deleteItem}
                  onSendToGrocery={sendToGrocery}
                />
              ))}
            </div>
          )}
        </>
      )}

      {view === 'history' && <HistoryView logs={logs} />}

      {view === 'data' && <DataView items={items} categories={categories} categoryName={categoryName} importItems={importItems} />}

      {editor && (
        <ItemEditor
          item={editor.item}
          parents={parents}
          subsByParent={subsByParent}
          onAddSubcategory={addSubcategory}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}

const TONES = {
  default: 'text-[var(--color-primary)]',
  amber: STATUS_STYLES.low.text,
  rose: STATUS_STYLES.out.text,
  sky: 'text-sky-300',
  purple: STATUS_STYLES.expired.text,
}

function StatTile({ icon: Icon, label, value, tone = 'default', active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'bg-[var(--color-surface)] border rounded-3xl p-3 text-left shadow-sm transition-colors',
        active ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'
      )}
    >
      <Icon size={16} className={TONES[tone]} />
      <p className={cn('text-xl font-extrabold mt-1', TONES[tone])}>{value}</p>
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
    </button>
  )
}

const REASON_LABELS = { added: 'Added', used: 'Used', restocked: 'Restocked', edited: 'Adjusted', purchased: 'Bought' }

// Filters combine: item + reason + date range.
function HistoryView({ logs }) {
  const [itemFilter, setItemFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const itemNames = useMemo(() => [...new Set(logs.map((l) => l.item_name))].sort((a, b) => a.localeCompare(b)), [logs])

  const filtered = logs.filter((log) => {
    if (itemFilter !== 'all' && log.item_name !== itemFilter) return false
    if (reasonFilter !== 'all' && log.reason !== reasonFilter) return false
    const day = new Date(log.created_at).toLocaleDateString('sv-SE')
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })

  const anyFilter = itemFilter !== 'all' || reasonFilter !== 'all' || from || to

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} className="text-xs" aria-label="Item">
            <option value="all">All items</option>
            {itemNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="text-xs" aria-label="Reason">
            <option value="all">All reasons</option>
            {Object.entries(REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <label className="text-[10px] text-[var(--color-text-muted)]">
            From
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-xs mt-0.5" />
          </label>
          <label className="text-[10px] text-[var(--color-text-muted)]">
            To
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-xs mt-0.5" />
          </label>
        </div>
        {anyFilter && (
          <button
            onClick={() => {
              setItemFilter('all')
              setReasonFilter('all')
              setFrom('')
              setTo('')
            }}
            className="text-[11px] font-bold text-[var(--color-accent)]"
          >
            Show all ({logs.length})
          </button>
        )}
      </Card>

      {filtered.length === 0 ? (
        <Card className="text-center">
          <p className="text-xs text-[var(--color-text-muted)]">{logs.length === 0 ? 'No stock changes recorded yet.' : 'No changes match these filters.'}</p>
        </Card>
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {filtered.map((log) => {
            const change = Number(log.change)
            return (
              <div key={log.id} className="flex items-center gap-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[var(--color-text)] truncate">{log.item_name}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {REASON_LABELS[log.reason] || log.reason} ·{' '}
                    {new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className={cn('font-mono font-bold', change >= 0 ? STATUS_STYLES.ok.text : STATUS_STYLES.out.text)}>
                  {change >= 0 ? '+' : ''}
                  {change} {log.unit}
                </span>
                <span className="font-mono text-[var(--color-text-muted)] w-20 text-right">
                  → {Number(log.new_stock)} {log.unit}
                </span>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function DataView({ items, categories, categoryName, importItems }) {
  const csvInput = useRef(null)
  const jsonInput = useRef(null)
  const [message, setMessage] = useState('')
  const today = localDateString()

  const exportCsv = () => {
    downloadFile(`nutrihub-inventory-${today}.csv`, itemsToCsv(items, categoryName), 'text/csv;charset=utf-8')
  }

  const exportExcel = async () => {
    const data = await itemsToXlsx(items, categoryName)
    downloadFile(`nutrihub-export-${today}.xlsx`, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }

  const exportJson = async () => {
    const backup = await buildBackup()
    downloadFile(`nutrihub-backup-${today}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  const handleCsv = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isExcel = /\.xlsx?$/i.test(file.name)
    let parsed
    try {
      parsed = isExcel ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text())
    } catch {
      return setMessage('Could not read that file.')
    }
    const rows = csvRowsToItems(parsed, categories)
    if (rows.length === 0) return setMessage('No items found in that file. The first row must be a header with at least a "name" column.')
    if (!window.confirm(`Import ${rows.length} item${rows.length === 1 ? '' : 's'}? Rows with an existing id overwrite that item.`)) return
    const { error } = await importItems(rows)
    setMessage(error ? 'Import failed: ' + error.message : `Imported ${rows.length} item${rows.length === 1 ? '' : 's'}.`)
  }

  const handleJson = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      return setMessage('That file is not valid JSON.')
    }
    if (backup.app !== 'nutrihub-inventory' || !Array.isArray(backup.items)) {
      return setMessage('That file is not a NutriHub inventory backup.')
    }
    if (!window.confirm(`Restore ${backup.items.length} items from ${backup.exported_at?.slice(0, 10) || 'this backup'}? Items in the backup overwrite current ones with the same id; other items are kept.`)) return
    const steps = [() => restoreCategories(backup), () => importItems(backup.items), () => restoreLogs(backup)]
    for (const step of steps) {
      const { error } = await step()
      if (error) return setMessage('Restore failed: ' + error.message)
    }
    setMessage(`Restored ${backup.items.length} items.`)
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Export</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          CSV and Excel include every item field plus category and subcategory names. The JSON backup holds everything (categories, items, history) and can be
          restored here.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" onClick={exportCsv} className="px-2">
            <Download size={14} /> Export CSV
          </Button>
          <Button variant="ghost" onClick={exportExcel} className="px-2">
            <Download size={14} /> Export Excel
          </Button>
          <Button variant="ghost" onClick={exportJson} className="px-2">
            <Download size={14} /> Export JSON
          </Button>
        </div>
      </Card>
      <Card className="space-y-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Import</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          CSV or Excel columns: name, category, subcategory, unit, packaging_unit, quantity_per_pack, current_stock, min_stock, expiry_date (YYYY-MM-DD), batch_lot,
          notes, price, payer. Only name is required.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => csvInput.current?.click()}>
            <Upload size={14} /> Import CSV / Excel
          </Button>
          <Button variant="ghost" onClick={() => jsonInput.current?.click()}>
            <Upload size={14} /> Restore backup
          </Button>
        </div>
        <input ref={csvInput} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={handleCsv} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={handleJson} />
      </Card>
      {message && <p className="text-xs text-[var(--color-text-soft)]">{message}</p>}
    </div>
  )
}
