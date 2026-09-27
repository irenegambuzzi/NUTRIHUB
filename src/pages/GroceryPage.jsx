import { useState } from 'react'
import { Plus, Check, Trash2, X, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { GROCERY_CATEGORIES, UNIT_OPTIONS } from '../data/constants'
import { groceryCategoryColor } from '../lib/categoryColors'

export function GroceryPage() {
  const { items, addItem, toggleComplete, updatePrice, deleteItem, clearCompleted } = useGroceryItems()
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [name, setName] = useState('')
  const [category, setCategory] = useState(GROCERY_CATEGORIES[0])
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(UNIT_OPTIONS[0])

  const filteredItems = selectedCategory === 'All' ? items : items.filter((i) => i.category === selectedCategory)
  const totalBudget = filteredItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const completedCount = items.filter((i) => i.completed).length

  const handleClearCompleted = () => {
    if (window.confirm(`Remove ${completedCount} checked item${completedCount === 1 ? '' : 's'} from the list?`)) {
      clearCompleted()
    }
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const { error } = await addItem({
      name,
      category,
      price: parseFloat(price) || 0,
      quantity: parseFloat(quantity) || 1,
      unit,
    })
    if (error) {
      alert('Could not save the item: ' + error.message)
      return
    }
    setName('')
    setPrice('')
    setQuantity('1')
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Grocery List</h2>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full border border-[var(--color-border)] shadow-sm">
          €{totalBudget.toFixed(2)}
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setSelectedCategory('All')}
          className={cn(
            'px-4 py-2 rounded-full border whitespace-nowrap font-bold transition-all duration-200',
            selectedCategory === 'All'
              ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white shadow-sm'
              : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)]'
          )}
        >
          All
        </button>
        {GROCERY_CATEGORIES.map((cat) => {
          const c = groceryCategoryColor(cat)
          const active = selectedCategory === cat
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'px-4 py-2 rounded-full border whitespace-nowrap font-bold transition-all duration-200 flex items-center gap-1.5',
                active ? cn(c.solid, 'border-transparent text-white shadow-sm') : cn(c.bg, c.border, c.text)
              )}
            >
              <CategoryIcon category={cat} size={14} />
              {cat}
            </button>
          )
        })}
      </div>

      <form onSubmit={handleAdd}>
        <Card className="space-y-3 rounded-3xl">
          <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {GROCERY_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
            <Input type="number" step="0.01" placeholder="Estimated price (€)" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.01" min="0" placeholder="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="w-full rounded-2xl">
            <Plus size={16} /> Add to list
          </Button>
        </Card>
      </form>

      {completedCount > 0 && (
        <button
          onClick={handleClearCompleted}
          className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-muted)] hover:text-rose-400 transition"
        >
          <X size={13} /> Clear {completedCount} checked item{completedCount === 1 ? '' : 's'}
        </button>
      )}

      {filteredItems.length === 0 ? (
        <Card className="text-center rounded-3xl">
          <p className="text-xs text-[var(--color-text-muted)]">Nothing here yet — add your first item above.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredItems.map((item) => (
            <GroceryItemTile key={item.id} item={item} onToggle={toggleComplete} onDelete={deleteItem} onUpdatePrice={updatePrice} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroceryItemTile({ item, onToggle, onDelete, onUpdatePrice }) {
  const c = groceryCategoryColor(item.category)
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceDraft, setPriceDraft] = useState(item.price || '')

  const savePrice = async () => {
    setEditingPrice(false)
    const value = parseFloat(priceDraft) || 0
    if (value !== Number(item.price)) await onUpdatePrice(item.id, value)
  }

  return (
    <div
      className={cn(
        'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
        item.completed ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : cn(c.bg, c.border)
      )}
    >
      <button
        onClick={() => window.confirm(`Remove "${item.name}" from the list?`) && onDelete(item.id)}
        className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-rose-400 transition p-1 z-10"
      >
        <Trash2 size={13} />
      </button>

      <button onClick={() => onToggle(item)} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
        <div
          className={cn(
            'w-9 h-9 rounded-2xl flex items-center justify-center mb-2 transition-all duration-200',
            item.completed ? 'bg-[var(--color-primary)] text-white' : cn(c.solid, 'text-white')
          )}
        >
          {item.completed ? <Check size={18} /> : <CategoryIcon category={item.category} size={18} />}
        </div>

        <p className={cn('text-sm font-bold leading-tight', item.completed ? 'line-through text-[var(--color-icon-muted)]' : 'text-[var(--color-text)]')}>
          {item.name}
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          {item.quantity} {item.unit}
        </p>
      </button>

      {editingPrice ? (
        <input
          type="number"
          step="0.01"
          min="0"
          autoFocus
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={savePrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setPriceDraft(item.price || '')
              setEditingPrice(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full mt-1.5 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs font-mono text-[var(--color-accent)] focus:outline-none focus:border-[var(--color-primary)]"
        />
      ) : (
        <button
          onClick={() => setEditingPrice(true)}
          className="flex items-center gap-1 mt-1.5 text-xs font-mono font-bold text-[var(--color-accent)] hover:opacity-80 transition"
        >
          {Number(item.price) > 0 ? `€${Number(item.price).toFixed(2)}` : <span className="text-[var(--color-text-muted)] font-sans font-semibold">+ Add price</span>}
          <Pencil size={10} className="text-[var(--color-icon-muted)]" />
        </button>
      )}
    </div>
  )
}
