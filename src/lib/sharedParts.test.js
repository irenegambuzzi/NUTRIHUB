import { describe, expect, it } from 'vitest'
import { PAID_BY_OPTIONS } from '../data/constants'
import {
  applyFix,
  checkSplit,
  emptySplit,
  hasParts,
  missingPartsColumn,
  partColumn,
  partFields,
  partOfText,
  partsColumnsReady,
  partsLine,
  PARTS_NOTICE,
  PEOPLE,
  personalExpenses,
  realExpense,
  scaleParts,
  shownParts,
  splitEqually,
  splitFrom,
  spreadParts,
  staleNote,
  storedParts,
  typePart,
  withoutPartsNote,
} from './sharedParts'

// The payers are read from PAID_BY_OPTIONS (never written out): the two
// people in their order, and their labels.
const [P1, P2] = PEOPLE
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const [L1, L2] = [label(P1), label(P2)]
const SHARED_LABEL = label('shared')
const both = [
  [P1, P2],
  [P2, P1],
]
const withParts = (amount, a, b, extra = {}) => ({ id: 'e1', paid_by: 'shared', amount, [partColumn(P1)]: a, [partColumn(P2)]: b, ...extra })

describe('who the parts are for', () => {
  it('the two people are the payers of PAID_BY_OPTIONS other than Shared, and name the columns', () => {
    expect(PEOPLE).toEqual(PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared'))
    expect(PEOPLE).toHaveLength(2)
    expect(partColumn(P1)).toBe(`part_${P1}`)
    expect(PARTS_NOTICE).toBe('This needs the database update supabase/029_shared_parts.sql')
  })

  it('029 is seen on rows read with all their columns (also empty); before it, never', () => {
    expect(partsColumnsReady([])).toBe(false)
    expect(partsColumnsReady([{ id: 'a', amount: 3 }])).toBe(false)
    expect(partsColumnsReady([{ id: 'a', amount: 3, [partColumn(P1)]: null, [partColumn(P2)]: null }])).toBe(true)
    expect(missingPartsColumn({ code: 'PGRST204', message: `Could not find the '${partColumn(P1)}' column of 'expenses'` })).toBe(true)
    expect(missingPartsColumn({ code: '42703', message: `column "${partColumn(P2)}" does not exist` })).toBe(true)
    expect(missingPartsColumn({ code: '42703', message: 'column "pack_size" does not exist' })).toBe(false)
  })

  it('stored parts: both filled, else none; only a Shared expense "has parts"', () => {
    expect(storedParts(withParts(268.58, 100, 168.58))).toEqual({ [P1]: 100, [P2]: 168.58 })
    expect(storedParts(withParts(268.58, '100.00', '168.58'))).toEqual({ [P1]: 100, [P2]: 168.58 })
    expect(storedParts(withParts(268.58, 100, null))).toBeNull()
    expect(storedParts({ id: 'x', amount: 4 })).toBeNull()
    expect(hasParts(withParts(268.58, 100, 168.58))).toBe(true)
    expect(hasParts(withParts(268.58, 100, 168.58, { paid_by: P1 }))).toBe(false)
  })
})

describe('the 27/10 bill (€268.58 = €100.00 + €168.58), whoever paid which', () => {
  it.each(both)('personal views: the one who paid €100.00 (%s here) sees "of €268.58", the other (%s) €168.58; Everyone and Shared whole', (p100, p168) => {
    const bill = withParts(268.58, 0, 0, { id: 'bill', description: 'SPESE CONDOMINIO', [partColumn(p100)]: 100, [partColumn(p168)]: 168.58 })
    const own = { id: 'own', paid_by: p100, amount: 12.5 }
    const other = { id: 'other', paid_by: p168, amount: 7 }
    const list = [bill, own, other]
    const mine = personalExpenses(list, p100)
    expect(mine.map((e) => [e.id, e.amount])).toEqual([
      ['bill', 100],
      ['own', 12.5],
    ])
    expect(partOfText(mine[0])).toBe('of €268.58')
    expect(realExpense(mine[0])).toBe(bill)
    expect(realExpense(own)).toBe(own)
    expect(personalExpenses(list, p168).map((e) => [e.id, e.amount])).toEqual([
      ['bill', 168.58],
      ['other', 7],
    ])
    expect(personalExpenses(list, 'all')).toBe(list)
    expect(personalExpenses(list, 'shared')).toEqual([bill])
    // The two personal views together are Everyone.
    const sum = (rows) => Math.round(rows.reduce((s, e) => s + e.amount, 0) * 100) / 100
    expect(sum([...personalExpenses(list, p100), ...personalExpenses(list, p168)])).toBe(sum(list))
  })

  it('a Shared expense without parts is in no personal view, and the note says so (K4)', () => {
    const old = { id: 'old', paid_by: 'shared', amount: 268.58 }
    expect(personalExpenses([old], P1)).toEqual([])
    expect(withoutPartsNote([old])).toBe(`1 ${SHARED_LABEL} expense without parts (€268.58) is not in this total.`)
    expect(withoutPartsNote([old, { id: 'o2', paid_by: 'shared', amount: 31.42 }, withParts(10, 4, 6), { id: 'x', paid_by: P2, amount: 9 }])).toBe(
      `2 ${SHARED_LABEL} expenses without parts (€300.00) are not in this total.`
    )
    expect(withoutPartsNote([withParts(10, 4, 6)])).toBe('')
  })

  it('the parts line under the row', () => {
    expect(partsLine(withParts(268.58, 100, 168.58))).toBe(`${L1} €100.00 · ${L2} €168.58`)
    expect(partsLine({ paid_by: 'shared', amount: 3 })).toBe('')
  })
})

describe('an amount changed by another path (K9): shown scaled, with an amber note', () => {
  it('€268.58 → €260.00: scaled in proportion, the rest to the second person; the stored parts stay', () => {
    const bill = withParts(260, 100, 168.58)
    expect(shownParts(bill)).toEqual({ parts: { [P1]: 96.81, [P2]: 163.19 }, stale: true, storedTotal: 268.58, amount: 260 })
    expect(staleNote(bill)).toBe('Parts were for €268.58 — the expense is now €260.00. Edit to check.')
    expect(personalExpenses([bill], P1)[0].amount).toBe(96.81)
    expect(personalExpenses([bill], P2)[0].amount).toBe(163.19)
    expect(storedParts(bill)).toEqual({ [P1]: 100, [P2]: 168.58 })
  })

  it('parts that add up are shown as they are, without a note; 0 / 0 for an amount gives it all to the second person', () => {
    expect(staleNote(withParts(268.58, 100, 168.58))).toBe('')
    expect(scaleParts({ [P1]: 10, [P2]: 20 }, 30)).toEqual({ [P1]: 10, [P2]: 20 })
    expect(scaleParts({ [P1]: 0, [P2]: 0 }, 12)).toEqual({ [P1]: 0, [P2]: 12 })
    expect(scaleParts({ [P1]: 1, [P2]: 2 }, 10)).toEqual({ [P1]: 3.33, [P2]: 6.67 })
  })
})

describe('the two fields: typing one fills the other, Split equally, the refusals and the one-tap fix', () => {
  it('typing one fills the other with the rest, until the other is typed by hand', () => {
    let split = typePart(emptySplit(), P1, '100', 268.58)
    expect(split.texts).toEqual({ [P1]: '100', [P2]: '168.58' })
    split = typePart(split, P1, '100,5', 268.58)
    expect(split.texts[P2]).toBe('168.08')
    split = typePart(split, P2, '160', 268.58)
    expect(split.texts).toEqual({ [P1]: '100,5', [P2]: '160' })
    // Now both are typed by hand: changing one leaves the other.
    split = typePart(split, P1, '90', 268.58)
    expect(split.texts).toEqual({ [P1]: '90', [P2]: '160' })
    // More than the total, or not a number: the other is left empty.
    expect(typePart(emptySplit(), P2, '300', 268.58).texts[P1]).toBe('')
    expect(typePart(emptySplit(), P2, '1x', 268.58).texts[P1]).toBe('')
  })

  it('Split equally: both halves, the odd cent to the second person (nothing is prefilled before it)', () => {
    expect(emptySplit().texts).toEqual({ [P1]: '', [P2]: '' })
    expect(splitEqually(268.58).texts).toEqual({ [P1]: '134.29', [P2]: '134.29' })
    expect(splitEqually(10.01).texts).toEqual({ [P1]: '5.00', [P2]: '5.01' })
    expect(checkSplit(splitEqually(10.01), 10.01).parts).toEqual({ [P1]: 5, [P2]: 5.01 })
  })

  it('required: nothing typed is refused; not required (an old Shared expense), nothing typed is fine', () => {
    expect(checkSplit(emptySplit(), 268.58).problem).toBe(`Type what ${L1} and ${L2} paid.`)
    expect(checkSplit(emptySplit(), 268.58, { required: false })).toEqual({ problem: '', fix: null, hint: '', parts: null })
    // Nothing to share (a free item, or no total yet): nothing needed.
    expect(checkSplit(emptySplit(), 0).problem).toBe('')
    expect(checkSplit(emptySplit(), NaN).problem).toBe('')
  })

  it('not adding up: refused, and "Put the difference on {label}" fixes it on the field not typed last', () => {
    const split = { texts: { [P1]: '100', [P2]: '160' }, typed: { [P1]: true, [P2]: true }, last: P1 }
    const check = checkSplit(split, 268.58)
    expect(check.problem).toBe('The parts add up to €260.00, not €268.58.')
    expect(check.fix).toEqual({ code: P2, text: '168.58', label: `Put the difference on ${L2}` })
    expect(checkSplit(applyFix(split, check.fix), 268.58)).toEqual({ problem: '', fix: null, hint: '', parts: { [P1]: 100, [P2]: 168.58 } })
    // Typed last on the second: the difference goes on the first.
    expect(checkSplit({ ...split, last: P2 }, 268.58).fix).toEqual({ code: P1, text: '108.58', label: `Put the difference on ${L1}` })
    // Neither typed last (Split equally, then the total changed): the second person.
    expect(checkSplit(splitEqually(268.58), 270).fix).toMatchObject({ code: P2, text: '135.71' })
  })

  it('each part ≥ 0 and ≤ the total; one empty asks for it (with the fix); a typo is refused', () => {
    expect(checkSplit({ texts: { [P1]: '300', [P2]: '' }, typed: {}, last: P1 }, 268.58).problem).toBe(`The part of ${L1} (€300.00) is more than the total (€268.58).`)
    const one = checkSplit({ texts: { [P1]: '', [P2]: '168.58' }, typed: { [P2]: true }, last: P2 }, 268.58)
    expect(one.problem).toBe(`Type what ${L1} paid too.`)
    expect(one.fix).toMatchObject({ code: P1, text: '100.00' })
    expect(checkSplit({ texts: { [P1]: '-5', [P2]: '273.58' }, typed: {}, last: null }, 268.58).problem).toBe('Type each part as a number, like 100 or 168,58.')
    expect(checkSplit({ texts: { [P1]: '1o0', [P2]: '168.58' }, typed: {}, last: null }, 268.58).problem).toBe('Type each part as a number, like 100 or 168,58.')
  })

  it('a part of €0 is allowed, with a hint (K10)', () => {
    const check = checkSplit({ texts: { [P1]: '0', [P2]: '268.58' }, typed: {}, last: P1 }, 268.58)
    expect(check.problem).toBe('')
    expect(check.parts).toEqual({ [P1]: 0, [P2]: 268.58 })
    expect(check.hint).toBe(`Only ${L2} paid — you could choose Paid by ${L2} instead.`)
  })

  it('Edit expense starts from the parts kept', () => {
    expect(splitFrom({ [P1]: 100, [P2]: 168.58 }).texts).toEqual({ [P1]: '100.00', [P2]: '168.58' })
  })
})

describe('one split for a whole purchase, spread over its lines (K7)', () => {
  const check = (lines, parts) => {
    const spread = spreadParts(lines, parts)
    // Every line adds up; both totals are what was typed.
    spread.forEach((p, i) => {
      if (!p) return
      expect(p[P1]).toBeGreaterThanOrEqual(0)
      expect(p[P2]).toBeGreaterThanOrEqual(0)
      expect(Math.round((p[P1] + p[P2]) * 100) / 100).toBe(lines[i])
    })
    const total = (code) => Math.round(spread.filter(Boolean).reduce((s, p) => s + p[code], 0) * 100) / 100
    expect([total(P1), total(P2)]).toEqual([parts[P1], parts[P2]])
    return spread
  }

  it('Lidl: 8.70 + 7.31 + 17.39 = 33.40 (after an item discount and a coupon), paid 20.00 + 13.40', () => {
    expect(check([8.7, 7.31, 17.39], { [P1]: 20, [P2]: 13.4 })).toEqual([
      { [P1]: 5.21, [P2]: 3.49 },
      { [P1]: 4.38, [P2]: 2.93 },
      { [P1]: 10.41, [P2]: 6.98 },
    ])
  })

  it('a free line (€0) takes no part; the cents left go to the last line', () => {
    expect(check([10, 0, 10, 10], { [P1]: 10, [P2]: 20 })).toEqual([{ [P1]: 3.33, [P2]: 6.67 }, null, { [P1]: 3.33, [P2]: 6.67 }, { [P1]: 3.34, [P2]: 6.66 }])
  })

  it('the last line too small for the cents: the line before takes them', () => {
    check([99.99, 0.01], { [P1]: 50, [P2]: 50 })
    check([0.01, 0.01, 0.01], { [P1]: 0.02, [P2]: 0.01 })
  })

  it('the 27/10 numbers over two lines, both ways round; one person paid all', () => {
    check([200, 68.58], { [P1]: 100, [P2]: 168.58 })
    check([200, 68.58], { [P1]: 168.58, [P2]: 100 })
    expect(check([12.4, 3.1], { [P1]: 0, [P2]: 15.5 })).toEqual([
      { [P1]: 0, [P2]: 12.4 },
      { [P1]: 0, [P2]: 3.1 },
    ])
  })

  it('what a line sends', () => {
    expect(partFields({ [P1]: 5.21, [P2]: 3.49 })).toEqual({ [partColumn(P1)]: 5.21, [partColumn(P2)]: 3.49 })
    expect(partFields(null)).toEqual({})
  })
})
