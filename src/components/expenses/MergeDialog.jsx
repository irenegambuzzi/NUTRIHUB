import { useState } from 'react'
import { AlertTriangle, Merge, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Label } from '../ui/Field'
import { ShopTag } from '../ui/ShopIcon'
import { ShopPicker } from './ShopPicker'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { joinablePurchases, mergeProblem, mergeStore, selectBlock } from '../../lib/merge'
import { money } from '../../lib/pricing'
import { parseLocalDate } from '../../lib/week'
import { addToPurchase, mergeExpenses } from '../../hooks/useMerge'
import { cn } from '../../lib/cn'

const payerLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value
const dateLabel = (date) => parseLocalDate(date).toLocaleDateString('en-GB')
const sum = (rows) => Math.round(rows.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100

// "Select" in Expenses: the expenses on screen, newest first, each with a
// tick box — only single expenses: one that is part of a purchase or an
// online order's expense says so instead. Below: how many are ticked and
// "Merge into one purchase", or why they can't be merged.
//   expenses          the expenses shown (period and person)
//   orderExpenseIds   expense ids of online orders
//   names(categoryId) → { main, sub }; shopOf(shopId) → store
export function SelectExpenses({ expenses, orderExpenseIds, names, shopOf, trips, allExpenses, onDone }) {
  const [picked, setPicked] = useState(() => new Set())
  const [merging, setMerging] = useState(false)
  const selected = expenses.filter((e) => picked.has(e.id) && !selectBlock(e, orderExpenseIds))
  const problem = mergeProblem(selected)
  const joinable = joinablePurchases(selected, trips, allExpenses)
  // A new purchase needs two or more; one alone can join an existing one.
  const canMerge = !problem || joinable.length > 0
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <div className="flex justify-between items-center gap-2">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Select expenses</p>
          <button type="button" onClick={onDone} aria-label="Stop selecting" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Tick single expenses of the same day, paid by the same person, to merge them into one purchase. Their amounts and categories don't change.
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-text-soft)]">
            {selected.length} ticked · <span className="font-mono">{money(sum(selected))}</span>
          </span>
          <Button type="button" onClick={() => setMerging(true)} disabled={!canMerge} className="px-3 py-1.5 text-xs">
            <Merge size={14} /> Merge into one purchase
          </Button>
        </div>
        {!canMerge && selected.length > 0 && (
          <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {problem}
          </p>
        )}
      </Card>

      {merging && selected.length > 0 && (
        <MergeForm
          key={[...picked].sort().join(',')}
          selected={selected}
          joinable={joinable}
          shopOf={shopOf}
          onCancel={() => setMerging(false)}
          onMerged={() => {
            setMerging(false)
            setPicked(new Set())
            onDone()
          }}
        />
      )}

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs px-3">
        {expenses.length === 0 && <p className="py-4 text-center text-[var(--color-text-muted)]">No expenses in this period.</p>}
        {expenses.map((e) => {
          const block = selectBlock(e, orderExpenseIds)
          const { main, sub } = names(e.category_id)
          const shop = shopOf(e.shop_id)
          return (
            <label key={e.id} className={cn('flex items-center gap-3 py-2 border-t first:border-t-0 border-[var(--color-border)] min-h-11', block ? 'opacity-60' : 'cursor-pointer')}>
              {block ? (
                <span className="w-4 shrink-0" />
              ) : (
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.description || 'expense'}`} className="w-4 h-4 accent-[var(--color-primary)] shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="text-[var(--color-text)] block truncate">{e.description || sub || main || 'Expense'}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
                  {dateLabel(e.expense_date)} · {main ?? 'Uncategorized'} · {shop ? <ShopTag shop={shop} /> : 'no store'} · {payerLabel(e.paid_by)}
                  {block && ` · ${block}`}
                </span>
              </span>
              <span className="font-mono text-[var(--color-text-soft)] shrink-0">€{Number(e.amount).toFixed(2)}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// The merge form, inline: the store (prefilled when the ticked expenses
// share one; to choose when they differ or have none), date and payer
// (read-only: they must be the same). Or "Add to an existing purchase" of
// that day and payer. The new purchase's id is made once, so pressing
// again saves it once.
export function MergeForm({ selected, joinable, shopOf, onCancel, onMerged }) {
  const [id] = useState(() => crypto.randomUUID())
  const store = mergeStore(selected)
  const canMakeNew = !mergeProblem(selected)
  const [target, setTarget] = useState(canMakeNew ? 'new' : joinable[0]?.id ?? 'new')
  const [shopId, setShopId] = useState(store.shopId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = sum(selected)
  const { expense_date: date, paid_by: payer } = selected[0]
  const differ = new Set(selected.map((e) => e.shop_id ?? null)).size > 1

  const save = async () => {
    if (busy) return
    if (target === 'new' && !shopId) return setError('Choose the store for this purchase.')
    setBusy(true)
    const ids = selected.map((e) => e.id)
    const { error: failed } = target === 'new' ? await mergeExpenses({ id, expenseIds: ids, shopId, total }) : await addToPurchase({ tripId: target, expenseIds: ids, total })
    setBusy(false)
    if (failed) return setError(failed.message)
    onMerged()
  }

  return (
    <Card className="space-y-3" data-unsaved>
      <p className="text-xs font-bold text-[var(--color-primary)] uppercase">
        Merge {selected.length} expense{selected.length === 1 ? '' : 's'} · {money(total)}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <Label>Date</Label>
          <p className="text-[var(--color-text)] min-h-9 flex items-center">{dateLabel(date)}</p>
        </div>
        <div>
          <Label>Paid by</Label>
          <p className="text-[var(--color-text)] min-h-9 flex items-center">{payerLabel(payer)}</p>
        </div>
      </div>

      {joinable.length > 0 && (
        <div className="space-y-1" role="radiogroup" aria-label="Merge into">
          {canMakeNew && (
            <label className="flex items-center gap-2 min-h-9 text-xs text-[var(--color-text)] cursor-pointer">
              <input type="radio" name="merge-target" checked={target === 'new'} onChange={() => setTarget('new')} className="accent-[var(--color-primary)]" />
              A new purchase
            </label>
          )}
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] pt-1">Add to an existing purchase</p>
          {joinable.map((t) => (
            <label key={t.id} className="flex items-center gap-2 min-h-9 text-xs text-[var(--color-text)] cursor-pointer">
              <input type="radio" name="merge-target" checked={target === t.id} onChange={() => setTarget(t.id)} className="accent-[var(--color-primary)]" />
              {shopOf(t.shop_id)?.name ?? 'Purchase'} · {dateLabel(t.trip_date)} · {money(t.total)}
            </label>
          ))}
        </div>
      )}

      {target === 'new' && (
        <div className="space-y-1">
          <ShopPicker value={shopId} onChange={(v) => { setShopId(v); setError('') }} label="Store of the purchase" />
          {store.mustChoose && (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              {differ ? 'These expenses have different stores' : 'These expenses have no store'} — choose the store for this purchase. Each expense takes it while merged and gets its own store back with Split.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={busy} className="flex-1">
          <Merge size={16} /> {busy ? 'Merging…' : target === 'new' ? 'Merge' : 'Add to purchase'}
        </Button>
      </div>
    </Card>
  )
}
