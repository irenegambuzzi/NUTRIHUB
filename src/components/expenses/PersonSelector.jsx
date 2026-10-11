import { PERSON_OPTIONS } from '../../lib/personFilter'
import { cn } from '../../lib/cn'

// "Everyone / Irene / Akbar / Shared": whose entries a section shows.
export function PersonSelector({ value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 self-start w-fit">
      {PERSON_OPTIONS.map((o) => (
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
