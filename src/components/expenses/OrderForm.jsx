import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Input, Label, Select, Textarea } from '../ui/Field'
import { ExpenseCategoryManager, ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { ShopPicker } from './ShopPicker'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'
import { categoryTree } from '../../lib/moneyList'
import { normalizeUrl } from '../../lib/orders'

// The order fields, for a new order or an existing one (`initial`).
// onSubmit(values, ids) resolves to { error }; on failure the form keeps
// what was typed. `ids` ({ orderId, expenseId }) are made once per form,
// so saving again after a dropped connection can't make a second order or
// expense. A store made here is an online one unless changed.
export function OrderForm({
  initial,
  submitLabel = 'Add order',
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
}) {
  const initialMain = initial ? categoryTree(categories).mainOf(initial.category_id) : null
  const [ids] = useState(() => ({ orderId: crypto.randomUUID(), expenseId: crypto.randomUUID() }))
  const [itemName, setItemName] = useState(initial?.item_name ?? '')
  const [details, setDetails] = useState(initial?.details ?? '')
  const [shopId, setShopId] = useState(initial?.shop_id ?? '')
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? localDateString())
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? 'shared')
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(initial && initial.category_id !== initialMain?.id ? initial.category_id ?? '' : '')
  const [expectedDate, setExpectedDate] = useState(initial?.expected_date ?? '')
  const [expectedUntil, setExpectedUntil] = useState(initial?.expected_until ?? '')
  const [url, setUrl] = useState(initial?.order_url ?? '')
  const [datesValid, setDatesValid] = useState({ order: true, expected: true, until: true })
  const [managingCategories, setManagingCategories] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pickCategory = ({ mainId: main, subId: sub }) => {
    setMainId(main)
    setSubId(sub)
  }

  const problem = () => {
    if (!itemName.trim()) return 'Give the order a name.'
    if (!(Number(price) > 0)) return 'Enter the price (more than 0).'
    if (!orderDate || !datesValid.order) return 'Fix the order date first (DD/MM/YYYY).'
    if (!datesValid.expected || !datesValid.until) return 'Fix the expected date first (DD/MM/YYYY), or remove it.'
    if (expectedUntil && !expectedDate) return 'Add the expected arrival date too, or remove the latest date.'
    if (expectedUntil && expectedUntil < expectedDate) return "The latest date can't be before the expected arrival date."
    if (url.trim() && !normalizeUrl(url)) return 'That link is not a web address (e.g. https://www.vinted.it/…).'
    return ''
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const found = problem()
    setError(found)
    if (found) return
    setBusy(true)
    const { error: saveError } = await onSubmit(
      { itemName, details, shopId, orderDate, price: Number(price), paidBy, categoryId: subId || mainId || null, expectedDate, expectedUntil, url },
      ids
    )
    setBusy(false)
    // On failure the toast explains and the form keeps what was typed.
    if (saveError) return
    if (!initial) {
      setItemName('')
      setDetails('')
      setShopId('')
      setPrice('')
      setExpectedDate('')
      setExpectedUntil('')
      setUrl('')
    }
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

      <form onSubmit={submit} data-unsaved={itemName || price || details ? '' : undefined} className="space-y-3">
        <div>
          <Label>What did you order?</Label>
          <Input placeholder="e.g. Winter jacket" value={itemName} onChange={(e) => setItemName(e.target.value)} aria-label="Item name" required />
        </div>

        <div>
          <Label>Details (optional)</Label>
          <Textarea className="h-16" placeholder="Size, colour, seller…" value={details} onChange={(e) => setDetails(e.target.value)} aria-label="Details" />
        </div>

        <ShopPicker value={shopId} onChange={setShopId} defaultOnline label="Store (optional)" />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Order date</Label>
            <DateField label="Order date" required value={orderDate} onChange={setOrderDate} onValidity={(ok) => setDatesValid((v) => (v.order === ok ? v : { ...v, order: ok }))} />
          </div>
          <div>
            <Label>Price (€)</Label>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" required />
          </div>
        </div>

        <ExpenseCategoryPicker value={{ mainId, subId }} onChange={pickCategory} mainCategories={mainCategories} subsOf={subsOf} onManage={() => setManagingCategories(true)} />

        <div>
          <Label>Paid by</Label>
          <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} aria-label="Paid by">
            {PAID_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Expected arrival</Label>
            <DateField label="Expected arrival" value={expectedDate} onChange={setExpectedDate} onValidity={(ok) => setDatesValid((v) => (v.expected === ok ? v : { ...v, expected: ok }))} />
          </div>
          <div>
            <Label>Latest date (optional)</Label>
            <DateField label="Latest expected date" value={expectedUntil} onChange={setExpectedUntil} onValidity={(ok) => setDatesValid((v) => (v.until === ok ? v : { ...v, until: ok }))} />
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] -mt-2">Some marketplaces give a range, e.g. between 14 and 20 Oct: fill in both.</p>

        <div>
          <Label>Link to the order (optional)</Label>
          <Input inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Order link" />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy} className="flex-1">
            {initial ? <Check size={16} /> : <Plus size={16} />} {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </>
  )
}
