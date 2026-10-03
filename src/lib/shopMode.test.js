import { describe, expect, it } from 'vitest'
import { categoryKey, groupByCategory, itemKey, moveCategoryWrites, moveItemWrites, positionsFrom, routeOrder } from './shopMode'

const defaultOrder = ['produce', 'snacks', 'meat', 'dairy']
const item = (name, category_id) => ({ id: name, name, category_id })
// The example from the shop: fruit & veg, snacks, beef steak, sausages,
// yogurt, then chicken.
const items = [
  item('Chicken', 'meat'),
  item('Yogurt', 'dairy'),
  item('Apples', 'produce'),
  item('Steak', 'meat'),
  item('Chips', 'snacks'),
  item('Sausages', 'meat'),
]
const names = (list) => list.map((i) => i.name)

describe('routeOrder', () => {
  it('starts in category order, by name within a category', () => {
    expect(names(routeOrder(items, new Map(), defaultOrder))).toEqual(['Apples', 'Chips', 'Chicken', 'Sausages', 'Steak', 'Yogurt'])
  })

  it('puts items anywhere, whatever their category', () => {
    const positions = positionsFrom([
      { id: itemKey('Steak'), position: 2500 },
      { id: itemKey('Sausages'), position: 2600 },
      { id: itemKey('Yogurt'), position: 2700 },
      { id: itemKey('Chicken'), position: 2800 },
    ])
    expect(names(routeOrder(items, positions, defaultOrder))).toEqual(['Apples', 'Chips', 'Steak', 'Sausages', 'Yogurt', 'Chicken'])
  })

  it('keeps a place by name, so it holds on the next shopping trip', () => {
    const positions = positionsFrom([{ id: itemKey('Chicken'), position: 1 }])
    expect(routeOrder([item('chicken ', 'meat'), item('Apples', 'produce')], positions, defaultOrder)[0].name).toBe('chicken ')
  })

  it('puts new items where their category is', () => {
    const positions = positionsFrom([{ id: categoryKey('dairy'), position: 1500 }])
    expect(names(routeOrder([item('Milk', 'dairy'), item('Chips', 'snacks'), item('Apples', 'produce')], positions, defaultOrder))).toEqual(['Apples', 'Milk', 'Chips'])
  })
})

describe('moveItemWrites', () => {
  it('saves one position between the new neighbours', () => {
    const positions = positionsFrom([
      { id: itemKey('A'), position: 100 },
      { id: itemKey('B'), position: 200 },
      { id: itemKey('C'), position: 300 },
    ])
    const list = [item('A', null), item('B', null), item('C', null)]
    expect(moveItemWrites(list, 2, 0, positions, [])).toEqual([{ id: itemKey('C'), position: -900 }])
    expect(moveItemWrites(list, 0, 1, positions, [])).toEqual([{ id: itemKey('A'), position: 250 }])
    expect(moveItemWrites(list, 0, 2, positions, [])).toEqual([{ id: itemKey('A'), position: 1300 }])
  })

  it('numbers the shown items afresh when there is no room in between', () => {
    // All three are still at their category's place.
    const list = [item('Chicken', 'meat'), item('Sausages', 'meat'), item('Steak', 'meat')]
    const writes = moveItemWrites(list, 2, 1, new Map(), defaultOrder)
    expect(writes).toHaveLength(3)
    const moved = routeOrder(list, positionsFrom(writes), defaultOrder)
    expect(names(moved)).toEqual(['Chicken', 'Steak', 'Sausages'])
  })

  it('needs just one position to move to the very top', () => {
    const list = [item('Chicken', 'meat'), item('Sausages', 'meat'), item('Steak', 'meat')]
    const writes = moveItemWrites(list, 2, 0, new Map(), defaultOrder)
    expect(writes).toHaveLength(1)
    expect(names(routeOrder(list, positionsFrom(writes), defaultOrder))).toEqual(['Steak', 'Chicken', 'Sausages'])
  })

  it('does nothing for a drop in the same place', () => {
    expect(moveItemWrites(items, 1, 1, new Map(), defaultOrder)).toEqual([])
  })
})

describe('categories', () => {
  it('groups by category in aisle order', () => {
    const positions = positionsFrom([{ id: categoryKey('dairy'), position: 1 }])
    expect(groupByCategory(items, positions, defaultOrder).map((g) => g.categoryId)).toEqual(['dairy', 'produce', 'snacks', 'meat'])
  })

  it('moves a category by swapping places with its neighbour', () => {
    const writes = moveCategoryWrites(['produce', 'snacks', 'meat'], 'meat', -1, new Map(), defaultOrder)
    const order = groupByCategory(items, positionsFrom(writes), defaultOrder).map((g) => g.categoryId)
    expect(order).toEqual(['produce', 'meat', 'snacks', 'dairy'])
  })
})
