import { describe, expect, it } from 'vitest'
import { compareCategories, isCatchAll, sortCategories, sortCategoryTree } from './categoryOrder'

const names = (list) => list.map((c) => c.name)

describe('category order: A–Z, catch-alls last', () => {
  it('ignores capitals and accents', () => {
    const list = [{ id: 'b', name: 'Fruit' }, { id: 'a', name: 'éclair' }, { id: 'c', name: 'apples' }, { id: 'd', name: 'Dairy' }]
    expect(names(sortCategories(list))).toEqual(['apples', 'Dairy', 'éclair', 'Fruit'])
  })

  it('puts "Other" last among MONEY mains', () => {
    const list = [{ id: '1', name: 'Groceries' }, { id: '2', name: 'Other' }, { id: '3', name: 'Bank & Fee' }, { id: '4', name: 'Trips & Holidays' }]
    expect(names(sortCategories(list))).toEqual(['Bank & Fee', 'Groceries', 'Trips & Holidays', 'Other'])
  })

  it('puts "Others" last among Shopping subs', () => {
    const list = [{ id: '1', name: 'Others' }, { id: '2', name: 'Gifts' }, { id: '3', name: 'Clothing' }]
    expect(names(sortCategories(list))).toEqual(['Clothing', 'Gifts', 'Others'])
  })

  it('keeps HOME "misc" last even after a rename (found by its id)', () => {
    const list = [{ id: 'misc', name: 'Altro e stagionale' }, { id: 'produce', name: 'Fruit & Vegetables' }, { id: 'baby', name: 'Baby' }]
    expect(sortCategories(list).map((c) => c.id)).toEqual(['baby', 'produce', 'misc'])
    expect(isCatchAll({ id: 'x', name: 'Miscellaneous / Seasonal' })).toBe(true)
    expect(isCatchAll({ id: 'x', name: '  other ' })).toBe(true)
  })

  it('sorts numbers naturally', () => {
    const list = [{ id: '1', name: 'Size 10' }, { id: '2', name: 'Size 2' }]
    expect(names(sortCategories(list))).toEqual(['Size 2', 'Size 10'])
  })

  it('orders the same name by id, so the order never jumps', () => {
    const list = [{ id: 'z', name: 'Frozen Vegetables' }, { id: 'a', name: 'Frozen Vegetables' }]
    expect(sortCategories(list).map((c) => c.id)).toEqual(['a', 'z'])
    expect(compareCategories(list[0], list[1])).toBeGreaterThan(0)
  })

  it('does not change the list it is given', () => {
    const list = [{ id: '2', name: 'B' }, { id: '1', name: 'A' }]
    sortCategories(list)
    expect(names(list)).toEqual(['B', 'A'])
    expect(sortCategories(null)).toEqual([])
  })

  it('a tree: each main A–Z followed by its subs A–Z, catch-alls last at both levels', () => {
    const flat = [
      { id: 'o', name: 'Other', parent_id: null },
      { id: 's', name: 'Shopping', parent_id: null },
      { id: 's1', name: 'Others', parent_id: 's' },
      { id: 's2', name: 'Gifts', parent_id: 's' },
      { id: 'b', name: 'Bank & Fee', parent_id: null },
      { id: 'b1', name: 'Taxes & Fines', parent_id: 'b' },
      { id: 'b2', name: 'Documents & Permits', parent_id: 'b' },
    ]
    expect(names(sortCategoryTree(flat))).toEqual(['Bank & Fee', 'Documents & Permits', 'Taxes & Fines', 'Shopping', 'Gifts', 'Others', 'Other'])
  })
})
