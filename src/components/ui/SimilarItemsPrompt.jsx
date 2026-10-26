import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/cn'
import { CHANGE_ON_CARD, CREATE_NEW_HINT, alreadyListedText, createNewLabel, moreMatchesText } from '../../lib/similarItems'

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
// label }]), "4 more — type more of the name" when more matched than
// are shown (`more`) and, when `onCreateNew` is given, "Create new “…”".
// `title` replaces the first line (the HOME editor's "… is already in HOME").
export function SimilarItemsQuestion({ name, options, more = 0, onPick, onCreateNew = null, title = 'Similar item in HOME:', busy = false, scroll = true, className = '' }) {
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
      {more > 0 && <p className="text-[11px] text-[var(--color-text-muted)] px-1">{moreMatchesText(more)}</p>}
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

// "Already on your SHOP list: Dish soap — in the cart" with "OK" (nothing
// changes) and, to buy or in the cart, "Change the quantity or price on
// its card." with "Go to card" (`onGoToCard`); ordered online — the order
// can't change — "Add anyway" (`onAddAnyway`, a new card to buy).
export function AlreadyListed({ found, onOk, onGoToCard, onAddAnyway, busy = false, className = '' }) {
  const ref = useShown(true)
  const ordered = found.state === 'ordered'
  return (
    <div ref={ref} role="group" aria-label="Already on your SHOP list" className={cn(box, className)}>
      <p className="text-[11px] text-yellow-300 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {alreadyListedText(found)}
      </p>
      {!ordered && <p className="text-[11px] text-[var(--color-text-muted)] px-1">{CHANGE_ON_CARD}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={onOk} className={cn(choice, 'w-auto px-4')}>
          OK
        </button>
        <button type="button" disabled={busy} onClick={ordered ? onAddAnyway : onGoToCard} className={cn(choice, 'w-auto flex-1')}>
          {ordered ? 'Add anyway' : 'Go to card'}
        </button>
      </div>
    </div>
  )
}
