import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, History, Info, Settings2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Select } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { InventoryCategoryManager } from './InventoryCategoryManager'
import { useExpenseCategories } from '../../hooks/useExpenses'
import { FLOW_NOTICE, useFlow } from '../../hooks/useFlow'
import { applyPastPurchases, previewPastPurchases, setBudgetMapping } from '../../hooks/useBudgetMap'
import { effectiveBudget } from '../../lib/budgetMap'
import { sortCategoryTree } from '../../lib/categoryOrder'
import { inventoryCategoryStore } from '../../lib/stores'
import { cn } from '../../lib/cn'

// HOME → Categories: which budget category (MONEY) each item category
// (HOME and SHOP) is booked under when it is bought — in a shop (Confirm
// purchase) or online (Order online). Nothing is chosen at first: every
// item category then follows the default, exactly as the app always did
// (Groceries; appliances under Home & Appliances). A sub-category follows
// its main category unless it gets its own. Changing it only affects
// future purchases; past ones change only with "Apply the mapping to past
// purchases", after a preview.
export function BudgetMappingView({ parents, subsByParent }) {
  const flow = useFlow()
  const { categories: expenseCategories } = useExpenseCategories()
  const { rows: inventoryCategories } = inventoryCategoryStore.useRows()
  const [openIds, setOpenIds] = useState(() => new Set())
  const [preview, setPreview] = useState(null) // { changes, summary } | 'loading'
  const [managing, setManaging] = useState(false)

  const ctx = useMemo(() => ({ mapRows: flow.mapRows, expenseCategories, inventoryCategories }), [flow.mapRows, expenseCategories, inventoryCategories])
  const byId = useMemo(() => new Map(expenseCategories.map((c) => [c.id, c])), [expenseCategories])
  const nameOf = (id) => {
    const c = byId.get(id)
    if (!c) return 'No budget category'
    const parent = c.parent_id ? byId.get(c.parent_id) : null
    return parent ? `${parent.name} › ${c.name}` : c.name
  }
  // Each main A–Z followed by its subs A–Z, "Other" last.
  const options = useMemo(() => sortCategoryTree(expenseCategories).filter((c) => !c.parent_id || byId.has(c.parent_id)), [expenseCategories, byId])

  if (!flow.ready) {
    return (
      <Card className="space-y-1">
        <p className="text-xs font-bold text-amber-300">Budget categories by item category</p>
        <p className="text-xs text-[var(--color-text-soft)]">{flow.missing ? FLOW_NOTICE : 'Loading…'}</p>
      </Card>
    )
  }

  const toggle = (id) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const picker = (category, parentName = null) => {
    const own = flow.mapRows.find((r) => r.id === category.id && byId.has(r.expense_category_id))?.expense_category_id ?? ''
    const { target, source } = effectiveBudget(category, ctx)
    const fallback = source === 'own' ? null : parentName && source === 'main' ? `Same as ${parentName}: ${nameOf(target)}` : `Default: ${nameOf(target)}`
    const ownFallback = source === 'own' ? (category.parent_id ? `Same as ${parentName}` : 'Default (as before)') : fallback
    return (
      <Select
        value={own}
        onChange={(e) => setBudgetMapping(category.id, e.target.value || null)}
        aria-label={`Budget category for ${category.name}`}
        className={cn('text-xs py-2', !own && 'text-[var(--color-text-muted)]')}
      >
        <option value="">{ownFallback}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.parent_id ? `   › ${c.name}` : c.name}
          </option>
        ))}
      </Select>
    )
  }

  const openPreview = async () => {
    setPreview('loading')
    try {
      setPreview(await previewPastPurchases())
    } catch (error) {
      console.error(error)
      setPreview({ error: error.message ?? String(error) })
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="ghost" onClick={() => setManaging(true)} className="w-full text-xs min-h-9">
        <Settings2 size={14} /> Manage categories
      </Button>

      <Card className="space-y-1.5">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Item category → Budget category</p>
        <p className="text-[11px] text-[var(--color-text-soft)] flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          The item category says what a product is (HOME, SHOP). The budget category says what the money was for (MONEY). Each purchase — Confirm purchase or Order online — is booked under the budget category chosen here; a single expense can still be changed by hand. Changes apply to new purchases only.
        </p>
      </Card>

      <div className="space-y-2">
        {parents.map((p) => {
          const subs = subsByParent.get(p.id) ?? []
          const subsOpen = openIds.has(p.id)
          const custom = subs.filter((s) => flow.mapRows.some((r) => r.id === s.id)).length
          return (
            <div key={p.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2">
                <span className="flex items-center gap-2 min-w-0 text-xs font-bold text-[var(--color-text)]">
                  <CategoryIcon category={p.id} size={14} />
                  <span className="truncate">{p.name}</span>
                </span>
                {picker(p)}
              </div>
              {subs.length > 0 && (
                <button type="button" onClick={() => toggle(p.id)} aria-expanded={subsOpen} className="min-h-8 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-text-muted)]">
                  Sub-categories ({subs.length}){custom ? ` · ${custom} with their own` : ''}
                  <ChevronDown size={12} className={cn('transition-transform', subsOpen && 'rotate-180')} />
                </button>
              )}
              {subsOpen &&
                subs.map((sub) => (
                  <div key={sub.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 pl-5">
                    <span className="text-[11px] text-[var(--color-text-soft)] truncate">{sub.name}</span>
                    {picker(sub, p.name)}
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      <Card className="space-y-2">
        <p className="text-xs font-bold text-[var(--color-text)]">Past purchases</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">Past expenses never change by themselves. To book past purchases the way the mapping says, see first what would change.</p>
        <Button type="button" variant="ghost" onClick={openPreview} className="text-xs">
          <History size={14} /> Apply the mapping to past purchases…
        </Button>
      </Card>

      {managing && <InventoryCategoryManager onClose={() => setManaging(false)} />}

      {preview && <PastPurchasesPreview preview={preview} nameOf={nameOf} onClose={() => setPreview(null)} />}
    </div>
  )
}

function PastPurchasesPreview({ preview, nameOf, onClose }) {
  const [busy, setBusy] = useState(false)
  const loading = preview === 'loading'
  const count = loading || preview.error ? 0 : preview.changes.length
  const apply = async () => {
    setBusy(true)
    const { error } = await applyPastPurchases(preview.changes)
    setBusy(false)
    if (!error) onClose()
  }
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Apply the mapping to past purchases"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Apply the mapping to past purchases</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>
        {loading ? (
          <p className="text-xs text-[var(--color-text-muted)]">Looking through past purchases…</p>
        ) : preview.error ? (
          <p className="text-xs text-rose-400">Couldn't look through past purchases — check your connection. {preview.error}</p>
        ) : count === 0 ? (
          <p className="text-xs text-[var(--color-text-soft)]">Nothing would change: every past purchase is already booked the way the mapping says.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--color-text-soft)]">
              {count} expense{count === 1 ? '' : 's'} from past purchases would move. Nothing else changes (amounts, dates, stores stay), and Undo is offered.
            </p>
            <ul className="space-y-1.5">
              {preview.summary.map((m) => (
                <li key={`${m.from}>${m.to}`} className="rounded-2xl border border-[var(--color-border)] px-3 py-2 text-xs flex justify-between gap-2">
                  <span className="min-w-0">
                    <b className="text-[var(--color-text)]">{m.count}</b> from <b className="text-[var(--color-text)]">{nameOf(m.from)}</b> to <b className="text-[var(--color-text)]">{nameOf(m.to)}</b>
                  </span>
                  <span className="font-mono text-[var(--color-text-soft)] shrink-0">€{m.total.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            {count ? 'Cancel' : 'Close'}
          </Button>
          {count > 0 && (
            <Button type="button" className="flex-1" disabled={busy} onClick={apply}>
              {busy ? 'Moving…' : `Move ${count} expense${count === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
