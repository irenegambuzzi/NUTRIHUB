import { CATEGORY_RULES } from '../data/categoryKeywords'

// Guesses an inventory category (and sub-category) from an item name using
// the keyword list in data/categoryKeywords.js.

// Words that only describe the amount, dropped before matching.
const AMOUNT = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|grammi|grams?|mg|ml|cl|dl|l|lt|litri|liters?|litres?|pz|pcs|pezzi|x|oz)?\b|\bx\s*\d+\b/g
const UNIT_WORDS = new Set(['pcs', 'pz', 'pezzi', 'pack', 'conf', 'confezione', 'kg', 'gr', 'ml', 'lt', 'x'])

// "Ice-Cream 500g" → "ice cream": lower case, no accents, punctuation and
// amounts removed, single spaces.
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`´]/g, ' ')
    .replace(AMOUNT, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !UNIT_WORDS.has(w))
    .join(' ')
}

// English plurals → singular (berries → berry, tomatoes → tomato,
// apples → apple). Applied to names and keywords alike, so other
// languages' words still line up with themselves.
export function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 4 && /(?:o|ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

const tokensOf = (name) =>
  normalizeName(name)
    .split(' ')
    .filter(Boolean)
    .map(singular)

const split = (list) => (list ? list.split('|').map((k) => k.trim()).filter(Boolean) : [])

// Keyword index: "ice cream" is stored as "ice cream" and "icecream";
// stems ("pomodor*") separately.
function buildIndex(rules) {
  const phrases = new Map() // key → [{ rule, words, kind, weak }]
  const stems = [] // { stem, rule, kind, weak }
  rules.forEach(([categoryId, subcategoryId, keywords, { weak, kind } = {}], order) => {
    const rule = { categoryId, subcategoryId, order }
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

const INDEX = buildIndex(CATEGORY_RULES)
const MAX_PHRASE = 5

// Words after these describe the item ("torta di mele", "budino al
// cioccolato", "tonno all'olio d'oliva", "susu rasa coklat"): however
// long, they count less than one word before them, so the item itself
// wins ("chips … al sale marino" are chips, not salt).
const LINKS = new Set(['di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'al', 'all', 'alla', 'allo', 'ai', 'agli', 'alle', 'con', 'with', 'of', 'flavour', 'flavor', 'gusto', 'rasa', 'dengan'])
const DESCRIBING = 0.75

// Every keyword found in the name, as spans of its words. Weak keywords
// count only when they are the whole name.
function findMatches(tokens) {
  const link = tokens.findIndex((t, i) => i > 0 && LINKS.has(t))
  const describes = (start) => link > 0 && start > link
  const matches = []
  for (let start = 0; start < tokens.length; start++) {
    for (let len = 1; len <= Math.min(MAX_PHRASE, tokens.length - start); len++) {
      const part = tokens.slice(start, start + len)
      for (const key of new Set([part.join(' '), part.join('')])) {
        for (const e of INDEX.phrases.get(key) || []) {
          if (e.weak && len !== tokens.length) continue
          // "pop corn" matching "popcorn" counts as two words.
          const full = Math.max(e.words, len) + (e.kind ? 0.5 : 0) - (e.weak ? 0.5 : 0)
          const score = describes(start) ? Math.min(full, DESCRIBING) : full
          matches.push({ rule: e.rule, start, end: start + len, score })
        }
      }
    }
    for (const s of INDEX.stems) {
      if (tokens[start].startsWith(s.stem) && (!s.weak || tokens.length === 1)) {
        matches.push({ rule: s.rule, start, end: start + 1, score: describes(start) ? DESCRIBING : 1 })
      }
    }
  }
  // A keyword inside a longer match ("cream" in "ice cream") doesn't count
  // on its own.
  return matches.filter((m) => !matches.some((o) => o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start))
}

// { categoryId, subcategoryId } or null. The most specific match wins:
// more words beat fewer, and a word saying what the product is beats a
// flavour or ingredient. If the best matches point to different main
// categories, it's unclear and nothing is guessed.
export function guessCategory(name) {
  const tokens = tokensOf(name)
  if (!tokens.length || tokens.join('').length < 2) return null
  const matches = findMatches(tokens)
  if (!matches.length) return null
  const best = Math.max(...matches.map((m) => m.score))
  const top = matches.filter((m) => m.score === best).map((m) => m.rule)
  if (new Set(top.map((r) => r.categoryId)).size > 1) return null
  const rule = top.reduce((a, b) => (b.order < a.order ? b : a))
  return { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId }
}
