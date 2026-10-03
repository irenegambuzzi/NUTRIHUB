import { afterEach, describe, expect, it } from 'vitest'
import { RECEIPT_MATCHERS, findMismatches, suggestionChange } from './receiptMatch'

afterEach(() => RECEIPT_MATCHERS.splice(0))

describe('receipt vs cart (for later)', () => {
  it('finds nothing until a matcher is added', () => {
    expect(findMismatches([{ description: 'Latte', amount: 1.2 }], [])).toEqual([])
  })

  it('uses a matcher once there is one', () => {
    RECEIPT_MATCHERS.push({ name: 'test', match: () => [{ kind: 'not-on-receipt', itemId: 'g1', suggestion: { action: 'remove' } }] })
    expect(findMismatches([{ description: 'Latte', amount: 1.2 }], [{ id: 'g1' }])).toHaveLength(1)
  })

  it('turns each approved suggestion into a change the confirm screen can make', () => {
    expect(suggestionChange({ kind: 'price', itemId: 'g1', suggestion: { action: 'adjust', total: 2.5 } })).toEqual({ type: 'price', itemId: 'g1', total: 2.5 })
    expect(suggestionChange({ kind: 'quantity', itemId: 'g1', suggestion: { action: 'adjust', quantity: 3 } })).toEqual({ type: 'update', itemId: 'g1', patch: { quantity: 3 } })
    expect(suggestionChange({ kind: 'not-on-receipt', itemId: 'g1', suggestion: { action: 'remove' } })).toEqual({ type: 'remove', itemId: 'g1' })
    expect(
      suggestionChange({ kind: 'not-in-cart', receipt: {}, suggestion: { action: 'add', name: 'Bread', quantity: 1, unit: 'pcs', total: 1.1 } })
    ).toEqual({ type: 'add', item: { name: 'Bread', quantity: 1, unit: 'pcs', total: 1.1 } })
  })
})
