import { cn } from '../../lib/cn'
import { ONE_TIME_BADGE, ONE_TIME_LABEL, SMALL_LABEL } from '../../lib/inventoryStyles'

// The grey "1× purchase" label of a one-time purchase (see lib/oneTime.js),
// exactly the size of the "New Item" label.
export function OneTimeBadge({ className }) {
  return (
    <span title="One-time purchase" className={cn(SMALL_LABEL, ONE_TIME_BADGE, 'whitespace-nowrap', className)}>
      {ONE_TIME_LABEL}
    </span>
  )
}
