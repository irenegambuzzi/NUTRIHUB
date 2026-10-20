import { CategoryChips } from '../ui/CategoryChips'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'

// The chips for an entry saved without a category (tap its grey "No
// category"): pick one or make a new one; the pick is saved on the entry
// and, when it is not the first chip, remembered for the name.
export function FixCategory({ item, onUpdateCategory, onDone }) {
  const { parents, subsByParent } = useInventoryCategories()
  const { suggestions, remember } = useCategorySuggestions({ parents, subsByParent })
  const chips = suggestions(item.name)
  return (
    <CategoryChips
      mode="home"
      name={item.name}
      chips={chips}
      className="mt-1"
      onPick={async (pick) => {
        const { error } = await onUpdateCategory(item, pick)
        if (error) return
        remember(item.name, pick.categoryId, pick.subcategoryId, { chips })
        onDone?.()
      }}
    />
  )
}
