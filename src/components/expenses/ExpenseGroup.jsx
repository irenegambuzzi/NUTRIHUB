import { useState } from 'react'
import { ChevronDown, Pencil, ShoppingCart, Store, Trash2 } from 'lucide-react'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { parseLocalDate } from '../../lib/week'
import { ShopTag } from '../ui/ShopIcon'
import { cn } from '../../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value

// A main category's expenses for one day. Collapsed: one line with the
// total. Opened: the expenses grouped by sub-category. `shopOf(shopId)` →
// the store of an expense (shown in the header when they all share one).
// For a shopping trip (`trip`: the trip, `tripShop`: its store) the row is
// that trip's part in this budget category — "Conad · 16/10/2026 · 10
// items" — and the store can be changed for the whole trip
// (`onChangeTripStore`).
export function ExpenseGroup({ group, color, styleFor, subName, shopOf, onEdit, onDelete, trip = null, tripShop = null, onChangeTripStore = null }) {
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
          {trip ? (
            <div className="min-w-0">
              <p className="font-bold text-[var(--color-text)] flex items-center gap-1.5 min-w-0">
                <ShoppingCart size={12} className="shrink-0 text-[var(--color-primary)]" />
                <span className="truncate">
                  {tripShop?.name ?? 'Shopping trip'} · {parseLocalDate(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} · {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </p>
              <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
                {main?.name || 'Uncategorized'} · {parseLocalDate(date).toLocaleDateString('en-GB')} · {payers.join(', ')}
              </span>
            </div>
          ) : (
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
          )}
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
          {trip && onChangeTripStore && (
            <button
              type="button"
              onClick={() => onChangeTripStore(trip)}
              className="mt-2 min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]"
            >
              <Store size={12} /> Change the store of the whole trip
            </button>
          )}
        </div>
      )}
    </div>
  )
}
