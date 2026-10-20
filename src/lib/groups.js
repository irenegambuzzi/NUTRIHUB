import { unitFactor } from './units'
import { isOneTime } from './oneTime'

// Item groups: a group is a pantry row with is_group = true ("Chips &
// Snacks"); its variants are pantry rows with group_id = the group's id.
// A group has no stock of its own: what it shows is the sum of its
// variants, counted in the group's unit. supabase/018_item_groups.sql adds
// the two columns; until it has been run, no row has them and every item
// is an ordinary item.

const round = (n) => Math.round(n * 100) / 100

export const isGroup = (item) => Boolean(item?.is_group)
export const isVariant = (item) => Boolean(item?.group_id)

// Whether the database has the group columns (any row shows them). With
// no items yet nothing can be told, and groups are allowed.
export const groupsReady = (rows) => rows.length === 0 || rows.some((r) => 'is_group' in r)

export function variantsOf(rows, groupId) {
  return rows.filter((r) => r.group_id === groupId)
}

// The rows as the app shows them: each group's current_stock is the total
// of its variants (and `variants` lists them). Every other row is returned
// untouched, and without groups the same array comes back.
export function withGroupTotals(rows) {
  if (!rows.some(isGroup)) return rows
  const byGroup = new Map()
  for (const r of rows) {
    if (!r.group_id) continue
    byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r])
  }
  return rows.map((r) => {
    if (!isGroup(r)) return r
    const variants = byGroup.get(r.id) ?? []
    return { ...r, current_stock: round(variants.reduce((sum, v) => sum + (Number(v.current_stock) || 0), 0)), variants }
  })
}

// Moving `item` into `group`: all variants count in the group's unit.
//   { ok: true }                      same unit
//   { convert: { factor, from, to } } a different unit that converts (kg → gr)
//   { blocked: message }              can't be converted: nothing happens
export function checkMoveIntoGroup(item, group) {
  if (isGroup(item)) return { blocked: `"${item.name}" is a group itself — a group can't go inside another group.` }
  if (item.unit === group.unit) return { ok: true }
  const factor = unitFactor(item.unit, group.unit)
  if (factor !== null) return { convert: { factor, from: item.unit, to: group.unit } }
  return {
    blocked: `"${item.name}" is counted in ${item.unit}, but "${group.name}" counts in ${group.unit}, and ${item.unit} can't be converted to ${group.unit}. Change the item's unit first, or pick another group.`,
  }
}

// What a restock of a group's variant or a new variant needs to look like.
export function newVariantFields(group, name, extra = {}) {
  return {
    name: name.trim(),
    category_id: group.category_id,
    subcategory_id: group.subcategory_id ?? null,
    unit: group.unit,
    min_stock: 0,
    group_id: group.id,
    ...extra,
  }
}

// The variants a group's SHOP row lists as out: at 0, not one-time (a
// finished 1× variant is never bought by itself) and not taken off the
// list by hand (shop_dismissed_at, cleared by the database once it is
// restocked). A–Z.
export function listedOutVariants(variants = []) {
  return variants
    .filter((v) => (Number(v.current_stock) || 0) <= 0 && !isOneTime(v) && !v.shop_dismissed_at)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Variants in buying order (the SHOP row and Confirm purchase): those at 0
// first, then from the lowest stock to the highest; A–Z between equals.
// HOME's group card keeps its A–Z list.
export function variantOrder(variants = []) {
  return [...variants].sort((a, b) => (Number(a.current_stock) || 0) - (Number(b.current_stock) || 0) || a.name.localeCompare(b.name))
}

// The variant Confirm purchase picks for a group line until the user
// chooses: the first one the SHOP row lists as out, else none.
export function firstOutVariant(variants = []) {
  const listed = new Set(listedOutVariants(variants).map((v) => v.id))
  return variantOrder(variants).find((v) => listed.has(v.id)) ?? null
}
