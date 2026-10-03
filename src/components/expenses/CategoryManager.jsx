import { useState } from 'react'
import { X, Trash2, Plus, CornerDownRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label, Select } from '../ui/Field'

// Used by the grocery list (Groceries) and as the fallback for deleted
// categories (Other), so neither can be removed here.
const PROTECTED = ['Other', 'Groceries']

export function CategoryManager({ categories, expenses, onAdd, onDelete, onClose }) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null)

  const parents = categories.filter((c) => !c.parent_id)
  const subsOf = (id) => categories.filter((c) => c.parent_id === id)
  const usage = (c) => expenses.filter((e) => e.category_id === c.id || subsOf(c.id).some((s) => s.id === e.category_id)).length

  const handleAdd = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return setError(`"${trimmed}" already exists.`)
    const { error: addError } = await onAdd(trimmed, parentId || null)
    // Failures show a toast.
    if (addError) return
    setName('')
    setError('')
  }

  const handleDelete = async (c) => {
    const { error: deleteError } = await onDelete(c.id)
    setConfirming(null)
    // Failures show a toast ("Other" can't be picked: its button is disabled).
    if (!deleteError) setError('')
  }

  const row = (c, isSub) => {
    const count = usage(c)
    const locked = PROTECTED.includes(c.name) && !c.parent_id
    return (
      <div key={c.id} className="flex items-center gap-2 py-1.5 text-xs">
        {isSub && <CornerDownRight size={12} className="text-[var(--color-icon-muted)] ml-2 shrink-0" />}
        <span className="flex-1 text-[var(--color-text)]">{c.name}</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {count} expense{count === 1 ? '' : 's'}
        </span>
        {confirming === c.id ? (
          <span className="flex items-center gap-1">
            <button onClick={() => handleDelete(c)} className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
              Delete
            </button>
            <button onClick={() => setConfirming(null)} className="px-2 py-0.5 rounded-full text-[10px] font-bold text-[var(--color-text-muted)]">
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(c.id)}
            disabled={locked}
            title={locked ? 'This category is required' : 'Delete category'}
            className="text-[var(--color-icon-muted)] hover:text-red-400 disabled:opacity-30 disabled:hover:text-[var(--color-icon-muted)] p-1"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    )
  }

  const confirmingCategory = categories.find((c) => c.id === confirming)

  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Expense categories</p>
          <button onClick={onClose} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleAdd} className="space-y-2">
          <Label>Add a category</Label>
          <Input placeholder="Name (e.g. Restaurants)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="flex-1" aria-label="Parent category">
              <option value="">Main category</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  Sub-category of {p.name}
                </option>
              ))}
            </Select>
            <Button type="submit" className="px-3">
              <Plus size={14} /> Add
            </Button>
          </div>
        </form>

        {confirmingCategory && (
          <p className="text-[11px] text-yellow-300">
            Deleting "{confirmingCategory.name}"{subsOf(confirmingCategory.id).length > 0 ? ' and its sub-categories' : ''} moves its{' '}
            {usage(confirmingCategory)} expense{usage(confirmingCategory) === 1 ? '' : 's'} to "Other". Nothing is lost.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="divide-y divide-[var(--color-border)]">
          {parents.map((p) => (
            <div key={p.id}>
              {row(p, false)}
              {subsOf(p.id).map((s) => row(s, true))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
