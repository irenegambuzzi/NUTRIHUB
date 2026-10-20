import { isOneTime } from './oneTime'
import { variantOrder } from './groups'

// Groups on the SHOP list. Every variant at 0 (not one-time) has its own
// SHOP entry (pantry_item_id = the variant); the group itself never gets
// one. The list shows those entries as ONE card per group, one row per
// variant, coloured by the group's status (lib/inventory.js shopReason).
// Group-level entries from before (an older version of the app, or a
// purchase reopened from then) are still shown and bought as before; the
// ones still "to buy" are replaced by per-variant entries.

const stock = (row) => Number(row.current_stock) || 0

// Oldest first: the entry that stays when there are two.
const oldestFirst = (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id))

// What the SHOP list of one group should change.
//   group      the group row
//   variants   its variants (with current_stock, one_time)
//   open       the open entries (not bought) linked to the group or a
//              variant: { id, pantry_item_id, auto_generated, in_cart, created_at }
//   ordered    ids of entries ordered online and on the way
//   groupNeeds the group's total is at or below its minimum (or expired)
// Returns { remove: [entry ids], add: [variants that need a new entry] }.
//
// - The group's own automatic entries still "to buy" go; in the cart or on
//   the way they stay until they are bought, arrive or are cancelled.
// - A variant at 0 (not one-time) needs one entry. If it has none, one is
//   added; if it has more, the automatic ones still "to buy" go — the
//   oldest stays, unless another entry (in the cart, on the way, typed by
//   hand) is already there.
// - A group that needs buying while every variant still has some: the
//   variant with the least gets an entry, unless one of them is on the list
//   already (so the row doesn't jump from one variant to the next).
// - A variant that isn't needed loses its automatic entries (one on the
//   way stays; a one-time variant's entry in the cart stays).
// - Entries typed by hand ("+ Add another variant") are never removed.
export function planGroupEntries({ group, variants, open, ordered = new Set(), groupNeeds = false }) {
  const toBuy = (e) => !e.in_cart && !ordered.has(e.id)
  const autoToBuy = (e) => e.auto_generated && toBuy(e)
  const remove = new Set()
  for (const e of open) if (e.pantry_item_id === group.id && autoToBuy(e)) remove.add(e.id)

  const entriesOf = (v) => open.filter((e) => e.pantry_item_id === v.id)
  const listable = variants.filter((v) => !isOneTime(v))
  const wanted = new Set(listable.filter((v) => stock(v) <= 0).map((v) => v.id))
  const lowWithoutZero = groupNeeds && wanted.size === 0 && listable.length > 0
  if (lowWithoutZero && !listable.some((v) => entriesOf(v).length)) wanted.add(variantOrder(listable)[0].id)

  const add = []
  for (const v of variants) {
    const own = entriesOf(v)
    const needed = wanted.has(v.id) || (lowWithoutZero && !isOneTime(v))
    if (!needed) {
      for (const e of own) if (e.auto_generated && !ordered.has(e.id) && !(isOneTime(v) && e.in_cart)) remove.add(e.id)
      continue
    }
    const spare = own.filter(autoToBuy).sort(oldestFirst)
    const others = own.length - spare.length
    for (const e of others > 0 ? spare : spare.slice(1)) remove.add(e.id)
    if (own.length === 0 && wanted.has(v.id)) add.push(v)
  }
  return { remove: [...remove], add }
}

// The automatic entries "to buy" that are one too many for one item (not
// a group): the oldest stays, unless another entry is already there.
export function spareEntryIds(open, ordered = new Set()) {
  const spare = open.filter((e) => e.auto_generated && !e.in_cart && !ordered.has(e.id)).sort(oldestFirst)
  return (spare.length < open.length ? spare : spare.slice(1)).map((e) => e.id)
}

// The groups whose SHOP entries are not as planGroupEntries wants, seen
// from the rows already on the phone: a group-level automatic entry still
// "to buy", a variant with a second entry, or a variant at 0 (not
// one-time) with none. Used to tidy the list once (old group-level
// entries, duplicates) without reading anything when it is already right.
export function groupsToTidy({ entries, pantryRows, ordered = new Set() }) {
  const byId = new Map(pantryRows.map((p) => [p.id, p]))
  const openOf = new Map()
  const ids = new Set()
  for (const e of entries) {
    if (e.completed || !e.pantry_item_id) continue
    openOf.set(e.pantry_item_id, [...(openOf.get(e.pantry_item_id) ?? []), e])
    const linked = byId.get(e.pantry_item_id)
    if (linked?.is_group && e.auto_generated && !e.in_cart && !ordered.has(e.id)) ids.add(linked.id)
  }
  for (const v of pantryRows) {
    if (!v.group_id || !byId.get(v.group_id)?.is_group) continue
    const own = openOf.get(v.id) ?? []
    if (spareEntryIds(own, ordered).length) ids.add(v.group_id)
    if (!isOneTime(v) && stock(v) <= 0 && own.length === 0) ids.add(v.group_id)
  }
  return [...ids]
}

// The SHOP list as it is shown: `entries` in their display order become
// units — { kind: 'entry', key, entry } for an entry on its own, or
// { kind: 'group', key, group, inCart, entries } for a group's card, put
// where its first entry is. A group has at most one card "to buy" and one
// in the cart. `groupOf(entry)` is the group an entry belongs to (through
// its variant, or a group-level entry from before), else null.
// `pantryOf(entry)` gives each row's HOME item, for the order inside the
// card: variants at 0 first, then from the lowest stock to the highest
// (a group-level entry last).
export function shopUnits(entries, groupOf, pantryOf = () => null) {
  const units = []
  const cards = new Map()
  for (const entry of entries) {
    const group = groupOf(entry)
    if (!group) {
      units.push({ kind: 'entry', key: entry.id, entry })
      continue
    }
    const key = `group:${group.id}:${entry.in_cart ? 'cart' : 'buy'}`
    let card = cards.get(key)
    if (!card) {
      card = { kind: 'group', key, group, inCart: Boolean(entry.in_cart), entries: [] }
      cards.set(key, card)
      units.push(card)
    }
    card.entries.push(entry)
  }
  for (const card of cards.values()) card.entries = rowOrder(card.entries, pantryOf)
  return units
}

function rowOrder(entries, pantryOf) {
  const rank = (e) => {
    const p = pantryOf(e)
    return p && !p.is_group ? stock(p) : Infinity
  }
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

// What a unit is called and where it sits in the shop (Shopping mode):
// a card by its group.
export const unitItem = (unit) => (unit.kind === 'group' ? { name: unit.group.name, category_id: unit.group.category_id } : unit.entry)

// The variants "+ Add another variant" offers in a group's card: those
// with stock above 0 that aren't on the list yet (`listedIds`), A–Z.
export function addableVariants(group, listedIds) {
  return (group.variants ?? []).filter((v) => stock(v) > 0 && !listedIds.has(v.id)).sort((a, b) => a.name.localeCompare(b.name))
}

// How much a variant's entry asks for at first: 1 of its purchase unit
// (its pack, when it has one), with its last price.
export function variantPurchase(variant) {
  const perPack = Number(variant.quantity_per_pack)
  return { quantity: 1, unit: variant.packaging_unit && perPack > 0 ? variant.packaging_unit : variant.unit }
}
