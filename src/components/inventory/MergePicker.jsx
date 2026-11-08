import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '../ui/Button'
import { SearchBox } from '../ui/SearchBox'
import { cn } from '../../lib/cn'
import { groupMergeNote, mergeButtonText, mergeRows } from '../../lib/itemNames'
import { searchRank } from '../../lib/pantryFilters'

// "Merge other items into this one…" (plan 9N, K109–K112): which items go
// into `target`, on top of its editor. Empty search: the items of the
// target's main category, A–Z; typing: every item that matches, by the HOME
// search (other names too). Ticked items stay on top under "Chosen", whatever
// the search says. A variant of the target is always chosen and can't be
// unticked (K70); stock that can't be converted is shown greyed with why.
// `onMerge(ids)` asks the question and merges → whether it is done.
export function MergePicker({ target, items, categoryName = () => '', onMerge, onClose }) {
  const rows = useMemo(() => mergeRows(target, items), [target, items])
  const variants = rows.filter((row) => row.variant)
  const [chosen, setChosen] = useState(() => new Set(variants.map((row) => row.item.id)))
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const query = search.trim().toLowerCase()

  const toggle = (id) =>
    setChosen((now) => {
      const next = new Set(now)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const picked = rows.filter((row) => chosen.has(row.item.id))
  const others = rows.filter((row) => !chosen.has(row.item.id))
  const listed = query
    ? others
        .map((row) => ({ row, rank: searchRank(row.item, query, categoryName) }))
        .filter((r) => r.rank >= 0)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => r.row)
    : others.filter((row) => row.item.category_id === target.category_id)

  const merge = async () => {
    setBusy(true)
    const done = await onMerge(picked.map((row) => row.item.id))
    setBusy(false)
    if (done) onClose()
  }

  const row = (r) => {
    const locked = r.variant
    const ticked = chosen.has(r.item.id)
    return (
      <label key={r.item.id} className={cn('flex items-start gap-2.5 min-h-9 py-1.5', r.blocked ? 'opacity-60 cursor-default' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={ticked}
          disabled={locked || Boolean(r.blocked)}
          onChange={() => toggle(r.item.id)}
          aria-label={`Merge ${r.item.name} into ${target.name}`}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-primary)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-[var(--color-text)] break-words">
            {r.label}
            {locked && ' (variant)'}
          </span>
          {r.blocked && <span className="block text-[10px] text-[var(--color-text-muted)] break-words">{r.blocked}</span>}
        </span>
      </label>
    )
  }

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Merge into "${target.name}"`}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-3"
      >
        <div className="flex justify-between items-start gap-2">
          <p className="text-sm font-extrabold text-[var(--color-primary)] min-w-0 break-words">Merge into "{target.name}"</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1 shrink-0">
            <X size={18} />
          </button>
        </div>
        {variants.length > 0 && <p className="text-[11px] text-[var(--color-text-muted)]">{groupMergeNote(target, variants.length)}</p>}
        <SearchBox value={search} onChange={setSearch} placeholder="Search your items…" />

        {picked.length > 0 && (
          <div role="group" aria-label="Chosen" className="rounded-2xl border border-[var(--color-border)] px-3 py-1.5">
            <p className="text-[11px] font-bold text-[var(--color-primary)] pt-1">Chosen ({picked.length})</p>
            {picked.map(row)}
          </div>
        )}

        <div role="group" aria-label="Items" className="px-3">
          {listed.map(row)}
          {listed.length === 0 && (
            <p className="text-[11px] text-[var(--color-text-muted)] py-2">
              {query ? `Nothing else matches "${search.trim()}".` : 'No other items in this category — search to find more.'}
            </p>
          )}
        </div>

        <Button type="button" onClick={merge} disabled={busy || picked.length === 0} className="w-full">
          {mergeButtonText(picked.length)}
        </Button>
      </div>
    </div>,
    document.body
  )
}
