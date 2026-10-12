import { useState } from 'react'
import { Plus, Settings2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label, Select } from '../ui/Field'
import { ShopIcon } from '../ui/ShopIcon'
import { OnlineToggle } from './OnlineToggle'
import { ShopManager } from './ShopManager'
import { useShops } from '../../hooks/useShops'
import { shopUsageStore } from '../../lib/stores'
import { SHOPS_NOTICE, quickShops, shopNameProblem } from '../../lib/shops'
import { cn } from '../../lib/cn'

// "Bought at": the store of a purchase (optional). Quick buttons for the
// most used stores, a list of all of them, "+ Store" to make one on the
// spot (asking if it is online) and a manager to rename or delete them.
// `value` is a store id or ''; `onChange(id | '')`. A store made here is
// picked at once. Before supabase/019 it says so instead of failing.
// Drawn without a <form> of its own: it sits inside other forms.
export function ShopPicker({ value, onChange, defaultOnline = false, label = 'Bought at (optional)' }) {
  const { ready, missing } = useShops()
  if (missing) {
    return (
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-yellow-300 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-2.5">{SHOPS_NOTICE}</p>
      </div>
    )
  }
  if (!ready) return null
  return <ShopField value={value} onChange={onChange} defaultOnline={defaultOnline} label={label} />
}

function ShopField({ value, onChange, defaultOnline, label }) {
  const { shops, byId, addShop } = useShops()
  const { rows: usage } = shopUsageStore.useRows()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [online, setOnline] = useState(defaultOnline)
  const [error, setError] = useState('')
  const [managing, setManaging] = useState(false)
  // A store that has since been deleted (on the other phone) counts as none.
  const picked = byId.has(value) ? value : ''
  const chips = quickShops(shops, usage, { alwaysInclude: picked ? [picked] : [] })

  const create = async () => {
    const problem = shopNameProblem(shops, name)
    if (problem) return setError(problem)
    const { data, error: addError } = await addShop(name, online)
    // Failures show a toast and the panel stays open.
    if (addError) return
    onChange(data.id)
    setName('')
    setError('')
    setAdding(false)
  }

  const openAdd = () => {
    setOnline(defaultOnline)
    setError('')
    setAdding(true)
  }

  return (
    <div>
      <Label>{label}</Label>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {chips.map((shop) => (
            <button
              key={shop.id}
              type="button"
              onClick={() => onChange(picked === shop.id ? '' : shop.id)}
              aria-pressed={picked === shop.id}
              className={cn(
                'min-h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold border transition-all duration-200',
                picked === shop.id ? 'bg-[var(--color-primary)] border-transparent text-white' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)] text-[var(--color-text)]'
              )}
            >
              <ShopIcon online={shop.is_online} size={12} />
              {shop.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Select value={picked} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0" aria-label="Bought at">
          <option value="">No store</option>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
              {shop.is_online ? ' (online)' : ''}
            </option>
          ))}
        </Select>
        {!adding && (
          <Button type="button" variant="ghost" onClick={openAdd} className="px-3 shrink-0" title="Add a store">
            <Plus size={14} /> Store
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setManaging(true)} className="px-3 shrink-0" title="Rename or delete stores" aria-label="Manage stores">
          <Settings2 size={14} />
        </Button>
      </div>

      {adding && (
        <div className="mt-2 space-y-2 rounded-2xl border border-[var(--color-border)] p-2.5">
          <p className="text-xs font-bold text-[var(--color-text-soft)]">New store</p>
          <Input
            autoFocus
            placeholder="Name (e.g. Zalando)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              create()
            }}
            aria-label="New store name"
          />
          <div>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-1">Is it an online store?</p>
            <OnlineToggle value={online} onChange={setOnline} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="button" onClick={create} className="flex-1">
              <Plus size={14} /> Add store
            </Button>
          </div>
        </div>
      )}

      {managing && <ShopManager defaultOnline={defaultOnline} onClose={() => setManaging(false)} onRemoved={(id) => id === value && onChange('')} />}
    </div>
  )
}
