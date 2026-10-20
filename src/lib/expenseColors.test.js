import { describe, expect, it } from 'vitest'
import { assignCategoryColors, categoryStyle, colorDistance, contrast, pickColor, UNCATEGORIZED_COLOR } from './expenseColors'

const cats = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, name: `Cat ${i}`, created_at: `2026-01-${String(i + 1).padStart(2, '0')}` }))

describe('category colors', () => {
  it('gives 12 categories colors that are all clearly different', () => {
    const { colors } = assignCategoryColors(cats(12))
    const list = [...colors.values()]
    expect(new Set(list).size).toBe(12)
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(colorDistance(list[i], list[j])).toBeGreaterThan(27)
    for (const c of list) expect(colorDistance(c, UNCATEGORIZED_COLOR)).toBeGreaterThan(20)
  })

  it('never repeats a color, however many categories there are', () => {
    const { colors } = assignCategoryColors(cats(60))
    expect(new Set(colors.values()).size).toBe(60)
  })

  it('is stable: the same categories always get the same colors, in creation order', () => {
    const a = assignCategoryColors(cats(15)).colors
    const b = assignCategoryColors([...cats(15)].reverse()).colors
    expect([...a]).toEqual([...b])
  })

  it('keeps saved colors, and a new category gets one different from all of them', () => {
    const all = cats(6)
    const { colors, fresh } = assignCategoryColors(all)
    const stored = [...colors].map(([category_id, color]) => ({ category_id, color }))
    const added = [...all, { id: 'new', name: 'New', created_at: '2026-06-01' }]
    const next = assignCategoryColors(added, stored)
    for (const [id, color] of colors) expect(next.colors.get(id)).toBe(color)
    expect(fresh).toHaveLength(6)
    expect(next.fresh).toHaveLength(1)
    const mine = next.colors.get('new')
    for (const color of colors.values()) expect(colorDistance(mine, color)).toBeGreaterThan(27)
  })

  it('does not shift anyone when a category is deleted', () => {
    const all = cats(8)
    const { colors } = assignCategoryColors(all)
    const stored = [...colors].map(([category_id, color]) => ({ category_id, color }))
    const after = assignCategoryColors(all.filter((c) => c.id !== 'c02'), stored).colors
    for (const c of all.filter((c) => c.id !== 'c02')) expect(after.get(c.id)).toBe(colors.get(c.id))
  })

  it('ignores invalid saved colors', () => {
    const { colors } = assignCategoryColors(cats(1), [{ category_id: 'c00', color: 'orange' }])
    expect(colors.get('c00')).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('draws every color readably on the dark surface', () => {
    const used = []
    for (let i = 0; i < 40; i++) used.push(pickColor(used))
    for (const hex of used) {
      const style = categoryStyle(hex)
      expect(contrast(hex, '#1C1E23')).toBeGreaterThanOrEqual(3) // dots, bars, chart slices
      expect(contrast(style.text, '#1C1E23')).toBeGreaterThanOrEqual(4.5) // names in the color
    }
  })
})

describe('sub-categories take their main category\'s color (expenses)', () => {
  const tree = [
    { id: 'going', name: 'Going out', parent_id: null, created_at: '2026-01-01' },
    { id: 'going:bars', name: 'Bars', parent_id: 'going', created_at: '2026-01-02' },
    { id: 'going:food', name: 'Restaurants', parent_id: 'going', created_at: '2026-01-03' },
    { id: 'home', name: 'Home', parent_id: null, created_at: '2026-01-04' },
    { id: 'home:rent', name: 'Rent', parent_id: 'home', created_at: '2026-01-05' },
  ]

  it('shows a sub in its main\'s color and works out colors for mains only', () => {
    const { colors, fresh } = assignCategoryColors(tree, [], { subsFollowMain: true })
    expect(colors.get('going:bars')).toBe(colors.get('going'))
    expect(colors.get('going:food')).toBe(colors.get('going'))
    expect(colors.get('home:rent')).toBe(colors.get('home'))
    expect(colors.get('going')).not.toBe(colors.get('home'))
    expect(fresh.map((f) => f.category_id)).toEqual(['going', 'home'])
  })

  it('ignores colors saved for subs earlier (old expenses change too, the rows stay untouched)', () => {
    const stored = [
      { category_id: 'going', color: '#3B82F6' },
      { category_id: 'going:bars', color: '#EF4444' },
      { category_id: 'home', color: '#22C55E' },
    ]
    const { colors, fresh } = assignCategoryColors(tree, stored, { subsFollowMain: true })
    expect(colors.get('going:bars')).toBe('#3B82F6')
    expect(colors.get('home:rent')).toBe('#22C55E')
    expect(fresh).toEqual([])
  })

  it('leaves income exactly as it is: every sub-category keeps a color of its own', () => {
    const { colors, fresh } = assignCategoryColors(tree, [{ category_id: 'going:bars', color: '#EF4444' }])
    expect(colors.get('going:bars')).toBe('#EF4444')
    expect(new Set(colors.values()).size).toBe(5)
    expect(fresh.map((f) => f.category_id)).toHaveLength(4)
  })

  it('gives a sub whose main is missing a color of its own', () => {
    const { colors } = assignCategoryColors([{ id: 'x', name: 'X', parent_id: 'gone' }], [], { subsFollowMain: true })
    expect(colors.get('x')).toMatch(/^#[0-9A-F]{6}$/)
  })
})
