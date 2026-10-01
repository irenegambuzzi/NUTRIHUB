// Badge/bar classes for stock status and expiry, written out in full
// so Tailwind's scanner picks them up.
export const STATUS_STYLES = {
  ok: { badge: 'bg-emerald-500/15 text-emerald-300', bar: 'bg-emerald-500' },
  low: { badge: 'bg-amber-500/15 text-amber-300', bar: 'bg-amber-500' },
  out: { badge: 'bg-rose-500/15 text-rose-300', bar: 'bg-rose-500' },
}

export const EXPIRY_STYLES = {
  expired: 'bg-rose-500/15 text-rose-300',
  week: 'bg-amber-500/15 text-amber-300',
  month: 'bg-sky-500/15 text-sky-300',
  ok: 'bg-[var(--color-surface-soft)] text-[var(--color-text-muted)]',
}
