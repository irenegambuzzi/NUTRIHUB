import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { normName, payerLabel } from '../../lib/grocery'
import { formatUnitPrice } from '../../lib/pricing'

// The names that match what is typed (lib/quickAdd.js matchSuggestions),
// each a button with its category, unit, last price and payer, and "on
// list" when an open SHOP card has that name. Used under the quick-add box
// (Shop mode) and under the name of the "Add to SHOP list" form.
// `active`: the row an arrow key moved to (quick add only), or -1.
export function NameSuggestions({ matches, onPick, categoryName, listed = [], active = -1, onHover = null }) {
  if (!matches.length) return null
  return (
    <ul role="listbox" aria-label="Suggestions" className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {matches.map((s, i) => {
        const onList = listed.some((g) => !g.completed && normName(g.name) === normName(s.name))
        const price = formatUnitPrice({ price: s.price, price_qty: s.priceQty, price_unit: s.priceUnit, unit: s.unit })
        return (
          <li key={s.name} role="option" aria-selected={i === active}>
            <button
              type="button"
              onClick={() => onPick(s)}
              onMouseEnter={onHover ? () => onHover(i) : undefined}
              className={cn('w-full min-h-9 flex items-center gap-3 px-3 py-2.5 text-left', i === active ? 'bg-[var(--color-surface-soft)]' : '')}
            >
              <CategoryIcon category={s.categoryId} size={16} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-text)] truncate">{s.name}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                  {[s.categoryId && categoryName(s.categoryId), s.unit, price, s.payer && payerLabel(s.payer)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {onList && <span className="text-[10px] font-bold text-[var(--color-accent)] shrink-0">on list</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
