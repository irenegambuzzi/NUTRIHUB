import { cn } from '../../lib/cn'
import { STATUS_STYLES } from '../../lib/inventoryStyles'

const TONES = {
  default: 'text-[var(--color-primary)]',
  amber: STATUS_STYLES.low.text,
  rose: STATUS_STYLES.out.text,
  sky: 'text-sky-300',
  purple: STATUS_STYLES.expired.text,
}

export function StatTile({ icon: Icon, label, value, tone = 'default', active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'bg-[var(--color-surface)] border rounded-3xl p-3 text-left shadow-sm transition-colors',
        active ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'
      )}
    >
      <Icon size={16} className={TONES[tone]} />
      <p className={cn('text-xl font-extrabold mt-1', TONES[tone])}>{value}</p>
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
    </button>
  )
}
