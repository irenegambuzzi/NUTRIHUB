import { CATEGORY_RULES } from '../data/categoryKeywords'

// Guesses a category (and sub-category) from an item name using a keyword
// list: the HOME list in data/categoryKeywords.js, and (through
// createGuesser) the MONEY list in data/budgetKeywords.js. Both use the same
// matching rules below.

// Words that only describe the amount, dropped before matching.
const AMOUNT = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|grammi|grams?|mg|ml|cl|dl|l|lt|litri|liters?|litres?|pz|pcs|pezzi|x|oz)?\b|\bx\s*\d+\b/g
const UNIT_WORDS = new Set(['pcs', 'pz', 'pezzi', 'pack', 'conf', 'confezione', 'kg', 'gr', 'ml', 'lt', 'x'])

// "Ice-Cream 500g" → "ice cream": lower case, no accents, punctuation and
// amounts removed, single spaces. (Also the key of a remembered name.)
export function normalizeName(name) {
  return cleanWords(name)
    .filter((w) => !UNIT_WORDS.has(w))
    .join(' ')
}

const cleanWords = (name) =>
  String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`´]/g, ' ')
    .replace(AMOUNT, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)

// Words that look like a plural but are a thing of their own: "glasses"
// (to see with) is not two drinking "glass"es, so "Glasses" and "Wine
// Glasses" can mean different things.
const NOT_PLURAL = new Set(['glasses'])

// English plurals → singular (berries → berry, tomatoes → tomato,
// apples → apple). Applied to names and keywords alike, so other
// languages' words still line up with themselves.
export function singular(word) {
  if (NOT_PLURAL.has(word)) return word
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 4 && /(?:o|ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

// The words a name is read by. Unit words stay ("Party pack" is a snack,
// "Party" a party) but never count towards the whole name: "Ace pz" is
// still just "Ace" for a weak word.
const tokensOf = (name) => cleanWords(name).map(singular)
const contentLength = (tokens) => tokens.filter((t) => !UNIT_WORDS.has(t)).length

const split = (list) => (list ? list.split('|').map((k) => k.trim()).filter(Boolean) : [])

// Keyword index: "ice cream" is stored as "ice cream" and "icecream";
// stems ("pomodor*") separately.
function buildIndex(rules) {
  const phrases = new Map() // key → [{ rule, words, kind, weak }]
  const stems = [] // { stem, rule, kind, weak }
  rules.forEach(([categoryId, subcategoryId, keywords, { weak, kind, priority = null, notAlone = false } = {}], order) => {
    const rule = { categoryId, subcategoryId, order, priority, notAlone }
    const kinds = new Set(split(kind).map((k) => tokensOf(k).join(' ')))
    const add = (keyword, isWeak) => {
      if (keyword.endsWith('*')) {
        stems.push({ stem: normalizeName(keyword.slice(0, -1)), rule, weak: isWeak, kind: false })
        return
      }
      const tokens = tokensOf(keyword)
      if (!tokens.length) return
      const entry = { rule, words: tokens.length, weak: isWeak, kind: kinds.has(tokens.join(' ')) }
      for (const key of new Set([tokens.join(' '), tokens.join('')])) {
        if (!phrases.has(key)) phrases.set(key, [])
        phrases.get(key).push(entry)
      }
    }
    split(keywords).forEach((k) => add(k, false))
    split(weak).forEach((k) => add(k, true))
    // A kind word not listed among the keywords still counts as one.
    split(kind).forEach((k) => {
      const key = tokensOf(k).join(' ')
      if (!(phrases.get(key) || []).some((e) => e.rule === rule)) add(k, false)
    })
  })
  return { phrases, stems }
}

const MAX_PHRASE = 5

// Words after these describe the item ("torta di mele", "budino al
// cioccolato", "tonno all'olio d'oliva", "susu rasa coklat"): however
// long, they count less than one word before them, so the item itself
// wins ("chips … al sale marino" are chips, not salt).
const LINKS = new Set(['di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'al', 'all', 'alla', 'allo', 'ai', 'agli', 'alle', 'con', 'with', 'of', 'flavour', 'flavor', 'gusto', 'rasa', 'dengan'])
const DESCRIBING = 0.75

// Every keyword of the index found in the name, as spans of its words.
// Weak keywords count only when they are the whole name; the words of a
// `notAlone` rule only when they are not ("Office Chair" is for work, a
// bare "Office" is the software). A purpose word
// (a rule with a `priority`) after a linking word doesn't count at all:
// "Torta della nonna" is a cake, not money for grandma.
function findMatches(index, tokens) {
  const link = tokens.findIndex((t, i) => i > 0 && LINKS.has(t))
  const describes = (start) => link > 0 && start > link
  const whole = contentLength(tokens)
  const matches = []
  for (let start = 0; start < tokens.length; start++) {
    for (let len = 1; len <= Math.min(MAX_PHRASE, tokens.length - start); len++) {
      const part = tokens.slice(start, start + len)
      for (const key of new Set([part.join(' '), part.join('')])) {
        for (const e of index.phrases.get(key) || []) {
          const isWhole = contentLength(part) === whole
          if (e.weak && !isWhole) continue
          if (e.rule.notAlone && isWhole) continue
          if (e.rule.priority && describes(start)) continue
          // "pop corn" matching "popcorn" counts as two words.
          const full = Math.max(e.words, len) + (e.kind ? 0.5 : 0) - (e.weak ? 0.5 : 0)
          const score = describes(start) ? Math.min(full, DESCRIBING) : full
          matches.push({ rule: e.rule, start, end: start + len, score })
        }
      }
    }
    for (const s of index.stems) {
      if (s.rule.priority && describes(start)) continue
      if (tokens[start].startsWith(s.stem) && (!s.weak || whole === 1)) {
        matches.push({ rule: s.rule, start, end: start + 1, score: describes(start) ? DESCRIBING : 1 })
      }
    }
  }
  // A keyword inside a longer match ("cream" in "ice cream") doesn't count
  // on its own. A rule without a category (a "not this" phrase, e.g.
  // "Mamma Emma" is a brand of gnocchi) only does that: it hides the
  // shorter words inside it and suggests nothing itself.
  return matches
    .filter((m) => !matches.some((o) => o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start))
    .filter((m) => m.rule.categoryId)
}

// The matches that decide: those of the most important purpose rules when
// there are any (a rule's `priority`, 1 first — "Regalo mamma" is money
// for the family whatever else the name says), else the best scores.
function deciding(matches) {
  const priorities = matches.map((m) => m.rule.priority).filter(Boolean)
  if (priorities.length) {
    const first = Math.min(...priorities)
    return matches.filter((m) => m.rule.priority === first)
  }
  const best = Math.max(...matches.map((m) => m.score))
  return matches.filter((m) => m.score === best)
}

const rank = (m) => m.rule.priority ?? Infinity

// A rule as it applies to the categories that exist now. `available` is
// { parents, subsByParent } (the categories on offer). A rule whose main
// category is missing (deleted, merged away, never created) is dropped; if
// only its sub-category is missing, it points to the main category alone.
// Nothing is reported: a missing category just isn't suggested.
function ruleFor(rule, available) {
  if (!available?.parents) return rule
  if (!available.parents.some((p) => p.id === rule.categoryId)) return null
  if (!rule.subcategoryId) return rule
  const subOk = (available.subsByParent?.get(rule.categoryId) || []).some((s) => s.id === rule.subcategoryId)
  return subOk ? rule : { ...rule, subcategoryId: null }
}

// A guesser for one keyword list. Each rule: [categoryId, subcategoryId
// (or null), keywords, options] (see data/categoryKeywords.js). The list is
// indexed once, here.
export function createGuesser(rules) {
  const index = buildIndex(rules)

  // { categoryId, subcategoryId } or null. The most specific match wins:
  // more words beat fewer, and a word saying what the product is beats a
  // flavour or ingredient. If the best matches point to different main
  // categories, it's unclear and nothing is guessed. With `available`, rules
  // for categories that don't exist are ignored *before* this is decided, so
  // a missing category can never make a clear answer "unclear". A purpose
  // rule (`priority`) beats every score.
  function guessCategory(name, available = null) {
    const tokens = tokensOf(name)
    if (!tokens.length || tokens.join('').length < 2) return null
    const matches = findMatches(index, tokens)
      .map((m) => ({ ...m, rule: ruleFor(m.rule, available) }))
      .filter((m) => m.rule)
    if (!matches.length) return null
    const top = deciding(matches).map((m) => m.rule)
    if (new Set(top.map((r) => r.categoryId)).size > 1) return null
    const rule = top.reduce((a, b) => (b.order < a.order ? b : a))
    return { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId }
  }

  // The best distinct rules for a name, best first: [{ categoryId,
  // subcategoryId }] (at most `limit`). Same scoring as guessCategory, but
  // instead of one answer (or nothing when the best matches disagree) it
  // lists them, so the form can show a few chips. Rules for categories that
  // don't exist are ignored first, exactly like guessCategory.
  function guessCategories(name, available = null, limit = 3) {
    const tokens = tokensOf(name)
    if (!tokens.length || tokens.join('').length < 2) return []
    const best = new Map() // "category|sub" → { rule, score }
    for (const m of findMatches(index, tokens)) {
      const rule = ruleFor(m.rule, available)
      if (!rule) continue
      const key = `${rule.categoryId}|${rule.subcategoryId ?? ''}`
      const known = best.get(key)
      if (!known || m.score > known.score || (m.score === known.score && rule.order < known.rule.order)) best.set(key, { rule, score: m.score })
    }
    return [...best.values()]
      .sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.rule.order - b.rule.order)
      .slice(0, limit)
      .map(({ rule }) => ({ categoryId: rule.categoryId, subcategoryId: rule.subcategoryId }))
  }

  return { guessCategory, guessCategories }
}

// The HOME guesser, used everywhere an item gets a HOME category.
const home = createGuesser(CATEGORY_RULES)
export const guessCategory = home.guessCategory
export const guessCategories = home.guessCategories
