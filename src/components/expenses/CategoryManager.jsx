import { useState } from 'react'
import { X, Trash2, Plus, CornerDownRight, Pencil, FolderInput, Check, Lock } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label, Select } from '../ui/Field'
import { SimilarNote } from '../ui/SimilarNote'
import { expenseUsageStore } from '../../lib/stores'
import { moveProblem, renameProblem } from '../../lib/categoryEdit'
import { DURABLE_EXPENSE_CATEGORY, TRIPS_CATEGORY_ID } from '../../data/constants'
import { sortCategories } from '../../lib/categoryOrder'

// Used by the grocery list (Groceries), as the fallback for deleted
// categories (Other) and for durable purchases (Home & Appliances), so none
// of them can be removed here.
const PROTECTED = ['Other', 'Groceries', DURABLE_EXPENSE_CATEGORY]

const MOVE_UNSET = '__choose'

// Main categories the app finds by name, so they keep their name and
// place; each shows why. (Income passes its own.)
const EXPENSE_LOCKED = {
  Other: 'Where expenses go when a category is deleted.',
  Groceries: 'Used by the shopping list for purchases.',
  [DURABLE_EXPENSE_CATEGORY]: 'Used for home and appliance purchases.',
}

// Main categories the app finds by id: they can be renamed (any name
// keeps working) but not moved or deleted; each shows why. Their
// sub-categories are free, and others can still be moved under them.
// (Income has none.)
const EXPENSE_FIXED = {
  [TRIPS_CATEGORY_ID]: "Locked: it can't be moved or deleted. You can rename it.",
}

// Expense categories by default; income passes its own wording and usage
// store — both work the same way. `smallSubDots`: a sub-category's dot is
// half the size of a main one's (expenses; income keeps equal dots).
export function CategoryManager({
  categories,
  styleFor,
  onAdd,
  onDelete,
  onRename,
  onMove,
  onClose,
  title = 'Expense categories',
  noun = 'expense',
  plural = 'expenses',
  usageStore = expenseUsageStore,
  protectedNames = PROTECTED,
  lockedHints = EXPENSE_LOCKED,
  fixedHints = EXPENSE_FIXED,
  smallSubDots = false,
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null)
  // The one row being renamed or moved: { id, mode: 'rename' | 'move', value }.
  const [editing, setEditing] = useState(null)
  const lockedNames = Object.keys(lockedHints)
  const fixedIds = Object.keys(fixedHints)

  // A–Z, "Other" last (the list, "Main category" and Move).
  const parents = sortCategories(categories.filter((c) => !c.parent_id))
  const subsOf = (id) => sortCategories(categories.filter((c) => c.parent_id === id))
  // Counts every expense ever, not just the period on screen.
  const { rows: expenses } = usageStore.useRows()
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

  const startEdit = (c, mode) => {
    setConfirming(null)
    setError('')
    if (mode === 'move' && !c.parent_id && subsOf(c.id).length > 0) {
      return setError(`"${c.name}" still has sub-categories. Move those first, then it can become a sub-category.`)
    }
    setEditing({ id: c.id, mode, value: mode === 'rename' ? c.name : MOVE_UNSET })
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    const { id, mode, value } = editing
    if (value === MOVE_UNSET) return setError('Choose where to move it.')
    const problem = mode === 'rename' ? renameProblem(categories, id, value, lockedNames) : moveProblem(categories, id, value || null, lockedNames, fixedIds)
    if (problem) return setError(problem)
    const category = categories.find((c) => c.id === id)
    // Nothing to save when the name is as it was.
    if (mode === 'rename' && value.trim() === category.name) return setEditing(null)
    const { error: saveError } = mode === 'rename' ? await onRename(id, value.trim()) : await onMove(id, value || null)
    // Failures show a toast and the row stays open.
    if (saveError) return
    setEditing(null)
    setError('')
  }

  // The category's colour dot; a sub-category's is half the size, centred
  // in the same space so the names line up.
  const dot = (c, isSub) =>
    isSub && smallSubDots ? (
      <span className="w-2.5 h-2.5 flex items-center justify-center shrink-0">
        <span data-dot="sub" className="w-[5px] h-[5px] rounded-full" style={{ background: styleFor(c.id).hex }} />
      </span>
    ) : (
      <span data-dot="main" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleFor(c.id).hex }} />
    )

  const iconButton = 'text-[var(--color-icon-muted)] w-8 h-8 flex items-center justify-center disabled:opacity-30'

  const editRow = (c, isSub) => (
    <div key={c.id}>
    <form onSubmit={saveEdit} className="flex items-center gap-2 py-1.5 text-xs">
      {isSub && <CornerDownRight size={12} className="text-[var(--color-icon-muted)] ml-2 shrink-0" />}
      {dot(c, isSub)}
      {editing.mode === 'rename' ? (
        <Input autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} aria-label={`New name for ${c.name}`} className="flex-1 min-w-0" />
      ) : (
        <Select value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} aria-label={`Move ${c.name} to`} className="flex-1 min-w-0">
          <option value={MOVE_UNSET} disabled>
            {c.parent_id ? 'Move to…' : 'Make it a sub-category of…'}
          </option>
          {c.parent_id && <option value="">Make it a main category</option>}
          {parents
            .filter((p) => p.id !== c.id && p.id !== c.parent_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {c.parent_id ? 'Move to' : 'Make it a sub-category of'} {p.name}
              </option>
            ))}
        </Select>
      )}
      <button type="submit" aria-label="Save" title="Save" className={`${iconButton} hover:text-[var(--color-primary)]`}>
        <Check size={15} />
      </button>
      <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel" className={`${iconButton} hover:text-[var(--color-text)]`}>
        <X size={15} />
      </button>
    </form>
    {editing.mode === 'rename' && <SimilarNote name={editing.value} categories={categories} exceptId={c.id} className="ml-2 pb-1" />}
    </div>
  )

  const row = (c, isSub) => {
    if (editing?.id === c.id) return editRow(c, isSub)
    const count = usage(c)
    const hint = !c.parent_id ? lockedHints[c.name] : null
    const fixedHint = !c.parent_id && !hint ? fixedHints[c.id] : null
    const locked = (protectedNames.includes(c.name) && !c.parent_id) || Boolean(fixedHint)
    return (
      <div key={c.id} className="py-1.5 text-xs">
      <div className="flex items-center gap-2">
        {isSub && <CornerDownRight size={12} className="text-[var(--color-icon-muted)] ml-2 shrink-0" />}
        {dot(c, isSub)}
        <span className="flex-1 min-w-0">
          <span className="block text-[var(--color-text)] truncate">{c.name}</span>
          <span className="block text-[10px] text-[var(--color-text-muted)]">
            {count} {count === 1 ? noun : plural}
          </span>
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
          <span className="flex items-center shrink-0">
            {onRename && (
              <button onClick={() => startEdit(c, 'rename')} disabled={!!hint} title={hint ? 'Can\'t be renamed' : 'Rename'} aria-label={`Rename ${c.name}`} className={`${iconButton} hover:text-[var(--color-primary)]`}>
                {hint ? <Lock size={13} /> : <Pencil size={13} />}
              </button>
            )}
            {onMove && (
              <button onClick={() => startEdit(c, 'move')} disabled={!!(hint || fixedHint)} title={hint || fixedHint ? 'Can\'t be moved' : 'Move'} aria-label={`Move ${c.name}`} className={`${iconButton} hover:text-[var(--color-primary)]`}>
                <FolderInput size={13} />
              </button>
            )}
            <button
              onClick={() => setConfirming(c.id)}
              disabled={locked}
              title={locked ? 'This category is required' : 'Delete category'}
              aria-label={`Delete ${c.name}`}
              className={`${iconButton} hover:text-red-400 disabled:hover:text-[var(--color-icon-muted)]`}
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 ml-[18px]">{hint} Locked: it can't be renamed, moved or deleted.</p>}
      {fixedHint && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 ml-[18px]">{fixedHint}</p>}
      </div>
    )
  }

  const confirmingCategory = categories.find((c) => c.id === confirming)

  return (
    <div data-unsaved className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">{title}</p>
          <button onClick={onClose} className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleAdd} className="space-y-2">
          <Label>Add a category</Label>
          <Input placeholder="Name (e.g. Restaurants)" value={name} onChange={(e) => setName(e.target.value)} />
          <SimilarNote name={name} categories={categories} />
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
            {usage(confirmingCategory)} {usage(confirmingCategory) === 1 ? noun : plural} to "Other". Nothing is lost.
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
