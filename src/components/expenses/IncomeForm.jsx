import { useState } from 'react'
import { Plus, Check, Settings2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Label, Input, Select } from '../ui/Field'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'

// The income fields, for adding an entry or editing one (`initial`).
// onSubmit resolves to { error }; on failure the form keeps what was
// typed. `tree` is the income categories' tree (see categoryTree);
// `onManage` opens the category manager (not offered until it can work).
export function IncomeForm({ initial, submitLabel, onSubmit, onCancel, tree, onManage }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [incomeDate, setIncomeDate] = useState(initial?.income_date ?? localDateString())
  // A new entry starts on "Salary", as before.
  const initialMain = initial ? tree.mainOf(initial.category_id) : tree.mainCategories.find((c) => c.name === 'Salary') ?? tree.mainCategories[0]
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(initial && initial.category_id !== initialMain?.id ? initial.category_id ?? '' : '')
  const [receivedBy, setReceivedBy] = useState(initial?.received_by ?? 'shared')
  const [source, setSource] = useState(initial?.source ?? '')
  const [dateOk, setDateOk] = useState(true)
  const [dateError, setDateError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    if (!dateOk) return setDateError('Fix the date first (DD/MM/YYYY).')
    const { error } = await onSubmit({ amount: Number(amount), incomeDate, categoryId: subId || mainId || null, receivedBy, source: source.trim() })
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
          <DateField label="Date" required value={incomeDate} onChange={(v) => { setIncomeDate(v); setDateError('') }} onValidity={setDateOk} />
        </div>
      </div>

      <div>
        <Label>Category</Label>
        <div className="flex gap-2">
          <Select
            value={mainId}
            onChange={(e) => {
              setMainId(e.target.value)
              setSubId('')
            }}
            className="flex-1"
            aria-label="Income category"
          >
            {tree.mainCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {onManage && (
            <Button type="button" variant="ghost" onClick={onManage} className="px-3" title="Add or delete income categories">
              <Settings2 size={14} /> Manage
            </Button>
          )}
        </div>
        {mainId && tree.subsOf(mainId).length > 0 && (
          <Select value={subId} onChange={(e) => setSubId(e.target.value)} className="mt-2" aria-label="Income subcategory">
            <option value="">No subcategory</option>
            {tree.subsOf(mainId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
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

      <div>
        <Label>Note or source (optional)</Label>
        <Input placeholder="e.g. October salary, refund…" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>

      {dateError && <p className="text-xs text-red-400">{dateError}</p>}

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
