import { useId } from 'react'
import { AlertTriangle, Scale } from 'lucide-react'
import { Label } from './Field'
import { DecimalHint, DecimalInput } from './DecimalInput'
import { decimalProblem } from '../../lib/decimal'
import { PEOPLE, applyFix, payerLabel, splitEqually, typePart } from '../../lib/sharedParts'

// What each person paid of a Shared expense (plan 9K): one field per
// person, right under "Paid by". Nothing is filled in by itself; typing
// one fills the other with the rest (until that one is typed by hand);
// "Split equally" fills both. Under them: why it can't be saved yet
// (`check` from lib/sharedParts.js checkSplit, shown when `showProblem`),
// with the one-tap fix "Put the difference on …", the €0 hint, and
// `note` (the amber "Parts were for …" of an amount changed elsewhere).
//   split / onChange   the fields as typed
//   total              the Shared amount they must add up to
//   caption            a line above the fields (e.g. for a purchase), or none
export function SharedPartsFields({ split, onChange, total, check, showProblem = true, caption = null, note = '' }) {
  const id = useId()
  const bad = PEOPLE.map((code) => split.texts[code]).find((t) => decimalProblem(t)) ?? ''
  return (
    <div role="group" aria-label="What each one paid" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2.5 space-y-1.5">
      {caption && <p className="text-[11px] text-[var(--color-text-muted)]">{caption}</p>}
      <div className="grid grid-cols-2 gap-2">
        {PEOPLE.map((code) => (
          <div key={code} className="min-w-0">
            <Label htmlFor={`${id}-${code}`}>{payerLabel(code)} paid (€)</Label>
            <DecimalInput
              id={`${id}-${code}`}
              value={split.texts[code]}
              onChange={(e) => onChange(typePart(split, code, e.target.value, total))}
              placeholder="0.00"
              className="text-sm p-2 text-right font-mono"
            />
          </div>
        ))}
      </div>
      <DecimalHint value={bad} />
      <button type="button" onClick={() => onChange(splitEqually(total))} className="min-h-9 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-accent)]">
        <Scale size={12} /> Split equally
      </button>
      {note && (
        <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {note}
        </p>
      )}
      {showProblem && check?.problem && (
        <p role="alert" className="text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {check.problem}
        </p>
      )}
      {showProblem && check?.fix && (
        <button type="button" onClick={() => onChange(applyFix(split, check.fix))} className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text)]">
          {check.fix.label}
        </button>
      )}
      {check?.hint && <p className="text-[11px] text-[var(--color-text-muted)]">{check.hint}</p>}
    </div>
  )
}
