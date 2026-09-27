import { useState } from 'react'
import { Plus, Check, Trash2, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { GROCERY_CATEGORIES } from '../data/constants'
import { groceryCategoryColor } from '../lib/categoryColors'

export function GroceryPage() {
  const { items, addItem, toggleComplete, deleteItem, clearCompleted } = useGroceryItems()
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [name, setName] = useState('')
  const [category, setCategory] = useState(GROCERY_CATEGORIES[0])
  const [price, setPrice] = useState('')

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
    const { error } = await addItem({ name, category, price: parseFloat(price) || 0 })
    if (error) {
      alert('Could not save the item: ' + error.message)
      return
    }
    setName('')
    setPrice('')
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
          {filteredItems.map((item) => {
            const c = groceryCategoryColor(item.category)
            return (
              <div
                key={item.id}
                className={cn(
                  'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
                  item.completed ? 'bg-[var(--color-surface-soft)] border-[var(--color-border)] opacity-60' : cn(c.bg, c.border)
                )}
              >
                <button
                  onClick={() => window.confirm(`Remove "${item.name}" from the list?`) && deleteItem(item.id)}
                  className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-rose-400 transition p-1 z-10"
                >
                  <Trash2 size={13} />
                </button>

                <button onClick={() => toggleComplete(item)} className="w-full text-left hover:-translate-y-0.5 transition-transform duration-200">
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
                  {Number(item.price) > 0 && (
                    <p className="text-xs font-mono font-bold text-[var(--color-accent)] mt-1">€{Number(item.price).toFixed(2)}</p>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
