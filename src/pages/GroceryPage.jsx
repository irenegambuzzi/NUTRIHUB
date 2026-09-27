import { useMemo, useState } from 'react'
import { Plus, Check, Trash2, X, Pencil, Receipt } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { useExpenses } from '../hooks/useExpenses'
import { GROCERY_CATEGORIES, UNIT_OPTIONS } from '../data/constants'
import { groceryCategoryColor } from '../lib/categoryColors'

export function GroceryPage() {
  const { items, addItem, toggleComplete, updatePrice, deleteItem, clearCompleted } = useGroceryItems()
  const { expenses, deleteExpenses } = useExpenses()
  const [view, setView] = useState('list')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [name, setName] = useState('')
  const [category, setCategory] = useState(GROCERY_CATEGORIES[0])
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState(UNIT_OPTIONS[0])

  const filteredItems = selectedCategory === 'All' ? items : items.filter((i) => i.category === selectedCategory)
  const totalBudget = filteredItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const completedCount = items.filter((i) => i.completed).length

  // Every checked-off grocery item logs a "Groceries" expense — reuse
  // that history both to remember prices and to build receipts.
  const groceryExpenses = useMemo(() => expenses.filter((e) => e.expense_categories?.name === 'Groceries'), [expenses])

  const lastKnownPrices = useMemo(() => {
    const map = new Map()
    for (const e of groceryExpenses) {
      const key = (e.description || '').trim().toLowerCase()
      if (key && !map.has(key)) map.set(key, Number(e.amount))
    }
    return map
  }, [groceryExpenses])

  const receipts = useMemo(() => {
    const map = new Map()
    for (const e of groceryExpenses) {
      const list = map.get(e.expense_date) || []
      list.push(e)
      map.set(e.expense_date, list)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, list, total: list.reduce((sum, e) => sum + Number(e.amount || 0), 0) }))
  }, [groceryExpenses])

  const handleClearCompleted = () => {
    if (window.confirm(`Remove ${completedCount} checked item${completedCount === 1 ? '' : 's'} from the list?`)) {
      clearCompleted()
    }
  }

  const handleNameBlur = () => {
    if (price.trim() || !name.trim()) return
    const known = lastKnownPrices.get(name.trim().toLowerCase())
    if (known) setPrice(String(known))
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

      <div className="flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 w-fit text-xs font-bold">
        <button
          onClick={() => setView('list')}
          className={cn('px-4 py-1.5 rounded-full transition-all duration-200', view === 'list' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]')}
        >
          List
        </button>
        <button
          onClick={() => setView('receipts')}
          className={cn(
            'px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5',
            view === 'receipts' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          <Receipt size={13} /> Receipts
        </button>
      </div>

      {view === 'list' ? (
        <>
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
              <Input placeholder="Item name (e.g. Olive oil)" value={name} onChange={(e) => setName(e.target.value)} onBlur={handleNameBlur} />
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
        </>
      ) : (
        <ReceiptsView receipts={receipts} onDeleteReceipt={deleteExpenses} />
      )}
    </div>
  )
}

function ReceiptsView({ receipts, onDeleteReceipt }) {
  if (receipts.length === 0) {
    return (
      <Card className="text-center rounded-3xl">
        <p className="text-xs text-[var(--color-text-muted)]">No receipts yet — they appear here as you check off priced items.</p>
      </Card>
    )
  }

  const handleDelete = (date, list) => {
    if (window.confirm(`Delete the receipt from ${new Date(date).toLocaleDateString('en-GB')} (${list.length} item${list.length === 1 ? '' : 's'})?`)) {
      onDeleteReceipt(list.map((e) => e.id))
    }
  }

  return (
    <div className="space-y-3">
      {receipts.map(({ date, list, total }) => (
        <Card key={date} className="rounded-3xl">
          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 mb-2">
            <span className="text-xs font-bold text-[var(--color-text)]">
              {new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-[var(--color-accent)]">€{total.toFixed(2)}</span>
              <button onClick={() => handleDelete(date, list)} className="text-[var(--color-icon-muted)] hover:text-rose-400 transition">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {list.map((e) => (
              <div key={e.id} className="flex justify-between text-xs text-[var(--color-text-soft)]">
                <span>{e.description || 'Item'}</span>
                <span className="font-mono">€{Number(e.amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
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
    if (value !== Number(item.price)) await onUpdatePrice(item, value)
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
