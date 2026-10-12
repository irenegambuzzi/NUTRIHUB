import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Layers, PackageCheck, PackagePlus, Plus, X } from 'lucide-react'
import { Label, Select } from '../ui/Field'
import { SearchBox } from '../ui/SearchBox'
import { ItemEditor } from '../inventory/ItemEditor'
import { RestockForm } from '../inventory/RestockForm'
import { usePantryItems } from '../../hooks/usePantryItems'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'
import { showToast } from '../../lib/feedback'
import { newVariantFields } from '../../lib/groups'
import { formatPurchaseQuantity } from '../../lib/inventory'

const CHOICES = [
  { mode: 'item', label: 'Add to an existing item', hint: 'Restock something you already have in HOME.', Icon: PackagePlus },
  { mode: 'group', label: 'Add to a variant of an item group', hint: 'E.g. one brand inside "Chips & Snacks".', Icon: Layers },
  { mode: 'new', label: 'Create a new item', hint: 'It becomes a New Item in HOME.', Icon: Plus },
]

// Asked once an order has arrived: should it go into HOME? Stock goes to
// an existing item, to a variant of an item group, or into a new item; the
// quantity can be given in the item's purchase unit or its stock unit
// (the same conversion as the + button in HOME). "Don't add to HOME" just
// closes. Only HOME's stock is touched here — never an expense.
export function ArrivedDialog({ order, onClose }) {
  const { items, addItem, adjustStock } = usePantryItems()
  const { pantryParents: parents, subsByParent, addCategory, addSubcategory } = useInventoryCategories()
  const [mode, setMode] = useState(null) // null | 'item' | 'group' | 'new'
  const [search, setSearch] = useState('')
  const [itemId, setItemId] = useState('')
  const [groupId, setGroupId] = useState('')
  const saved = useRef(false)

  const plainItems = useMemo(() => items.filter((i) => !i.is_group && !i.group_id).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const groups = useMemo(() => items.filter((i) => i.is_group).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const query = search.trim().toLowerCase()
  const matching = query ? plainItems.filter((i) => i.name.toLowerCase().includes(query)) : plainItems
  const item = plainItems.find((i) => i.id === itemId)
  const group = groups.find((g) => g.id === groupId)
  const variants = group ? items.filter((i) => i.group_id === group.id).sort((a, b) => a.name.localeCompare(b.name)) : []

  const done = (message) => {
    saved.current = true
    showToast({ message })
    onClose()
  }

  const restockItem = async ({ delta }) => {
    const result = await adjustStock(item, delta, 'restocked')
    if (!result?.error) done(`Added ${formatPurchaseQuantity(delta, item.unit, item)} to "${item.name}"`)
    return result
  }

  const restockGroup = async ({ delta, variantId, newName }) => {
    const variant = variantId ? variants.find((v) => v.id === variantId) : null
    const result = variant
      ? await adjustStock(variant, delta, 'restocked')
      : await addItem(newVariantFields(group, newName, { current_stock: delta, packaging_unit: group.packaging_unit, quantity_per_pack: group.quantity_per_pack }))
    if (!result?.error) done(`Added ${delta} ${group.unit} to ${variant ? `"${variant.name}"` : `a new variant of "${group.name}"`}`)
    return result
  }

  const back = () => {
    setMode(null)
    setItemId('')
    setGroupId('')
  }

  if (mode === 'new') {
    return (
      <ItemEditor
        prefill={{ name: order.item_name }}
        parents={parents}
        subsByParent={subsByParent}
        onAddCategory={addCategory}
        onAddSubcategory={addSubcategory}
        onSave={async (fields) => {
          const result = await addItem(fields)
          if (!result?.error) {
            saved.current = true
            showToast({ message: `"${fields.name}" is now in HOME` })
          }
          return result
        }}
        onClose={() => (saved.current ? onClose() : back())}
      />
    )
  }

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`"${order.item_name}" arrived`}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2">
              <PackageCheck size={16} /> It arrived!
            </p>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">
              "{order.item_name}" is marked as arrived. Add it to HOME? The expense stays as it is — nothing new is added to your expenses.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        {!mode && (
          <div className="space-y-2">
            {CHOICES.map(({ mode: m, label, hint, Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="w-full text-left rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3 flex items-start gap-3"
              >
                <Icon size={16} className="mt-0.5 text-[var(--color-primary)] shrink-0" />
                <span>
                  <span className="block text-xs font-bold text-[var(--color-text)]">{label}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">{hint}</span>
                </span>
              </button>
            ))}
            <button type="button" onClick={onClose} className="w-full min-h-11 rounded-2xl text-xs font-bold text-[var(--color-text-muted)] border border-[var(--color-border)]">
              Don't add to HOME
            </button>
          </div>
        )}

        {mode === 'item' && (
          <div className="space-y-3">
            <button type="button" onClick={back} className="text-[11px] font-bold text-[var(--color-accent)] inline-flex items-center gap-1">
              <ChevronLeft size={12} /> Back
            </button>
            <div>
              <Label>Which item?</Label>
              <SearchBox value={search} onChange={setSearch} placeholder="Search your items…" />
              <Select value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-2" aria-label="Item">
                <option value="">{matching.length ? `Choose an item… (${matching.length})` : 'No item matches'}</option>
                {matching.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.current_stock} {i.unit})
                  </option>
                ))}
              </Select>
            </div>
            {item && <RestockForm key={item.id} item={item} onSubmit={restockItem} onClose={back} />}
          </div>
        )}

        {mode === 'group' && (
          <div className="space-y-3">
            <button type="button" onClick={back} className="text-[11px] font-bold text-[var(--color-accent)] inline-flex items-center gap-1">
              <ChevronLeft size={12} /> Back
            </button>
            {groups.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">There are no item groups yet. Make one in HOME ("Add group"), or create a new item instead.</p>
            ) : (
              <>
                <div>
                  <Label>Which group?</Label>
                  <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Item group">
                    <option value="">Choose a group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.current_stock} {g.unit})
                      </option>
                    ))}
                  </Select>
                </div>
                {group && <RestockForm key={group.id} item={group} variants={variants} onSubmit={restockGroup} onClose={back} />}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
