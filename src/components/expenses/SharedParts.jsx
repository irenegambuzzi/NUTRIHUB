import { partOfText, partsLine, realExpense, staleNote } from '../../lib/sharedParts'

// Under a Shared expense with parts (plan 9K): "{label} €100.00 · {label}
// €168.58", and in amber "Parts were for … Edit to check." when its amount
// was changed elsewhere since. Nothing for any other expense.
export function SharedPartsNote({ expense }) {
  const real = realExpense(expense)
  const line = partsLine(real)
  if (!line) return null
  const stale = staleNote(real)
  return (
    <>
      <span className="text-[10px] text-[var(--color-text-muted)] block break-words">{line}</span>
      {stale && <span className="text-[10px] text-amber-300 block break-words">{stale}</span>}
    </>
  )
}

// An expense's amount; in a personal view a Shared expense's part, with
// "of €268.58" under it.
export function PartAmount({ expense, className = '' }) {
  const amount = `€${Number(expense.amount).toFixed(2)}`
  const of = partOfText(expense)
  if (!of) return <span className={`font-mono ${className}`}>{amount}</span>
  return (
    <span className="text-right leading-tight">
      <span className={`font-mono block ${className}`}>{amount}</span>
      <span className="text-[10px] text-[var(--color-text-muted)] block">{of}</span>
    </span>
  )
}
