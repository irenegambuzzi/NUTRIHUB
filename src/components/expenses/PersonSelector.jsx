import { PERSON_OPTIONS } from '../../lib/personFilter'
import { cn } from '../../lib/cn'

// "Everyone / {label} / {label} / Shared": whose entries a section shows.
// `options` leaves some out (Income hides "Shared" in a period without
// Shared income, plan 9O K174).
export function PersonSelector({ value, onChange, label, options = PERSON_OPTIONS }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 self-start w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
            value === o.value ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
