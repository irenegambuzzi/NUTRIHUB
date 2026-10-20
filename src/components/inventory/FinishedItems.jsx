import { useState } from 'react'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from '../ui/CategoryIcon'
import { OneTimeBadge } from '../ui/OneTimeBadge'
import { cn } from '../../lib/cn'

// HOME's "Finished one-time items (N)": one-time purchases used up, kept
// (never deleted) so buying the same name again brings them back. Closed
// at first. "Not one-time" makes one a normal item again — then at 0 it is
// Out and goes on the SHOP list like any other. `groupName(id)` names a
// variant's group.
export function FinishedItems({ items, groupName = () => null, onNotOneTime, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full min-h-9 flex items-center justify-between gap-2 text-left">
        <span className="text-xs font-bold text-[var(--color-text-soft)] uppercase">Finished one-time items ({items.length})</span>
        <ChevronDown size={14} className={cn('text-[var(--color-icon-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <p className="text-[11px] text-[var(--color-text-muted)]">Used up and kept here. Buying the same name again brings it back.</p>
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <li key={item.id} className="py-2 flex items-center gap-2">
                <CategoryIcon category={item.category_id} size={14} className="text-[var(--color-text-muted)] shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text)]">
                    <span className="truncate">{item.name}</span>
                    <OneTimeBadge className="shrink-0" />
                  </span>
                  {item.group_id && groupName(item.group_id) && <span className="block text-[10px] text-[var(--color-text-muted)]">in {groupName(item.group_id)}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onNotOneTime(item)}
                  title="It becomes a normal item: at 0 it is Out and goes on the SHOP list."
                  className="min-h-9 px-2.5 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text)] shrink-0"
                >
                  Not one-time
                </button>
                <button type="button" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`} className="w-9 h-9 flex items-center justify-center text-[var(--color-icon-muted)] hover:text-[var(--color-text)] shrink-0">
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => onDelete(item)} aria-label={`Delete ${item.name}`} className="w-9 h-9 flex items-center justify-center text-[var(--color-icon-muted)] hover:text-rose-400 shrink-0">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-[var(--color-text-muted)]">"Not one-time": it becomes a normal item — at 0 it is Out and goes on the SHOP list.</p>
        </>
      )}
    </section>
  )
}
