import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Layers, PackageCheck, PackagePlus, Plus, X } from 'lucide-react'
import { Label, Select } from '../ui/Field'
import { SearchBox } from '../ui/SearchBox'
import { ItemEditor } from '../inventory/ItemEditor'
import { RestockForm } from '../inventory/RestockForm'
import { pickFields, usePantryItems } from '../../hooks/usePantryItems'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'
import { alreadyArrivedMessage, arriveLinkedOrder, arrivedToast, discardUnusedItem } from '../../hooks/useOrders'
import { newVariantFields } from '../../lib/groups'
import { formatPurchaseQuantity } from '../../lib/inventory'
import { arrivalPickLabel } from '../../lib/similarItems'
import { localDateString } from '../../lib/week'

const CHOICES = [
  { mode: 'item', label: 'Add to an existing item', hint: 'Restock something you already have in HOME.', Icon: PackagePlus },
  { mode: 'group', label: 'Add to a variant of an item group', hint: 'E.g. one brand inside "Chips & Snacks".', Icon: Layers },
  { mode: 'new', label: 'Create a new item', hint: 'It becomes a New Item in HOME.', Icon: Plus },
]

// "Arrived" on an order not linked to HOME: should it go into HOME? Stock
// goes to an existing item, to a variant of an item group, or into a new
// item; the quantity can be given in the item's purchase unit or its stock
// unit (the same conversion as the + button in HOME; in a package, with
// the pack field of plan 9H, for this arrival only — nothing is saved as
// the item's usual size here). Every choice marks the order arrived and
// adds the stock in one step, exactly like a linked arrival (arrive_order,
// plan 9J), so the toast's Undo and "Back on the way" take out exactly
// that; a new item or variant is made first with stock 0. "Don't add to
// HOME" marks it arrived with nothing added. Closed with × or a tap
// outside, nothing happens: the order stays on the way. Only the first
// Arrived adds anything, on whichever phone. Never an expense.
export function ArrivedDialog({ order, onClose }) {
  const { items } = usePantryItems()
  const { pantryParents: parents, subsByParent, addCategory, addSubcategory } = useInventoryCategories()
  const [mode, setMode] = useState(null) // null | 'item' | 'group' | 'new'
  const [search, setSearch] = useState('')
  const [itemId, setItemId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [variantStart, setVariantStart] = useState(null)
  const [busy, setBusy] = useState(false)
  const saved = useRef(false)
  // Ids fixed per dialog, so pressing again never makes a second item:
  // one for "Create a new item", one per group for "New variant…".
  const newItemId = useRef(crypto.randomUUID())
  const variantIds = useRef(new Map())
  const variantIdFor = (id) => {
    if (!variantIds.current.has(id)) variantIds.current.set(id, crypto.randomUUID())
    return variantIds.current.get(id)
  }
  // New items made by a try whose second step failed: deleted again when
  // the dialog closes without them having arrived.
  const tried = useRef(new Set())

  const plainItems = useMemo(() => items.filter((i) => !i.is_group && !i.group_id).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const groups = useMemo(() => items.filter((i) => i.is_group).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const query = search.trim().toLowerCase()
  const matching = query ? plainItems.filter((i) => i.name.toLowerCase().includes(query)) : plainItems
  const item = plainItems.find((i) => i.id === itemId)
  const group = groups.find((g) => g.id === groupId)
  const variants = group ? items.filter((i) => i.group_id === group.id).sort((a, b) => a.name.localeCompare(b.name)) : []

  const discardTried = (except = null) => {
    for (const id of tried.current) if (id !== except) discardUnusedItem(id)
    tried.current.clear()
  }

  const close = () => {
    if (!saved.current) discardTried()
    onClose()
  }

  // One arrival (arriveLinkedOrder) and its toast, with Undo. On a failure
  // the form stays open with what was typed.
  const arrive = async (args, message) => {
    const made = args.newVariant ?? args.newItem
    const result = await arriveLinkedOrder(order, { date: localDateString(), ...args })
    if (result.error) {
      if (made && !result.error.offline) tried.current.add(made.id)
      return result
    }
    saved.current = true
    discardTried(made?.id)
    arrivedToast(result.added ? message : alreadyArrivedMessage(order), result.arrival)
    onClose()
    return result
  }

  const restockItem = ({ delta }) => arrive({ itemId: item.id, delta }, `Added ${formatPurchaseQuantity(delta, item.unit, item)} to "${item.name}"`)

  const restockGroup = ({ delta, variantId, newName }) => {
    const variant = variantId ? variants.find((v) => v.id === variantId) : null
    const message = `Added ${delta} ${group.unit} to ${variant ? `"${variant.name}"` : `a new variant of "${group.name}"`}`
    if (variant) return arrive({ itemId: variant.id, delta }, message)
    const fields = newVariantFields(group, newName, { packaging_unit: group.packaging_unit ?? null, quantity_per_pack: group.quantity_per_pack ?? null })
    return arrive({ newVariant: { id: variantIdFor(group.id), fields }, delta }, message)
  }

  // "Create a new item": the item is made with stock 0, then the arrival
  // adds the "Current stock" typed (0 is allowed: it arrives with nothing
  // added, plan 9J K6).
  const createItem = (fields) => {
    const { current_stock: stock, ...rest } = pickFields(fields)
    const delta = Math.max(0, Math.round((Number(stock) || 0) * 100) / 100)
    return arrive({ newItem: { id: newItemId.current, fields: rest }, delta }, `"${fields.name}" is now in HOME`)
  }

  const withoutStock = async () => {
    setBusy(true)
    await arrive({ itemId: null, delta: 0 }, `"${order.item_name}" marked as arrived — nothing added to HOME`)
    setBusy(false)
  }

  // The new item's name is (like) one already in HOME (plan 9G safety
  // net, K12): its button adds the arrival to that item instead — a
  // variant through its group — with the quantity asked as usual.
  const pickExisting = (existing) => {
    setSearch('')
    if (existing.is_group || existing.group_id) {
      setGroupId(existing.is_group ? existing.id : existing.group_id)
      setVariantStart(existing.is_group ? null : existing.id)
      setMode('group')
    } else {
      setItemId(existing.id)
      setMode('item')
    }
  }

  const back = () => {
    setMode(null)
    setItemId('')
    setGroupId('')
    setVariantStart(null)
  }

  if (mode === 'new') {
    return (
      <ItemEditor
        prefill={{ name: order.item_name }}
        parents={parents}
        subsByParent={subsByParent}
        onAddCategory={addCategory}
        onAddSubcategory={addSubcategory}
        onSave={createItem}
        onClose={() => (saved.current ? onClose() : back())}
        homeItems={items}
        onGoTo={pickExisting}
        optionLabel={arrivalPickLabel}
      />
    )
  }

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-label={`"${order.item_name}" arrived`}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5 space-y-4"
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-sm font-extrabold text-[var(--color-primary)] flex items-center gap-2">
              <PackageCheck size={16} /> It arrived!
            </p>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">
              Add "{order.item_name}" to HOME? Choose below — that marks it as arrived. The expense stays as it is — nothing new is added to your expenses.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
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
            <button
              type="button"
              onClick={withoutStock}
              disabled={busy}
              className="w-full min-h-11 rounded-2xl text-xs font-bold text-[var(--color-text-muted)] border border-[var(--color-border)] disabled:opacity-40"
            >
              Don't add to HOME
            </button>
          </div>
        )}

        {mode === 'item' && (
          <div className="space-y-3">
            <button type="button" onClick={back} className="min-h-9 text-[11px] font-bold text-[var(--color-accent)] inline-flex items-center gap-1">
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
            {item && <RestockForm key={item.id} item={item} onSubmit={restockItem} onClose={back} packs />}
          </div>
        )}

        {mode === 'group' && (
          <div className="space-y-3">
            <button type="button" onClick={back} className="min-h-9 text-[11px] font-bold text-[var(--color-accent)] inline-flex items-center gap-1">
              <ChevronLeft size={12} /> Back
            </button>
            {groups.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">There are no item groups yet. Make one in HOME ("Add group"), or create a new item instead.</p>
            ) : (
              <>
                <div>
                  <Label>Which group?</Label>
                  <Select
                    value={groupId}
                    onChange={(e) => {
                      setGroupId(e.target.value)
                      setVariantStart(null)
                    }}
                    aria-label="Item group"
                  >
                    <option value="">Choose a group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.current_stock} {g.unit})
                      </option>
                    ))}
                  </Select>
                </div>
                {group && (
                  <RestockForm key={`${group.id}:${variantStart ?? ''}`} item={group} variants={variants} initial={variantStart ? { variantId: variantStart } : null} onSubmit={restockGroup} onClose={back} packs />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
