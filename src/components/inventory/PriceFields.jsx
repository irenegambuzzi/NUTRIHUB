import { useState } from 'react'
import { Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { decimalProblem, moneyText, parseDecimal } from '../../lib/decimal'
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
  const row = { ...value, price: parseDecimal(value.price) || 0, price_unit: basisUnit, price_qty: parseDecimal(value.price_qty) || 1 }
  const total = line ? lineTotal({ ...row, quantity: line.quantity, unit: line.unit }, pack) : 0
  const basis = priceBasis({ ...row, unit: basisUnit })
  const size = compact ? 'text-xs p-2' : ''

  const setTotal = (text) => {
    setTotalDraft(text)
    // Wrong text goes to the unit price as typed, so Save can refuse it.
    if (decimalProblem(text)) return onChange({ price: text })
    const price = unitPriceFromTotal(parseDecimal(text) || 0, { ...row, quantity: line.quantity, unit: line.unit }, pack)
    // Units that can't be converted leave the unit price alone.
    if (price !== null) onChange({ price: price ? moneyText(price) : '' })
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
                if (key === 'total') setTotalDraft(total ? moneyText(total) : '')
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
          <DecimalInput
            placeholder="€ 0.00"
            value={value.price}
            onChange={(e) => onChange({ price: e.target.value })}
            className={cn('flex-1 min-w-0', size)}
            aria-label="Unit price (€)"
          />
          <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">per</span>
          <DecimalInput
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
        <DecimalInput
          placeholder={`Total for ${line.quantity} ${line.unit} (€)`}
          value={totalDraft}
          onChange={(e) => setTotal(e.target.value)}
          className={size}
          aria-label="Total price (€)"
        />
      )}

      <DecimalHint value={(mode === 'unit' || !line ? [value.price, value.price_qty] : [totalDraft]).find((t) => decimalProblem(t)) ?? ''} />

      {line && row.price > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {line.quantity} {line.unit} × {money(row.price)} / {basis.qty === 1 ? '' : `${basis.qty} `}
          {basis.unit} ={' '}
          {total === null ? (
            <>
              <b className="font-mono">?</b> — {line.unit} can't be converted to {basis.unit}; pick another price unit or set a pack size.
            </>
          ) : (
            <b className="font-mono text-[var(--color-accent)]">{money(total)}</b>
          )}
        </p>
      )}
    </div>
  )
}
