import { OneTimeBadge } from '../ui/OneTimeBadge'

// The "One-time purchase (1×)" switch of the HOME editor and the SHOP
// add form (see lib/oneTime.js).
export function OneTimeToggle({ checked, onChange, hint = 'Bought once, not kept in stock: it never goes on the SHOP list by itself, and when it is used up it moves to "Finished one-time items".' }) {
  return (
    <label className="flex items-start gap-2.5 min-h-9 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)] shrink-0" />
      <span className="text-xs text-[var(--color-text)]">
        <span className="font-bold inline-flex items-center gap-1.5">
          One-time purchase <OneTimeBadge />
        </span>
        <span className="block text-[11px] text-[var(--color-text-muted)]">{hint}</span>
      </span>
    </label>
  )
}
