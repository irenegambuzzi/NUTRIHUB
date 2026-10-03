import { describe, expect, it } from 'vitest'
import { goneSummary, tripState } from './trips'

const items = [
  { id: 'i1', name: 'Tea', line_total: 2, expense_id: 'e1', pantry_item_id: null, stock_added: 2, pantry_created: false },
  { id: 'i2', name: 'Soap', line_total: 4, expense_id: null, pantry_item_id: 'p2', stock_added: 2, pantry_created: false },
  { id: 'i3', name: 'Kettle', line_total: 25, expense_id: 'e3', pantry_item_id: null, stock_added: 0, pantry_created: false },
]
const expenses = [
  { id: 'e1', amount: 2 },
  { id: 'e3', amount: 25 },
]

describe('a purchase after parts were deleted by hand', () => {
  it('totals only what is really left', () => {
    const state = tripState(items, expenses)
    expect(state.total).toBe(27)
    expect(state.lines.map((l) => l.amount)).toEqual([2, 0, 25])
  })

  it('marks deleted expenses and pantry items, but not appliances (which never had stock)', () => {
    const state = tripState(items, expenses)
    expect(state.lines.map((l) => [l.expenseGone, l.pantryGone])).toEqual([
      [false, true],
      [true, false],
      [false, false],
    ])
    expect(state.incomplete).toBe(true)
    expect(goneSummary(state.lines)).toBe('Already deleted by hand, so not undone: Tea (pantry item), Soap (expense).')
  })

  it('is complete when nothing was deleted', () => {
    const whole = [{ id: 'i', name: 'Milk', line_total: 2, expense_id: 'e', pantry_item_id: 'p', stock_added: 1 }]
    expect(tripState(whole, [{ id: 'e', amount: 2 }])).toMatchObject({ total: 2, incomplete: false })
    expect(goneSummary(tripState(whole, [{ id: 'e', amount: 2 }]).lines)).toBeNull()
  })
})
