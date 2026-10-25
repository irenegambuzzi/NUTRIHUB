import { useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { decimalProblem, firstDecimalProblem, moneyText, parseDecimal } from '../../lib/decimal'
import { CategoryFields } from '../inventory/CategoryFields'
import { CategoryChips } from '../ui/CategoryChips'
import { PriceFields } from '../inventory/PriceFields'
import { PayerPicker, UnitOptions } from './shared'
import { EXTRA_PACKAGING_UNITS, normName } from '../../lib/grocery'
import { DEFAULT_UNIT, SUGGESTED_UNITS } from '../../data/constants'
import { cn } from '../../lib/cn'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { useLastPrice } from '../../hooks/useLastPrice'
import { isDurable, roundQuantity } from '../../lib/inventory'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
import { isOneTime } from '../../lib/oneTime'
import { OneTimeToggle } from '../inventory/OneTimeToggle'
import { priceUnitOptions } from '../../lib/pricing'

const EMPTY_PRICE = { price: '', price_qty: '1', price_unit: '' }

// What a name fills in: the suggested category (see useCategorySuggestions)
// and the unit and last price of the pantry item with that name.
function fieldsFromName(value, suggest, pantryByName, priceDraft = EMPTY_PRICE) {
  const pick = suggest(value)
  // No (or no longer a) suggestion: drop an earlier one instead of keeping
  // it, e.g. "Te" → Coffee & Tea, then "Test" → nothing.
  const fields = { categoryId: pick?.categoryId ?? '', subcategoryId: pick?.subcategoryId ?? '', suggested: Boolean(pick) }
  const known = pantryByName.get(normName(value))
  if (known) {
    fields.unit = known.unit
    if (Number(known.price) > 0 && !priceDraft.price) {
      fields.priceDraft = { price: moneyText(known.price), price_qty: String(known.price_qty || 1), price_unit: known.price_unit || known.unit }
    }
  }
  return fields
}

// The full form for adding an item to the grocery list. `initialName`
// (from the quick-add box) starts it filled in. The category is suggested
// from the name, or left empty for the user to pick; a pick by hand is
// remembered for that name on both phones.
export function AddItemForm({ parents, subsByParent, categoryName, pantryByName, onAdd, onAddCategory, onAddSubcategory, initialName = '', onAdded }) {
  const { suggest, suggestions, remember } = useCategorySuggestions({ parents, subsByParent })
  const [initial] = useState(() => (initialName ? fieldsFromName(initialName, suggest, pantryByName) : {}))
  const [name, setName] = useState(initialName)
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '')
  const [subcategoryId, setSubcategoryId] = useState(initial.subcategoryId ?? '')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [suggested, setSuggested] = useState(initial.suggested ?? false)
  const [priceDraft, setPriceDraft] = useState(initial.priceDraft ?? EMPTY_PRICE)
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(initial.unit ?? DEFAULT_UNIT)
  const [payer, setPayer] = useState('shared')
  // One-time purchase (1×), for something not in HOME yet: Confirm
  // purchase makes its new HOME item one-time too.
  const [oneTime, setOneTime] = useState(false)
  // Bought before: the last normal price and the unit it was bought in fill
  // in until the price or unit is changed by hand (the store never is).
  const [priceEdited, setPriceEdited] = useState(false)
  const [autoFilled, setAutoFilled] = useState(false)
  const last = useLastPrice(name)
  const lastKey = last ? `${last.price}|${last.quantity}|${last.unit}` : ''
  useEffect(() => {
    if (priceEdited) return
    if (last) {
      setPriceDraft({ price: moneyText(last.price), price_qty: String(last.quantity), price_unit: last.unit })
      setUnit(last.unit)
      setAutoFilled(true)
    } else if (autoFilled) {
      setPriceDraft(EMPTY_PRICE)
      setAutoFilled(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey, priceEdited])
  const chips = suggestions(name)

  // Suggest category/subcategory from the name until the user picks one.
  const handleNameChange = (value) => {
    setName(value)
    if (categoryTouched) return
    const fields = fieldsFromName(value, suggest, pantryByName, priceDraft)
    setCategoryId(fields.categoryId)
    setSubcategoryId(fields.subcategoryId)
    setSuggested(fields.suggested)
    if (fields.categoryId) setCategoryError('')
    if (fields.unit) setUnit(fields.unit)
    if (fields.priceDraft) setPriceDraft(fields.priceDraft)
  }

  const suggestedUnits = SUGGESTED_UNITS[categoryId] || []
  const formQuantity = roundQuantity(quantity, unit) || 1
  const formPack = pantryByName.get(normName(name))
  const formPriceUnits = priceUnitOptions({ unit }, formPack)
  const formPriceUnit = formPriceUnits.includes(priceDraft.price_unit) ? priceDraft.price_unit : unit

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    if (firstDecimalProblem(quantity, priceDraft.price, priceDraft.price_qty)) return
    const known = pantryByName.get(normName(name))
    const { error } = await onAdd({
      name: name.trim(),
      categoryId: categoryId || null,
      subcategoryId: categoryId ? subcategoryId || null : null,
      price: parseDecimal(priceDraft.price) || 0,
      priceQty: parseDecimal(priceDraft.price) > 0 ? parseDecimal(priceDraft.price_qty) || 1 : null,
      priceUnit: parseDecimal(priceDraft.price) > 0 ? formPriceUnit : null,
      quantity: formQuantity,
      unit,
      payer,
      pantryItemId: known?.id ?? null,
      oneTime: !known && oneTime && !isDurable({ category_id: categoryId }),
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    if (categoryTouched && categoryId) remember(name, categoryId, subcategoryId || null, { chips })
    setName('')
    setCategoryId('')
    setSubcategoryId('')
    setPriceDraft({ price: '', price_qty: '1', price_unit: '' })
    setQuantity('1')
    setCategoryTouched(false)
    setSuggested(false)
    setOneTime(false)
    setPriceEdited(false)
    setAutoFilled(false)
    onAdded?.()
  }

  return (
    <form onSubmit={handleAdd} data-unsaved={name.trim() ? '' : undefined}>
      <Card className="space-y-3 rounded-3xl">
        <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => handleNameChange(e.target.value)} />
        <CategoryChips
          mode="home"
          name={name}
          chips={chips}
          selected={{ categoryId, subcategoryId }}
          onPick={(pick) => {
            setCategoryId(pick.categoryId)
            setSubcategoryId(pick.subcategoryId ?? '')
            setCategoryTouched(true)
            setSuggested(false)
            setCategoryError('')
          }}
        />
        <CategoryFields
          categoryId={categoryId}
          subcategoryId={subcategoryId}
          parents={parents}
          subsByParent={subsByParent}
          onAddCategory={onAddCategory}
          onAddSubcategory={onAddSubcategory}
          onChange={(pick) => {
            setCategoryId(pick.categoryId)
            setSubcategoryId(pick.subcategoryId)
            setCategoryTouched(true)
            setSuggested(false)
            setCategoryError('')
          }}
          suggested={suggested}
          error={categoryError}
          labels={false}
        />
        <div className="grid grid-cols-2 gap-2">
          <DecimalInput
            placeholder="Qty to buy"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => !decimalProblem(quantity) && setQuantity(String(roundQuantity(quantity, unit) || 1))}
            aria-label="Quantity"
          />
          <Select
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value)
              setPriceEdited(true)
            }}
            aria-label="Unit"
          >
            <UnitOptions />
          </Select>
        </div>
        <DecimalHint value={quantity} className="-mt-2" />
        <PriceFields
          value={{ ...priceDraft, price_unit: formPriceUnit }}
          onChange={(patch) => {
            setPriceEdited(true)
            setPriceDraft((d) => ({ ...d, ...patch }))
          }}
          unitOptions={formPriceUnits}
          line={{ quantity: formQuantity, unit }}
          pack={formPack}
        />
        {suggestedUnits.length > 0 && !suggestedUnits.includes(unit) && !EXTRA_PACKAGING_UNITS.includes(unit) && (
          <p className={cn('text-[11px] flex items-center gap-1.5 -mt-1', STATUS_STYLES.low.text)}>
            <AlertTriangle size={12} /> "{unit}" is unusual for {categoryName(categoryId)} (usually {suggestedUnits.join(', ')}).
          </p>
        )}
        {/* A durable is never HOME stock, so never 1× either (plan 9F).
            Without a category, Confirm purchase would put it into HOME. */}
        {!categoryId && <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">Is this a consumable? Durable items don't go into HOME stock.</p>}
        {formPack ? (
          isOneTime(formPack) && <p className="text-[11px] text-[var(--color-text-muted)]">"{formPack.name}" is a one-time purchase (1×) in HOME — change it there.</p>
        ) : (
          !isDurable({ category_id: categoryId }) && <OneTimeToggle checked={oneTime} onChange={setOneTime} />
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Paid by</span>
          <PayerPicker value={payer} onChange={setPayer} />
        </div>
        <Button type="submit" className="w-full rounded-2xl">
          <Plus size={16} /> Add to list
        </Button>
      </Card>
    </form>
  )
}
