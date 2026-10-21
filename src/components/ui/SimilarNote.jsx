import { categoryPath, sameName, similarCategories } from '../../lib/categoryNames'

// A short warning under a name being typed in Manage: "Similar category
// exists: Shopping › Gifts" (also for a small typo like "Gfits"). It only
// warns — Add / Save stay on, because "Car" and "Cart" can both be real. A
// name that is exactly taken is explained by the refusal instead. `exceptId`
// is the category being renamed.
export function SimilarNote({ name, categories, exceptId = null, className = '' }) {
  if (!String(name ?? '').trim()) return null
  if (categories.some((c) => c.id !== exceptId && sameName(c.name, name))) return null
  const similar = similarCategories(name, categories, { exceptId })
  if (similar.length === 0) return null
  return (
    <p className={`text-[11px] text-yellow-300 ${className}`}>
      Similar category exists: {similar.map((c) => categoryPath(categories, c)).join(', ')}. You can still use your name.
    </p>
  )
}
