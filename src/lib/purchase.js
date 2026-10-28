import { expiryState, isDurable, toBaseQuantity } from './inventory'
import { normName } from './grocery'
import { firstOutVariant } from './groups'
import { couponFields, lineDiscountFields, priceLines } from './discounts'
import { firstTimePatch, hasPackField, packField, packStartText, packTextFor } from './packSize'

// Confirming a purchase: for each item in the cart, the pantry item it
// restocks, how much stock that adds, and the questions still open (pack
// size, expired stock); then the payload for confirm_shopping_trip
// (supabase/014), which does everything at once.

// The pantry item a grocery entry restocks: its linked item, else the one
// with the same name. A name never matches a group (stock is never added
// to a group itself, only to its variants): that makes a normal item.
export function pantryItemFor(item, pantryItems) {
  return pantryItems.find((p) => p.id === item.pantry_item_id) ?? pantryItems.find((p) => !p.is_group && normName(p.name) === normName(item.name)) ?? null
}

// The entry's quantity in the pantry item's base unit, or null when the
// pack size of this purchase is still missing. A line bought in a package
// (lib/packSize.js hasPackField) counts with the pack size typed for this
// purchase (`packSize`), never by itself with the item's usual size: that
// only starts the field. Anything else converts as always (kg → gr).
export function purchasedQuantity(pantry, item, packSize) {
  const quantity = Number(item.quantity) || 1
  const base = hasPackField(pantry, item.unit) ? (packSize > 0 ? quantity * packSize : null) : toBaseQuantity(pantry, quantity, item.unit)
  return base === null ? null : Math.round(base * 100) / 100
}

// One cart item, as the confirm screen shows it. answer: { pack,
// discard (true = throw the expired stock away, false = keep it),
// expiryDate, variantId / newVariantName } from the user; `pack` is the
// pack field as typed ({ text, unit }: the unit it was typed for).
//   pack            – the line's pack field (lib/packSize.js), or null: how
//                     many stock units are in 1 package for this purchase,
//                     started with the item's usual size. A first-time
//                     size is saved only on the item the line restocks
//                     itself (not through a group's old group-level entry)
//   needsPackSize   – that field is still empty
//   needsVariant    – the entry is a group: which of its variants gets the
//                     stock (or the name of a new one); the first out
//                     variant is taken until the user chooses
//   expired         – the pantry item has expired (with stock: must choose
//                     to throw it away or keep it; the new date is optional)
//   ready           – every question that must be answered is
// `pantry` is the item (or group) the line restocks, for showing; `target`
// the item whose stock really changes — the chosen variant for a group.
// A durable line (its HOME category is in the Durables tree, or
// `durableBudget`: its budget category is a durable one, lib/durable.js)
// is an expense only: no HOME item, no stock (plan 9F).
export function purchaseLine(item, pantryItems, answer = {}, { durableBudget = false } = {}) {
  const durable = isDurable(item) || durableBudget
  const entry = durable ? null : pantryItemFor(item, pantryItems)
  const group = entry?.is_group ? entry : null
  // Until the user picks one, a group line takes the first variant its
  // SHOP row lists as out (they can change it, or pick none).
  const untouched = answer.variantId === undefined && answer.newVariantName === undefined
  const variantId = group && untouched ? firstOutVariant(group.variants)?.id : answer.variantId
  const chosen = group ? pantryItems.find((p) => p.id === variantId && p.group_id === group.id) ?? null : entry
  const newVariant = group && !chosen ? answer.newVariantName?.trim() || null : null
  const quantity = Number(item.quantity) || 1
  const pack = entry ? packField({ item: entry, unit: item.unit, quantity, text: packTextFor(answer.pack, item.unit, packStartText(entry, item.unit)), canSave: chosen?.id === entry.id }) : null
  const add = entry ? purchasedQuantity(entry, item, pack?.value) : durable ? 0 : quantity
  const needsPackSize = Boolean(entry) && add === null
  const needsVariant = Boolean(group) && !chosen && !newVariant
  const expired = Boolean(chosen) && expiryState(chosen) === 'expired'
  const expiredStock = expired ? Number(chosen.current_stock) || 0 : 0
  const needsExpiryChoice = expiredStock > 0 && typeof answer.discard !== 'boolean'
  return {
    item,
    pantry: chosen ?? entry,
    target: chosen,
    group,
    newVariant,
    durable,
    add,
    pack,
    needsPackSize,
    needsVariant,
    expired,
    expiredStock,
    needsExpiryChoice,
    ready: !needsPackSize && !needsExpiryChoice && !needsVariant,
  }
}

// The discounts of the confirm screen worked out: each item's own discount
// (`discounts`: item id → { kind, text }) first, then the coupon (`coupon`:
// { kind, text }, for two items or more) spread over what is left.
// `items` are the edited items of the trip; totalOf(item) is the NORMAL
// price of the line. → { priced, byItem } as confirmationPayload wants it.
export function purchasePricing(items, totalOf, discounts = {}, coupon = null) {
  const priced = priceLines(
    items.map((item) => ({ list: totalOf(item) ?? NaN, discount: discounts[item.id] })),
    items.length > 1 ? coupon : null
  )
  return { priced, byItem: new Map(items.map((item, i) => [item.id, priced.lines[i]])) }
}

// The payload for confirm_shopping_trip. totalOf(item) is the line total
// (null when it can't be worked out: no expense then); expenseCategoryFor
// (item) the expense category id.
// `variantIds`: the ids of the new variants made for group lines (item id → id).
// `shopId` / `paidBy`: the trip's store and payer (supabase/021; an older
// database ignores them).
// `pricing`: the discounts typed on the confirm screen (priceLines() of
// lib/discounts.js, plus `byItem`: item id → its priced line). `totalOf`
// stays the NORMAL price of the line (it is also what the grocery entry
// and the HOME item keep as the last price); what is paid, the expense,
// is the priced line's `paid`. Without it nothing changes.
export function confirmationPayload({ id, date, at, lines, answers, totalOf, expenseCategoryFor, photoIds = [], variantIds = new Map(), shopId = null, paidBy = null, pricing = null }) {
  return {
    ...(pricing ? couponFields(pricing.priced) : {}),
    id,
    trip_date: date,
    at,
    photo_ids: photoIds,
    shop_id: shopId || null,
    paid_by: paidBy || null,
    items: lines.map(({ item, target, durable, add, expired, pack }) => {
      const answer = answers[item.id] ?? {}
      const priced = pricing?.byItem.get(item.id) ?? null
      const row = {
        grocery_item_id: item.id,
        line_total: priced && Number.isFinite(priced.paid) ? priced.paid : (totalOf(item) ?? 0),
        ...(priced ? lineDiscountFields(priced) : {}),
        payer: item.payer || 'shared',
        expense_category_id: expenseCategoryFor(item),
        durable,
        pantry_item_id: target?.id ?? variantIds.get(item.id) ?? null,
        add: add ?? 0,
      }
      if (expired) {
        row.discard_expired = answer.discard === true
        // A fresh purchase replaces the expired date (or clears it).
        row.expiry_date = answer.expiryDate || null
      }
      // The item's usual size only the first time (it has none yet).
      if (target) Object.assign(row, firstTimePatch(pack))
      return row
    }),
  }
}

// An item as edited on the confirm screen. edit: { quantity, unit, total,
// payer }, any of them. A typed total becomes the price for exactly this
// quantity and unit, so the line total is what was typed — and that same
// item is what the confirmation uses for the expense, stock, history and
// the grocery entry.
export function editedItem(item, edit) {
  if (!edit) return item
  const out = { ...item }
  if (edit.quantity > 0) out.quantity = edit.quantity
  if (edit.unit) out.unit = edit.unit
  if (edit.payer) out.payer = edit.payer
  if (edit.total != null && edit.total >= 0) {
    out.price = edit.total
    out.price_qty = out.quantity
    out.price_unit = out.unit
  }
  return out
}

const EDITABLE = ['quantity', 'unit', 'price', 'price_qty', 'price_unit', 'payer']

// The grocery fields an edit changes ({} when nothing does), to save
// before confirming.
export function editPatch(item, edit) {
  const edited = editedItem(item, edit)
  return Object.fromEntries(EDITABLE.filter((k) => edited[k] !== item[k]).map((k) => [k, edited[k]]))
}
