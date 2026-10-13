import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { cn } from '../../lib/cn'

const PLACES = [
  { key: 'shop', what: 'Things you keep in stock, bought in a shop', where: 'SHOP → put them in the cart → Confirm purchase' },
  { key: 'online', what: 'Things you keep in stock, ordered online', where: 'SHOP → Order online (they wait under "On the way")' },
  { key: 'orders', what: 'One-off purchases that are not in HOME', where: 'MONEY → Orders (online) or Add expense' },
]

// "Where do I record this?" — one tap opens three short lines, so it is
// clear which section a purchase belongs in and nothing is recorded twice.
// `here`: the line that is about this screen, shown first.
export function WhereToRecord({ here = null, className }) {
  const [open, setOpen] = useState(false)
  const lines = here ? [...PLACES.filter((p) => p.key === here), ...PLACES.filter((p) => p.key !== here)] : PLACES
  return (
    <div className={cn('text-[11px] text-[var(--color-text-muted)]', className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-8 inline-flex items-center gap-1.5 font-bold">
        <Info size={13} className="text-[var(--color-accent)]" /> Where do I record a purchase?
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
          {lines.map((p) => (
            <li key={p.key}>
              <span className="text-[var(--color-text-soft)]">{p.what}:</span> <b className="text-[var(--color-text)]">{p.where}</b>
            </li>
          ))}
          <li className="pt-0.5">Each purchase is recorded once: an order made from SHOP already has its expense in MONEY.</li>
        </ul>
      )}
    </div>
  )
}
