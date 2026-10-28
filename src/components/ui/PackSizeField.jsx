import { DecimalHint, DecimalInput } from './DecimalInput'
import { cn } from '../../lib/cn'
import { decimalProblem } from '../../lib/decimal'
import { PACK_FIRST_TIME_TEXT, PACK_LATER_TEXT, packLabel, packMissingText, packTotalText, packUsualText } from '../../lib/packSize'

// The pack field of one line (lib/packSize.js packField): "pcs per box",
// what this purchase adds ("= 60 pcs") and what happens to the item's
// usual size. The same everywhere: Confirm purchase, MONEY "Add expense",
// Order online and Arrived. `later`: Order online, where it may stay empty
// until the order arrives. `ariaLabel` tells several lines apart.
export function PackSizeField({ pack, onChange, ariaLabel = null, later = false }) {
  const label = packLabel(pack)
  return (
    <div className={cn('rounded-xl border p-2 space-y-1', pack.blocking ? 'bg-amber-500/10 border-amber-400/30' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)]')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-[var(--color-text-soft)]">{label}</span>
        <DecimalInput value={pack.text} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel ?? label} className="w-20 text-sm p-2 text-right" />
      </div>
      <DecimalHint value={pack.text} />
      {pack.total !== null && <p className="text-[11px] text-[var(--color-text-muted)]">{packTotalText(pack)}</p>}
      {pack.differs && <p className="text-[11px] text-[var(--color-text-muted)]">{packUsualText(pack)}</p>}
      {pack.empty && !decimalProblem(pack.text) && <p className={cn('text-[11px]', pack.blocking ? 'text-amber-300' : 'text-[var(--color-text-muted)]')}>{later && !pack.blocking ? PACK_LATER_TEXT : packMissingText(pack)}</p>}
      {pack.firstTime && <p className="text-[11px] text-[var(--color-text-muted)]">{PACK_FIRST_TIME_TEXT}</p>}
    </div>
  )
}
