import { NoCategoryLabel } from '../ui/NoCategoryLabel'
import { useState } from 'react'
import { ChevronDown, Pencil, RotateCcw, ShoppingCart, Split, Store, Trash2 } from 'lucide-react'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { parseLocalDate } from '../../lib/week'
import { ShopTag } from '../ui/ShopIcon'
import { cn } from '../../lib/cn'
import { purchaseSections } from '../../lib/moneyList'
import { purchaseUndo } from '../../lib/trips'
import { lineHistory, purchaseCouponNote } from '../../lib/discounts'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value

// A main category's expenses for one day. Collapsed: one line with the
// total. Opened: the expenses grouped by sub-category. `shopOf(shopId)` →
// the store of an expense (shown in the header when they all share one).
// A purchase has its own row (PurchaseGroup, below).
export function ExpenseGroup({ group, color, styleFor, subName, shopOf, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const { date, main, items, total } = group
  const payers = [...new Set(items.map((e) => paidByLabel(e.paid_by)))]
  const single = items.length === 1 ? items[0] : null
  const subtitle = single?.description || `${items.length} expense${items.length === 1 ? '' : 's'}`
  const stores = new Set(items.map((e) => e.shop_id ?? null))
  const sharedShop = stores.size === 1 ? shopOf?.([...stores][0]) : null

  // Sub-category sections (expenses filed directly under the main category
  // have no header), the one with the most recent expense first. `items`
  // arrive newest first, so a section is placed where its newest one is.
  const sections = []
  for (const e of items) {
    const name = subName(e.category_id)
    let section = sections.find((s) => s.name === name)
    if (!section) sections.push((section = { name, categoryId: e.category_id, items: [], total: 0 }))
    section.items.push(e)
    section.total += Number(e.amount || 0)
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full p-3 flex justify-between items-center gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <span data-dot="main" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color.hex }} />
          <div className="min-w-0">
            <p className="font-bold text-[var(--color-text)]">{main?.name || 'Uncategorized'}</p>
            <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
              {parseLocalDate(date).toLocaleDateString('en-GB')} · {subtitle}
              {sharedShop && (
                <>
                  {' · '}
                  <ShopTag shop={sharedShop} />
                </>
              )}{' '}
              · {payers.join(', ')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
          <ChevronDown size={14} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-3 pb-2">
          {sections.map((section) => (
            <div key={section.name ?? '_main'} className="pt-2">
              {section.name && (
                <p className="flex justify-between text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 flex items-center justify-center shrink-0">
                      <span data-dot="sub" className="w-[5px] h-[5px] rounded-full" style={{ background: styleFor(section.categoryId).hex }} />
                    </span>
                    {section.name}
                  </span>
                  <span className="font-mono">€{section.total.toFixed(2)}</span>
                </p>
              )}
              {section.items.map((e) => (
                <div key={e.id} className="flex justify-between items-center gap-2 py-1 pl-2 border-l-2 border-[var(--color-border)]">
                  <div className="min-w-0">
                    <p className="text-[var(--color-text)] truncate">{e.description || section.name || main?.name || 'Expense'}</p>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {!e.category_id && <NoCategoryLabel className="mr-1" />}
                      {paidByLabel(e.paid_by)}
                      {shopOf?.(e.shop_id) && (
                        <>
                          {' · '}
                          <ShopTag shop={shopOf(e.shop_id)} />
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onEdit(e)}
                      className="text-[var(--color-icon-muted)] hover:text-[var(--color-primary)] transition w-9 h-9 -my-1.5 flex items-center justify-center"
                      title="Edit expense"
                      aria-label="Edit expense"
                    >
                      <Pencil size={13} />
                    </button>
                    <span className="font-mono text-[var(--color-text-soft)]">€{Number(e.amount).toFixed(2)}</span>
                    <button
                      onClick={() => onDelete(e)}
                      className="text-[var(--color-icon-muted)] hover:text-red-400 transition"
                      title="Delete expense"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const shortDate = (date) => parseLocalDate(date).toLocaleDateString('en-GB')
const quantityLabel = (line) => (line && Number(line.quantity) > 0 ? `${Math.round(Number(line.quantity) * 100) / 100} ${line.unit || 'pcs'}` : null)

// One purchase (a SHOP trip, a MONEY purchase or merged expenses — they
// look and work the same). Collapsed: store · date · total, one dot per
// main category in it, payers. Opened: the items by main category with a
// subtotal each; every item with its sub-category (small dot), quantity,
// amount, and edit / delete as for any expense; then "Change the store of
// the whole purchase" and Reopen / Undo purchase / Split by its source.
//   group        { date, items, total } — the expenses shown (with a
//                category filter on, only that category's part)
//   fullTotal    the whole purchase, when only a part is shown
//   mainOf(categoryId), subName(categoryId), styleFor(categoryId)
//   lineOf(expense) → its purchase line (quantity, unit), if any
//   onUndo(trip, items) → Reopen / Undo purchase / Split
//   onSplitMerged(trip) → only the merged expenses out (SHOP/MONEY purchase)
export function PurchaseGroup({ group, trip, shop, fullTotal = null, mainOf, subName, styleFor, lineOf = () => null, onEdit, onDelete, onChangeStore = null, onUndo = null, onSplitMerged = null }) {
  const [open, setOpen] = useState(false)
  const { items, total } = group
  const date = trip?.trip_date ?? group.date
  const sections = purchaseSections(items, mainOf)
  const payers = [...new Set(items.map((e) => paidByLabel(e.paid_by)))]
  const undo = purchaseUndo(trip?.source)
  const hasMerged = items.some((e) => e.merged_at)
  const partial = fullTotal != null && Math.abs(fullTotal - total) > 0.004
  const couponNote = purchaseCouponNote(trip)

  return (
    <div data-purchase className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full p-3 flex justify-between items-center gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <ShoppingCart size={14} className="shrink-0 text-[var(--color-primary)]" />
          <div className="min-w-0">
            <p className="font-bold text-[var(--color-text)] truncate">
              {shop?.name ?? 'Purchase'} · {shortDate(date)}
            </p>
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 min-w-0">
              {sections.map((section) => (
                <span key={section.key} data-dot="main" title={section.name} className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleFor(section.main?.id).hex }} />
              ))}
              <span className="truncate ml-0.5">
                {items.length} item{items.length === 1 ? '' : 's'} · {payers.join(', ')}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-right">
            <span className="font-mono font-bold text-[var(--color-accent)] block">€{total.toFixed(2)}</span>
            {couponNote && <span className="text-[10px] text-emerald-300 block">{couponNote}</span>}
            {partial && <span className="text-[10px] text-[var(--color-text-muted)] block">of total €{fullTotal.toFixed(2)}</span>}
          </span>
          <ChevronDown size={14} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-3 pb-2">
          {sections.map((section) => (
            <div key={section.key} className="pt-2">
              <p className="flex justify-between text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">
                <span className="flex items-center gap-1.5">
                  <span data-dot="main" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleFor(section.main?.id).hex }} />
                  {section.name}
                </span>
                <span className="font-mono">€{section.total.toFixed(2)}</span>
              </p>
              {section.items.map((e) => {
                const sub = subName(e.category_id)
                const line = lineOf(e)
                const quantity = quantityLabel(line)
                const history = lineHistory(line)
                return (
                  <div key={e.id} className="flex justify-between items-center gap-2 py-1 pl-2 border-l-2 border-[var(--color-border)]">
                    <div className="min-w-0">
                      <p className="text-[var(--color-text)] truncate">{e.description || sub || section.name || 'Expense'}</p>
                      <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 min-w-0">
                        {sub && (
                          <>
                            <span className="w-2.5 h-2.5 flex items-center justify-center shrink-0">
                              <span data-dot="sub" className="w-[5px] h-[5px] rounded-full" style={{ background: styleFor(e.category_id).hex }} />
                            </span>
                            <span className="truncate">{sub}</span>
                            <span>·</span>
                          </>
                        )}
                        {quantity && (
                          <>
                            <span className="shrink-0">{quantity}</span>
                            <span>·</span>
                          </>
                        )}
                        {!e.category_id && <NoCategoryLabel className="shrink-0" />}
                        <span className="shrink-0">{paidByLabel(e.paid_by)}</span>
                        {e.merged_at && <span className="shrink-0">· merged</span>}
                      </span>
                      {history && <span className="text-[10px] font-bold text-emerald-300 block">{history}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onEdit(e)}
                        className="text-[var(--color-icon-muted)] hover:text-[var(--color-primary)] transition w-9 h-9 -my-1.5 flex items-center justify-center"
                        title="Edit expense"
                        aria-label="Edit expense"
                      >
                        <Pencil size={13} />
                      </button>
                      <span className="font-mono text-[var(--color-text-soft)]">€{Number(e.amount).toFixed(2)}</span>
                      <button onClick={() => onDelete(e)} className="text-[var(--color-icon-muted)] hover:text-red-400 transition" title="Delete expense" aria-label="Delete expense">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-x-4">
            {trip && onChangeStore && (
              <button type="button" onClick={() => onChangeStore(trip)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
                <Store size={12} /> Change the store of the whole purchase
              </button>
            )}
            {trip && onUndo && (
              <button type="button" onClick={() => onUndo(trip, items)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-muted)]">
                {undo.kind === 'split' ? <Split size={12} /> : <RotateCcw size={12} />} {undo.label}
              </button>
            )}
            {trip && onSplitMerged && hasMerged && undo.kind !== 'split' && (
              <button type="button" onClick={() => onSplitMerged(trip)} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-muted)]">
                <Split size={12} /> Split merged expenses
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
