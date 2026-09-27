import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ArrowRight, Trash2, AlertCircle, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { usePantryItems } from '../hooks/usePantryItems'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { PANTRY_CATEGORIES, PANTRY_TO_GROCERY_CATEGORY, UNIT_OPTIONS } from '../data/constants'
import { pantryCategoryColor } from '../lib/categoryColors'

export function PantryPage() {
  const { items, addItem, toggleStatus, updateQuantity, deleteItem } = usePantryItems()
  const { addItem: addGroceryItem } = useGroceryItems()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [category, setCategory] = useState(PANTRY_CATEGORIES[0])
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(UNIT_OPTIONS[0])
  const [alreadyOut, setAlreadyOut] = useState(false)

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const qty = parseFloat(quantity) || 1
    const { data } = await addItem({
      name,
      category,
      status: alreadyOut ? 'out' : 'ok',
      quantity: alreadyOut ? 0 : qty,
      unit,
    })
    if (alreadyOut && data) {
      await addGroceryItem({ name: data.name, category: PANTRY_TO_GROCERY_CATEGORY[category] || 'Kitchen', price: 0, quantity: qty, unit })
    }
    setName('')
    setQuantity('1')
    setAlreadyOut(false)
  }

  const sendToGrocery = async (item) => {
    await addGroceryItem({
      name: item.name,
      category: PANTRY_TO_GROCERY_CATEGORY[item.category] || 'Kitchen',
      price: 0,
      quantity: item.quantity || 1,
      unit: item.unit || 'pcs',
    })
    navigate('/grocery')
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Pantry</h2>

      <form onSubmit={handleAdd}>
        <Card className="space-y-3 rounded-3xl">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add a pantry item</p>
          <div className="flex gap-2">
            <Input placeholder="Name (e.g. Detergent, Paper towels)" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-32">
              {PANTRY_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={alreadyOut ? 'Quantity to buy' : 'Quantity in stock'}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="button"
            onClick={() => setAlreadyOut((v) => !v)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 rounded-2xl text-xs font-bold border transition-all duration-200',
              alreadyOut
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                : 'bg-[var(--color-surface-soft)] border-[var(--color-border)] text-[var(--color-text-muted)]'
            )}
          >
            <AlertCircle size={14} />
            Already out of stock — add to grocery list too
          </button>
          <Button type="submit" className="w-full rounded-2xl">
            <Plus size={14} /> Save to pantry
          </Button>
        </Card>
      </form>

      {items.length === 0 ? (
        <Card className="text-center rounded-3xl">
          <p className="text-xs text-[var(--color-text-muted)]">No pantry items yet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item) => (
            <PantryItemTile
              key={item.id}
              item={item}
              onToggleStatus={toggleStatus}
              onUpdateQuantity={updateQuantity}
              onDelete={deleteItem}
              onSendToGrocery={sendToGrocery}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PantryItemTile({ item, onToggleStatus, onUpdateQuantity, onDelete, onSendToGrocery }) {
  const c = pantryCategoryColor(item.category)
  const isOut = item.status !== 'ok'
  const [editing, setEditing] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(item.quantity ?? 1)
  const [unitDraft, setUnitDraft] = useState(item.unit || 'pcs')

  const save = async (qty, unit) => {
    const value = parseFloat(qty)
    await onUpdateQuantity(item.id, Number.isFinite(value) ? value : 0, unit)
  }

  return (
    <div
      className={cn(
        'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
        isOut ? 'bg-rose-500/15 border-rose-500/30' : cn(c.bg, c.border)
      )}
    >
      <button
        onClick={() => window.confirm(`Remove "${item.name}" from the pantry?`) && onDelete(item.id)}
        className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-rose-400 transition p-1"
      >
        <Trash2 size={13} />
      </button>

      <div className={cn('w-9 h-9 rounded-2xl flex items-center justify-center mb-2', isOut ? 'bg-rose-400 text-white' : cn(c.solid, 'text-white'))}>
        <CategoryIcon category={item.category} size={18} />
      </div>

      <p className="text-sm font-bold leading-tight text-[var(--color-text)]">{item.name}</p>

      {editing ? (
        <div className="flex gap-1 mt-1">
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={() => {
              save(qtyDraft, unitDraft)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setQtyDraft(item.quantity ?? 1)
                setEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-14 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
          />
          <select
            value={unitDraft}
            onChange={(e) => {
              setUnitDraft(e.target.value)
              save(qtyDraft, e.target.value)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-lg px-1 py-1 text-[11px] text-[var(--color-text)] focus:outline-none"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 mt-0.5 text-[11px] text-[var(--color-text-muted)] hover:opacity-80 transition">
          {item.quantity} {item.unit}
          <Pencil size={9} className="text-[var(--color-icon-muted)]" />
        </button>
      )}

      <div className="flex items-center gap-1.5 mt-2">
        <button
          onClick={() => onToggleStatus(item.id, item.status)}
          className={cn(
            'flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-all duration-200',
            isOut ? 'bg-rose-400 text-white' : 'bg-[var(--color-surface-soft)] text-[var(--color-text)]'
          )}
        >
          {isOut ? 'Out of stock' : 'In stock'}
        </button>
        {isOut && (
          <button
            onClick={() => onSendToGrocery(item)}
            title="Send to grocery list"
            className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-accent)]"
          >
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
