import { describe, expect, it } from 'vitest'
import { incomeTypeFor, LEGACY_INCOME_CATEGORIES, resolveIncomeCategories } from './incomeCategories'

const cats = [
  { id: 's', name: 'Salary', parent_id: null },
  { id: 'o', name: 'Other', parent_id: null },
  { id: 'bonus', name: 'Bonus', parent_id: 's' },
]

describe('income categories', () => {
  it('before the update, entries fall under the stand-ins by their old type', () => {
    const got = resolveIncomeCategories([{ id: 1, income_type: 'salary' }, { id: 2, income_type: 'other' }], [], true)
    expect(got.map((e) => e.category_id)).toEqual(['legacy-salary', 'legacy-other'])
    expect(LEGACY_INCOME_CATEGORIES.map((c) => c.name)).toEqual(['Salary', 'Other'])
  })
  it('after it, keeps the saved category and fills in missing ones from the old type', () => {
    const got = resolveIncomeCategories(
      [{ id: 1, income_type: 'other', category_id: 'bonus' }, { id: 2, income_type: 'salary', category_id: null }, { id: 3, income_type: 'other', category_id: 'gone' }],
      cats,
      false
    )
    expect(got.map((e) => e.category_id)).toEqual(['bonus', 's', 'o'])
  })
  it('keeps the old type in step', () => {
    expect(incomeTypeFor('s', cats)).toBe('salary')
    expect(incomeTypeFor('bonus', cats)).toBe('salary')
    expect(incomeTypeFor('o', cats)).toBe('other')
    expect(incomeTypeFor(null, cats)).toBe('other')
  })
})
