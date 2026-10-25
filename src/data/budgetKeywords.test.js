import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BUDGET_RULES, MONEY_CATEGORY_IDS_025, MONEY_CATEGORY_IDS_026, NEW_MONEY_CATEGORY_IDS } from './budgetKeywords'
import { LIVE_MONEY_CATEGORIES } from './moneyCategories.fixture'
import { normalizeName, singular } from '../lib/categoryGuess'

const sql = fs.readFileSync(path.join(import.meta.dirname, '../../supabase/024_categories.sql'), 'utf8')
const newIds = Object.values(NEW_MONEY_CATEGORY_IDS)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

// The live MONEY ids: the export itself when it is on this computer
// (tmp-export/ is never committed), else the copy kept in the fixture.
function liveIds() {
  const csv = path.join(import.meta.dirname, '../../tmp-export/2_money.csv')
  if (!fs.existsSync(csv)) return LIVE_MONEY_CATEGORIES.map((c) => c.id)
  return fs.readFileSync(csv, 'utf8').split('\n').slice(1).map((line) => line.split(',')[0]).filter(Boolean)
}

describe('MONEY keywords (data/budgetKeywords.js)', () => {
  it('point only at MONEY ids that exist live or are added by 024, 025 or 026', () => {
    const known = new Set([...liveIds(), ...newIds, ...Object.values(MONEY_CATEGORY_IDS_025), ...Object.values(MONEY_CATEGORY_IDS_026)])
    for (const [mainId, subId] of BUDGET_RULES.filter((r) => r[0])) {
      expect(known.has(mainId), mainId).toBe(true)
      if (subId) expect(known.has(subId), subId).toBe(true)
    }
  })

  it('the fixture copy of the live ids matches the export, when the export is here', () => {
    expect(new Set(liveIds())).toEqual(new Set(LIVE_MONEY_CATEGORIES.map((c) => c.id)))
  })

  it('use the same fixed ids as supabase/024_categories.sql, and 024 uses no other new id', () => {
    const inSql = new Set(sql.match(UUID))
    for (const id of newIds) expect(inSql.has(id), id).toBe(true)
    const live = new Set(liveIds())
    for (const id of inSql) expect(live.has(id) || newIds.includes(id), id).toBe(true)
    expect(new Set(newIds).size).toBe(23)
  })

  it('never list a word both as a keyword and as weak', () => {
    const key = (k) => normalizeName(k).split(' ').map(singular).join(' ')
    const split = (list) => (list ? list.split('|').map(key).filter(Boolean) : [])
    for (const [, subId, keywords, options = {}] of BUDGET_RULES) {
      const weak = split(options.weak)
      expect(split(keywords).filter((k) => weak.includes(k)), String(subId)).toEqual([])
    }
  })

  it('have no rule for the categories not created (Books & Hobbies, Education, Baby, Home Supplies) and none for Trips › Food & Drinks', () => {
    const words = BUDGET_RULES.map((r) => r[2]).join('|')
    for (const word of ['feltrinelli', 'corso di italiano', 'asilo nido', 'passeggino']) expect(words).not.toContain(word)
    expect(BUDGET_RULES.some((r) => r[1] === '2b571b2a-1676-4c23-ae1c-46ec11613359')).toBe(false)
  })
})
