import { Info } from 'lucide-react'

const TEXT = {
  item: 'Item category: what kind of product it is (HOME and SHOP). Its budget category is set in HOME → Categories.',
  budget: 'Budget category: what the money was for (MONEY totals). Purchases get it from their item category.',
}

// The one-line explanation next to a category picker, so an item category
// (what the product is) and a budget category (what the money was for)
// are never mixed up.
export function CategoryKind({ kind }) {
  return (
    <p className="mt-1 text-[10px] leading-snug text-[var(--color-text-muted)] flex items-start gap-1">
      <Info size={11} className="mt-px shrink-0 text-[var(--color-accent)]" />
      {TEXT[kind]}
    </p>
  )
}
