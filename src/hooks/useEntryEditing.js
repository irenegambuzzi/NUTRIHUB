import { useState } from 'react'
import { firstDecimalProblem, moneyText, parseDecimal } from '../lib/decimal'
import { roundQuantity, stepQuantity } from '../lib/inventory'
import { lineTotal } from '../lib/pricing'

// The quantity and price of one SHOP entry (components/grocery/EntryControls.jsx).
// − / + saves right away, with the line total (and the budget) following.
// One change at a time, so quick taps never use a stale quantity. The
// editor (quantity, price) opens with startEditing.
export function useEntryEditing(item, pack, onUpdatePricing) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [savingQuantity, setSavingQuantity] = useState(false)

  const startEditing = () => {
    setDraft({
      quantity: String(item.quantity ?? 1),
      price: Number(item.price) > 0 ? moneyText(item.price) : '',
      price_qty: String(item.price_qty || 1),
      price_unit: item.price_unit || item.unit,
    })
    setEditing(true)
  }

  const changeQuantity = async (direction) => {
    const quantity = stepQuantity(item.quantity, item.unit, direction)
    if (quantity === null || savingQuantity) return
    setSavingQuantity(true)
    await onUpdatePricing(item, { quantity }, lineTotal({ ...item, quantity }, pack))
    setSavingQuantity(false)
  }

  const save = async () => {
    if (firstDecimalProblem(draft.quantity, draft.price, draft.price_qty)) return
    const price = parseDecimal(draft.price) || 0
    const patch = {
      quantity: roundQuantity(draft.quantity, item.unit) || 1,
      price,
      price_qty: price > 0 ? parseDecimal(draft.price_qty) || 1 : null,
      price_unit: price > 0 ? draft.price_unit : null,
    }
    const { error } = await onUpdatePricing(item, patch, lineTotal({ ...item, ...patch }, pack))
    if (!error) setEditing(false)
  }

  return { editing, draft, setDraft, startEditing, save, cancel: () => setEditing(false), changeQuantity, savingQuantity }
}
