import { describe, expect, it } from 'vitest'
import { joinablePurchases, mergeErrorMessage, mergeProblem, mergeStore, selectBlock } from './merge'

const e = (id, patch = {}) => ({ id, amount: 5, expense_date: '2026-10-14', paid_by: 'irene', shop_id: null, trip_id: null, ...patch })

describe('which expenses can be ticked', () => {
  it('only single expenses: not one of a purchase, not an online order', () => {
    expect(selectBlock(e('a'))).toBeNull()
    expect(selectBlock(e('b', { trip_id: 't1' }))).toBe('In a purchase')
    expect(selectBlock(e('c'), new Set(['c']))).toBe('Online order')
  })
})

describe('merging into a new purchase', () => {
  it('is allowed for two or more of the same day and payer', () => {
    expect(mergeProblem([e('a'), e('b'), e('c', { shop_id: 'lidl' })])).toBeNull()
  })
  it('is refused with a clear reason otherwise', () => {
    expect(mergeProblem([e('a')])).toMatch(/at least two/)
    expect(mergeProblem([e('a'), e('b', { expense_date: '2026-10-15' })])).toBe('Only expenses of the same day can be merged — these are on 14/10/2026, 15/10/2026.')
    expect(mergeProblem([e('a'), e('b', { paid_by: 'akbar' })])).toBe('Only expenses paid by the same person can be merged — these are paid by Irene and Akbar.')
  })
  it('one alone can join an existing purchase', () => {
    expect(mergeProblem([e('a')], { existing: true })).toBeNull()
    expect(mergeProblem([], { existing: true })).toMatch(/at least one/)
  })
})

describe('the store of the new purchase', () => {
  it('is prefilled when all share one', () => {
    expect(mergeStore([e('a', { shop_id: 'conad' }), e('b', { shop_id: 'conad' })])).toEqual({ shopId: 'conad', mustChoose: false })
  })
  it('must be chosen when they differ or have none', () => {
    expect(mergeStore([e('a', { shop_id: 'conad' }), e('b'), e('c', { shop_id: 'lidl' })])).toEqual({ shopId: '', mustChoose: true })
    expect(mergeStore([e('a'), e('b')])).toEqual({ shopId: '', mustChoose: true })
  })
})

describe('adding to an existing purchase', () => {
  const trips = [
    { id: 'same', trip_date: '2026-10-14', paid_by: 'irene' },
    { id: 'mixed', trip_date: '2026-10-14', paid_by: null },
    { id: 'other-day', trip_date: '2026-10-13', paid_by: 'irene' },
    { id: 'akbar', trip_date: '2026-10-14', paid_by: 'akbar' },
  ]
  const expenses = [
    e('x1', { trip_id: 'same' }),
    e('x2', { trip_id: 'mixed' }),
    e('x3', { trip_id: 'mixed', paid_by: 'akbar' }),
    e('x4', { trip_id: 'other-day', expense_date: '2026-10-13' }),
    e('x5', { trip_id: 'akbar', paid_by: 'akbar' }),
  ]
  it('lists only purchases of the same day paid only by the same person', () => {
    expect(joinablePurchases([e('a'), e('b')], trips, expenses).map((t) => t.id)).toEqual(['same'])
    expect(joinablePurchases([e('a')], trips, expenses).map((t) => t.id)).toEqual(['same'])
  })
  it('none when the ticked ones can\'t go together', () => {
    expect(joinablePurchases([e('a'), e('b', { paid_by: 'akbar' })], trips, expenses)).toEqual([])
  })
})

describe('two phones merging the same expenses', () => {
  it('the second is told plainly that nothing changed', () => {
    expect(mergeErrorMessage('"Bread" is already part of a purchase — only single expenses can be merged.')).toMatch(/merged on the other phone — nothing was changed/)
    expect(mergeErrorMessage('Only expenses of the same day can be merged into one purchase.')).toBe('Only expenses of the same day can be merged into one purchase.')
  })
})
