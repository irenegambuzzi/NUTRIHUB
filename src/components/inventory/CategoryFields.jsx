import { useState } from 'react'
import { Plus, Wand2 } from 'lucide-react'
import { Input, Label, Select } from '../ui/Field'

const NEW = '__new__'

// Category and sub-category pickers. Nothing is picked until there's a
// suggestion or the user chooses; "+ New category…" / "+ New
// sub-category…" create one on the spot. onChange({ categoryId,
// subcategoryId }) is called for every pick (by hand).
export function CategoryFields({ categoryId, subcategoryId, parents, subsByParent, onChange, onAddCategory, onAddSubcategory, suggested, error, labels = true }) {
  const [adding, setAdding] = useState(null) // null | 'category' | 'sub'
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const subs = subsByParent.get(categoryId) || []

  const create = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const { data, error: addError } = adding === 'category' ? await onAddCategory(name) : await onAddSubcategory(categoryId, name)
    setBusy(false)
    if (addError) return
    onChange(adding === 'category' ? { categoryId: data.id, subcategoryId: '' } : { categoryId, subcategoryId: data.id })
    setAdding(null)
    setNewName('')
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          {labels && <Label>Category</Label>}
          <Select
            value={adding === 'category' ? NEW : categoryId}
            onChange={(e) => {
              if (e.target.value === NEW) return setAdding('category')
              setAdding(null)
              onChange({ categoryId: e.target.value, subcategoryId: '' })
            }}
            aria-label="Category"
            aria-invalid={Boolean(error)}
          >
            <option value="" disabled>
              Choose a category…
            </option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {onAddCategory && <option value={NEW}>+ New category…</option>}
          </Select>
        </div>
        <div>
          {labels && <Label>Sub-category</Label>}
          <Select
            value={adding === 'sub' ? NEW : subcategoryId}
            onChange={(e) => {
              if (e.target.value === NEW) return setAdding('sub')
              setAdding(null)
              onChange({ categoryId, subcategoryId: e.target.value })
            }}
            disabled={!categoryId}
            aria-label="Sub-category"
          >
            <option value="">No sub-category</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {onAddSubcategory && categoryId && <option value={NEW}>+ New sub-category…</option>}
          </Select>
        </div>
      </div>

      {adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder={adding === 'category' ? 'New category name' : 'New sub-category name'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
            className="flex-1"
          />
          <button
            type="button"
            onClick={create}
            disabled={!newName.trim() || busy}
            className="shrink-0 px-3 rounded-2xl bg-[var(--color-primary)] text-white text-xs font-bold flex items-center gap-1 disabled:opacity-40"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      )}

      {suggested && !error && (
        <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Wand2 size={12} className="text-[var(--color-accent)]" /> Category suggested from the name — change it if it's wrong (it will be remembered).
        </p>
      )}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  )
}
