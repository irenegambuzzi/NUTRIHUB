import { useState } from 'react'
import { AlertTriangle, Pencil, Wallet } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { cn } from '../../lib/cn'
import { money } from '../../lib/pricing'
import { STATUS_STYLES } from '../../lib/inventoryStyles'

// Budget limit for the whole list (stored in budget_settings), with the
// total split by who pays.
export function BudgetCard({ budget, listTotal, boughtTotal, payerTotals, overBudget, unpricedCount, unknownTotalCount, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const pct = budget ? Math.min(listTotal / budget, 1) : 0

  // Stays open if saving fails, so the amount can be saved again.
  const save = async (amount) => {
    const { error } = await onSave(amount)
    if (!error) setEditing(false)
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
          {unknownTotalCount > 0 && (
            <p className={cn('text-[11px] flex items-start gap-1.5', STATUS_STYLES.low.text)}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {unknownTotalCount} item{unknownTotalCount === 1 ? "'s" : "s'"} total can't be worked out (marked "?"): the quantity's unit can't be converted to
              the price's unit. {unknownTotalCount === 1 ? "It isn't" : "They aren't"} counted in the totals or the budget.
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
