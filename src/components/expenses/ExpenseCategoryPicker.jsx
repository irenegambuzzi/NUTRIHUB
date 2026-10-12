import { Settings2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Label, Select } from '../ui/Field'
import { CategoryManager } from './CategoryManager'

// The category of an expense (or order): a main category and, once the
// main one has some, a sub-category. `value` is { mainId, subId } ('' for
// none); `onChange` gets the same; `onManage` opens the category manager.
export function ExpenseCategoryPicker({ value, onChange, mainCategories, subsOf, onManage }) {
  const { mainId, subId } = value
  return (
    <div>
      <Label>Category</Label>
      <div className="flex gap-2">
        <Select value={mainId} onChange={(e) => onChange({ mainId: e.target.value, subId: '' })} className="flex-1" aria-label="Category">
          <option value="">Uncategorized</option>
          {mainCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="button" variant="ghost" onClick={onManage} className="px-3" title="Add or delete categories">
          <Settings2 size={14} /> Manage
        </Button>
      </div>
      {mainId && subsOf(mainId).length > 0 && (
        <Select value={subId} onChange={(e) => onChange({ mainId, subId: e.target.value })} className="mt-2" aria-label="Subcategory">
          <option value="">No subcategory</option>
          {subsOf(mainId).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}

// The category manager for a form's picker. Render it next to the form,
// not inside it (it has forms of its own). Deleting or moving the
// category on screen takes it out of the picker.
export function ExpenseCategoryManager({ value, onChange, categories, styleFor, addCategory, renameCategory, moveCategory, deleteCategory, onClose }) {
  const { mainId, subId } = value
  const clearIfPicked = (id, result) => {
    if (!result.error && (mainId === id || subId === id)) onChange({ mainId: '', subId: '' })
    return result
  }
  return (
    <CategoryManager
      categories={categories}
      styleFor={styleFor}
      onAdd={addCategory}
      onDelete={async (id) => clearIfPicked(id, await deleteCategory(id))}
      onRename={renameCategory}
      onMove={async (id, parentId) => clearIfPicked(id, await moveCategory(id, parentId))}
      onClose={onClose}
    />
  )
}
