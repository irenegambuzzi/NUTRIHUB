import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ArrowRight, Trash2, AlertCircle } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { CategoryIcon } from '../components/ui/CategoryIcon'
import { cn } from '../lib/cn'
import { usePantryItems } from '../hooks/usePantryItems'
import { useGroceryItems } from '../hooks/useGroceryItems'
import { PANTRY_CATEGORIES } from '../data/constants'
import { pantryCategoryColor } from '../lib/categoryColors'

export function PantryPage() {
  const { items, addItem, toggleStatus, deleteItem } = usePantryItems()
  const { addItem: addGroceryItem } = useGroceryItems()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [category, setCategory] = useState(PANTRY_CATEGORIES[0])
  const [alreadyOut, setAlreadyOut] = useState(false)

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const { data } = await addItem({ name, category, status: alreadyOut ? 'out' : 'ok' })
    if (alreadyOut && data) {
      await addGroceryItem({ name: data.name, category: 'Kitchen', price: 0 })
    }
    setName('')
    setAlreadyOut(false)
  }

  const sendToGrocery = async (item) => {
    await addGroceryItem({ name: item.name, category: 'Kitchen', price: 0 })
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
          {items.map((item) => {
            const c = pantryCategoryColor(item.category)
            const isOut = item.status !== 'ok'
            return (
              <div
                key={item.id}
                className={cn(
                  'relative rounded-3xl border p-3.5 shadow-sm transition-all duration-200',
                  isOut ? 'bg-rose-500/15 border-rose-500/30' : cn(c.bg, c.border)
                )}
              >
                <button
                  onClick={() => window.confirm(`Remove "${item.name}" from the pantry?`) && deleteItem(item.id)}
                  className="absolute top-2 right-2 text-[var(--color-icon-muted)] hover:text-rose-400 transition p-1"
                >
                  <Trash2 size={13} />
                </button>

                <div className={cn('w-9 h-9 rounded-2xl flex items-center justify-center mb-2', isOut ? 'bg-rose-400 text-white' : cn(c.solid, 'text-white'))}>
                  <CategoryIcon category={item.category} size={18} />
                </div>

                <p className="text-sm font-bold leading-tight text-[var(--color-text)]">{item.name}</p>

                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    onClick={() => toggleStatus(item.id, item.status)}
                    className={cn(
                      'flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-all duration-200',
                      isOut ? 'bg-rose-400 text-white' : 'bg-[var(--color-surface-soft)] text-[var(--color-text)]'
                    )}
                  >
                    {isOut ? 'Out of stock' : 'In stock'}
                  </button>
                  {isOut && (
                    <button
                      onClick={() => sendToGrocery(item)}
                      title="Send to grocery list"
                      className="bg-[var(--color-surface-soft)] p-1.5 rounded-xl text-[var(--color-accent)]"
                    >
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
