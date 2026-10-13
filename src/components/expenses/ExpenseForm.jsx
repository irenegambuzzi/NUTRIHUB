import { useState } from 'react'
import { Plus, Check, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Label, Input, Select } from '../ui/Field'
import { ExpenseCategoryManager, ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { ShopPicker } from './ShopPicker'
import { useShops } from '../../hooks/useShops'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'
import { categoryTree } from '../../lib/moneyList'

// The expense fields, for adding an expense by hand or editing one
// (`initial`), plus the category manager they open. onSubmit resolves to
// { error }; on failure the form keeps what was typed.
export function ExpenseForm({
  initial,
  submitLabel = 'Add expense',
  onSubmit,
  onCancel,
  categories,
  mainCategories,
  subsOf,
  addCategory,
  renameCategory,
  moveCategory,
  deleteCategory,
  styleFor,
  onClose,
}) {
  const initialMain = initial ? categoryTree(categories).mainOf(initial.category_id) : null
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(initial && initial.category_id !== initialMain?.id ? initial.category_id ?? '' : '')
  const [managingCategories, setManagingCategories] = useState(false)
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? 'shared')
  const [expenseDate, setExpenseDate] = useState(initial?.expense_date ?? localDateString())
  const [shopId, setShopId] = useState(initial?.shop_id ?? '')
  const [dateOk, setDateOk] = useState(true)
  const [dateError, setDateError] = useState('')
  // Stores are only saved once the database has them (supabase/019).
  const { ready: shopsReady } = useShops()

  const handleAddExpense = async (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) return
    if (!dateOk) return setDateError('Fix the date first (DD/MM/YYYY).')
    const { error } = await onSubmit({
      categoryId: subId || mainId || null,
      amount: Number(amount),
      description,
      paidBy,
      expenseDate,
      ...(shopsReady ? { shopId: shopId || null } : {}),
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    if (!initial) {
      setAmount('')
      setDescription('')
      setShopId('')
    }
    onClose?.()
  }

  const pickCategory = ({ mainId: main, subId: sub }) => {
    setMainId(main)
    setSubId(sub)
  }

  return (
    <>
      {managingCategories && (
        <ExpenseCategoryManager
          value={{ mainId, subId }}
          onChange={pickCategory}
          categories={categories}
          styleFor={styleFor}
          addCategory={addCategory}
          renameCategory={renameCategory}
          moveCategory={moveCategory}
          deleteCategory={deleteCategory}
          onClose={() => setManagingCategories(false)}
        />
      )}

      <form onSubmit={handleAddExpense} data-unsaved={amount || description ? '' : undefined}>
        <Card className={initial ? 'space-y-3 border-0 shadow-none p-0 bg-transparent' : 'space-y-3'}>
          <div className="flex justify-between items-center">
            {!initial && <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add an expense</p>}
            {!initial && onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Amount (€)</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label>Date</Label>
              <DateField label="Date" required value={expenseDate} onChange={(v) => { setExpenseDate(v); setDateError('') }} onValidity={setDateOk} />
            </div>
          </div>

          <ExpenseCategoryPicker value={{ mainId, subId }} onChange={pickCategory} mainCategories={mainCategories} subsOf={subsOf} onManage={() => setManagingCategories(true)} />

          <ShopPicker value={shopId} onChange={setShopId} />

          <div>
            <Label>Description</Label>
            <Input placeholder="e.g. Cigarettes, dinner out…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <Label>Paid by</Label>
            <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {PAID_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
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
        </Card>
      </form>
    </>
  )
}
