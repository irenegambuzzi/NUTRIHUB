import { useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Field'
import { CategoryFields } from '../inventory/CategoryFields'
import { PriceFields } from '../inventory/PriceFields'
import { PayerPicker, UnitOptions } from './shared'
import { EXTRA_PACKAGING_UNITS, normName } from '../../lib/grocery'
import { DEFAULT_UNIT, SUGGESTED_UNITS } from '../../data/constants'
import { cn } from '../../lib/cn'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { quantityStep, roundQuantity } from '../../lib/inventory'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
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
      fields.priceDraft = { price: String(known.price), price_qty: String(known.price_qty || 1), price_unit: known.price_unit || known.unit }
    }
  }
  return fields
}

// The full form for adding an item to the grocery list. `initialName`
// (from the quick-add box) starts it filled in. The category is suggested
// from the name, or left empty for the user to pick; a pick by hand is
// remembered for that name on both phones.
export function AddItemForm({ parents, subsByParent, categoryName, pantryByName, onAdd, onAddCategory, onAddSubcategory, initialName = '', onAdded }) {
  const { suggest, remember } = useCategorySuggestions({ parents, subsByParent })
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
    if (!categoryId) return setCategoryError('Pick a category (or add a new one).')
    const known = pantryByName.get(normName(name))
    const { error } = await onAdd({
      name: name.trim(),
      categoryId,
      subcategoryId: subcategoryId || null,
      price: parseFloat(priceDraft.price) || 0,
      priceQty: parseFloat(priceDraft.price) > 0 ? parseFloat(priceDraft.price_qty) || 1 : null,
      priceUnit: parseFloat(priceDraft.price) > 0 ? formPriceUnit : null,
      quantity: formQuantity,
      unit,
      payer,
      pantryItemId: known?.id ?? null,
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    if (categoryTouched) remember(name, categoryId, subcategoryId || null)
    setName('')
    setCategoryId('')
    setSubcategoryId('')
    setPriceDraft({ price: '', price_qty: '1', price_unit: '' })
    setQuantity('1')
    setCategoryTouched(false)
    setSuggested(false)
    onAdded?.()
  }

  return (
    <form onSubmit={handleAdd} data-unsaved={name.trim() ? '' : undefined}>
      <Card className="space-y-3 rounded-3xl">
        <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => handleNameChange(e.target.value)} />
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
          <Input
            type="number"
            step={quantityStep(unit)}
            min="0"
            placeholder="Qty to buy"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => setQuantity(String(roundQuantity(quantity, unit) || 1))}
            aria-label="Quantity"
          />
          <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
            <UnitOptions />
          </Select>
        </div>
        <PriceFields
          value={{ ...priceDraft, price_unit: formPriceUnit }}
          onChange={(patch) => setPriceDraft((d) => ({ ...d, ...patch }))}
          unitOptions={formPriceUnits}
          line={{ quantity: formQuantity, unit }}
          pack={formPack}
        />
        {suggestedUnits.length > 0 && !suggestedUnits.includes(unit) && !EXTRA_PACKAGING_UNITS.includes(unit) && (
          <p className={cn('text-[11px] flex items-center gap-1.5 -mt-1', STATUS_STYLES.low.text)}>
            <AlertTriangle size={12} /> "{unit}" is unusual for {categoryName(categoryId)} (usually {suggestedUnits.join(', ')}).
          </p>
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
