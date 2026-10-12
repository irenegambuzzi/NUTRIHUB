import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Label } from '../ui/Field'
import { ShopIcon } from '../ui/ShopIcon'
import { OnlineToggle } from './OnlineToggle'
import { useShops } from '../../hooks/useShops'
import { shopUsageStore } from '../../lib/stores'
import { shopNameProblem } from '../../lib/shops'

const enter = (fn) => (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  fn()
}

// The list of stores: add, rename, switch online / in store, delete.
// Deleting a store never deletes an expense: they just have no store
// afterwards. Built without <form>s (it opens from inside the expense
// form) and drawn outside it, so Enter here never saves the expense.
export function ShopManager({ defaultOnline = false, onClose, onRemoved }) {
  const { shops, addShop, updateShop, deleteShop } = useShops()
  // Counts every expense ever, not just the period on screen.
  const { rows: usageRows } = shopUsageStore.useRows()
  const [name, setName] = useState('')
  const [online, setOnline] = useState(defaultOnline)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [editing, setEditing] = useState(null) // { id, name }

  const usage = (shop) => usageRows.filter((r) => r.shop_id === shop.id).length

  const add = async () => {
    const problem = shopNameProblem(shops, name)
    if (problem) return setError(problem)
    const { error: addError } = await addShop(name, online)
    // Failures show a toast.
    if (addError) return
    setName('')
    setError('')
  }

  const saveRename = async () => {
    const problem = shopNameProblem(shops, editing.name, editing.id)
    if (problem) return setError(problem)
    const shop = shops.find((s) => s.id === editing.id)
    if (editing.name.trim() !== shop.name) {
      const { error: saveError } = await updateShop(editing.id, { name: editing.name })
      if (saveError) return
    }
    setEditing(null)
    setError('')
  }

  const remove = async (shop) => {
    const { error: deleteError } = await deleteShop(shop.id)
    setConfirming(null)
    if (!deleteError) {
      setError('')
      onRemoved?.(shop.id)
    }
  }

  const iconButton = 'text-[var(--color-icon-muted)] w-8 h-8 flex items-center justify-center'
  const confirmingShop = shops.find((s) => s.id === confirming)

  return createPortal(
    <div data-unsaved className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Stores"
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex justify-between items-center">
          <p className="text-sm font-extrabold text-[var(--color-primary)]">Stores</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          <Label>Add a store</Label>
          <Input placeholder="Name (e.g. Zalando)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter(add)} aria-label="New store name" />
          <div className="flex gap-2 items-center">
            <OnlineToggle value={online} onChange={setOnline} className="flex-1" />
            <Button type="button" onClick={add} className="px-3">
              <Plus size={14} /> Add
            </Button>
          </div>
        </div>

        {confirmingShop && (
          <p className="text-[11px] text-yellow-300">
            Deleting "{confirmingShop.name}" keeps its {usage(confirmingShop)} {usage(confirmingShop) === 1 ? 'expense' : 'expenses'}: they just won't have a store any more. Nothing is lost.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

        {shops.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-2">No stores yet.</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {shops.map((shop) => (
              <div key={shop.id} className="py-1.5 text-xs">
                {editing?.id === shop.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={enter(saveRename)}
                      aria-label={`New name for ${shop.name}`}
                      className="flex-1 min-w-0"
                    />
                    <button type="button" onClick={saveRename} aria-label="Save" title="Save" className={`${iconButton} hover:text-[var(--color-primary)]`}>
                      <Check size={15} />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel" className={`${iconButton} hover:text-[var(--color-text)]`}>
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <ShopIcon online={shop.is_online} size={14} className="text-[var(--color-icon-muted)] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[var(--color-text)] truncate">{shop.name}</span>
                      <span className="block text-[10px] text-[var(--color-text-muted)]">
                        {shop.is_online ? 'Online' : 'In store'} · {usage(shop)} {usage(shop) === 1 ? 'expense' : 'expenses'}
                      </span>
                    </span>
                    {confirming === shop.id ? (
                      <span className="flex items-center gap-1">
                        <button type="button" onClick={() => remove(shop)} className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="px-2 py-0.5 rounded-full text-[10px] font-bold text-[var(--color-text-muted)]">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => updateShop(shop.id, { isOnline: !shop.is_online })}
                          title={shop.is_online ? 'Make it an in-store shop' : 'Make it an online shop'}
                          aria-label={`${shop.name}: switch to ${shop.is_online ? 'in store' : 'online'}`}
                          className="px-2 py-1 rounded-full text-[10px] font-bold border border-[var(--color-border)] text-[var(--color-text-muted)] mr-1"
                        >
                          {shop.is_online ? 'Online' : 'In store'} ⇄
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirming(null)
                            setError('')
                            setEditing({ id: shop.id, name: shop.name })
                          }}
                          title="Rename"
                          aria-label={`Rename ${shop.name}`}
                          className={`${iconButton} hover:text-[var(--color-primary)]`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null)
                            setConfirming(shop.id)
                          }}
                          title="Delete store"
                          aria-label={`Delete ${shop.name}`}
                          className={`${iconButton} hover:text-red-400`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
