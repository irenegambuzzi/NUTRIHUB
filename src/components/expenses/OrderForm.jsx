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
import { parseNumber } from '../../lib/feedback'

// The order fields, for a new order or an existing one (`initial`).
// onSubmit(values, ids) resolves to { error }; on failure the form keeps
// what was typed. `ids` ({ orderId, expenseId }) are made once per form,
// so saving again after a dropped connection can't make a second order or
// expense. A store made here is an online one unless changed.
// `prefill`: starting values for a new order (from "Order online" on the
// SHOP list: { itemName, shopId, price, paidBy, categoryId, quantity,
// unit }); `units`: the units the quantity can be given in, which adds
// the quantity field (orders linked to a HOME item); `linkNote` says what
// it is linked to.
export function OrderForm({
  initial,
  prefill = null,
  units = null,
  linkNote = null,
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
  const start = initial ? null : prefill
  const startCategory = initial?.category_id ?? start?.categoryId ?? null
  const initialMain = startCategory ? categoryTree(categories).mainOf(startCategory) : null
  const [ids] = useState(() => ({ orderId: crypto.randomUUID(), expenseId: crypto.randomUUID() }))
  const [itemName, setItemName] = useState(initial?.item_name ?? start?.itemName ?? '')
  const [details, setDetails] = useState(initial?.details ?? '')
  const [shopId, setShopId] = useState(initial?.shop_id ?? start?.shopId ?? '')
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? localDateString())
  const [price, setPrice] = useState(initial ? String(initial.price) : start?.price > 0 ? String(start.price) : '')
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? start?.paidBy ?? 'shared')
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(startCategory && startCategory !== initialMain?.id ? startCategory : '')
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? start?.quantity ?? 1))
  const [unit, setUnit] = useState(initial?.unit ?? start?.unit ?? units?.[0] ?? '')
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
    if (units && !(parseNumber(quantity) > 0)) return 'Enter how many you ordered (more than 0).'
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
      {
        itemName,
        details,
        shopId,
        orderDate,
        price: Number(price),
        paidBy,
        categoryId: subId || mainId || null,
        expectedDate,
        expectedUntil,
        url,
        ...(units ? { quantity: parseNumber(quantity), unit } : {}),
      },
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
        {linkNote && <p className="text-[11px] text-[var(--color-text-soft)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2.5">{linkNote}</p>}

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

        {units && (
          <div>
            <Label>Quantity ordered</Label>
            <div className="flex gap-2">
              <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity ordered" className="w-24 text-right" />
              <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit ordered" className="w-auto">
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

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
