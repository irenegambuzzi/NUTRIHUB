import { expiryState, isDurable, toBaseQuantity } from './inventory'
import { normName } from './grocery'
import { oldGroupLineText } from './groups'
import { couponFields, lineDiscountFields, priceLines, round2 } from './discounts'
import { parseDecimal } from './decimal'
import { firstTimePatch, hasPackField, packField, packStartText, packTextFor } from './packSize'
import { partFields } from './sharedParts'
import { asksStockUnit, newItemKeys, newStockUnit, sameNameProblems, stockUnitQuestion } from './newItemUnit'
import { NAME_TWICE_TEXT, boughtAsOtherName, itemForName, lineNaming, namedPack, namePackKeys, onName, packItemFor } from './itemNames'
import { exactKey } from './similarItems'
import { lineTotal } from './pricing'

// Confirming a purchase: for each item in the cart, the pantry item it
// restocks, how much stock that adds, and the questions still open (pack
// size, expired stock); then the payload for confirm_shopping_trip
// (supabase/014), which does everything at once.

// The pantry item a grocery entry restocks: its linked item, else the one
// with the same name, else the one that has it as another name (plan 9N;
// an item's own name goes first). A name never matches a group row from an
// older version of the app (it never gets stock, K138): that makes a normal
// item, as confirm_shopping_trip does (022).
export function pantryItemFor(item, pantryItems) {
  return (
    pantryItems.find((p) => p.id === item.pantry_item_id) ??
    pantryItems.find((p) => !p.is_group && normName(p.name) === normName(item.name)) ??
    itemForName(item.name, pantryItems, { groups: false })?.item ??
    null
  )
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
// expiryDate, newUnit } from the user; `pack`
// is the pack field as typed ({ text, unit }: the unit it was typed for),
// `newUnit` the answer to "Count it at home in" ({ unit, stockUnit, text },
// lib/newItemUnit.js).
//   pack            – the line's pack field (lib/packSize.js), or null: how
//                     many stock units are in 1 package for this purchase,
//                     started with the item's usual size. A first-time
//                     size is saved on the item (or, under another name,
//                     on that name)
//   needsPackSize   – that field is still empty
//   oldGroup        – the entry is linked to a group row an older version
//                     of the app made (K138): it never gets stock, so the
//                     line can't be confirmed (`groupProblem` says why)
//   expired         – the pantry item has expired (with stock: must choose
//                     to throw it away or keep it; the new date is optional)
//   stockUnit       – a line that makes a NEW HOME item in a package
//                     (plan 9L, only once supabase/030 is known: `unitsReady`
//                     true): how to count it at home, and with another unit
//                     its usual pack size; null otherwise. "New" is decided
//                     as confirm_shopping_trip decides it: no linked item and
//                     no item with the same name (never a group row)
//   asksStockUnit   – the line would get that question once 030 is known
//                     (to check first while that isn't known)
//   ready           – every question that must be answered is
//   takesNames      – the card can have name lines (plan 9N): `typedName` was
//                     given (supabase/032 is known) and it is a normal item,
//                     or a new one; never a group row, a variant of one or a
//                     durable
//   naming          – what the name on the line means (itemNames lineNaming)
// `pantry` is the item the line restocks, for showing; `target` the item
// whose stock really changes (null for a new item, and for `oldGroup`).
// A durable line (its HOME category is in the Durables tree, or
// `durableBudget`: its budget category is a durable one, lib/durable.js)
// is an expense only: no HOME item, no stock (plan 9F).
export function purchaseLine(item, pantryItems, answer = {}, { durableBudget = false, unitsReady = null, typedName } = {}) {
  const durable = isDurable(item) || durableBudget
  const found = durable ? null : pantryItemFor(item, pantryItems)
  const oldGroup = found?.is_group ? found : null
  const entry = oldGroup ? null : found
  const quantity = Number(item.quantity) || 1
  const takesNames = typedName !== undefined && !durable && !oldGroup && !entry?.group_id
  const naming = takesNames ? lineNaming({ item: entry ?? { name: item.name }, cardName: item.name, name: typedName, items: pantryItems, first: true }) : null
  const packItem = entry && packItemFor(entry, item.name, item.unit)
  const pack = !entry ? null : onName(naming) ? namedPack(entry, naming.name, item.unit, { quantity, typed: answer.pack }) : packField({ item: packItem, unit: item.unit, quantity, text: packTextFor(answer.pack, item.unit, packStartText(packItem, item.unit)), canSave: !boughtAsOtherName(entry, item.name) })
  const add = entry ? purchasedQuantity(entry, item, pack?.value) : durable || oldGroup ? 0 : quantity
  const needsPackSize = Boolean(entry) && add === null
  const expired = Boolean(entry) && expiryState(entry) === 'expired'
  const expiredStock = expired ? Number(entry.current_stock) || 0 : 0
  const needsExpiryChoice = expiredStock > 0 && typeof answer.discard !== 'boolean'
  const isNew = !durable && !found
  const stockUnit = isNew ? stockUnitQuestion({ unit: item.unit, quantity, answer: answer.newUnit, ready: unitsReady }) : null
  const needsStockUnit = Boolean(stockUnit?.blocking)
  return {
    item,
    pantry: entry,
    target: entry,
    oldGroup,
    groupProblem: oldGroup ? oldGroupLineText(oldGroup) : '',
    durable,
    add,
    pack,
    needsPackSize,
    expired,
    expiredStock,
    needsExpiryChoice,
    stockUnit,
    needsStockUnit,
    isNew,
    asksStockUnit: isNew && asksStockUnit(item.unit),
    takesNames,
    naming,
    ready: !needsPackSize && !needsExpiryChoice && !oldGroup && !needsStockUnit && !naming?.problem,
  }
}

// One more name line of a card (plan 9N): it exists only on the confirm
// screen (K52). `draft`: { key, name, quantityText, unit, totalText } as
// typed. The line stands in for the card, with what was typed: the same item,
// category and payer (K92, line 1's at the moment of Confirm). A total typed
// is the price for exactly this quantity, as on line 1.
export function emptyNameLine(key, unit) {
  return { key, name: '', quantityText: '1', unit, totalText: '', priceEdited: false, unitTouched: false, autoFilled: false, autoPer: null }
}

export function nameLineItem(card, draft) {
  const quantity = parseDecimal(draft.quantityText) > 0 ? parseDecimal(draft.quantityText) : 1
  const total = parseDecimal(draft.totalText) >= 0 ? round2(parseDecimal(draft.totalText)) : 0
  return { ...card, id: `${card.id}:${draft.key}`, cardId: card.id, name: draft.name.trim(), quantity, unit: draft.unit, price: total, price_qty: quantity, price_unit: draft.unit }
}

// The item a later line of a card counts its stock in: the card's, or for a
// new HOME item the unit its first line chose (J.1, D10; null until it is
// chosen). It starts without a usual size: each name has its own.
function laterLineHome(first) {
  if (first.target) return first.target
  if (first.stockUnit && !first.stockUnit.stockUnit) return null
  return { name: first.item.name, unit: newStockUnit(first.stockUnit, first.item.unit) }
}

// Line 2…N of a card, as purchaseLine gives line 1 (`first`): it goes to the
// item the first line finds or makes, never makes one itself, and asks about
// neither the unit nor expired stock (the item's first line does).
export function laterNameLine(first, draft, pantryItems, answer = {}) {
  const item = nameLineItem(first.item, draft)
  const home = laterLineHome(first)
  const naming = lineNaming({ item: first.target ?? { name: first.item.name }, cardName: first.item.name, name: draft.name, items: pantryItems })
  const quantity = Number(item.quantity) || 1
  const canSave = Boolean(first.target) || !first.stockUnit?.pack
  const pack = !home ? null : onName(naming) ? namedPack(home, naming.name, item.unit, { quantity, typed: answer.pack }) : packField({ item: home, unit: item.unit, quantity, text: packTextFor(answer.pack, item.unit, packStartText(home, item.unit)), canSave })
  const add = home ? purchasedQuantity(home, item, pack?.value) : null
  const needsPackSize = Boolean(home) && add === null
  return { item, pantry: first.pantry, target: first.target, oldGroup: null, groupProblem: '', durable: false, add, pack, needsPackSize, expired: false, expiredStock: 0, needsExpiryChoice: false, stockUnit: null, needsStockUnit: false, isNew: false, asksStockUnit: false, takesNames: true, naming, ready: !needsPackSize && !naming.problem }
}

// K71 + K80: expired stock is asked about once per item, on its first line
// in the purchase; a later line (of the card, or another card of the item)
// says nothing and sends nothing.
export function expiryOncePerItem(lines) {
  const seen = new Set()
  return lines.map((line) => {
    const id = line.target?.id
    if (!id) return line
    if (!seen.has(id)) {
      seen.add(id)
      return line
    }
    if (!line.expired) return line
    return { ...line, expired: false, expiredStock: 0, needsExpiryChoice: false, ready: !line.needsPackSize && !line.oldGroup && !line.needsStockUnit && !line.naming?.problem }
  })
}

// K101: a new name only once in a purchase. A line that would add a new name
// (kind 'new') is refused, under that line, when the name is the name of
// another card of the purchase that makes a new HOME item (1), or when a line
// of another card added it earlier in screen order (2). Lines of one card may
// share it (032 adds it once). Confirm stays locked while one is refused.
export function newNameOnce(lines) {
  const cardOf = (line) => line.item.cardId ?? line.item.id
  const newCards = new Map()
  for (const line of lines.filter((l) => l.isNew)) {
    const key = exactKey(line.item.name)
    newCards.set(key, [...(newCards.get(key) ?? []), cardOf(line)])
  }
  const first = new Map()
  return lines.map((line) => {
    if (line.naming?.kind !== 'new' || line.naming.problem) return line
    const key = exactKey(line.naming.name)
    const card = cardOf(line)
    if (!first.has(key)) first.set(key, card)
    const clash = (newCards.get(key) ?? []).some((c) => c !== card) || first.get(key) !== card
    if (!clash) return line
    return { ...line, naming: { ...line.naming, problem: NAME_TWICE_TEXT(line.naming.name), note: '' }, ready: false }
  })
}

// K98: what line 1 costs under a name with a last price (`last`, report F:
// { price, quantity, unit }), for its quantity and unit; null when there is
// no price or it can't be converted (the same unit, kg/gr, L/ml only).
export function namePriceTotal(last, quantity, unit) {
  if (!(Number(last?.price) > 0)) return null
  const total = lineTotal({ price: last.price, price_qty: last.quantity, price_unit: last.unit, quantity, unit })
  return total > 0 ? total : null
}

// What a card's lines add up to at home, or null when it can't be told yet:
// { total, unit }. A line of a new item counted in another unit has `add` in
// the unit bought.
export function cardStock(lines) {
  const [first] = lines
  if (first.stockUnit && !first.stockUnit.stockUnit) return null
  if (lines.some((l) => l.add === null)) return null
  const adds = lines.map((l) => (l.stockUnit?.pack ? l.add * (l.stockUnit.pack.value ?? 0) : l.add))
  return { total: round2(adds.reduce((sum, add) => sum + add, 0)), unit: first.pantry?.unit ?? newStockUnit(first.stockUnit, first.item.unit) }
}

// Per line, what the same new name twice says (lib/newItemUnit.js
// sameNameProblems; '' for every other line).
export function twiceProblems(lines) {
  const fresh = lines.filter((l) => l.isNew)
  const problems = new Map(sameNameProblems(fresh.map((l) => ({ name: l.item.name, unit: l.item.unit, question: l.stockUnit }))).map((p, i) => [fresh[i], p]))
  return lines.map((l) => problems.get(l) ?? '')
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
// `shopId` / `paidBy`: the trip's store and payer (supabase/021; an older
// database ignores them).
// `pricing`: the discounts typed on the confirm screen (priceLines() of
// lib/discounts.js, plus `byItem`: item id → its priced line). `totalOf`
// stays the NORMAL price of the line (it is also what the grocery entry
// and the HOME item keep as the last price); what is paid, the expense,
// is the priced line's `paid`. Without it nothing changes.
// `partsByItem`: the parts of the Shared lines (plan 9K: item id → { [code]:
// € }, lib/sharedParts.js spreadParts). Lines of a person, and every line
// without it, send none.
// A line making a new item counted in another unit (plan 9L) sends
// new_stock_unit / new_pack_size; `add` stays in the line's unit.
// Name lines (plan 9N) repeat the card's grocery_item_id and send what is
// theirs alone (nameKeys); a card of one line under its own word sends what
// it always sent.
export function confirmationPayload({ id, date, at, lines, answers, totalOf, expenseCategoryFor, photoIds = [], shopId = null, paidBy = null, pricing = null, partsByItem = null }) {
  const several = new Set(lines.map((l) => l.item.cardId).filter(Boolean))
  return {
    ...(pricing ? couponFields(pricing.priced) : {}),
    id,
    trip_date: date,
    at,
    photo_ids: photoIds,
    shop_id: shopId || null,
    paid_by: paidBy || null,
    items: lines.map(({ item, target, durable, add, expired, pack, stockUnit, naming }) => {
      const answer = answers[item.id] ?? {}
      const priced = pricing?.byItem.get(item.id) ?? null
      const row = {
        grocery_item_id: item.cardId ?? item.id,
        line_total: priced && Number.isFinite(priced.paid) ? priced.paid : (totalOf(item) ?? 0),
        ...(priced ? lineDiscountFields(priced) : {}),
        ...partFields(partsByItem?.get(item.id)),
        payer: item.payer || 'shared',
        expense_category_id: expenseCategoryFor(item),
        durable,
        pantry_item_id: target?.id ?? null,
        add: add ?? 0,
      }
      if (expired) {
        row.discard_expired = answer.discard === true
        // A fresh purchase replaces the expired date (or clears it).
        row.expiry_date = answer.expiryDate || null
      }
      // The item's usual size only the first time (it has none yet).
      if (target || item.cardId) Object.assign(row, firstTimePatch(pack))
      Object.assign(row, newItemKeys(stockUnit), nameKeys(item, naming, pack, several))
      return row
    }),
  }
}

// What a line sends about its name: the six fields of that line only, when
// the card has several lines or the name was changed; add_name for a new
// name; name_pack for a first size on a name.
function nameKeys(item, naming, pack, several) {
  if (!naming) return {}
  const own = item.cardId || several.has(item.id) || naming.changed
  return {
    ...(own ? { name: naming.name, quantity: item.quantity, unit: item.unit, price: item.price ?? null, price_qty: item.price_qty ?? null, price_unit: item.price_unit ?? null } : {}),
    ...(naming.kind === 'new' ? { add_name: true } : {}),
    ...namePackKeys(pack),
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
