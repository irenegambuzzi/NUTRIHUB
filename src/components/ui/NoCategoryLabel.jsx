import { cn } from '../../lib/cn'
import { NO_CATEGORY, SMALL_LABEL } from '../../lib/inventoryStyles'

// The grey "No category" label of an item saved without a category: the
// same size and style as "New Item".
export function NoCategoryLabel({ className }) {
  return <span className={cn(SMALL_LABEL, NO_CATEGORY.className, 'whitespace-nowrap', className)}>{NO_CATEGORY.label}</span>
}
