import { cn } from '../../lib/cn'
import { ONE_TIME_BADGE } from '../../lib/inventoryStyles'

// The grey "1×" label of a one-time purchase (see lib/oneTime.js).
export function OneTimeBadge({ className }) {
  return (
    <span title="One-time purchase" className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full', ONE_TIME_BADGE, className)}>
      1×
    </span>
  )
}
