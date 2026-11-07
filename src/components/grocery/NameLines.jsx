import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Input, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { DiscountField, LineDiscountNotes } from '../ui/DiscountField'
import { PackSizeField } from '../ui/PackSizeField'
import { UnitOptions } from './shared'
import { cn } from '../../lib/cn'
import { decimalProblem, moneyText, parseDecimal } from '../../lib/decimal'
import { round2 } from '../../lib/discounts'
import { useLastPrice } from '../../hooks/useLastPrice'

// Name lines of one SHOP card in "Confirm purchase" (plan 9N, stage 3): the
// card is bought under one or more names of its HOME item, each with its own
// quantity, price and discount. Line 1 is the card itself; lines 2…N live
// only on this screen until Confirm (K52).

// The name of a line, with the item's names as chips (K56) and what the
// name means: a refusal (K59, K94; Confirm stays locked), "New name of …",
// and for a new name that looks durable the HOME editor's warning (not
// blocking).
export function NameField({ value, placeholder, onChange, label, chipsLabel, naming, chips, durableText = '', onRemove = null, removeLabel = '' }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-[var(--color-text-soft)] shrink-0">Name</span>
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn('flex-1 min-w-0 text-sm p-2', naming?.problem && 'border-amber-400')} />
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={removeLabel} className="w-9 h-9 flex items-center justify-center shrink-0 text-[var(--color-icon-muted)] hover:text-rose-400">
            <X size={16} />
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={chipsLabel}>
          {chips.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              aria-pressed={name.trim().toLowerCase() === value.trim().toLowerCase()}
              className={cn(
                'min-h-9 max-w-full px-3 rounded-full border text-[11px] font-bold break-words text-left',
                name.trim().toLowerCase() === value.trim().toLowerCase() ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text-soft)]'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {naming?.problem && (
        <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {naming.problem}
        </p>
      )}
      {naming?.note && <p className="text-[11px] text-[var(--color-text-muted)]">{naming.note}</p>}
      {naming?.kind === 'new' && durableText && (
        <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {durableText}
        </p>
      )}
    </div>
  )
}

// Line 2…N of a card: its name, quantity, unit, total and discount, and the
// pack field when its unit needs one (K60). No payer: the card's is used
// (K92). Its price starts with the last normal price of that name (K55,
// report F), for its quantity; a brand-new name starts empty.
export function NameLine({ line, draft, number, cardName, chips, durableText, priced, discount, onDiscount, onDraft, onRemove, onPack, onNumberValidity = () => {} }) {
  const { item } = line
  const label = `Name of line ${number} of ${cardName}`
  const numbersBad = Boolean(decimalProblem(draft.quantityText) || decimalProblem(draft.totalText) || decimalProblem(line.pack?.text))
  useEffect(() => {
    onNumberValidity(item.id, !numbersBad)
    return () => onNumberValidity(item.id, true)
  }, [item.id, numbersBad, onNumberValidity])

  const last = useLastPrice(draft.name)
  const lastKey = last ? `${last.price}|${last.quantity}|${last.unit}` : ''
  useEffect(() => {
    if (draft.priceEdited || draft.unitTouched) return
    if (last) {
      const per = last.price / last.quantity
      const quantity = parseDecimal(draft.quantityText) > 0 ? parseDecimal(draft.quantityText) : 1
      const patch = { totalText: moneyText(round2(per * quantity)), unit: last.unit, autoFilled: true, autoPer: per }
      if (patch.totalText !== draft.totalText || patch.unit !== draft.unit || !draft.autoFilled) onDraft(patch)
    } else if (draft.autoFilled) {
      onDraft({ totalText: '', autoFilled: false, autoPer: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey, draft.priceEdited, draft.unitTouched])

  const changeQuantity = (text) => {
    const quantity = parseDecimal(text)
    const follows = draft.autoFilled && !draft.priceEdited && draft.autoPer > 0 && quantity > 0
    onDraft({ quantityText: text, ...(follows ? { totalText: moneyText(round2(draft.autoPer * quantity)) } : {}) })
  }

  return (
    <div role="group" aria-label={`Line ${number} of ${cardName}`} className={cn('rounded-xl border p-2 space-y-2', line.ready ? 'border-[var(--color-border)]' : 'border-amber-400/60')}>
      <NameField
        value={draft.name}
        placeholder="e.g. Corn Snack"
        onChange={(name) => onDraft({ name })}
        label={label}
        chipsLabel={`Names for line ${number} of ${cardName}`}
        naming={line.naming}
        chips={chips}
        durableText={durableText}
        onRemove={onRemove}
        removeLabel={`Remove line ${number} of ${cardName}`}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <DecimalInput value={draft.quantityText} onChange={(e) => changeQuantity(e.target.value)} aria-label={`Quantity of line ${number} of ${cardName}`} className="w-20 text-sm p-2 text-right" />
          <Select value={draft.unit} onChange={(e) => onDraft({ unit: e.target.value, unitTouched: true })} aria-label={`Unit of line ${number} of ${cardName}`} className="w-auto text-xs p-2">
            <UnitOptions />
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">€</span>
          <DecimalInput value={draft.totalText} placeholder="0.00" onChange={(e) => onDraft({ totalText: e.target.value, priceEdited: true })} aria-label={`Total for line ${number} of ${cardName}`} className="w-24 text-sm p-2 text-right font-mono" />
        </div>
      </div>
      <DecimalHint value={[draft.quantityText, draft.totalText].find((t) => decimalProblem(t)) ?? ''} />
      <DiscountField kind={discount.kind} text={discount.text} onChange={onDiscount} label={`Discount for line ${number} of ${cardName}`} problem={priced?.problem ?? ''} />
      <LineDiscountNotes priced={priced} />
      {line.pantry && line.add > 0 && item.unit !== line.pantry.unit && !line.pack && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          = {line.add} {line.pantry.unit} added to the stock
        </p>
      )}
      {line.pack && <PackSizeField pack={line.pack} onChange={onPack} ariaLabel={`${line.pack.stockUnit} per ${line.pack.unit} for line ${number} of ${cardName}`} />}
    </div>
  )
}
