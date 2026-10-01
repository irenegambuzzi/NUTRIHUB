import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Boxes, AlertTriangle, PackageX, CalendarClock, CalendarX, ShoppingCart, Download, Upload, History } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { ItemEditor } from '../components/inventory/ItemEditor'
import { ItemTile } from '../components/inventory/ItemTile'
import { EXPIRY_STYLES } from '../lib/inventoryStyles'
import { cn } from '../lib/cn'
import { usePantryItems } from '../hooks/usePantryItems'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { useInventoryCategories } from '../hooks/useInventoryCategories'
import { daysUntil, expiryLabel, expiryState, stockFill, stockStatus, suggestedPurchase } from '../lib/inventory'
import {
  buildBackup,
  csvRowsToItems,
  downloadFile,
  itemsToCsv,
  parseCsv,
  restoreCategories,
  restoreLogs,
} from '../lib/inventoryBackup'

const STATUS_ORDER = { out: 0, low: 1, ok: 2 }

const SORTS = {
  recent: (a, b) => b.created_at.localeCompare(a.created_at),
  name: (a, b) => a.name.localeCompare(b.name),
  expiry: (a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'),
  stock: (a, b) => STATUS_ORDER[stockStatus(a)] - STATUS_ORDER[stockStatus(b)] || stockFill(a) - stockFill(b),
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
  const { categories, parents, subsByParent, byId, categoryName, addSubcategory } = useInventoryCategories()
  const navigate = useNavigate()

  const [view, setView] = useState('items')
  const [editor, setEditor] = useState(null) // null | { item } (item undefined = new)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [sort, setSort] = useState('recent')

  const stats = useMemo(() => {
    const count = (fn) => items.filter(fn).length
    return {
      total: items.length,
      low: count((i) => stockStatus(i) === 'low'),
      out: count((i) => stockStatus(i) === 'out'),
      expired: count((i) => expiryState(i) === 'expired'),
      expiringSoon: count((i) => ['week', 'month'].includes(expiryState(i))),
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

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => {
        if (categoryFilter !== 'all' && i.category_id !== categoryFilter && i.subcategory_id !== categoryFilter) return false
        if (!matchesStatus(i, statusFilter) || !matchesExpiry(i, expiryFilter)) return false
        if (!q) return true
        const haystack = [i.name, i.notes, i.batch_lot, categoryName(i.category_id), i.subcategory_id && categoryName(i.subcategory_id)]
        return haystack.some((s) => s && s.toLowerCase().includes(q))
      })
      .sort(SORTS[sort])
  }, [items, search, categoryFilter, statusFilter, expiryFilter, sort, categoryName])

  const applyQuickFilter = (status, expiry) => {
    setStatusFilter(status)
    setExpiryFilter(expiry)
    setView('items')
  }

  const sendToGrocery = async (item) => {
    const { quantity, unit } = suggestedPurchase(item)
    await addGroceryItem({ name: item.name, categoryId: item.category_id, price: 0, quantity, unit, pantryItemId: item.id })
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatTile icon={Boxes} label="Total items" value={stats.total} onClick={() => applyQuickFilter('all', 'all')} />
        <StatTile icon={AlertTriangle} label="Low stock" value={stats.low} tone="amber" onClick={() => applyQuickFilter('low', 'all')} />
        <StatTile icon={PackageX} label="Out of stock" value={stats.out} tone="rose" onClick={() => applyQuickFilter('out', 'all')} />
        <StatTile icon={CalendarX} label="Expired" value={stats.expired} tone="rose" onClick={() => applyQuickFilter('all', 'expired')} />
        <StatTile
          icon={CalendarClock}
          label="Expiring ≤30 days"
          value={stats.expiringSoon}
          tone="sky"
          onClick={() => applyQuickFilter('all', 'month')}
        />
      </div>

      {(stats.low + stats.out > 0 || openShoppingCount > 0) && (
        <button
          onClick={() => navigate('/grocery')}
          className="w-full flex items-center gap-3 rounded-3xl border border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] p-3 text-left"
        >
          <ShoppingCart size={18} className="text-[var(--color-accent)] shrink-0" />
          <span className="text-xs text-[var(--color-text)] flex-1">
            <b>{stats.low + stats.out}</b> item{stats.low + stats.out === 1 ? '' : 's'} need buying ·{' '}
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
              <Input placeholder="Search items, notes, categories…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="text-xs">
                <option value="all">All categories</option>
                {parents.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    <option value={p.id}>All {p.name}</option>
                    {(subsByParent.get(p.id) || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-xs">
                <option value="all">Any stock status</option>
                <option value="attention">Low or out</option>
                <option value="ok">OK</option>
                <option value="low">Low</option>
                <option value="out">Out</option>
              </Select>
              <Select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} className="text-xs">
                <option value="all">Any expiry</option>
                <option value="expired">Expired</option>
                <option value="week">Within 7 days</option>
                <option value="month">Within 30 days</option>
                <option value="none">No expiry date</option>
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="text-xs">
                <option value="recent">Sort: newest</option>
                <option value="name">Sort: name</option>
                <option value="expiry">Sort: expiry date</option>
                <option value="stock">Sort: lowest stock</option>
              </Select>
            </div>
          </Card>

          {filteredItems.length === 0 ? (
            <Card className="text-center">
              <p className="text-xs text-[var(--color-text-muted)]">
                {items.length === 0 ? 'No items yet — tap "Add item" to start your inventory.' : 'No items match these filters.'}
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
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
}

function StatTile({ icon: Icon, label, value, tone = 'default', onClick }) {
  return (
    <button onClick={onClick} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-3xl p-3 text-left shadow-sm">
      <Icon size={16} className={TONES[tone]} />
      <p className={cn('text-xl font-extrabold mt-1', TONES[tone])}>{value}</p>
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
    </button>
  )
}

const REASON_LABELS = { added: 'Added', edited: 'Edited', restocked: 'Restocked', used: 'Used', purchased: 'Bought' }

function HistoryView({ logs }) {
  if (logs.length === 0) {
    return (
      <Card className="text-center">
        <p className="text-xs text-[var(--color-text-muted)]">No stock changes recorded yet.</p>
      </Card>
    )
  }
  return (
    <Card className="divide-y divide-[var(--color-border)]">
      {logs.map((log) => {
        const change = Number(log.change)
        return (
          <div key={log.id} className="flex items-center gap-3 py-2 text-xs">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[var(--color-text)] truncate">{log.item_name}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                {REASON_LABELS[log.reason] || log.reason} ·{' '}
                {new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <span className={cn('font-mono font-bold', change >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
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
  )
}

function DataView({ items, categories, categoryName, importItems }) {
  const csvInput = useRef(null)
  const jsonInput = useRef(null)
  const [message, setMessage] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const exportCsv = () => {
    downloadFile(`nutrihub-inventory-${today}.csv`, itemsToCsv(items, categoryName), 'text/csv;charset=utf-8')
  }

  const exportJson = async () => {
    const backup = await buildBackup()
    downloadFile(`nutrihub-backup-${today}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  const handleCsv = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const rows = csvRowsToItems(parseCsv(await file.text()), categories)
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
        <p className="text-[11px] text-[var(--color-text-muted)]">CSV opens directly in Excel or Google Sheets. The JSON backup holds everything (categories, items, history) and can be restored here.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={14} /> CSV (Excel)
          </Button>
          <Button variant="ghost" onClick={exportJson}>
            <Download size={14} /> JSON backup
          </Button>
        </div>
      </Card>
      <Card className="space-y-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Import</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          CSV columns: name, category, subcategory, unit, packaging_unit, quantity_per_pack, current_stock, min_stock, expiry_date (YYYY-MM-DD), batch_lot, notes. Only
          name is required.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => csvInput.current?.click()}>
            <Upload size={14} /> Import CSV
          </Button>
          <Button variant="ghost" onClick={() => jsonInput.current?.click()}>
            <Upload size={14} /> Restore backup
          </Button>
        </div>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={handleCsv} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={handleJson} />
      </Card>
      {message && <p className="text-xs text-[var(--color-text-soft)]">{message}</p>}
    </div>
  )
}
