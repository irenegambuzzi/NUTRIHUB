import { ShopIcon } from '../ui/ShopIcon'
import { cn } from '../../lib/cn'

// "In store / Online": whether a store is a physical shop or a website.
export function OnlineToggle({ value, onChange, className }) {
  return (
    <div role="group" aria-label="Kind of store" className={cn('flex gap-1 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-full p-1', className)}>
      {[
        [false, 'In store'],
        [true, 'Online'],
      ].map(([online, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(online)}
          aria-pressed={value === online}
          className={cn(
            'flex-1 min-h-8 px-2 rounded-full text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all duration-200',
            value === online ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          <ShopIcon online={online} size={12} /> {label}
        </button>
      ))}
    </div>
  )
}
