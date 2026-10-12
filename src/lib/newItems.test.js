import { describe, expect, it } from 'vitest'
import { NEW_ITEM_SINCE, isNewItem } from './newItems'

const after = '2026-10-15T08:00:00Z'
const later = '2026-10-16T08:00:00Z'
const item = { id: 'a', created_at: after }

describe('isNewItem', () => {
  it('is new from the moment it enters HOME', () => {
    expect(isNewItem(item, [])).toBe(true)
  })
  it('stops being new once it is bought or restocked afterwards', () => {
    expect(isNewItem(item, [{ item_id: 'a', created_at: later }])).toBe(false)
  })
  it('ignores the purchase that created it and other items', () => {
    expect(isNewItem(item, [{ item_id: 'a', created_at: after }, { item_id: 'b', created_at: later }])).toBe(true)
  })
  it('counts a purchase made the moment the item was created as its entry (a variant made on the spot)', () => {
    expect(isNewItem(item, [{ item_id: 'a', created_at: '2026-10-15T08:00:02Z' }])).toBe(true)
    expect(isNewItem(item, [{ item_id: 'a', created_at: '2026-10-15T08:01:00Z' }])).toBe(false)
  })
  it('never counts items that existed before this update', () => {
    expect(isNewItem({ id: 'a', created_at: '2026-01-01T00:00:00Z' }, [])).toBe(false)
    expect(isNewItem({ id: 'a', created_at: NEW_ITEM_SINCE }, [])).toBe(true)
  })
})
