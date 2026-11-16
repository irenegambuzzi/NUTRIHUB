import { Search, X } from 'lucide-react'
import { Input } from './Field'

// The search field used in HOME and SHOP: live, with a clear (X) button.
// `bigClear`: the X gets a 36 px tap target (only where a screen asks for
// it, e.g. "Confirm purchase"; the other screens keep the small one).
export function SearchBox({ value, onChange, placeholder, bigClear = false }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={bigClear ? 'pl-8 pr-10' : 'pl-8 pr-8'} aria-label={placeholder} />
      {value && (
        <button
          onClick={() => onChange('')}
          title="Clear search"
          aria-label="Clear search"
          className={
            bigClear
              ? 'absolute right-0 top-1/2 -translate-y-1/2 min-w-9 min-h-9 flex items-center justify-center text-[var(--color-icon-muted)]'
              : 'absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]'
          }
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
