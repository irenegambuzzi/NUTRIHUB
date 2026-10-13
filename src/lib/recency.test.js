import { describe, expect, it } from 'vitest'
import { newestGroupFirst, sortNewestFirst } from './recency'

const date = (e) => e.date
const e = (id, d, created_at) => ({ id, date: d, created_at })

describe('sortNewestFirst', () => {
  it('puts the newest date first, and on the same date the last entered first', () => {
    const list = [e('a', '2026-10-05', '2026-10-05T09:00:00+00:00'), e('b', '2026-10-12', '2026-10-12T08:00:00+00:00'), e('c', '2026-10-05', '2026-10-05T20:00:00+00:00')]
    expect(sortNewestFirst(list, date).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
  it('goes by the entry date even when an older date was entered later', () => {
    const list = [e('old-date-entered-now', '2026-09-01', '2026-10-13T10:00:00+00:00'), e('recent', '2026-10-12', '2026-10-12T08:00:00+00:00')]
    expect(sortNewestFirst(list, date).map((x) => x.id)).toEqual(['recent', 'old-date-entered-now'])
  })
  it('compares times, not text (different offsets and precision)', () => {
    const list = [e('a', '2026-10-05', '2026-10-05T10:00:00+02:00'), e('b', '2026-10-05', '2026-10-05T09:30:00.123456+00:00')]
    expect(sortNewestFirst(list, date).map((x) => x.id)).toEqual(['b', 'a'])
  })
  it('puts rows with no creation time after those with one, in their old order, without errors', () => {
    const list = [e('none1', '2026-10-05', null), e('has', '2026-10-05', '2026-10-05T09:00:00+00:00'), e('none2', '2026-10-05', undefined), e('bad', '2026-10-05', 'garbage')]
    expect(sortNewestFirst(list, date).map((x) => x.id)).toEqual(['has', 'none1', 'none2', 'bad'])
  })
  it('does not change the list it is given', () => {
    const list = [e('a', '2026-10-01', null), e('b', '2026-10-02', null)]
    sortNewestFirst(list, date)
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('newestGroupFirst', () => {
  it('orders groups by their most recent entry', () => {
    const groups = [
      { name: 'big but old', items: [e('1', '2026-10-01', '2026-10-01T09:00:00+00:00')] },
      { name: 'small but newest', items: [e('2', '2026-10-05', '2026-10-05T09:00:00+00:00'), e('3', '2026-09-01', null)] },
      { name: 'same day, entered later', items: [e('4', '2026-10-05', '2026-10-05T18:00:00+00:00')] },
    ]
    expect([...groups].sort(newestGroupFirst(date, (g) => g.items)).map((g) => g.name)).toEqual(['same day, entered later', 'small but newest', 'big but old'])
  })
})
