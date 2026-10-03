import { useState } from 'react'
import { AlertTriangle, Plus, Wand2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Field'
import { PriceFields } from '../inventory/PriceFields'
import { PayerPicker, UnitOptions } from './shared'
import { EXTRA_PACKAGING_UNITS, normName } from '../../lib/grocery'
import { DEFAULT_UNIT, SUGGESTED_UNITS } from '../../data/constants'
import { cn } from '../../lib/cn'
import { guessCategory } from '../../lib/categoryGuess'
import { quantityStep, roundQuantity } from '../../lib/inventory'
import { STATUS_STYLES } from '../../lib/inventoryStyles'
import { priceUnitOptions } from '../../lib/pricing'

// The form for adding an item to the grocery list by hand.
export function AddItemForm({ parents, subsByParent, categoryName, pantryByName, onAdd }) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [suggested, setSuggested] = useState(false)
  const [priceDraft, setPriceDraft] = useState({ price: '', price_qty: '1', price_unit: '' })
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(DEFAULT_UNIT)
  const [payer, setPayer] = useState('shared')

  // Manual add only: guess category/subcategory from the name (or take
  // them from the pantry item of the same name) until the user picks one.
  const handleNameChange = (value) => {
    setName(value)
    if (categoryTouched) return
    const known = pantryByName.get(normName(value))
    const guess = known ? { categoryId: known.category_id, subcategoryId: known.subcategory_id } : guessCategory(value)
    if (guess?.categoryId && parents.some((p) => p.id === guess.categoryId)) {
      // Only use a sub-category that actually exists in the database.
      const subExists = (subsByParent.get(guess.categoryId) || []).some((sub) => sub.id === guess.subcategoryId)
      setCategoryId(guess.categoryId)
      setSubcategoryId(subExists ? guess.subcategoryId : '')
      setSuggested(true)
      if (known) {
        setUnit(known.unit)
        if (Number(known.price) > 0 && !priceDraft.price) {
          setPriceDraft({ price: String(known.price), price_qty: String(known.price_qty || 1), price_unit: known.price_unit || known.unit })
        }
      }
    } else {
      // No (or no longer a) match: drop an earlier guess instead of
      // keeping it, e.g. "Te" → Coffee & Tea, then "Test" → nothing.
      setCategoryId('')
      setSubcategoryId('')
      setSuggested(false)
    }
  }

  const formCategory = categoryId || parents[0]?.id || ''
  const formSubs = subsByParent.get(formCategory) || []
  const suggestedUnits = SUGGESTED_UNITS[formCategory] || []
  const formQuantity = roundQuantity(quantity, unit) || 1
  const formPack = pantryByName.get(normName(name))
  const formPriceUnits = priceUnitOptions({ unit }, formPack)
  const formPriceUnit = formPriceUnits.includes(priceDraft.price_unit) ? priceDraft.price_unit : unit

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const known = pantryByName.get(normName(name))
    const { error } = await onAdd({
      name: name.trim(),
      categoryId: formCategory || null,
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
    setName('')
    setPriceDraft({ price: '', price_qty: '1', price_unit: '' })
    setQuantity('1')
    setCategoryTouched(false)
    setSuggested(false)
  }

  return (
    <form onSubmit={handleAdd}>
      <Card className="space-y-3 rounded-3xl">
        <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => handleNameChange(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={formCategory}
            onChange={(e) => {
              setCategoryId(e.target.value)
              setSubcategoryId('')
              setCategoryTouched(true)
              setSuggested(false)
            }}
            aria-label="Category"
          >
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={subcategoryId}
            onChange={(e) => {
              setSubcategoryId(e.target.value)
              setCategoryTouched(true)
              setSuggested(false)
            }}
            aria-label="Subcategory"
          >
            <option value="">No subcategory</option>
            {formSubs.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </Select>
        </div>
        {suggested && (
          <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5 -mt-1">
            <Wand2 size={12} className="text-[var(--color-accent)]" /> Category suggested from the name — change it if it's wrong.
          </p>
        )}
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
            <AlertTriangle size={12} /> "{unit}" is unusual for {categoryName(formCategory)} (usually {suggestedUnits.join(', ')}).
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
