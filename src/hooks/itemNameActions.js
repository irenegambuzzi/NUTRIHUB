import { supabase } from '../lib/supabaseClient'
import { attempt, must } from '../lib/db'
import { showToast, toastSaveError } from '../lib/feedback'
import { isOffline } from '../lib/connection'
import { normalizeItem } from '../lib/inventory'
import { canHaveNames, hasName, itemForName, nameElement, nameTakenBy, namesColumnReady } from '../lib/itemNames'
import { pantryStore } from '../lib/stores'
import { checkItemNames } from './useItemNamesReady'

// Writing the other names of an item (plan 9N): only through save_item_names
// (supabase/032), never in a plain update. Before 032 nothing here is called.

async function writeNames(payload) {
  const row = normalizeItem(must(await supabase.rpc('save_item_names', { payload })))
  pantryStore.upsertLocal([row])
  return row
}

const rowOf = (id) => pantryStore.getSnapshot().rows.find((row) => row.id === id)

// A refusal of the function says itself what happened and that nothing was
// changed; shown as it is.
const refusalOf = (error) => (error?.code === 'P0001' ? error.message : '')

// From "Edit item" ("Other names"). Refused offline, like every save there.
export const saveItemNames = (payload) => attempt(() => writeNames(payload), { retry: false, messageOf: refusalOf, onFail: pantryStore.refresh })

// Undo of a word saved below: only that name goes. The list is read now, so
// a name added meanwhile stays.
const forgetName = (word, itemId) =>
  attempt(() => writeNames({ item_id: itemId, remove: [word], was: { names: rowOf(itemId)?.names ?? [] } }), { messageOf: refusalOf, onFail: pantryStore.refresh })

// K58 + K85: a word the safety net linked to an item ("Use …", "Add it to
// …", or the word first typed before "Create new") becomes a real name of
// it, after the normal action was saved; that action stays whatever happens
// here. Nothing to do when the word already is a name of the item, for a
// group, variant or durable, or when another item has it. Offline it is
// simply not saved: no toast, no queue.
export async function keepTypedName(word, itemId) {
  const text = String(word ?? '').trim()
  if (!text || isOffline()) return
  const { rows } = pantryStore.getSnapshot()
  if (!namesColumnReady(rows) && (await checkItemNames()) !== true) return
  const item = rowOf(itemId)
  if (!canHaveNames(item) || hasName(item, text) || nameTakenBy(text, rows, [itemId])) return
  try {
    await writeNames({ item_id: itemId, add: [{ name: text, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null }], was: { names: item.names ?? [] } })
  } catch (error) {
    toastSaveError(error, () => keepTypedName(text, itemId), `"${text}" was not saved as another name of "${item.name}".`)
    return
  }
  showToast({ message: `"${text}" saved as another name of "${item.name}"`, action: { label: 'Undo', onClick: () => forgetName(text, itemId) } })
}

// The same for an item a purchase has just made, known only by its name.
export async function keepFirstWord(word, itemName) {
  if (isOffline()) return
  await pantryStore.refresh()
  const found = itemForName(itemName, pantryStore.getSnapshot().rows, { groups: false })
  if (found) await keepTypedName(word, found.item.id)
}

// K90 + K95: the pack size of one name of an item, written only while the
// name, as read now, still passes `allowed(element)` (a first size: it has
// none; putting one back: it still has what an arrival saved). The list is
// read first, so `was` is fresh. → whether it was written. Throws on a
// failure (the caller's follow-up offers Retry).
export async function setNamePack(itemId, name, fields, allowed) {
  const row = must(await supabase.from('pantry_items').select('id, name, names').eq('id', itemId).maybeSingle())
  const element = row ? nameElement(row, name) : null
  if (!element || !allowed(element)) return false
  await writeNames({ item_id: itemId, edit: [{ name: element.name, packaging_unit: fields.packaging_unit ?? null, quantity_per_pack: fields.quantity_per_pack ?? null }], was: { names: row.names ?? [] } })
  return true
}
