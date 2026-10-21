import { DecimalInput } from './DecimalInput'
import { cn } from '../../lib/cn'
import { couponText, linePreview } from '../../lib/discounts'
import { money } from '../../lib/pricing'

// A discount being typed, in % or in €: two small buttons choose which
// ("−%" / "−€"), then the number. It only edits the text — the rules
// (refusals, "€80 → €56 (−30%)", the coupon spread) are in lib/discounts.js.
//   kind      'percent' | 'amount'
//   text      the number as typed ("" = no discount)
//   onChange  ({ kind, text }) — whichever part changed
//   label     what the field is called for a screen reader / the tests
//   problem   why the discount can't be used ('' = fine), shown under it
export function DiscountField({ kind, text, onChange, label, placeholder = 'Discount', problem = '', className }) {
  const pick = (value) => (
    <button
      key={value}
      type="button"
      onClick={() => onChange({ kind: value, text })}
      aria-pressed={kind === value}
      aria-label={`${label} in ${value === 'percent' ? 'percent' : 'euros'}`}
      className={cn(
        'min-h-9 min-w-9 px-2 text-xs font-bold border',
        value === 'percent' ? 'rounded-l-xl' : 'rounded-r-xl -ml-px',
        kind === value ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
      )}
    >
      {value === 'percent' ? '−%' : '−€'}
    </button>
  )
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="flex items-center">{['percent', 'amount'].map(pick)}</span>
        <DecimalInput
          value={text}
          onChange={(e) => onChange({ kind, text: e.target.value })}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={problem ? true : undefined}
          className="w-24 text-sm p-2 text-right"
        />
      </div>
      {problem && (
        <p role="alert" className="text-[11px] text-rose-400 mt-1">
          {problem}
        </p>
      )}
    </div>
  )
}

// What a line says about its price as soon as it has a discount or a part
// of the coupon, live and in the words of the saved purchase: "€80 → €56
// (−30%)", "€120.00 → €90.00 (coupon −€30.00)", "€80.00 → €56.00 (−30%) ·
// coupon −€5.60 → €50.40". Green, and it wraps instead of being cut off on
// a narrow screen. `priced`: the line from priceLines() (lib/discounts.js).
export function LineDiscountNotes({ priced }) {
  const text = linePreview(priced)
  if (!text) return null
  return <p className="text-[11px] font-bold text-emerald-300 break-words">{text}</p>
}

// "Purchase discount": one coupon for the whole receipt (two items or
// more), spread over the items by price. `priced`: priceLines() of the
// whole purchase. `names`: the item names in the same order — with a
// coupon typed, each item's result is repeated here, so it can be checked
// right where the coupon is typed (it is also under each item).
export function PurchaseDiscountBox({ coupon, onChange, priced, names = [] }) {
  const results = priced.couponTotal > 0 ? priced.lines.map((line, i) => ({ name: names[i] || `Item ${i + 1}`, text: linePreview(line) })).filter((r) => r.text) : []
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-1.5">
      <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Purchase discount</p>
      <DiscountField kind={coupon.kind} text={coupon.text} onChange={onChange} label="Purchase discount" placeholder="Coupon" problem={priced.couponProblem} />
      {priced.couponTotal > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {couponText(priced.coupon)} = {money(priced.couponTotal)} off, spread over the items by what each costs after its own discount.
        </p>
      )}
      {results.length > 0 && (
        <ul aria-label="Each item after the purchase discount" className="space-y-1">
          {results.map((r, i) => (
            <li key={i} className="text-[11px] break-words">
              <span className="text-[var(--color-text-muted)]">{r.name}: </span>
              <span className="font-bold text-emerald-300">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
