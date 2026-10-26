import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/cn'
import { CREATE_NEW_HINT, alreadyListedText, createNewLabel } from '../../lib/similarItems'

// The inline questions of the similar-name safety net (plan 9G), shown
// under the name field — never a popup. Long names wrap, so nothing
// scrolls sideways on a phone; every button is at least 36 px high.

const box = 'rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-2 space-y-1.5'

// The question appears after a press of Add / Save, which may be further
// down the form: it is scrolled into view once (`scroll`), so it is seen.
function useShown(scroll) {
  const ref = useRef(null)
  useEffect(() => {
    if (scroll) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [scroll])
  return ref
}

const choice =
  'w-full min-h-9 px-3 py-1.5 rounded-xl text-left text-xs font-bold bg-[var(--color-surface-soft)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] disabled:opacity-50'

// "Similar item in HOME:" with a button per item (`options`: [{ item,
// label }]) and, when `onCreateNew` is given, "Create new “…”".
// `title` replaces the first line (the HOME editor's "… is already in HOME").
export function SimilarItemsQuestion({ name, options, onPick, onCreateNew = null, title = 'Similar item in HOME:', busy = false, scroll = true, className = '' }) {
  const ref = useShown(scroll)
  return (
    <div ref={ref} role="group" aria-label="Similar item in HOME" className={cn(box, className)}>
      <p className="text-[11px] text-yellow-300 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {title}
      </p>
      {options.map(({ item, label }) => (
        <button key={item.id} type="button" disabled={busy} onClick={() => onPick(item)} className={choice}>
          {label}
        </button>
      ))}
      {onCreateNew && (
        <button type="button" disabled={busy} onClick={onCreateNew} className={cn(choice, 'font-semibold text-[var(--color-text-muted)]')}>
          {createNewLabel(name)}
        </button>
      )}
    </div>
  )
}

// After "Create new": a nudge to make the name clearer (it stays editable).
export function CreateNewHint({ className = '' }) {
  return <p className={cn('text-[11px] text-[var(--color-text-muted)]', className)}>{CREATE_NEW_HINT}</p>
}

// "Already on your SHOP list: Dish soap — in the cart" with "OK" and one
// more action ("Add 1 more (now 2 pcs)" or "Add anyway").
export function AlreadyListed({ found, actionLabel, onAction, onOk, busy = false, className = '' }) {
  const ref = useShown(true)
  return (
    <div ref={ref} role="group" aria-label="Already on your SHOP list" className={cn(box, className)}>
      <p className="text-[11px] text-yellow-300 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {alreadyListedText(found)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={onOk} className={cn(choice, 'w-auto px-4')}>
          OK
        </button>
        <button type="button" disabled={busy} onClick={onAction} className={cn(choice, 'w-auto flex-1')}>
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
