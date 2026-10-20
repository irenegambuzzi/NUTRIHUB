// One palette for item state, used by pantry and grocery tiles, badges,
// progress bars, the dashboard and grocery labels. Classes are written
// out in full so Tailwind's scanner picks them up.
//   ok      → green  rgba(34,197,94)
//   low     → yellow rgba(234,179,8)
//   out     → red    rgba(239,68,68)
//   expired → purple rgba(168,85,247)
//   new     → blue   rgba(59,130,246)  (grocery items not in the pantry)
//   not-urgent → sky rgba(56,189,248)  (a group with a variant at 0 but
//                enough in total; lighter than the blue of "New Item")
export const STATUS_STYLES = {
  ok: {
    tile: 'bg-[rgba(34,197,94,0.15)] border-[rgba(34,197,94,0.35)]',
    badge: 'bg-green-500/20 text-green-300',
    bar: 'bg-green-500',
    text: 'text-green-300',
  },
  low: {
    tile: 'bg-[rgba(234,179,8,0.15)] border-[rgba(234,179,8,0.35)]',
    badge: 'bg-yellow-500/20 text-yellow-300',
    bar: 'bg-yellow-500',
    text: 'text-yellow-300',
  },
  out: {
    tile: 'bg-[rgba(239,68,68,0.15)] border-[rgba(239,68,68,0.35)]',
    badge: 'bg-red-500/20 text-red-300',
    bar: 'bg-red-500',
    text: 'text-red-300',
  },
  expired: {
    tile: 'bg-[rgba(168,85,247,0.15)] border-[rgba(168,85,247,0.4)]',
    badge: 'bg-purple-500/20 text-purple-300',
    bar: 'bg-purple-500',
    text: 'text-purple-300',
  },
  new: {
    tile: 'bg-[rgba(59,130,246,0.15)] border-[rgba(59,130,246,0.4)]',
    badge: 'bg-blue-500/20 text-blue-300',
    bar: 'bg-blue-500',
    text: 'text-blue-300',
  },
  'not-urgent': {
    tile: 'bg-[rgba(56,189,248,0.08)] border-[rgba(56,189,248,0.3)]',
    badge: 'bg-sky-400/15 text-sky-200',
    bar: 'bg-sky-400',
    text: 'text-sky-200',
  },
}

// The small round labels on item cards ("New Item", "1× purchase",
// "Out of Stock" on SHOP…): one size, weight and padding for all.
export const SMALL_LABEL = 'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full'

// The neutral grey "1× purchase" label of a one-time purchase (grey is
// only used for this).
export const ONE_TIME_BADGE = 'bg-zinc-500/25 text-zinc-300'
export const ONE_TIME_LABEL = '1× purchase'

export const EXPIRY_STYLES = {
  expired: STATUS_STYLES.expired.badge,
  week: STATUS_STYLES.low.badge,
  month: 'bg-sky-500/20 text-sky-300',
  ok: 'bg-[var(--color-surface-soft)] text-[var(--color-text-muted)]',
}

// Why an item is on the grocery list.
export const RESTOCK_LABELS = {
  out: { label: 'Out of Stock', className: STATUS_STYLES.out.badge },
  low: { label: 'Low Stock', className: STATUS_STYLES.low.badge },
  expired: { label: 'Expired', className: STATUS_STYLES.expired.badge },
  new: { label: 'New Item', className: STATUS_STYLES.new.badge },
  'not-urgent': { label: 'Not urgent', className: STATUS_STYLES['not-urgent'].badge },
}
