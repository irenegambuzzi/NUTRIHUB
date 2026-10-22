import { Label } from '../ui/Field'
import { MoneyCategorySelect } from '../ui/MoneyCategorySelect'
import { CategoryManager } from './CategoryManager'
import { CategoryKind } from '../ui/CategoryKind'

// The budget category of an expense (or order): a main category and, once
// the main one has some, a sub-category, side by side. `value` is
// { mainId, subId } ('' for none); `onChange` gets the same; `onManage`
// opens the category manager.
export function ExpenseCategoryPicker({ value, onChange, mainCategories, subsOf, onManage }) {
  return (
    <div>
      <Label>Budget category</Label>
      <MoneyCategorySelect
        value={value.subId || value.mainId}
        onChange={(id, { mainId, subId }) => onChange({ mainId, subId })}
        mainCategories={mainCategories}
        subsOf={subsOf}
        onManage={onManage}
      />
      <CategoryKind kind="budget" />
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
      smallSubDots
    />
  )
}
