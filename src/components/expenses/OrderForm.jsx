import { useMemo, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Input, Label, Select, Textarea } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { DiscountField, LineDiscountNotes } from '../ui/DiscountField'
import { PackSizeField } from '../ui/PackSizeField'
import { ExpenseCategoryManager, ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { ShopPicker } from './ShopPicker'
import { PAID_BY_OPTIONS } from '../../data/constants'
import { localDateString } from '../../lib/expensePeriods'
import { categoryTree } from '../../lib/moneyList'
import { ORDER_UNITS, normalizeUrl } from '../../lib/orders'
import { chooseTotalPrice, chooseUnitPrice, changeQuantity, emptyPrice, orderTotal, prefilledPrice, priceMismatch, savedPrice, typeTotalPrice, typeUnitPrice } from '../../lib/orderPricing'
import { useFlow } from '../../hooks/useFlow'
import { decimalProblem, moneyText, parseDecimal } from '../../lib/decimal'
import { priceLines } from '../../lib/discounts'
import { packField, packStartText, packTextFor } from '../../lib/packSize'

// The order fields, for a new order or an existing one (`initial`).
// onSubmit(values, ids) resolves to { error }; on failure the form keeps
// what was typed. `ids` ({ orderId, expenseId }) are made once per form,
// so saving again after a dropped connection can't make a second order or
// expense. A store made here is an online one unless changed.
// `prefill`: starting values for a new order (from "Order online" on the
// SHOP list: { itemName, shopId, price, paidBy, categoryId, quantity,
// unit }); `units`: the units the quantity can be given in (a simple list
// when not given; for an order linked to a HOME item its purchase unit
// comes first); `linkNote` says what it is linked to.
// `packItem`: the HOME item (or group) the order is for. Bought in a
// package that isn't its stock unit, the order asks how many of its stock
// units are in 1 package (plan 9H): started with the item's usual size, or
// the order's own when editing; it may stay empty until Arrived. It never
// changes the item's usual size (only Arrived may, the first time).
//
// The price is a unit price and a total price, like on the SHOP list (see
// orderPricing.js): the NORMAL price. An order may have a discount of its
// own, in % or € (never a purchase coupon): what is paid after it is the
// order's price and the amount of its expense; the normal price is kept as
// `list_price` and is what the next order starts from. The quantity is only
// asked once the database has it (supabase/021).
export function OrderForm({
  initial,
  prefill = null,
  units: unitOptions = null,
  linkNote = null,
  packItem = null,
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
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? start?.paidBy ?? 'shared')
  const [mainId, setMainId] = useState(initialMain?.id ?? '')
  const [subId, setSubId] = useState(startCategory && startCategory !== initialMain?.id ? startCategory : '')
  const flow = useFlow()
  // Orders have a quantity once supabase/021 has been run; before that
  // the form has the total price only, as it always had.
  const withQuantity = flow.ready
  const [quantity, setQuantity] = useState(String(Number(initial?.quantity) > 0 ? Number(initial.quantity) : start?.quantity > 0 ? Number(start.quantity) : 1))
  const unitList = useMemo(() => [...new Set([...(unitOptions ?? ORDER_UNITS), initial?.unit].filter(Boolean))], [unitOptions, initial])
  const [unit, setUnit] = useState(initial?.unit ?? start?.unit ?? unitList[0])
  // The pack field as typed, for the unit it was typed for; an order
  // being edited starts with its own.
  const [packTyped, setPackTyped] = useState(() => (Number(initial?.pack_size) > 0 && initial.unit ? { text: String(Number(initial.pack_size)), unit: initial.unit } : null))
  const [price, setPrice] = useState(() =>
    initial ? savedPrice(initial.list_price ?? initial.price, quantity, unit) : start?.price > 0 ? prefilledPrice(start.price, quantity, unit) : emptyPrice
  )
  const [discountKind, setDiscountKind] = useState(initial?.discount_kind ?? 'percent')
  const [discountText, setDiscountText] = useState(initial?.discount_kind && Number(initial.discount_value) > 0 ? moneyText(initial.discount_value).replace(/\.00$/, '') : '')
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

  const pack = withQuantity && packItem ? packField({ item: packItem, unit, quantity: parseDecimal(quantity), text: packTextFor(packTyped, unit, packStartText(packItem, unit)), required: false, canSave: false }) : null
  const mismatch = withQuantity ? priceMismatch(price, quantity, unit) : null
  const normalTotal = orderTotal(price)
  const priced = priceLines([{ list: normalTotal > 0 ? normalTotal : NaN, discount: { kind: discountKind, text: discountText } }]).lines[0]

  const problem = () => {
    if (!itemName.trim()) return 'Give the order a name.'
    if (decimalProblem(price.total)) return `Total price: ${decimalProblem(price.total)}`
    if (withQuantity && decimalProblem(price.unit)) return `Unit price: ${decimalProblem(price.unit)}`
    if (withQuantity && decimalProblem(quantity)) return `Quantity: ${decimalProblem(quantity)}`
    if (withQuantity && !(parseDecimal(quantity) > 0)) return 'Enter how many you ordered (more than 0).'
    if (pack && decimalProblem(pack.text)) return `${pack.stockUnit} per ${pack.unit}: ${decimalProblem(pack.text)}`
    if (mismatch) return "The unit price and the total price don't match: choose which one is right."
    if (priced.problem) return priced.problem
    if (!(orderTotal(price) > 0)) return withQuantity ? 'Enter the total price or the unit price (more than 0).' : 'Enter the total price (more than 0).'
    if (!(priced.paid > 0)) return 'Nothing is paid after the discount — lower it.'
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
      {
        itemName,
        details,
        shopId,
        orderDate,
        price: priced.paid,
        listPrice: priced.discount ? priced.list : null,
        discountKind: priced.discount?.kind ?? null,
        discountValue: priced.discount?.value ?? null,
        paidBy,
        categoryId: subId || mainId || null,
        expectedDate,
        expectedUntil,
        url,
        ...(withQuantity ? { quantity: parseDecimal(quantity), unit } : {}),
        ...(withQuantity && packItem ? { packSize: pack?.value ?? null } : {}),
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
      setPrice(emptyPrice)
      setDiscountText('')
      setQuantity('1')
      setPackTyped(null)
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

      <form onSubmit={submit} data-unsaved={itemName || price.total || price.unit || details ? '' : undefined} className="space-y-3">
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

        <div>
          <Label>Order date</Label>
          <DateField label="Order date" required value={orderDate} onChange={setOrderDate} onValidity={(ok) => setDatesValid((v) => (v.order === ok ? v : { ...v, order: ok }))} />
        </div>

        {withQuantity && (
          <div>
            <Label>Quantity ordered</Label>
            <div className="flex gap-2">
              <DecimalInput
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setPrice((p) => changeQuantity(p, e.target.value, unit))
                }}
                aria-label="Quantity ordered"
                className="w-24 text-right"
              />
              <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit ordered" className="w-auto">
                {unitList.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
            <DecimalHint value={quantity} />
            {pack && (
              <div className="mt-2">
                <PackSizeField pack={pack} later onChange={(text) => setPackTyped({ text, unit: pack.unit })} />
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            {withQuantity && (
              <div>
                <Label>Unit price (€)</Label>
                <DecimalInput
                  value={price.unit}
                  onChange={(e) => setPrice((p) => typeUnitPrice(p, e.target.value, quantity, unit))}
                  aria-label="Unit price"
                  placeholder="0.00"
                />
                <DecimalHint value={price.unit} />
              </div>
            )}
            <div className={withQuantity ? undefined : 'col-span-2'}>
              <Label>Total price (€)</Label>
              <DecimalInput
                value={price.total}
                onChange={(e) => setPrice((p) => typeTotalPrice(p, e.target.value, quantity, unit))}
                aria-label="Total price"
                placeholder="0.00"
                required={!withQuantity}
              />
              <DecimalHint value={price.total} />
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {withQuantity ? 'The total price is the normal price. Fill in either price and the other is worked out from the quantity. With no discount it is what you paid: it becomes the expense.' : 'The total price is the normal price. With no discount it is what you paid: it becomes the expense.'}
          </p>
          {mismatch && (
            <div role="alert" className="rounded-2xl border border-amber-400/60 bg-amber-500/10 p-2.5 space-y-2">
              <p className="text-[11px] text-amber-200">
                {parseDecimal(quantity)} × €{mismatch.unit.toFixed(2)} is €{mismatch.expected.toFixed(2)}, not €{mismatch.total.toFixed(2)}. Which one is right?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPrice((p) => chooseUnitPrice(p, quantity, unit))}
                  className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text)]"
                >
                  Unit price is right (total €{mismatch.expected.toFixed(2)})
                </button>
                <button
                  type="button"
                  onClick={() => setPrice((p) => chooseTotalPrice(p, quantity, unit))}
                  className="min-h-9 px-3 rounded-xl border border-[var(--color-border)] text-[11px] font-bold text-[var(--color-text)]"
                >
                  Total price is right (€{mismatch.total.toFixed(2)})
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <DiscountField
            kind={discountKind}
            text={discountText}
            onChange={({ kind, text }) => {
              setDiscountKind(kind)
              setDiscountText(text)
            }}
            label="Discount"
            problem={priced.problem}
          />
          <LineDiscountNotes priced={priced} />
          {priced.discount && !priced.problem && <p className="text-[11px] text-[var(--color-text-muted)]">You pay €{priced.paid.toFixed(2)}: that is the order's price and its expense.</p>}
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
