import { Select } from '../ui/Field'

// The "Paid by" / "Received by" field of a Money form (plan 9P K216,
// K217): the options given (the accounts, plus "Shared" for a row that is
// Shared), and "Choose…" while nothing is chosen — there is no default
// payer, and "Choose…" can't be picked again once a payer is.
export function PayerSelect({ value, onChange, options, label }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {value === '' && (
        <option value="" disabled>
          Choose…
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}
