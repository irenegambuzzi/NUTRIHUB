import { exactKey } from './similarItems'
import { normName } from './grocery'
import { isDurable } from './inventory'
import { stockFactor } from './reopenUnits'
import { packField, packStartText, packTextFor, savesUsualSize, usualPackSize } from './packSize'
import { decimalProblem, parseDecimal } from './decimal'

// One item, many names (plan 9N, round 6D). An item keeps one stock, and
// pantry_items.names lists the other names it is really bought under. Every
// name on the list is a real name of that item and of no other (K58, K59).
// supabase/032 writes the list, only through guarded functions; the app
// never sends `names` in a plain update. Pure, so every rule can be tested.
// The checks here come first, with the exact-name key of the safety net
// (lib/similarItems.js, also accents and plurals); 032 checks again with
// capitals and outer spaces. Before 032 no item has the list, so everything
// here finds nothing and every screen stays as it was.

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
  // Most items have none, and this runs for every item on every key press.
  const elements = nameElements(item)
  if (!elements.length) return elements
  const own = exactKey(item?.name)
  const seen = new Set()
  return elements.filter((element) => {
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

// Only a normal item has other names of its own: a group, a variant or a
// durable never (a merge decides for groups later, stage 4).
export const canHaveNames = (item) => Boolean(item) && !item.is_group && !item.group_id && !isDurable(item)

// A Map of names (normName → item) with every item's other names added: an
// item's own name, already in the Map, stays first.
export function addOtherNames(byName, items) {
  for (const item of items ?? []) {
    for (const { name } of otherNames(item)) if (!byName.has(normName(name))) byName.set(normName(name), item)
  }
  return byName
}

// The item's own name and its other names, for a search; `query` in lower case.
export const anyNameIncludes = (item, query) => [item?.name, ...otherNames(item).map((element) => element.name)].some((name) => String(name ?? '').toLowerCase().includes(query))

// The grey line under the name on a HOME tile (K57): the first two names,
// and how many more. { text: "also: Corn Snack, Nuvole di drago…", more: 8 },
// or null without other names.
const NAMES_ON_TILE = 2
export function alsoLine(item) {
  const names = otherNames(item).map((element) => element.name.trim())
  if (!names.length) return null
  const more = Math.max(0, names.length - NAMES_ON_TILE)
  return { text: `also: ${names.slice(0, NAMES_ON_TILE).join(', ')}${more ? '…' : ''}`, more }
}

// Whether something is bought under another name of `item`, not its own.
export const boughtAsOtherName = (item, name) => !isOwnName(item, name) && Boolean(nameElement(item, name))

// The item as a line bought under `name` in `unit` sees it for the pack
// field: under another name with a pack size for that unit, that size; else
// the item's own (report F). A first-time size is never saved on the item
// from such a line (K60): it goes on the name (namedPack).
export function packItemFor(item, name, unit) {
  const element = boughtAsOtherName(item, name) ? nameElement(item, name) : null
  return element && usualPackSize(element, unit) ? { ...item, packaging_unit: element.packaging_unit, quantity_per_pack: element.quantity_per_pack } : item
}

// K60: the pack field of a line of `item` bought under `name`, another name
// of it or a new one (packField for the rest). It starts with the name's own
// size for that unit, else the item's. A first-time size belongs to the name
// (`onName`, sent as name_pack): only while the name has none, and not when
// it is just the item's usual size, which the field starts with anyway.
export function namedPack(item, name, unit, { quantity = 1, typed = null, canSave = true } = {}) {
  const packItem = packItemFor(item, name, unit)
  const pack = packField({ item: packItem, unit, quantity, text: packTextFor(typed, unit, packStartText(packItem, unit)), canSave: false })
  if (!pack) return null
  const firstTime = canSave && pack.value !== null && savesUsualSize(nameElement(item, name) ?? {}, pack.unit) && pack.value !== usualPackSize(item, pack.unit)
  return { ...pack, firstTime, onName: true, differs: pack.differs && !firstTime }
}

// What a line sends so that first-time size lands on the name ({} for none).
export const namePackKeys = (pack) => (pack?.firstTime && pack.onName ? { name_pack: { packaging_unit: pack.unit, quantity_per_pack: pack.value } } : {})

// K59: the item that already has this word, other than `exceptIds`, or
// null. A word belongs to one item only; a similar word is allowed.
export const nameTakenBy = (name, items, exceptIds = []) => (items ?? []).find((item) => !exceptIds.includes(item.id) && hasName(item, name)) ?? null

// The title of a SHOP card (K53): the HOME item's name, with the card's own
// name under it when that differs. A card without a HOME item, and a group
// or a variant, keeps its own name.
export function cardTitle(entry, item) {
  const own = entry?.name ?? ''
  if (!item || item.is_group || item.group_id || exactKey(own) === exactKey(item.name)) return { title: own, subtitle: '' }
  return { title: item.name, subtitle: own }
}

export const NEW_NAME_LINE_TEXT = (item) => `New name of ${item.name} — it will be remembered.`
export const EMPTY_NAME_TEXT = 'Type the name of this line.'
// K101: a new name used on two lines of one purchase.
export const NAME_TWICE_TEXT = (name) => `"${String(name ?? '').trim()}" is also another line of this purchase — use it only once.`

// What the name on a purchase line means for its item (K50, K59, K94).
// `item`: the HOME item, or for a new one { name } (the card's); `cardName`:
// the SHOP card's own name; `first`: the card's own line, whose name may stay
// the card's or be emptied (then it counts as the card's).
// → { name (sent: the stored spelling of a name the item has), kind, changed
// (another word than the card's was typed), problem, note }. kind: 'own' / 'known' (the
// item's name or other name, a plain line), 'new' (add_name), 'card' (the
// card's own word, not a name of the item: left as it is), 'empty' / 'taken'
// (refused: `problem`, Confirm stays locked).
export function lineNaming({ item, cardName, name, items, first = false }) {
  const typed = String(name ?? '').trim()
  const card = String(cardName ?? '').trim()
  if (!typed && !first) return { name: '', kind: 'empty', changed: true, problem: EMPTY_NAME_TEXT, note: '' }
  const word = typed || card
  const changed = word !== card
  if (isOwnName(item, word)) return { name: item.name.trim(), kind: 'own', changed, problem: '', note: '' }
  const element = nameElement(item, word)
  if (element) return { name: element.name.trim(), kind: 'known', changed, problem: '', note: '' }
  if (first && exactKey(word) === exactKey(card)) return { name: word, kind: 'card', changed, problem: '', note: '' }
  const taken = nameTakenBy(word, items, item.id ? [item.id] : [])
  if (taken) return { name: word, kind: 'taken', changed, problem: takenNote(word, taken), note: '' }
  return { name: word, kind: 'new', changed, problem: '', note: NEW_NAME_LINE_TEXT(item) }
}

// A line under a name that is not the item's own: its pack counts on the name.
export const onName = (naming) => naming?.kind === 'known' || naming?.kind === 'new'

// The name chips of one line (K56): the item's names, last bought first
// (`recent`: names of its purchase lines, newest first), then in the order of
// the list. A name already on another line of the card is left out.
export function nameChips(item, recent = [], usedElsewhere = []) {
  const names = [item?.name, ...otherNames(item).map((element) => element.name)].map((name) => String(name ?? '').trim()).filter(Boolean)
  const used = usedElsewhere.map(exactKey).filter(Boolean)
  const last = (name) => {
    const at = recent.findIndex((r) => exactKey(r) === exactKey(name))
    return at < 0 ? Infinity : at
  }
  return names.filter((name) => !used.includes(exactKey(name))).sort((a, b) => last(a) - last(b))
}

// The refusals, word for word as supabase/032 says them.
export const changedMeanwhileText = (name) => `"${name}" changed meanwhile (on the other phone?) — open it again. Nothing was changed.`
export const takenNote = (name, item) => `"${String(name ?? '').trim()}" is already a name of "${item.name}" in HOME.`
export const takenText = (name, item) => `${takenNote(name, item)} Nothing was changed.`
const unitsText = (source, target) => `"${source.name}" is counted in ${source.unit}, "${target.name}" in ${target.unit}, and they can't be converted — change the unit first. Nothing was changed.`
const durableText = (item) => `"${item.name}" is a durable, so it can't be merged. Nothing was changed.`
const variantTargetText = (item) => `"${item.name}" is a variant — merge into its group, or take it out of the group first. Nothing was changed.`
const otherGroupText = (item) => `"${item.name}" is a variant of another group — take it out of that group first. Nothing was changed.`
const groupSourceText = (item) => `"${item.name}" is a group with variants — merge its variants into it first. Nothing was changed.`

// "Other names" in "Edit item": one draft per name of the item, plus the new
// ones typed. { key, name, unit, size, saved, merged }: `size` as typed, ''
// for no pack size; `merged`: it came from a merge, so it has no × (K74).
export const nameDrafts = (item) =>
  otherNames(item).map((element) => ({
    key: element.name,
    name: element.name,
    unit: element.packaging_unit ?? '',
    size: Number(element.quantity_per_pack) > 0 ? String(Number(element.quantity_per_pack)) : '',
    saved: true,
    merged: element.origin != null,
  }))

export const newNameDraft = (key) => ({ key, name: '', unit: '', size: '', saved: false, merged: false })

// The pack fields of a draft; a name without a size has no pack at all.
function packOf(draft, defaultUnit) {
  const size = parseDecimal(draft.size)
  return size > 0 ? { packaging_unit: draft.unit || defaultUnit, quantity_per_pack: size } : { packaging_unit: null, quantity_per_pack: null }
}

// Per draft key, why it can't be saved (a Map, empty when all can). K59: a
// new name that is another item's name or other name, or one already on this
// list; `ownName`: the name in the form now.
export function draftProblems(drafts, { item, ownName, items }) {
  const problems = new Map()
  const seen = []
  for (const draft of drafts) {
    const problem = decimalProblem(draft.size)
    if (problem) problems.set(draft.key, problem)
    else if (draft.size.trim() && !(parseDecimal(draft.size) > 0)) problems.set(draft.key, `Quantity per ${draft.unit || 'pack'} must be more than 0.`)
    if (draft.saved) {
      seen.push(draft.name)
      continue
    }
    if (!draft.name.trim()) continue
    const taken = nameTakenBy(draft.name, items, [item.id])
    if (taken) problems.set(draft.key, takenNote(draft.name, taken))
    else if (seen.some((name) => exactKey(name) === exactKey(draft.name)) || exactKey(draft.name) === exactKey(ownName)) problems.set(draft.key, takenNote(draft.name, { name: ownName }))
    seen.push(draft.name)
  }
  return problems
}

// The payload for save_item_names, or null when the names stay as they are.
// `was` is the list as the app read it, so a change on the other phone is
// refused. A new name with no text is not one. `defaultUnit`: the unit shown
// for a draft whose unit was not changed by hand.
export function namesChange(item, drafts, defaultUnit) {
  const kept = new Map(drafts.filter((draft) => draft.saved).map((draft) => [draft.name, draft]))
  const saved = otherNames(item)
  const remove = saved.filter((element) => !kept.has(element.name)).map((element) => element.name)
  const edit = saved.flatMap((element) => {
    const draft = kept.get(element.name)
    if (!draft) return []
    const pack = packOf(draft, defaultUnit)
    const size = Number(element.quantity_per_pack) > 0 ? Number(element.quantity_per_pack) : null
    const same = pack.quantity_per_pack === size && (size === null || pack.packaging_unit === element.packaging_unit)
    return same ? [] : [{ name: element.name, ...pack }]
  })
  const add = drafts.filter((draft) => !draft.saved && draft.name.trim()).map((draft) => ({ name: draft.name.trim(), ...packOf(draft, defaultUnit), price: null, price_qty: null, price_unit: null }))
  return add.length || remove.length || edit.length ? { item_id: item.id, add, remove, edit, was: { names: item.names ?? [] } } : null
}

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
