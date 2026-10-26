import { isAmountWord, isUnitWord, singular } from './categoryGuess'
import { nameDistance } from './categoryNames'
import { convertQuantity } from './units'
import { formatStock, isDurable, roundQuantity, stockStatus, tapStep } from './inventory'
import { isFinished, isOneTime } from './oneTime'

// The similar-name safety net (plan 9G): before something is added in
// SHOP, in MONEY (Add to HOME on) or in HOME, the typed name is compared
// with the HOME items, so "Pumpkin" doesn't become a second item next to
// "Fresh Pumpkin". Pure, so every rule can be tested; it only reads what
// is already on the phone, so it works offline too.

// Small words that only link the others: they never count as a word of
// the name ("Affettato di pollo" has two words, "affettato" and "pollo").
const CONNECTORS = new Set([
  'di', 'de', 'del', 'della', 'delle', 'dei', 'degli', 'la', 'le', 'il', 'lo', 'al', 'alla', 'e',
  'and', 'with', 'con', 'per', 'for', 'of', 'the', 'a', 'yang', 'dan', 'untuk', 'dengan', '&', '-',
])

// Lower case, accents off, punctuation as a space, single spaces.
const wordsOf = (name) =>
  String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)

// " Dish  Soaps!" → "dish soap": the words above, each singular (the
// keyword list's helper, so "Glasses" stays "glasses"). Numbers and units
// stay: "Milk 1L" and "Milk 500ml" are two names.
export const exactKey = (name) => wordsOf(name).map(singular).join(' ')

// The same name apart from capitals, accents, punctuation, spaces and a
// plural: "Cucumber" and "cucumbers" are one name.
export const sameItemName = (a, b) => {
  const key = exactKey(a)
  return Boolean(key) && key === exactKey(b)
}

// The words a name is compared by: like exactKey, without numbers, unit
// words ("g", "ml", "pack"…) and the linking words above.
// "Snack - Bulk Beef Jerky Sweet Chilli 100 g" → snack bulk beef jerky sweet chilli.
export const countedWords = (name) =>
  wordsOf(name)
    .filter((w) => !isAmountWord(w) && !isUnitWord(w) && !CONNECTORS.has(w))
    .map(singular)

// Two words that are the same apart from a typo. Short words (4 letters or
// fewer) must be identical — "Tea" is not "Pea", "Rice" is not "Ice"; 5–8
// letters may be 1 step apart ("Pumkin" → "Pumpkin"), 9 or more 2 steps.
// The shorter word decides. Only for item names: category names keep
// their own, looser rule (lib/categoryNames.js).
export function typoEqual(a, b) {
  if (a === b) return true
  const shorter = Math.min(a.length, b.length)
  if (shorter <= 4) return false
  const allowed = shorter <= 8 ? 1 : 2
  // Lengths further apart than that can never be close enough.
  if (Math.abs(a.length - b.length) > allowed) return false
  const distance = nameDistance(a, b)
  return distance !== null && distance <= allowed
}

// Every word of `few` paired with its own word of `many` (equal or a
// typo apart), equal pairs first. → the number of typo pairs, or null when
// a word of `few` has no partner.
function pairUp(few, many) {
  const used = new Array(many.length).fill(false)
  const step = (i) => {
    if (i === few.length) return 0
    const options = many
      .map((word, j) => ({ j, typo: word !== few[i] }))
      .filter(({ j, typo }) => !used[j] && (!typo || typoEqual(few[i], many[j])))
      .sort((x, y) => Number(x.typo) - Number(y.typo))
    for (const { j, typo } of options) {
      used[j] = true
      const rest = step(i + 1)
      used[j] = false
      if (rest !== null) return rest + Number(typo)
    }
    return null
  }
  return step(0)
}

// How two names match:
//   'exact'  the same exactKey
//   'typo'   as many words each, every word the same or a typo apart, at
//            least one typo ("Fresh Pumkin" / "Fresh Pumpkin")
//   'words'  the half-name rule: every word of the shorter name is in the
//            longer one (or a typo apart), and the shorter has at least
//            half its words ("Pumpkin" / "Fresh Pumpkin" yes; "Snack" /
//            "Chicken Feet Snack" no)
//   null     not alike
// Every name is cleaned once and kept (a few hundred HOME names, compared
// on every key press of a MONEY row).
const prepared = new Map()
function prepare(name) {
  const text = String(name ?? '')
  let found = prepared.get(text)
  if (!found) {
    if (prepared.size > 5000) prepared.clear()
    found = { key: exactKey(text), words: countedWords(text) }
    prepared.set(text, found)
  }
  return found
}

export function matchKind(a, b) {
  const { key: keyA, words: wordsA } = prepare(a)
  const { key: keyB, words: wordsB } = prepare(b)
  if (keyA && keyA === keyB) return 'exact'
  if (!wordsA.length || !wordsB.length) return null
  if (wordsA.length === wordsB.length && pairUp(wordsA, wordsB) > 0) return 'typo'
  const [few, many] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA]
  return few.length * 2 >= many.length && pairUp(few, many) !== null ? 'words' : null
}

const KIND_ORDER = ['exact', 'typo', 'words']

// Out or Low first: a finished 1× item counts as Out, any other 1× item
// is never Low or Out (lib/inventory.js stockStatus for the rest; a group
// with its total).
export const needsStock = (item) => isFinished(item) || (!isOneTime(item) && stockStatus(item) !== 'ok')

// The HOME items searched: every pantry item — finished 1× items, groups
// and their variants too — but never a durable (not HOME stock).
// `exceptId`: the item being edited, never compared with itself.
const searchable = (items, exceptId) => items.filter((p) => p.id !== exceptId && !isDurable(p) && String(p.name ?? '').trim())

// The HOME items like `name`, best first: exact, then typo, then words;
// within those Out / Low first, then fewer words, then the shorter name,
// then A–Z. → { exact, similar }: `exact` is the item to use without a
// question (a normal item before a group of the same name), or null;
// `similar` up to `limit` { item, kind } to ask about (empty when there is
// an exact one: that never needs a question).
export function matchHomeItems(name, items, { exceptId = null, limit = 3 } = {}) {
  if (!exactKey(name)) return { exact: null, similar: [] }
  const found = searchable(items, exceptId)
    .map((item) => ({ item, kind: matchKind(name, item.name) }))
    .filter((m) => m.kind)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        Number(a.kind === 'exact' && Boolean(a.item.is_group)) - Number(b.kind === 'exact' && Boolean(b.item.is_group)) ||
        Number(!needsStock(a.item)) - Number(!needsStock(b.item)) ||
        prepare(a.item.name).words.length - prepare(b.item.name).words.length ||
        a.item.name.trim().length - b.item.name.trim().length ||
        a.item.name.localeCompare(b.item.name)
    )
  const exact = found.find((m) => m.kind === 'exact')?.item ?? null
  return { exact, similar: exact ? [] : found.slice(0, limit) }
}

// Where an open SHOP entry is: 'to-buy', 'in-cart' or 'ordered' (ordered
// online, on the way). `orderedIds`: the entries with an order on the way.
export const entryState = (entry, orderedIds = new Set()) => (orderedIds.has(entry.id) ? 'ordered' : entry.in_cart ? 'in-cart' : 'to-buy')

// The open SHOP entry for a HOME item or a name, or null. An entry counts
// when it is linked to `item`, or — an entry without a HOME item — when its
// name matches `name` (exact, typo or words; `kinds` can narrow that).
// Bought entries never count. With several, the one "to buy" first, then
// the one in the cart, then one ordered online (those can still take one
// more). → { entry, state }.
export function shopEntryFor({ item = null, name = '' }, entries, { orderedIds = new Set(), kinds = KIND_ORDER } = {}) {
  const typed = String(name ?? '').trim()
  const open = entries.filter(
    (g) => !g.completed && ((item && g.pantry_item_id === item.id) || (!g.pantry_item_id && typed && kinds.includes(matchKind(typed, g.name))))
  )
  for (const state of ['to-buy', 'in-cart', 'ordered']) {
    const entry = open.find((g) => entryState(g, orderedIds) === state)
    if (entry) return { entry, state }
  }
  return null
}

// What the screens say about stock: "2 pcs", "out of stock" or "finished
// 1× item, it comes back" (in the item's own unit, lib/inventory.js).
const inStock = (item) => !isFinished(item) && (Number(item.current_stock) || 0) > 0
export function stockWords(item) {
  if (isFinished(item)) return 'finished 1× item, it comes back'
  return inStock(item) ? formatStock(item) : 'out of stock'
}

const STATE_SUFFIX = { 'to-buy': ' · already to buy', 'in-cart': ' · already in the cart', ordered: ' · ordered online' }
const STATE_WORDS = { 'to-buy': 'to buy', 'in-cart': 'in the cart', ordered: 'ordered online' }

// "Use Fresh Pumpkin · 2 pcs at home · already to buy".
export const pickLabel = (item, state = null) => `Use ${item.name} · ${stockWords(item)}${inStock(item) ? ' at home' : ''}${state ? STATE_SUFFIX[state] : ''}`

// "Added “cucumber” · in HOME: 2 pcs" (or "· out of stock", "· finished 1×
// item, it comes back").
export const addedMessage = (item) => `Added “${item.name}” · ${inStock(item) ? 'in HOME: ' : ''}${stockWords(item)}`

// "In HOME: 2 pcs" under a MONEY row.
export const inHomeNote = (item) => `In HOME: ${stockWords(item)}`

// "Already on your SHOP list: Dish soap — in the cart".
export const alreadyListedText = (found) => `Already on your SHOP list: ${found.entry.name} — ${STATE_WORDS[found.state]}`

export const createNewLabel = (name) => `Create new “${String(name ?? '').trim()}”`
export const CREATE_NEW_HINT = 'Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.'

// "Go to Fresh Pumpkin" / "Go to Balloons (finished 1×)" in the HOME editor.
export const goToLabel = (item) => `Go to ${item.name}${isFinished(item) ? ' (finished 1×)' : ''}`

// How much "Add … more" adds to an entry that is already on the list, in
// the entry's own unit: the quantity typed (`typed` = { quantity, unit })
// when it is in that unit or converts to it (`pack`: the HOME item, for a
// multipack), else one step of the unit (1 pcs, 1 pack… as the + button
// does). → { amount, total, label: "Add 1 more (now 2 pcs)" }.
export function addMore(entry, typed = null, pack = null) {
  const unit = entry.unit
  const quantity = Number(typed?.quantity) || 0
  const converted = quantity > 0 ? (typed.unit === unit ? quantity : convertQuantity(quantity, typed.unit, unit, pack)) : null
  const amount = converted ? roundQuantity(converted, unit) || tapStep(unit) : tapStep(unit)
  const total = roundQuantity((Number(entry.quantity) || 0) + amount, unit)
  return { amount, total, label: `Add ${amount} more (now ${total} ${unit})` }
}
