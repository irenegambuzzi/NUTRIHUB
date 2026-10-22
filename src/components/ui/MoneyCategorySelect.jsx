import { Settings2 } from 'lucide-react'
import { Select } from './Field'
import { cn } from '../../lib/cn'
import { splitCategory } from '../../lib/moneyList'

// The one way to pick a MONEY category (expense or income) from a list:
// the main category on the left, its sub-categories on the right ("No
// sub-category" first), like "HOME item category". Mains and subs come
// in the order of `mainCategories` / `subsOf` (lib/moneyList.categoryTree:
// A–Z, "Other" last). Still one category id: `value` is the id ('' or
// null for none) and onChange(id or null, { mainId, subId }) gets the
// sub when one is picked, else the main.
//   emptyLabel  the first option of the left list, which means "none"
//               ("Uncategorized", or the mapping screen's default); null
//               when a category must be picked (income)
//   onManage    shows the small sliders button that opens the manager
export function MoneyCategorySelect({ value, onChange, mainCategories, subsOf, label = 'Budget category', subLabel = `${label}: sub-category`, emptyLabel = 'Uncategorized', onManage, manageLabel = 'Manage budget categories', manageTitle = 'Add or delete budget categories', selectClassName, className }) {
  const { mainId, subId } = splitCategory(value, mainCategories, subsOf)
  const subs = mainId ? subsOf(mainId) : []
  const emit = (mainPick, subPick) => onChange(subPick || mainPick || null, { mainId: mainPick, subId: subPick })

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
        {/* Another main starts with "No sub-category": a sub belongs to one main only. */}
        <Select value={mainId} onChange={(e) => emit(e.target.value, '')} aria-label={label} className={cn('min-w-0 min-h-9', selectClassName)}>
          {emptyLabel !== null && <option value="">{emptyLabel}</option>}
          {mainCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={subId} onChange={(e) => emit(mainId, e.target.value)} disabled={subs.length === 0} aria-label={subLabel} className={cn('min-w-0 min-h-9 disabled:opacity-50', selectClassName)}>
          <option value="">No sub-category</option>
          {subs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {onManage && (
        <button type="button" onClick={onManage} title={manageTitle} aria-label={manageLabel} className="w-9 h-9 flex items-center justify-center rounded-2xl border border-[var(--color-border)] text-[var(--color-icon-muted)] shrink-0">
          <Settings2 size={14} />
        </button>
      )}
    </div>
  )
}
