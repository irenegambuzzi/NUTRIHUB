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
//   inherited   { mainName, subName } when nothing is chosen and the value
//               comes from somewhere else (HOME → Categories: a sub-category
//               that follows its main). Both selects then show those names
//               in grey and the right one is disabled. A native select can
//               only show its selected option, so the grey names are drawn
//               over it; the list itself is unchanged. Ignored once a value
//               is chosen.
export function MoneyCategorySelect({ value, onChange, mainCategories, subsOf, label = 'Budget category', subLabel = `${label}: sub-category`, emptyLabel = 'Uncategorized', onManage, manageLabel = 'Manage budget categories', manageTitle = 'Add or delete budget categories', selectClassName, className, inherited = null }) {
  const { mainId, subId } = splitCategory(value, mainCategories, subsOf)
  const subs = mainId ? subsOf(mainId) : []
  const showInherited = !!inherited && !mainId
  const emit = (mainPick, subPick) => onChange(subPick || mainPick || null, { mainId: mainPick, subId: subPick })

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
        {/* Another main starts with "No sub-category": a sub belongs to one main only. */}
        <div className="relative min-w-0">
          <Select value={mainId} onChange={(e) => emit(e.target.value, '')} aria-label={label} className={cn('min-w-0 min-h-9', selectClassName, showInherited && HIDDEN_TEXT)}>
            {emptyLabel !== null && <option value="">{emptyLabel}</option>}
            {mainCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {showInherited && <InheritedName part="main">{inherited.mainName}</InheritedName>}
        </div>
        <div className="relative min-w-0">
          <Select value={subId} onChange={(e) => emit(mainId, e.target.value)} disabled={showInherited || subs.length === 0} aria-label={subLabel} className={cn('min-w-0 min-h-9 disabled:opacity-50', selectClassName, showInherited && HIDDEN_TEXT)}>
            <option value="">No sub-category</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {showInherited && <InheritedName part="sub">{inherited.subName || 'No sub-category'}</InheritedName>}
        </div>
      </div>
      {onManage && (
        <button type="button" onClick={onManage} title={manageTitle} aria-label={manageLabel} className="w-9 h-9 flex items-center justify-center rounded-2xl border border-[var(--color-border)] text-[var(--color-icon-muted)] shrink-0">
          <Settings2 size={14} />
        </button>
      )}
    </div>
  )
}

// The select's own text is hidden (its list stays readable) while the grey
// inherited name is drawn on top; clicks pass through to the select.
const HIDDEN_TEXT = 'text-transparent [&>option]:text-[var(--color-text)]'

// Two lines at most, so a long name is never cut off at phone width.
function InheritedName({ part, children }) {
  return (
    <span data-inherited={part} aria-hidden="true" className="absolute inset-y-0 left-0 right-7 flex items-center px-2.5 text-[11px] leading-tight break-words pointer-events-none text-[var(--color-text-muted)]">
      {children}
    </span>
  )
}
