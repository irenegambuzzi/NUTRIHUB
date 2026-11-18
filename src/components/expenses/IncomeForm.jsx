import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Label, Input } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { MoneyCategorySelect } from '../ui/MoneyCategorySelect'
import { moneyText, parseDecimal } from '../../lib/decimal'
import { RECEIVER_MISSING, payerOptionsFor, startingPayer } from '../../lib/payers'
import { PayerSelect } from './PayerSelect'
import { localDateString } from '../../lib/expensePeriods'

// The income fields, for adding an entry or editing one (`initial`).
// onSubmit resolves to { error }; on failure the form keeps what was
// typed. `tree` is the income categories' tree (see categoryTree);
// `onManage` opens the category manager (not offered until it can work).
export function IncomeForm({ initial, submitLabel, onSubmit, onCancel, tree, onManage }) {
  const [amount, setAmount] = useState(initial ? moneyText(initial.amount) : '')
  const [incomeDate, setIncomeDate] = useState(initial?.income_date ?? localDateString())
  // A new entry starts on "Salary", as before.
  const initialMain = initial ? tree.mainOf(initial.category_id) : tree.mainCategories.find((c) => c.name === 'Salary') ?? tree.mainCategories[0]
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(initial && initial.category_id !== initialMain?.id ? initial.category_id ?? '' : '')
  // The accounts, plus "Shared" only for an entry that is Shared (plan 9P
  // K216a); a new entry starts with nobody chosen (K217).
  const receiverOptions = payerOptionsFor(initial?.received_by)
  const [receivedBy, setReceivedBy] = useState(() => startingPayer(initial?.received_by))
  const [source, setSource] = useState(initial?.source ?? '')
  const [dateOk, setDateOk] = useState(true)
  const [dateError, setDateError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const value = parseDecimal(amount)
    if (!(value > 0)) return setDateError(amount.trim() ? 'Enter an amount above 0, like 13,60.' : 'Enter the amount.')
    if (!dateOk) return setDateError('Fix the date first (DD/MM/YYYY).')
    if (!receivedBy) return setDateError(RECEIVER_MISSING)
    const { error } = await onSubmit({ amount: value, incomeDate, categoryId: subId || mainId || null, receivedBy, source: source.trim() })
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
          <DecimalInput value={amount} onChange={(e) => { setAmount(e.target.value); setDateError('') }} aria-label="Amount (€)" placeholder="0.00" required />
          <DecimalHint value={amount} />
        </div>
        <div>
          <Label>Date</Label>
          <DateField label="Date" required value={incomeDate} onChange={(v) => { setIncomeDate(v); setDateError('') }} onValidity={setDateOk} />
        </div>
      </div>

      <div>
        <Label>Category</Label>
        <MoneyCategorySelect
          value={subId || mainId}
          onChange={(id, pick) => {
            setMainId(pick.mainId)
            setSubId(pick.subId)
          }}
          mainCategories={tree.mainCategories}
          subsOf={tree.subsOf}
          label="Income category"
          emptyLabel={null}
          onManage={onManage}
          manageLabel="Manage income categories"
          manageTitle="Add or delete income categories"
        />
      </div>

      <div>
        <Label>Received by</Label>
        <PayerSelect value={receivedBy} onChange={(v) => { setReceivedBy(v); setDateError('') }} options={receiverOptions} label="Received by" />
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
