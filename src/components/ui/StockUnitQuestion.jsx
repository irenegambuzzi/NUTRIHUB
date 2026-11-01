import { Select } from './Field'
import { PackSizeField } from './PackSizeField'
import { cn } from '../../lib/cn'
import { STOCK_UNIT_LABEL, STOCK_UNIT_MISSING } from '../../lib/newItemUnit'

// "Count it at home in" for a line that makes a new HOME item in a
// package (plan 9L, lib/newItemUnit.js stockUnitQuestion): two pills, the
// purchase unit and pcs, and a small drop-down with the other count units,
// so it fits a phone without scrolling sideways. Nothing is chosen at
// first; until something is, the line can't be saved. Another unit than
// the purchase unit asks its usual pack size with the pack field of 9H
// ("pcs per pack"). `onChange(answer)`: { unit, stockUnit, text } — a new
// choice empties the pack field. `name` tells several lines apart.
export function StockUnitQuestion({ question, onChange, name }) {
  const [own, pcs, ...others] = question.choices
  const pick = (stockUnit) => onChange({ unit: question.unit, stockUnit, text: '' })
  const other = others.includes(question.stockUnit) ? question.stockUnit : ''
  const pill = (unit) => (
    <button
      key={unit}
      type="button"
      role="radio"
      aria-checked={question.stockUnit === unit}
      onClick={() => pick(unit)}
      className={cn(
        'min-h-9 px-3 rounded-full text-xs font-bold border',
        question.stockUnit === unit ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
      )}
    >
      {unit}
    </button>
  )
  return (
    <div className={cn('rounded-xl border p-2 space-y-1.5', question.blocking ? 'bg-amber-500/10 border-amber-400/30' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)]')}>
      <p className="text-[11px] font-bold text-[var(--color-text-soft)]">{STOCK_UNIT_LABEL}</p>
      <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={`${STOCK_UNIT_LABEL} — ${name}`}>
        {pill(own)}
        {pill(pcs)}
        <Select
          value={other}
          onChange={(e) => (e.target.value ? pick(e.target.value) : null)}
          aria-label={`Other unit to count ${name} in`}
          className={cn('w-auto min-h-9 text-xs p-2', other && 'border-[var(--color-primary)]')}
        >
          <option value="">Other…</option>
          {others.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
      </div>
      {!question.stockUnit && <p className="text-[11px] text-amber-300">{STOCK_UNIT_MISSING}</p>}
      {question.pack && (
        <PackSizeField
          pack={question.pack}
          onChange={(text) => onChange({ unit: question.unit, stockUnit: question.stockUnit, text })}
          ariaLabel={`${question.pack.stockUnit} per ${question.pack.unit} for ${name}`}
        />
      )}
    </div>
  )
}
