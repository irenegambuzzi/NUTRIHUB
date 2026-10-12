import { Search, X } from 'lucide-react'
import { Input } from './Field'

// The search field used in HOME and SHOP: live, with a clear (X) button.
export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-8 pr-8" aria-label={placeholder} />
      {value && (
        <button onClick={() => onChange('')} title="Clear search" aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
