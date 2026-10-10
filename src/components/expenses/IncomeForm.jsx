import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { Button } from '../ui/Button'
import { Label, Input, Select } from '../ui/Field'
import { INCOME_TYPES, PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'

// The income fields, for adding an entry or editing one (`initial`).
// onSubmit resolves to { error }; on failure the form keeps what was
// typed.
export function IncomeForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [incomeDate, setIncomeDate] = useState(initial?.income_date ?? localDateString())
  const [incomeType, setIncomeType] = useState(initial?.income_type ?? 'salary')
  const [receivedBy, setReceivedBy] = useState(initial?.received_by ?? 'shared')
  const [source, setSource] = useState(initial?.source ?? '')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    const { error } = await onSubmit({ amount: Number(amount), incomeDate, incomeType, receivedBy, source: source.trim() })
    if (error) return
    if (!initial) {
      setAmount('')
      setSource('')
    }
  }

  return (
    <form onSubmit={handleSubmit} data-unsaved={amount || source ? '' : undefined} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Amount (€)</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Type</Label>
          <Select value={incomeType} onChange={(e) => setIncomeType(e.target.value)} aria-label="Income type">
            {INCOME_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Received by</Label>
          <Select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} aria-label="Received by">
            {PAID_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label>Note or source (optional)</Label>
        <Input placeholder="e.g. October salary, refund…" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>

      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        )}
        <Button type="submit" className="flex-1">
          {initial ? <Check size={16} /> : <Plus size={16} />} {submitLabel}
        </Button>
      </div>
    </form>
  )
}
