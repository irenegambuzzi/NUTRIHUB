import { DecimalInput } from './DecimalInput'
import { cn } from '../../lib/cn'
import { couponText, discountLabel } from '../../lib/discounts'
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

// What a line says about its price once a discount is typed: "€80 → €56
// (−30%)" and, when the purchase has a coupon, the line's share of it.
// `priced`: the line from priceLines() (lib/discounts.js).
export function LineDiscountNotes({ priced }) {
  if (!priced) return null
  return (
    <>
      {priced.discount && !priced.problem && <p className="text-[11px] font-bold text-emerald-300">{discountLabel(priced.list, priced.itemPaid, priced.discount)}</p>}
      {priced.share > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Purchase discount share −{money(priced.share)} → you pay {money(priced.paid)}
        </p>
      )}
    </>
  )
}

// "Purchase discount": one coupon for the whole receipt (two items or
// more), spread over the items by price. `priced`: priceLines() of the
// whole purchase.
export function PurchaseDiscountBox({ coupon, onChange, priced }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-1.5">
      <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Purchase discount</p>
      <DiscountField kind={coupon.kind} text={coupon.text} onChange={onChange} label="Purchase discount" placeholder="Coupon" problem={priced.couponProblem} />
      {priced.couponTotal > 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {couponText(priced.coupon)} = {money(priced.couponTotal)} off, spread over the items by what each costs after its own discount.
        </p>
      )}
    </div>
  )
}
