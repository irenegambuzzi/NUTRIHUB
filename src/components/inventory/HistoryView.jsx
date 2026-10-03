import { useMemo, useState } from 'react'
import { CheckSquare, Square, Trash2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input, Select } from '../ui/Field'
import { cn } from '../../lib/cn'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
import { deleteStockLogs, useStockLogs } from '../../hooks/usePantryItems'

const REASON_LABELS = { added: 'Added', used: 'Used', restocked: 'Restocked', edited: 'Adjusted', purchased: 'Bought', unpurchased: 'Purchase undone', discarded: 'Discarded' }

// Filters combine: item + reason + date range. Entries can be deleted one
// by one or several at once (Select), with Undo; that removes only the
// record, never stock, expenses or items.
export function HistoryView() {
  const logs = useStockLogs()
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
            return (
              <div
                key={log.id}
                onClick={selecting ? () => toggle(log.id) : undefined}
                className={cn('flex items-center gap-3 py-2 text-xs', selecting && 'cursor-pointer')}
              >
                {selecting && (
                  <span role="checkbox" aria-checked={selected.has(log.id)} aria-label={`Select ${log.item_name}`} className="text-[var(--color-primary)] shrink-0">
                    {selected.has(log.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--color-icon-muted)]" />}
                  </span>
                )}
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
                {!selecting && (
                  <button
                    onClick={() => deleteStockLogs([log.id])}
                    aria-label={`Delete this entry for ${log.item_name}`}
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
