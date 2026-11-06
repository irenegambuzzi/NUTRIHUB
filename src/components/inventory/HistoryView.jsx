import { useMemo, useState } from 'react'
import { CheckSquare, Square, Trash2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { DateField } from '../ui/DateField'
import { Select } from '../ui/Field'
import { cn } from '../../lib/cn'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
import { deleteStockLogs, useStockLogs } from '../../hooks/usePantryItems'
import { normName } from '../../lib/grocery'

const REASON_LABELS = { added: 'Added', used: 'Used', restocked: 'Restocked', edited: 'Adjusted', purchased: 'Bought', unpurchased: 'Purchase undone', discarded: 'Discarded', converted: 'Unit changed', merged: 'Merged', separated: 'Separated' }

// Only supabase/032 writes these two (plan 9N).
const NAMES_REASONS = ['merged', 'separated']

// A unit change that converted the stock (2 pack → 8 pcs, plan 9L K11)
// shows only the new stock: the difference of the numbers means nothing.
const showsChange = (log) => log.reason !== 'converted'

// A row whose HOME item no longer exists (deleted with the HOME trash, or
// before supabase/031 by Reopen): the record stays, marked (plan 9M, K29).
const DELETED_ITEM_LABEL = 'deleted item'
const itemGone = (log) => 'item_id' in log && !log.item_id

// Filters combine: item + reason + date range. Entries can be deleted one
// by one or several at once (Select), with Undo; that removes only the
// record, never stock, expenses or items.
// `namesReady`: supabase/032 is known to have run (plan 9N, report J.2): a
// row is titled with the item's name of now, from item_id (`items`: the HOME
// items), with the stored name under it when that differs, and the Item
// filter goes by item_id. Before that, and for a deleted item, the stored
// name is the title.
export function HistoryView({ items = [], namesReady = false }) {
  const logs = useStockLogs()
  const currentNames = useMemo(() => new Map(items.map((p) => [p.id, p.name])), [items])
  const titleOf = (log) => (namesReady && currentNames.get(log.item_id)) || log.item_name
  const filterKey = (log) => (namesReady && log.item_id ? `id:${log.item_id}` : log.item_name)
  const [itemFilter, setItemFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const itemOptions = useMemo(() => {
    const options = new Map()
    for (const log of logs) {
      if (!options.has(filterKey(log))) options.set(filterKey(log), namesReady && itemGone(log) ? `${log.item_name} (${DELETED_ITEM_LABEL})` : titleOf(log))
    }
    return [...options].sort((a, b) => a[1].localeCompare(b[1]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, namesReady, currentNames])

  const filtered = logs.filter((log) => {
    if (itemFilter !== 'all' && filterKey(log) !== itemFilter) return false
    if (reasonFilter !== 'all' && log.reason !== reasonFilter) return false
    const day = new Date(log.created_at).toLocaleDateString('sv-SE')
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })

  const anyFilter = itemFilter !== 'all' || reasonFilter !== 'all' || from || to

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  // Only entries still shown count (a filter may have hidden some).
  const chosen = filtered.filter((log) => selected.has(log.id)).map((log) => log.id)
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const deleteChosen = async () => {
    const { error } = await deleteStockLogs(chosen)
    if (!error) stopSelecting()
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} className="text-xs" aria-label="Item">
            <option value="all">All items</option>
            {itemOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="text-xs" aria-label="Reason">
            <option value="all">All reasons</option>
            {Object.entries(REASON_LABELS).filter(([value]) => namesReady || !NAMES_REASONS.includes(value)).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
            <span>From</span>
            <DateField label="From date" value={from} onChange={setFrom} />
          </div>
          <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
            <span>To</span>
            <DateField label="To date" value={to} onChange={setTo} />
          </div>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-[var(--color-text-muted)] flex-1 min-w-48">
          Deleting history only removes the record — stock, expenses and items stay as they are.
        </p>
        {filtered.length > 0 &&
          (selecting ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(chosen.length === filtered.length ? new Set() : new Set(filtered.map((log) => log.id)))}
                className="text-[11px] font-bold text-[var(--color-text-muted)]"
              >
                {chosen.length === filtered.length ? 'Select none' : 'Select all shown'}
              </button>
              <button
                onClick={deleteChosen}
                disabled={chosen.length === 0}
                className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-rose-500 text-white disabled:opacity-40"
              >
                <Trash2 size={12} /> Delete {chosen.length || ''}
              </button>
              <button onClick={stopSelecting} aria-label="Stop selecting" className="p-1 text-[var(--color-icon-muted)] hover:text-[var(--color-text)]">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSelecting(true)}
              className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]"
            >
              <CheckSquare size={12} /> Select
            </button>
          ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="text-center">
          <p className="text-xs text-[var(--color-text-muted)]">{logs.length === 0 ? 'No stock changes recorded yet.' : 'No changes match these filters.'}</p>
        </Card>
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {filtered.map((log) => {
            const change = Number(log.change)
            const title = titleOf(log)
            const storedName = normName(title) === normName(log.item_name) ? '' : log.item_name
            return (
              <div
                key={log.id}
                onClick={selecting ? () => toggle(log.id) : undefined}
                className={cn('flex items-center gap-3 py-2 text-xs', selecting && 'cursor-pointer')}
              >
                {selecting && (
                  <span role="checkbox" aria-checked={selected.has(log.id)} aria-label={`Select ${title}`} className="text-[var(--color-primary)] shrink-0">
                    {selected.has(log.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--color-icon-muted)]" />}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[var(--color-text)] truncate">{title}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {storedName && `${storedName} · `}
                    {REASON_LABELS[log.reason] || log.reason} ·{' '}
                    {new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {itemGone(log) && (
                      <>
                        {' · '}
                        <span className="text-[var(--color-icon-muted)]">{DELETED_ITEM_LABEL}</span>
                      </>
                    )}
                  </p>
                </div>
                {showsChange(log) && (
                  <span className={cn('font-mono font-bold', change >= 0 ? STATUS_STYLES.ok.text : STATUS_STYLES.out.text)}>
                    {change >= 0 ? '+' : ''}
                    {change} {log.unit}
                  </span>
                )}
                <span className="font-mono text-[var(--color-text-muted)] w-20 text-right">
                  → {Number(log.new_stock)} {log.unit}
                </span>
                {!selecting && (
                  <button
                    onClick={() => deleteStockLogs([log.id])}
                    aria-label={`Delete this entry for ${title}`}
                    className="p-1 text-[var(--color-icon-muted)] hover:text-rose-400 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
