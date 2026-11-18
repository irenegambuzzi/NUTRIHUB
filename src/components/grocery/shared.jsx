import { cn } from '../../lib/cn'
import { UNIT_GROUPS } from '../../data/constants'
import { ACCOUNT_OPTIONS, chosenPayer } from '../../lib/payers'
import { EXTRA_PACKAGING_UNITS } from '../../lib/grocery'

// Small pieces shared by the grocery list's components.

export function UnitOptions() {
  return (
    <>
      {UNIT_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.value}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Packaging">
        {EXTRA_PACKAGING_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </optgroup>
    </>
  )
}

// Who pays for a SHOP card (plan 9P K216, K225): the accounts only. A card
// whose payer is "Shared" (the database's default) or empty is "not chosen
// yet": no pill is lit.
export function PayerPicker({ value, onChange, size = 'md', label = 'Paid by' }) {
  const chosen = chosenPayer(value)
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-full p-0.5">
      {ACCOUNT_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={chosen === o.value}
          onClick={(e) => {
            e.stopPropagation()
            onChange(o.value)
          }}
          className={cn(
            'rounded-full font-bold transition-all',
            size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-3 py-1 text-[11px]',
            chosen === o.value ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
