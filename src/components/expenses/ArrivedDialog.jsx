import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, PackageCheck, PackagePlus, Plus, X } from 'lucide-react'
import { Label, Select } from '../ui/Field'
import { SearchBox } from '../ui/SearchBox'
import { ItemEditor } from '../inventory/ItemEditor'
import { RestockForm } from '../inventory/RestockForm'
import { pickFields, usePantryItems } from '../../hooks/usePantryItems'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'
import { alreadyArrivedMessage, arriveLinkedOrder, arrivedToast, discardUnusedItem } from '../../hooks/useOrders'
import { keepTypedName } from '../../hooks/itemNameActions'
import { formatPurchaseQuantity } from '../../lib/inventory'
import { arrivalPickLabel } from '../../lib/similarItems'
import { anyNameIncludes } from '../../lib/itemNames'
import { arrivalPrefill } from '../../lib/newItemUnit'
import { localDateString } from '../../lib/week'

const CHOICES = [
  { mode: 'item', label: 'Add to an existing item', hint: 'Restock something you already have in HOME.', Icon: PackagePlus },
  { mode: 'new', label: 'Create a new item', hint: 'It becomes a New Item in HOME.', Icon: Plus },
]

// "Arrived" on an order not linked to HOME: should it go into HOME? Stock
// goes to an existing item (found by its own or another name) or into a new
// item; the quantity can be given in the item's purchase unit or its stock
// unit (the same conversion as the + button in HOME; in a package, with
// the pack field of plan 9H, for this arrival only — nothing is saved as
// the item's usual size here). Every choice marks the order arrived and
// adds the stock in one step, exactly like a linked arrival (arrive_order,
// plan 9J), so the toast's Undo and "Back on the way" take out exactly
// that; a new item is made first with stock 0. "Don't add to
// HOME" marks it arrived with nothing added. Closed with × or a tap
// outside, nothing happens: the order stays on the way. Only the first
// Arrived adds anything, on whichever phone. Never an expense. An item
// chosen in "Which item?" doesn't remember the order's name as another name
// (K137: that is done by hand in "Edit item" → "Other names"); only the word
// typed before "Add it to …" is (K58). A group row from an older version of
// the app is never offered (K138): it never receives stock.
export function ArrivedDialog({ order, onClose }) {
  const { items } = usePantryItems()
  const { pantryParents: parents, subsByParent, addCategory, addSubcategory } = useInventoryCategories()
  const [mode, setMode] = useState(null) // null | 'item' | 'new'
  const [search, setSearch] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = useRef(false)
  // Fixed per dialog, so pressing again never makes a second item.
  const newItemId = useRef(crypto.randomUUID())
  // New items made by a try whose second step failed: deleted again when
  // the dialog closes without them having arrived.
  const tried = useRef(new Set())
  // The word "Add it to …" was pressed for (K58): { word, itemId }.
  const typedWord = useRef(null)

  const plainItems = useMemo(() => items.filter((i) => !i.is_group).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const query = search.trim().toLowerCase()
  const matching = query ? plainItems.filter((i) => anyNameIncludes(i, query)) : plainItems
  const item = plainItems.find((i) => i.id === itemId)

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
    const made = args.newItem
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

  const restockItem = async ({ delta }) => {
    const result = await arrive({ itemId: item.id, delta }, `Added ${formatPurchaseQuantity(delta, item.unit, item)} to "${item.name}"`)
    if (result.added && typedWord.current?.itemId === item.id) keepTypedName(typedWord.current.word, item.id)
    return result
  }

  // "Create a new item": the item is made with stock 0, then the arrival
  // adds the "Current stock" typed (0 is allowed: it arrives with nothing
  // added, plan 9J K6). `firstWord`: the word first typed before "Create
  // new" (K58), a real name of the new item.
  const createItem = async (fields, { firstWord = '' } = {}) => {
    const { current_stock: stock, ...rest } = pickFields(fields)
    const delta = Math.max(0, Math.round((Number(stock) || 0) * 100) / 100)
    const result = await arrive({ newItem: { id: newItemId.current, fields: rest }, delta }, `"${fields.name}" is now in HOME`)
    if (result.added && firstWord) keepTypedName(firstWord, newItemId.current)
    return result
  }

  const withoutStock = async () => {
    setBusy(true)
    await arrive({ itemId: null, delta: 0 }, `"${order.item_name}" marked as arrived — nothing added to HOME`)
    setBusy(false)
  }

  // The new item's name is (like) one already in HOME (plan 9G safety
  // net, K12): its button opens "Add to an existing item" with that item
  // chosen, with the quantity asked as usual. The word typed (`word`)
  // becomes another name of that item once it has arrived.
  const pickExisting = (existing, word) => {
    setSearch('')
    typedWord.current = { word, itemId: existing.id }
    setItemId(existing.id)
    setMode('item')
  }

  const back = () => {
    typedWord.current = null
    setMode(null)
    setItemId('')
  }

  if (mode === 'new') {
    return (
      <ItemEditor
        prefill={arrivalPrefill(order)}
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

      </div>
    </div>,
    document.body
  )
}
