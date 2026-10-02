import { useState } from 'react'
import { Input, Select } from '../ui/Field'
import { cn } from '../../lib/cn'
import { lineTotal, money, priceBasis, unitPriceFromTotal } from '../../lib/pricing'

// Price as "€ amount per <qty> <unit>" (e.g. €2.50 per 500 gr, €1 per
// can). With `line` (quantity + unit being bought) it also shows the line
// total and lets the user type the total instead of the unit price.
//   value: { price, price_qty, price_unit }   (strings while editing)
export function PriceFields({ value, onChange, unitOptions, line, pack, compact = false }) {
  const [mode, setMode] = useState('unit')
  const [totalDraft, setTotalDraft] = useState('')
  const basisUnit = value.price_unit || unitOptions[0]
  const row = { ...value, price: parseFloat(value.price) || 0, price_unit: basisUnit, price_qty: parseFloat(value.price_qty) || 1 }
  const total = line ? lineTotal({ ...row, quantity: line.quantity, unit: line.unit }, pack) : 0
  const basis = priceBasis({ ...row, unit: basisUnit })
  const size = compact ? 'text-xs p-2' : ''

  const setTotal = (text) => {
    setTotalDraft(text)
    const price = unitPriceFromTotal(parseFloat(text) || 0, { ...row, quantity: line.quantity, unit: line.unit }, pack)
    onChange({ price: price ? String(price) : '' })
  }

  return (
    <div className="space-y-1.5">
      {line && (
        <div className="flex gap-1 text-[10px] font-bold">
          {[
            ['unit', 'Unit price'],
            ['total', 'Total price'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key)
                if (key === 'total') setTotalDraft(total ? String(total) : '')
              }}
              className={cn(
                'px-2 py-0.5 rounded-full border',
                mode === key ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === 'unit' || !line ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="€ 0.00"
            value={value.price}
            onChange={(e) => onChange({ price: e.target.value })}
            className={cn('flex-1 min-w-0', size)}
            aria-label="Unit price (€)"
          />
          <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">per</span>
          <Input
            type="number"
            min="0"
            step="any"
            value={value.price_qty}
            placeholder="1"
            onChange={(e) => onChange({ price_qty: e.target.value })}
            className={cn('w-16 shrink-0', size)}
            aria-label="Price per quantity"
          />
          <Select value={basisUnit} onChange={(e) => onChange({ price_unit: e.target.value })} className={cn('w-20 shrink-0', size)} aria-label="Price per unit">
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder={`Total for ${line.quantity} ${line.unit} (€)`}
          value={totalDraft}
          onChange={(e) => setTotal(e.target.value)}
          className={size}
          aria-label="Total price (€)"
        />
      )}

      {line && row.price > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {line.quantity} {line.unit} × {money(row.price)} / {basis.qty === 1 ? '' : `${basis.qty} `}
          {basis.unit} = <b className="font-mono text-[var(--color-accent)]">{money(total)}</b>
        </p>
      )}
    </div>
  )
}
