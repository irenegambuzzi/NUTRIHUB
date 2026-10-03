import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { parseLocalDate } from '../../lib/week'
import { cn } from '../../lib/cn'

const paidByLabel = (value) => PAID_BY_OPTIONS.find((o) => o.value === value)?.label || value

// A main category's expenses for one day. Collapsed: one line with the
// total. Opened: the expenses grouped by sub-category.
export function ExpenseGroup({ group, color, subName, onDelete }) {
  const [open, setOpen] = useState(false)
  const { date, main, items, total } = group
  const payers = [...new Set(items.map((e) => paidByLabel(e.paid_by)))]
  const single = items.length === 1 ? items[0] : null
  const subtitle = single?.description || `${items.length} expense${items.length === 1 ? '' : 's'}`

  // Sub-category sections, with expenses filed directly under the main
  // category first (no header).
  const sections = []
  for (const e of items) {
    const name = subName(e.category_id)
    let section = sections.find((s) => s.name === name)
    if (!section) sections.push((section = { name, items: [], total: 0 }))
    section.items.push(e)
    section.total += Number(e.amount || 0)
  }
  sections.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : b.total - a.total))

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full p-3 flex justify-between items-center gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', color.chip.solid)} />
          <div className="min-w-0">
            <p className="font-bold text-[var(--color-text)]">{main?.name || 'Uncategorized'}</p>
            <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
              {parseLocalDate(date).toLocaleDateString('en-GB')} · {subtitle} · {payers.join(', ')}
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
                  <span>{section.name}</span>
                  <span className="font-mono">€{section.total.toFixed(2)}</span>
                </p>
              )}
              {section.items.map((e) => (
                <div key={e.id} className="flex justify-between items-center gap-2 py-1 pl-2 border-l-2 border-[var(--color-border)]">
                  <div className="min-w-0">
                    <p className="text-[var(--color-text)] truncate">{e.description || section.name || main?.name || 'Expense'}</p>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{paidByLabel(e.paid_by)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
