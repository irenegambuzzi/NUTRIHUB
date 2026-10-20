import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Plus, CornerDownRight, Pencil, FolderInput, Check, Lock } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label, Select } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'
import { categoryMemoryStore, groceryStore, pantryStore } from '../../lib/stores'
import {
  APPLIANCES_ID,
  LOCKED_HINT,
  deleteProblem,
  isUnused,
  mergeProblem,
  mergeTargets,
  moveProblem,
  moveTargets,
  nameProblem,
  pathOf,
  renameProblem,
  usageOf,
} from '../../lib/inventoryCategoryEdit'

const CHOOSE = '__choose'
const MAIN = '__main'

const APPLIANCES_HINT = `Used for home and appliance purchases. ${LOCKED_HINT}`

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What a delete will move along, in words ("3 items, 1 SHOP entry").
function usageText(usage) {
  const parts = []
  if (usage.items) parts.push(plural(usage.items, 'item'))
  if (usage.entries) parts.push(plural(usage.entries, 'SHOP entry', 'SHOP entries'))
  if (usage.memory) parts.push(plural(usage.memory, 'remembered name'))
  if (usage.subs) parts.push(plural(usage.subs, 'sub-category', 'sub-categories'))
  return parts.join(', ')
}

// HOME → Categories → Manage categories: add, rename, move and delete the
// item categories. Deleting one that is in use moves everything in it to
// another category (nothing is lost); old expenses, stock, colours and
// icons never change.
export function InventoryCategoryManager({ onClose }) {
  const { categories, parents, subsByParent, byId, addCategory, addSubcategory, renameCategory, moveSubcategory, deleteCategory } = useInventoryCategories()
  const { rows: items } = pantryStore.useRows()
  const { rows: entries } = groceryStore.useRows()
  const { rows: memory } = categoryMemoryStore.useRows()

  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // The one row being renamed or moved: { id, mode: 'rename' | 'move', value }.
  const [editing, setEditing] = useState(null)
  // The one row being deleted: { id, target }. target '' = not chosen yet.
  const [deleting, setDeleting] = useState(null)

  // A sub-category is named with its main ("Frozen Food › Frozen Vegetables"),
  // so two with the same name can be told apart.
  const full = (c) => pathOf(categories, c)

  const usageById = useMemo(() => new Map(categories.map((c) => [c.id, usageOf(categories, c, items, entries, memory)])), [categories, items, entries, memory])

  const run = async (action) => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    return result
  }
  const finish = (result) => {
    if (result.error) {
      // Refusals about names and rules show here; connection problems
      // already showed a toast.
      setError(result.error.nameProblem || result.error.message ? result.error.message : '')
      return false
    }
    setError('')
    setNotice(result.message ?? '')
    return true
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    const problem = nameProblem(categories, trimmed)
    if (problem) {
      setNotice('')
      return setError(problem)
    }
    const result = await run(() => (parentId ? addSubcategory(parentId, trimmed) : addCategory(trimmed)))
    if (result.error) return finish(result)
    setName('')
    setError('')
    setNotice(`"${trimmed}" added.`)
  }

  const startEdit = (c, mode) => {
    setDeleting(null)
    setError('')
    setNotice('')
    // A main with sub-categories can't become a sub-category: say why.
    if (mode === 'move' && !c.parent_id && (subsByParent.get(c.id)?.length ?? 0) > 0) {
      return setError(`"${c.name}" has sub-categories, so it can't become a sub-category. Move or merge those first.`)
    }
    setEditing({ id: c.id, mode, value: mode === 'rename' ? c.name : CHOOSE })
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    if (busy) return
    const { id, mode, value } = editing
    const category = byId.get(id)
    if (mode === 'rename') {
      // Nothing to save when the name is as it was.
      if (value.trim() === category.name) return setEditing(null)
      const problem = renameProblem(categories, id, value)
      if (problem) return setError(problem)
      const result = await run(() => renameCategory(id, value))
      if (!finish(result)) return
      setNotice(`Renamed to "${value.trim()}".`)
      return setEditing(null)
    }
    if (value === CHOOSE) return setError('Choose where to move it.')
    const target = value === MAIN ? null : value
    const problem = moveProblem(categories, id, target)
    if (problem) return setError(problem)
    const result = await run(() => moveSubcategory(id, target))
    if (finish(result)) setEditing(null)
  }

  const startDelete = (c) => {
    setEditing(null)
    setError('')
    setNotice('')
    setDeleting({ id: c.id, target: '' })
  }

  const confirmDelete = async () => {
    const c = byId.get(deleting.id)
    const unused = isUnused(usageById.get(c.id))
    if (!unused) {
      const problem = mergeProblem(categories, c.id, deleting.target)
      if (problem) return setError(problem)
    }
    const result = await run(() => deleteCategory(c.id, unused ? null : deleting.target))
    if (finish(result)) setDeleting(null)
  }

  const iconButton = 'text-[var(--color-icon-muted)] w-9 h-9 flex items-center justify-center disabled:opacity-30'

  const editRow = (c, isSub) => {
    const targets = editing.mode === 'move' ? moveTargets(categories, c.id) : []
    return (
      <form key={c.id} onSubmit={saveEdit} className="flex items-center gap-2 py-1.5 text-xs">
        {isSub && <CornerDownRight size={12} className="text-[var(--color-icon-muted)] ml-2 shrink-0" />}
        {editing.mode === 'rename' ? (
          <Input autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} aria-label={`New name for ${full(c)}`} className="flex-1 min-w-0" />
        ) : (
          <Select value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} aria-label={`Move ${full(c)} to`} className="flex-1 min-w-0">
            <option value={CHOOSE} disabled>
              {c.parent_id ? 'Move to…' : 'Make it a sub-category of…'}
            </option>
            {c.parent_id && c.id !== APPLIANCES_ID && !moveProblem(categories, c.id, null) && <option value={MAIN}>Make it a main category</option>}
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {c.parent_id ? 'Move to' : 'Make it a sub-category of'} {p.name}
              </option>
            ))}
          </Select>
        )}
        <button type="submit" disabled={busy} aria-label="Save" title="Save" className={`${iconButton} hover:text-[var(--color-primary)]`}>
          <Check size={15} />
        </button>
        <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel" className={`${iconButton} hover:text-[var(--color-text)]`}>
          <X size={15} />
        </button>
      </form>
    )
  }

  const deletePanel = (c) => {
    const usage = usageById.get(c.id)
    const unused = isUnused(usage)
    const targets = unused ? [] : mergeTargets(categories, c.id)
    const problem = !unused && deleting.target ? mergeProblem(categories, c.id, deleting.target) : null
    return (
      <div className="mt-1 ml-[18px] rounded-2xl border border-[var(--color-border)] p-3 space-y-2">
        {unused ? (
          <p className="text-[11px] text-yellow-300">Delete "{full(c)}"? Nothing uses it. You can undo for a few seconds.</p>
        ) : (
          <>
            <p className="text-[11px] text-yellow-300">
              "{full(c)}" is in use ({usageText(usage)}). Choose where everything goes; then it is deleted. This can't be undone, but nothing is lost: stock, old expenses, colours and icons stay as they are.
            </p>
            <Select
              value={deleting.target}
              onChange={(e) => setDeleting({ ...deleting, target: e.target.value })}
              aria-label={`Move the items of ${full(c)} to`}
              className="text-xs"
            >
              <option value="" disabled>
                Move items to…
              </option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.isSub ? `   › ${t.label}` : t.label}
                </option>
              ))}
            </Select>
            {problem && <p className="text-[11px] text-red-400">{problem}</p>}
          </>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-xs py-2 min-h-9" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy || (!unused && (!deleting.target || Boolean(problem)))}
            className="flex-1 min-h-9 rounded-2xl bg-red-500 text-white text-xs font-bold disabled:opacity-40"
          >
            {unused ? 'Delete' : 'Move & delete'}
          </button>
        </div>
      </div>
    )
  }

  const row = (c, isSub) => {
    if (editing?.id === c.id) return editRow(c, isSub)
    const usage = usageById.get(c.id)
    const appliances = c.id === APPLIANCES_ID
    const cannotDelete = deleteProblem(categories, c.id)
    return (
      <div key={c.id} className="py-1.5 text-xs">
        <div className="flex items-center gap-2">
          {isSub ? <CornerDownRight size={12} className="text-[var(--color-icon-muted)] ml-2 shrink-0" /> : <CategoryIcon category={c.id} size={14} />}
          <span className="flex-1 min-w-0">
            <span className="block text-[var(--color-text)] truncate">{c.name}</span>
            <span className="block text-[10px] text-[var(--color-text-muted)]">{plural(usage.items, 'item')}</span>
          </span>
          <span className="flex items-center shrink-0">
            <button
              onClick={() => startEdit(c, 'rename')}
              disabled={appliances}
              title={appliances ? "Can't be renamed" : 'Rename'}
              aria-label={`Rename ${full(c)}`}
              className={`${iconButton} hover:text-[var(--color-primary)]`}
            >
              {appliances ? <Lock size={13} /> : <Pencil size={13} />}
            </button>
            <button
              onClick={() => startEdit(c, 'move')}
              disabled={appliances}
              title={appliances ? "Can't be moved" : 'Move'}
              aria-label={`Move ${full(c)}`}
              className={`${iconButton} hover:text-[var(--color-primary)]`}
            >
              <FolderInput size={13} />
            </button>
            <button
              onClick={() => startDelete(c)}
              disabled={Boolean(cannotDelete)}
              title={cannotDelete ? "Can't be deleted" : 'Delete'}
              aria-label={`Delete ${full(c)}`}
              className={`${iconButton} hover:text-red-400 disabled:hover:text-[var(--color-icon-muted)]`}
            >
              <Trash2 size={13} />
            </button>
          </span>
        </div>
        {appliances && <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 ml-[22px]">{APPLIANCES_HINT}</p>}
        {deleting?.id === c.id && deletePanel(c)}
      </div>
    )
  }

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Manage categories"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Manage categories</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleAdd} className="space-y-2">
          <Label>Add a category</Label>
          <Input placeholder="Name (e.g. Gluten free)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="flex-1" aria-label="Parent category">
              <option value="">Main category</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  Sub-category of {p.name}
                </option>
              ))}
            </Select>
            <Button type="submit" className="px-3" disabled={busy}>
              <Plus size={14} /> Add
            </Button>
          </div>
        </form>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {!error && notice && <p className="text-xs text-emerald-400">{notice}</p>}

        <div className="divide-y divide-[var(--color-border)]">
          {parents.map((p) => (
            <div key={p.id}>
              {row(p, false)}
              {(subsByParent.get(p.id) ?? []).map((s) => row(s, true))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
