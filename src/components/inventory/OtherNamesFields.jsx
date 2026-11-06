import { X } from 'lucide-react'
import { Input, Label, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { purchaseUnitOptions } from '../../lib/units'

// "Other names" in "Edit item" (plan 9N): each name with its own pack field
// in the style of the item's ("pcs per pack"), and × to remove it. A name
// that came from a merge has no ×: it leaves by being separated (K74).
// `drafts`: lib/itemNames.js nameDrafts; `problems`: draft key → note.
export function OtherNamesFields({ drafts, problems, stockUnit, onChange, onRemove, onAdd }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-3 space-y-3">
      <p className="text-xs font-bold text-[var(--color-primary)]">Other names</p>
      {drafts.map((draft) => {
        const units = purchaseUnitOptions(stockUnit, draft.unit)
        const unit = draft.unit || units[0]
        const title = draft.name.trim() || 'the new name'
        return (
          <div key={draft.key} role="group" aria-label={`Other name ${title}`} className="space-y-1.5">
            <div className="flex items-center gap-1">
              {draft.saved ? (
                <p className="flex-1 min-w-0 break-words text-xs font-semibold text-[var(--color-text)]">{draft.name}</p>
              ) : (
                <Input autoFocus aria-label="New name" placeholder="e.g. Corn Snack" value={draft.name} onChange={(e) => onChange(draft.key, { name: e.target.value })} className="flex-1 min-w-0" />
              )}
              {!draft.merged && (
                <button type="button" onClick={() => onRemove(draft.key)} aria-label={`Remove ${title}`} className="w-9 h-9 flex items-center justify-center text-[var(--color-icon-muted)] hover:text-rose-400 shrink-0">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Purchase unit</Label>
                <Select value={unit} onChange={(e) => onChange(draft.key, { unit: e.target.value })} aria-label={`Purchase unit of ${title}`}>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{stockUnit} per {unit}</Label>
                <DecimalInput value={draft.size} onChange={(e) => onChange(draft.key, { size: e.target.value, unit })} aria-label={`${stockUnit} per ${unit} of ${title}`} />
                <DecimalHint value={draft.size} />
              </div>
            </div>
            {problems.get(draft.key) && <p className="text-[11px] text-red-400">{problems.get(draft.key)}</p>}
          </div>
        )
      })}
      <button type="button" onClick={onAdd} className="min-h-9 text-xs font-bold text-[var(--color-accent)]">
        + Add a name
      </button>
    </div>
  )
}
