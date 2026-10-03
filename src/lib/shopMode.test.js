import { describe, expect, it } from 'vitest'
import { groupByCategory, mergeOrder, moveCategory } from './shopMode'

const items = [
  { id: 1, name: 'Milk', category_id: 'beverages' },
  { id: 2, name: 'Apples', category_id: 'fruit' },
  { id: 3, name: 'Bread', category_id: 'bakery' },
  { id: 4, name: 'Mystery', category_id: null },
  { id: 5, name: 'Beer', category_id: 'beverages' },
]

describe('groupByCategory', () => {
  it('follows the saved aisle order, then the usual order, then no category', () => {
    const groups = groupByCategory(items, ['fruit'], ['bakery', 'beverages', 'fruit'])
    expect(groups.map((g) => g.categoryId)).toEqual(['fruit', 'bakery', 'beverages', null])
  })

  it('sorts items by name within a category', () => {
    const beverages = groupByCategory(items, [], []).find((g) => g.categoryId === 'beverages')
    expect(beverages.items.map((i) => i.name)).toEqual(['Beer', 'Milk'])
  })
})

describe('moveCategory and mergeOrder', () => {
  it('moves one place and stays in bounds', () => {
    expect(moveCategory(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveCategory(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
  })

  it("keeps the place of categories that aren't on today's list", () => {
    expect(mergeOrder(['b', 'a'], ['x', 'a', 'b'])).toEqual(['b', 'a', 'x'])
  })
})
