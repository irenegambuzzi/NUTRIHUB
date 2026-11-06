import { exactKey } from './similarItems'
import { isDurable } from './inventory'
import { stockFactor } from './reopenUnits'

// One item, many names (plan 9N, round 6D). An item keeps one stock, and
// pantry_items.names lists the other names it is really bought under. Every
// name on the list is a real name of that item and of no other (K58, K59).
// supabase/032 writes the list, only through guarded functions; the app
// never sends `names` in a plain update. Pure, so every rule can be tested.
// The checks here come first, with the exact-name key of the safety net
// (lib/similarItems.js, also accents and plurals); 032 checks again with
// capitals and outer spaces. No screen uses this file yet (stage 2 on).

export const NAMES_COLUMN = 'names'

// Whether a database error says the column isn't there: 032 has not run.
export const missingNamesColumn = (error) =>
  ['PGRST204', '42703'].includes(error?.code) && new RegExp(`\\b${NAMES_COLUMN}\\b`).test(String(error?.message ?? ''))

// Items read with all their columns tell by themselves whether 032 has run.
export const namesColumnReady = (rows) => (rows ?? []).some((row) => NAMES_COLUMN in row)

// The list of an item, as stored: never anything but elements with a name.
export const nameElements = (item) => (Array.isArray(item?.names) ? item.names.filter((e) => String(e?.name ?? '').trim()) : [])

// The other names of an item: without its own name (a merge may keep an
// element of that name for its row) and each only once.
export function otherNames(item) {
  const own = exactKey(item?.name)
  const seen = new Set()
  return nameElements(item).filter((element) => {
    const key = exactKey(element.name)
    if (!key || key === own || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// The element of this name on the item, or null.
export const nameElement = (item, name) => {
  const key = exactKey(name)
  return (key && nameElements(item).find((element) => exactKey(element.name) === key)) || null
}

export const isOwnName = (item, name) => {
  const key = exactKey(name)
  return Boolean(key) && key === exactKey(item?.name)
}

// The item's own name, or one of its other names.
export const hasName = (item, name) => isOwnName(item, name) || Boolean(nameElement(item, name))

// The item a typed name belongs to: { item, own }, or null. An item's own
// name goes before another item's other name, and a normal item before a
// group (`groups: false`: never a group, like the purchase's name match).
// `exceptId`: never this item.
export function itemForName(name, items, { exceptId = null, groups = true } = {}) {
  const list = (items ?? []).filter((item) => item.id !== exceptId && (groups || !item.is_group))
  const first = (found) => found.find((item) => !item.is_group) ?? found[0] ?? null
  const own = first(list.filter((item) => isOwnName(item, name)))
  if (own) return { item: own, own: true }
  const other = first(list.filter((item) => nameElement(item, name)))
  return other ? { item: other, own: false } : null
}

// K59: the item that already has this word, other than `exceptIds`, or
// null. A word belongs to one item only; a similar word is allowed.
export const nameTakenBy = (name, items, exceptIds = []) => (items ?? []).find((item) => !exceptIds.includes(item.id) && hasName(item, name)) ?? null

// The refusals, word for word as supabase/032 says them.
export const changedMeanwhileText = (name) => `"${name}" changed meanwhile (on the other phone?) — open it again. Nothing was changed.`
export const takenText = (name, item) => `"${name}" is already a name of "${item.name}" in HOME. Nothing was changed.`
const unitsText = (source, target) => `"${source.name}" is counted in ${source.unit}, "${target.name}" in ${target.unit}, and they can't be converted — change the unit first. Nothing was changed.`
const durableText = (item) => `"${item.name}" is a durable, so it can't be merged. Nothing was changed.`
const variantTargetText = (item) => `"${item.name}" is a variant — merge into its group, or take it out of the group first. Nothing was changed.`
const otherGroupText = (item) => `"${item.name}" is a variant of another group — take it out of that group first. Nothing was changed.`
const groupSourceText = (item) => `"${item.name}" is a group with variants — merge its variants into it first. Nothing was changed.`

// What merging `sources` into `target` would do, or why it can't (plan 9N,
// K44, K46, K59), with `items` all the HOME rows.
// → { problem } or { problem: null, moves: [{ source, factor, moved }], moved, stockAfter }
// A source at 0 is never refused for its unit; one with stock needs a
// conversion: the same unit, kg/gr, L/ml, or the target's usual pack.
export function mergeCheck({ target, sources, items }) {
  const refuse = (problem) => ({ problem })
  if (target.group_id) return refuse(variantTargetText(target))
  if (isDurable(target)) return refuse(durableText(target))
  const involved = [target.id, ...sources.map((source) => source.id)]
  const moves = []
  for (const source of sources) {
    if (isDurable(source)) return refuse(durableText(source))
    if (source.group_id && source.group_id !== target.id) return refuse(otherGroupText(source))
    if (items.some((item) => item.group_id === source.id)) return refuse(groupSourceText(source))
    const stock = Number(source.current_stock) || 0
    const factor = stockFactor(source.unit, target)
    if (stock > 0 && factor === null) return refuse(unitsText(source, target))
    for (const name of [source.name, ...nameElements(source).map((element) => element.name)]) {
      const taken = nameTakenBy(name, items, involved)
      if (taken) return refuse(takenText(name, taken))
    }
    moves.push({ source, factor, moved: stock > 0 ? stock * factor : 0 })
  }
  const moved = moves.reduce((sum, move) => sum + move.moved, 0)
  return { problem: null, moves, moved, stockAfter: (Number(target.current_stock) || 0) + moved }
}

// What taking `name` out of `item` would do, or why it can't (plan 9N, 4F).
// `stockMoved` is in the item's unit. Counted in the old unit when the
// conversion is known (the same unit, kg/gr, L/ml, or the name's pack
// size), else in the item's unit, so no stock is ever lost.
// → { problem } or { problem: null, element, origin, unit, stock, stockLeft }
export function separationCheck({ item, name, stockMoved, items }) {
  const refuse = (problem) => ({ problem })
  if (isOwnName(item, name)) return refuse(`"${item.name}" is the item's own name, so it can't be separated. Nothing was changed.`)
  const element = nameElement(item, name)
  if (!element) return refuse(`"${String(name ?? '').trim()}" is not a name of "${item.name}". Nothing was changed.`)
  const current = Number(item.current_stock) || 0
  const moved = Number(stockMoved)
  if (stockMoved === null || stockMoved === '' || !Number.isFinite(moved) || moved < 0 || moved > current) {
    return refuse(`The stock to move must be between 0 and ${current} ${item.unit}. Nothing was changed.`)
  }
  const taken = nameTakenBy(name, items, [item.id])
  if (taken) return refuse(takenText(element.name, taken))
  const origin = element.origin ?? null
  const oldUnit = origin?.unit ?? item.unit
  const factor = stockFactor(oldUnit, { unit: item.unit, packaging_unit: element.packaging_unit, quantity_per_pack: element.quantity_per_pack })
  return {
    problem: null,
    element,
    origin,
    unit: factor === null ? item.unit : oldUnit,
    stock: factor === null ? moved : moved / factor,
    stockLeft: current - moved,
  }
}
