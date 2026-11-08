import { supabase } from '../lib/supabaseClient'
import { OFFLINE_MESSAGE, attempt, followUp, must } from '../lib/db'
import { askDialog, confirmDialog, showToast, toastSaveError } from '../lib/feedback'
import { isOffline } from '../lib/connection'
import { normalizeItem, restockReason, syncShoppingForItem } from '../lib/inventory'
import {
  canHaveNames,
  hasName,
  itemForName,
  mergeCheck,
  mergePayload,
  mergeQuestion,
  mergedToast,
  nameElement,
  nameTakenBy,
  namesColumnReady,
  separatePayload,
  separateQuestion,
  separatedToast,
  separationCheck,
} from '../lib/itemNames'
import { groceryStore, orderStore, pantryStore, stockLogStore, tripItemStore } from '../lib/stores'
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

// ── Merge and separate (plan 9N stage 4, K111, K115) ──
// No Undo for either (K48, K69): each asks first and says so. Refused
// offline before anything is asked; a refusal of the database is shown as
// it says it, and nothing changed.

const refuseOffline = () => {
  showToast({ message: OFFLINE_MESSAGE, key: 'offline' })
  return false
}

// Every list the moved rows live in (items, SHOP entries, orders, history,
// purchase lines), read again; the ones not opened yet load when opened.
async function refreshMoved() {
  await pantryStore.refresh()
  await groceryStore.refresh()
  for (const store of [orderStore, stockLogStore, tripItemStore]) if (store.isStarted?.()) await store.refresh()
}

// The SHOP list judged again for these items, as stored now.
async function judgeShop(ids) {
  for (const id of ids) {
    const row = rowOf(id)
    if (row) await followUp('the shopping list', () => syncShoppingForItem(row))
  }
  await groceryStore.refresh()
}

const errorToast = (message) => showToast({ message, tone: 'error' })

// K111: merges `sourceIds` into `targetId` after the question; every row is
// taken as stored (a group row with its own 0, never the total of its
// variants, so `was` matches). → true when the editor can close.
export async function mergeItems(targetId, sourceIds) {
  if (isOffline()) return refuseOffline()
  const { rows } = pantryStore.getSnapshot()
  const target = rows.find((row) => row.id === targetId)
  const sources = sourceIds.map((id) => rows.find((row) => row.id === id)).filter(Boolean)
  if (!target || sources.length !== sourceIds.length) {
    errorToast('An item to merge was deleted meanwhile — open it again. Nothing was changed.')
    await refreshMoved()
    return false
  }
  // The same rules as 032, so a merge it would refuse is never asked.
  const { problem } = mergeCheck({ target, sources, items: rows })
  if (problem) {
    errorToast(problem)
    return false
  }
  if (!(await confirmDialog({ ...mergeQuestion(target, sources), confirmLabel: 'Merge' }))) return false
  const { data, error } = await attempt(async () => must(await supabase.rpc('merge_pantry_items', { payload: mergePayload(target, sources) })), {
    retry: false,
    messageOf: refusalOf,
    onFail: refreshMoved,
  })
  if (error) return false
  await refreshMoved()
  // Sent twice (the other phone was first): nothing was written.
  if (data?.already_merged) return true
  await judgeShop([targetId])
  showToast({ message: mergedToast(sources.length, rowOf(targetId) ?? target, data) })
  return true
}

// K115: `name` of `itemId` becomes an item of its own, with the stock typed
// in the question. `place`: "Snacks › Savory", where a name without origin
// goes. → true when the editor can close.
export async function separateName(itemId, name, { place = '' } = {}) {
  if (isOffline()) return refuseOffline()
  const item = rowOf(itemId)
  const element = item ? nameElement(item, name) : null
  if (!element) {
    errorToast(`"${String(name ?? '').trim()}" is not a name of "${item?.name ?? ''}". Nothing was changed.`)
    await refreshMoved()
    return false
  }
  const { field, note, ...question } = separateQuestion({ item, name, place, listsAtZero: restockReason })
  const answer = await askDialog({ title: question.title, message: question.message, fields: [field], note, confirmLabel: 'Separate' })
  if (!answer) return false
  const check = separationCheck({ item, name, stockMoved: answer.stock, items: pantryStore.getSnapshot().rows })
  if (check.problem) {
    errorToast(check.problem)
    return false
  }
  const { data, error } = await attempt(async () => must(await supabase.rpc('separate_item_name', { payload: separatePayload(item, element.name, answer.stock) })), {
    retry: false,
    messageOf: refusalOf,
    onFail: refreshMoved,
  })
  if (error) return false
  await refreshMoved()
  await judgeShop([itemId, data?.item_id].filter(Boolean))
  showToast({ message: separatedToast(element.name, element.origin, data?.stock ?? check.stock, rowOf(data?.item_id)?.unit ?? check.unit) })
  return true
}
