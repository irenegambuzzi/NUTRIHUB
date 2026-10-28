import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Globe, X } from 'lucide-react'
import { OrderForm } from '../expenses/OrderForm'
import { useExpenseCategories } from '../../hooks/useExpenses'
import { useCategoryColors } from '../../hooks/useCategoryColors'
import { createOrder } from '../../hooks/useOrders'
import { budgetCategoryFor } from '../../lib/budgetMap'
import { categoryTree } from '../../lib/moneyList'
import { budgetMapStore, expenseCategoryStore, inventoryCategoryStore } from '../../lib/stores'
import { showToast } from '../../lib/feedback'
import { orderUnits } from '../../lib/orders'
import { isDurableBudget, isServiceBudget } from '../../lib/durable'
import { isDurable } from '../../lib/inventory'

// "Order online" for a SHOP list entry: the order form, filled in from the
// entry and its HOME item (or group) — store (its usual one), quantity,
// price if known, budget category (from the item category's mapping) and
// who pays. Saving makes the order and its one expense, exactly like Orders
// in MONEY, linked to the HOME item and to this list entry; the entry then
// waits under "On the way".
export function OrderOnlineDialog({ entry, pantry, total, onClose }) {
  const { categories, addCategory, renameCategory, moveCategory, deleteCategory } = useExpenseCategories()
  const { rows: mapRows, loaded: mapLoaded } = budgetMapStore.useRows()
  const { rows: inventoryCategories, loaded: itemCategoriesLoaded } = inventoryCategoryStore.useRows()
  const { loaded: categoriesLoaded } = expenseCategoryStore.useRows()
  // The form takes its starting values once: it waits until the budget
  // categories and the mapping are loaded, so the prefilled one is right.
  const ready = categoriesLoaded && mapLoaded && itemCategoriesLoaded
  const styleFor = useCategoryColors(categories, { subsFollowMain: true })
  const { mainCategories, subsOf } = useMemo(() => categoryTree(categories), [categories])

  const categoryId = useMemo(() => {
    try {
      return budgetCategoryFor(entry, { mapRows, expenseCategories: categories, inventoryCategories })
    } catch {
      return null
    }
  }, [entry, mapRows, categories, inventoryCategories])

  const prefill = {
    itemName: entry.name,
    shopId: pantry?.usual_shop_id ?? '',
    price: total > 0 ? Math.round(total * 100) / 100 : '',
    paidBy: entry.payer || 'shared',
    categoryId,
    quantity: entry.quantity,
    unit: entry.unit,
  }
  // A durable entry (Durables tree, or a durable budget category) never
  // goes into HOME, not even when it arrives (plan 9F); nor a service
  // (a service budget category, decision 14b).
  const durable = isDurable(entry) || isDurableBudget(categoryId, categories)
  const service = !durable && isServiceBudget(categoryId, categories)
  const linkNote = durable
    ? 'Durable item — saving adds the expense; it never goes into HOME.'
    : service
    ? 'Service — saving adds the expense; it never goes into HOME.'
    : pantry
    ? `For "${pantry.name}" in HOME${pantry.is_group ? ' (group: you pick the variant when it arrives)' : ''}. Saving adds the expense now; "Arrived" adds the stock. Until then it waits under "On the way" and isn't bought twice.`
    : 'Not in HOME yet. Saving adds the expense now; when it arrives you can add it to HOME.'

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Order "${entry.name}" online`}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2">
            <Globe size={16} /> Order online
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>
        {!ready ? (
          <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>
        ) : (
        <OrderForm
          key={categoryId ?? 'none'}
          prefill={prefill}
          units={pantry || entry.unit ? orderUnits(entry, pantry) : null}
          linkNote={linkNote}
          packItem={durable || service ? null : pantry}
          submitLabel="Save order"
          onCancel={onClose}
          categories={categories}
          mainCategories={mainCategories}
          subsOf={subsOf}
          addCategory={addCategory}
          renameCategory={renameCategory}
          moveCategory={moveCategory}
          deleteCategory={deleteCategory}
          styleFor={styleFor}
          onSubmit={async (values, ids) => {
            const result = await createOrder(values, ids, { pantryItemId: pantry?.id ?? null, groceryItemId: entry.id })
            if (!result.error) {
              showToast({ message: `"${values.itemName}" ordered — its expense is in MONEY; it waits under "On the way".` })
              onClose()
            }
            return result
          }}
        />
        )}
      </div>
    </div>,
    document.body
  )
}
