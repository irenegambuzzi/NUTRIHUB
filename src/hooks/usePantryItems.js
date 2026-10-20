import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { afterStockChange, insertRows, latestLogId, normalizeItem, orderedEntryIds, stockChangeWithLog, syncShoppingForItem, toBuyEntriesOf, undoStockChange, updateRows, upsertRows } from '../lib/inventory'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { showToast } from '../lib/feedback'
import { groceryStore, pantryStore, stockLogStore } from '../lib/stores'
import { isOffline } from '../lib/connection'
import { cancelQueuedStock, queueStock } from '../lib/offlineActions'
import { withGroupTotals } from '../lib/groups'
import { becameFinished, isOneTime } from '../lib/oneTime'

export const ITEM_FIELDS = [
  'name',
  'category_id',
  'subcategory_id',
  'unit',
  'packaging_unit',
  'quantity_per_pack',
  'current_stock',
  'min_stock',
  'expiry_date',
  'batch_lot',
  'notes',
  'price',
  'price_qty',
  'price_unit',
  'payer',
  'last_purchased_at',
  'is_group',
  'group_id',
  'usual_shop_id',
  'one_time',
]

function pickFields(source) {
  const out = {}
  for (const f of ITEM_FIELDS) if (f in source) out[f] = source[f] === '' ? null : source[f]
  return out
}

// A one-time item just used up: it moves to "Finished one-time items".
// Undo (`undo()`) puts its stock back, which brings it back to the grid.
function announceFinished(item, amount, undo) {
  showToast({
    message: `"${item.name}" is finished — moved to Finished one-time items`,
    action: amount > 0 ? { label: 'Undo', onClick: undo } : null,
  })
}

// Undo of a stock change saved online: the stock goes back (`amount`) and
// its history rows (`logIds`) are deleted, so it leaves no trace.
function undoSaved(item, amount, logIds) {
  return attempt(
    async () => {
      const restored = await undoStockChange(item, amount, logIds)
      pantryStore.upsertLocal([restored])
      stockLogStore.removeLocal(logIds)
    },
    { onFail: pantryStore.refresh }
  )
}

// Undo of a stock change made offline (`opId`, which took `amount`):
// still waiting, it is simply never sent; sent meanwhile, its history row
// is looked up and undone like any other.
async function undoQueued(item, opId, amount, reason) {
  if (cancelQueuedStock(opId, item, -amount)) return { error: null }
  return attempt(
    async () => {
      const logId = await latestLogId(item.id, -amount, reason)
      const restored = await undoStockChange(item, amount, logId ? [logId] : [])
      pantryStore.upsertLocal([restored])
      if (logId) stockLogStore.removeLocal([logId])
    },
    { onFail: pantryStore.refresh }
  )
}

// Marking an item one-time takes it off "to buy": its open SHOP entries
// that are neither in a cart nor ordered online (`entries`, read before
// the change) are removed — typed by hand too. Undo puts them back
// exactly; the item stays one-time.
async function takeOffShopList(item, entries) {
  if (!entries.length) return
  const ids = entries.map((g) => g.id)
  await deleteWithUndo({
    message: `"${item.name}" is one-time: taken off the SHOP list`,
    remove: async () => {
      must(await supabase.from('grocery_items').delete().in('id', ids))
      groceryStore.removeLocal(ids)
      return entries
    },
    restore: async (rows) => {
      must(await supabase.from('grocery_items').upsert(rows))
      await groceryStore.refresh()
    },
    onFail: groceryStore.refresh,
  })
}

export function usePantryItems() {
  const { rows } = pantryStore.useRows()
  // Groups show the total of their variants (see lib/groups.js); every
  // other item is exactly as stored.
  const items = useMemo(() => withGroupTotals(rows), [rows])
  const fetchItems = pantryStore.refresh

  const addItem = useCallback(async (fields) => {
    const { data, error } = await attempt(async () => must(await insertRows('pantry_items', [pickFields(fields)]))[0], { retry: false })
    if (error) return { error }
    pantryStore.upsertLocal([data])
    const stock = Number(data.current_stock)
    await afterStockChange(data, stock, stock, 'added')
    return { data }
  }, [])

  // A one-time item used up says so, with Undo: the stock back and the
  // "Used" row gone from History (nothing new is written).
  const adjustStock = useCallback(
    async (item, delta, reason = delta > 0 ? 'restocked' : 'used') => {
      const change = Math.round(delta * 100) / 100
      const before = Number(item.current_stock) || 0
      // What this tap really took away (stock never goes below 0).
      const taken = (after) => Math.round((before - (Number(after.current_stock) || 0)) * 100) / 100
      // No signal: kept and sent later (see offlineActions.js).
      if (isOffline()) {
        const { error, opId } = queueStock(item, change, reason)
        const after = { ...item, current_stock: Math.max(0, before + change) }
        if (becameFinished(item, after)) announceFinished(after, taken(after), () => undoQueued(after, opId, taken(after), reason))
        return { error }
      }
      const { data, error } = await attempt(() => stockChangeWithLog(item, [{ change, reason }]), { onFail: fetchItems })
      if (error) return { error }
      pantryStore.upsertLocal([data.item])
      if (becameFinished(item, data.item)) announceFinished(data.item, taken(data.item), () => undoSaved(data.item, taken(data.item), data.logIds))
      return { error: null }
    },
    [fetchItems]
  )

  // Saved from the item editor. The field changes and the stock change
  // are saved together (the fields are put back if the stock fails).
  const updateItem = useCallback(
    async (item, fields) => {
      const { current_stock: stock, ...patch } = pickFields(fields)
      // The edited stock is applied as a change from what the form started
      // with, so a concurrent change by someone else isn't overwritten.
      const delta = stock == null ? 0 : Math.round((Number(stock) - Number(item.current_stock)) * 100) / 100
      // Becoming one-time: what is "to buy" now is read first, so it can
      // be put back exactly (saving may already remove the automatic one).
      const flagging = patch.one_time === true && !isOneTime(item) && !item.is_group
      let toBuy = []
      if (flagging && !isOffline()) {
        try {
          toBuy = await toBuyEntriesOf(item)
        } catch (readError) {
          console.error(readError)
        }
      }
      const { data: result, error } = await attempt(
        () =>
          inSteps(async (onFail) => {
            let saved = item
            if (Object.keys(patch).length) {
              saved = normalizeItem(must(await updateRows('pantry_items', item.id, patch))[0])
              const original = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k] ?? null]))
              onFail(async () => must(await updateRows('pantry_items', item.id, original)))
            }
            return delta ? stockChangeWithLog(saved, [{ change: delta, reason: 'edited' }]) : { item: saved, logIds: [] }
          }),
        { retry: false, onFail: fetchItems }
      )
      if (error) return { error }
      const data = result.item
      pantryStore.upsertLocal([data])
      if (!delta) await followUp('the shopping list', () => syncShoppingForItem(data))
      // Moved into or out of a group: both groups are judged again.
      if ((data.group_id ?? null) !== (item.group_id ?? null)) {
        for (const id of [item.group_id, data.group_id].filter(Boolean)) {
          const group = pantryStore.getSnapshot().rows.find((r) => r.id === id)
          if (group) await followUp('the shopping list', () => syncShoppingForItem(group))
        }
      }
      // A rename carries over to the item's open grocery entries.
      if (data.name !== item.name) {
        await followUp('the shopping list', async () =>
          must(await supabase.from('grocery_items').update({ name: data.name }).eq('pantry_item_id', item.id).eq('completed', false))
        )
      }
      if (flagging) await takeOffShopList(data, toBuy)
      // Undo puts the stock back and takes away its "Adjusted" row; the
      // other fields saved stay.
      const taken = Math.round(((Number(item.current_stock) || 0) - (Number(data.current_stock) || 0)) * 100) / 100
      if (becameFinished(item, data)) announceFinished(data, taken, () => undoSaved(data, taken, result.logIds))
      return { data }
    },
    [fetchItems]
  )


  // Throws away an expired item's stock (logged as "discarded") and
  // clears its expiry date, which described the stock that's gone. Undo
  // puts both back and takes the "Discarded" row away again.
  const discardExpired = useCallback(
    async (item) => {
      const amount = Number(item.current_stock) || 0
      const setExpiry = async (expiry_date) => must(await updateRows('pantry_items', item.id, { expiry_date }))
      const { data, error } = await attempt(
        () =>
          inSteps(async (onFail) => {
            await setExpiry(null)
            onFail(() => setExpiry(item.expiry_date))
            return stockChangeWithLog({ ...item, expiry_date: null }, [{ change: -amount, reason: 'discarded' }])
          }),
        { onFail: fetchItems }
      )
      if (error) return { error }
      pantryStore.upsertLocal([data.item])

      const undo = () =>
        attempt(
          async () =>
            inSteps(async (onFail) => {
              await setExpiry(item.expiry_date)
              onFail(() => setExpiry(null))
              const restored = await undoStockChange({ ...data.item, expiry_date: item.expiry_date }, amount, data.logIds)
              pantryStore.upsertLocal([restored])
              stockLogStore.removeLocal(data.logIds)
            }),
          { onFail: fetchItems }
        )
      showToast({
        message: amount ? `Discarded ${amount} ${item.unit} of "${item.name}"` : `Cleared the expiry date of "${item.name}"`,
        action: { label: 'Undo', onClick: undo },
      })
      return { error: null }
    },
    [fetchItems]
  )

  // Deletes right away; Undo puts the item back exactly, including the
  // grocery entries and history rows that pointed to it (the database
  // unlinks them on delete).
  const deleteItem = useCallback(
    (item) => {
      // A group is only deleted once it's empty: its variants and their
      // stock are never deleted with it.
      if (item.is_group && pantryStore.getSnapshot().rows.some((r) => r.group_id === item.id)) {
        showToast({ message: `"${item.name}" still has variants — move them out of the group first.`, tone: 'error' })
        return
      }
      // Its automatic SHOP entries still "to buy" go with it (in the cart
      // or on the way they stay): a deleted variant is no longer listed in
      // its group's card. Undo puts them back.
      const resyncGroup = () => {
        const group = item.group_id && pantryStore.getSnapshot().rows.find((r) => r.id === item.group_id)
        return group ? followUp('the shopping list', () => syncShoppingForItem(group)) : null
      }
      return deleteWithUndo({
        message: `Deleted "${item.name}"`,
        remove: async () => {
          const grocery = must(await supabase.from('grocery_items').select('*').eq('pantry_item_id', item.id))
          const ordered = await orderedEntryIds(grocery.map((g) => g.id))
          const listed = grocery.filter((g) => g.auto_generated && !g.completed && !g.in_cart && !ordered.has(g.id))
          if (listed.length) {
            must(await supabase.from('grocery_items').delete().in('id', listed.map((g) => g.id)))
            groceryStore.removeLocal(listed.map((g) => g.id))
          }
          const history = must(await supabase.from('stock_logs').select('id').eq('item_id', item.id))
          const [row] = must(await supabase.from('pantry_items').delete().eq('id', item.id).select())
          pantryStore.removeLocal([item.id])
          await resyncGroup()
          const kept = grocery.filter((g) => !listed.includes(g))
          return { row, groceryIds: kept.map((g) => g.id), listed, logIds: history.map((l) => l.id) }
        },
        restore: async ({ row, groceryIds, listed = [], logIds }) => {
          if (row) must(await supabase.from('pantry_items').upsert(row))
          if (groceryIds.length) must(await supabase.from('grocery_items').update({ pantry_item_id: item.id }).in('id', groceryIds))
          if (listed.length) must(await supabase.from('grocery_items').upsert(listed))
          if (logIds.length) must(await supabase.from('stock_logs').update({ item_id: item.id }).in('id', logIds))
          await fetchItems()
          await groceryStore.refresh()
          await resyncGroup()
        },
        onFail: fetchItems,
      })
    },
    [fetchItems]
  )

  // Restore/import: rows with an id overwrite that item, rows without
  // one are added as new items.
  const importItems = useCallback(
    async (rows) => {
      const withId = rows.filter((r) => r.id).map((r) => ({ id: r.id, ...pickFields(r) }))
      const withoutId = rows.filter((r) => !r.id).map(pickFields)
      const { error } = await attempt(
        async () => {
          if (withId.length) must(await upsertRows('pantry_items', withId))
          if (withoutId.length) must(await insertRows('pantry_items', withoutId))
        },
        { retry: false, onFail: fetchItems }
      )
      if (error) return { error }
      await pantryStore.refresh()
      await followUp('the shopping list', async () => {
        for (const item of pantryStore.getSnapshot().rows) await syncShoppingForItem(item)
      })
      return { error: null, count: rows.length }
    },
    [fetchItems]
  )

  return { items, addItem, updateItem, adjustStock, discardExpired, deleteItem, importItems }
}

// The latest stock changes (the pantry's History view); loaded only where
// it's shown.
export function useStockLogs() {
  return stockLogStore.useRows().rows
}

// Deletes history entries right away, with Undo. Only the record goes:
// stock, expenses and items stay exactly as they are (nothing else reads
// the history — unchecking a purchase works from the grocery entry).
export function deleteStockLogs(ids) {
  return deleteWithUndo({
    message: ids.length === 1 ? 'Deleted' : `${ids.length} entries deleted`,
    remove: async () => {
      const rows = must(await supabase.from('stock_logs').delete().in('id', ids).select())
      stockLogStore.removeLocal(ids)
      return rows
    },
    restore: async (rows) => {
      if (rows.length) must(await supabase.from('stock_logs').upsert(rows))
      await stockLogStore.refresh()
    },
    onFail: stockLogStore.refresh,
  })
}
