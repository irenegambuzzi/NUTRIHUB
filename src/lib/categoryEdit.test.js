import { describe, expect, it } from 'vitest'
import { moveProblem, renameProblem } from './categoryEdit'

const cats = [
  { id: 'o', name: 'Other', parent_id: null },
  { id: 'g', name: 'Going Out', parent_id: null },
  { id: 'a', name: 'Aperitivo', parent_id: null },
  { id: 'b', name: 'Bars', parent_id: 'g' },
  { id: 'f', name: 'Food', parent_id: null },
  { id: 'fs', name: 'Snacks', parent_id: 'f' },
]
const locked = ['Other']

describe('renameProblem', () => {
  it('allows a free name, also changing only the case of its own', () => {
    expect(renameProblem(cats, 'a', 'Drinks', locked)).toBeNull()
    expect(renameProblem(cats, 'a', 'aperitivo', locked)).toBeNull()
  })
  it('refuses a taken name (any case) and an empty one', () => {
    expect(renameProblem(cats, 'a', ' going out ', locked)).toMatch(/already exists/)
    expect(renameProblem(cats, 'a', 'Snacks', locked)).toMatch(/already exists/)
    expect(renameProblem(cats, 'a', '  ', locked)).toBeTruthy()
  })
  it('never renames a locked main category', () => {
    expect(renameProblem(cats, 'o', 'Misc', locked)).toMatch(/can't be renamed/)
  })
})

describe('moveProblem', () => {
  it('turns a childless main category into a sub-category', () => {
    expect(moveProblem(cats, 'a', 'g', locked)).toBeNull()
  })
  it('moves a sub-category elsewhere or makes it a main category', () => {
    expect(moveProblem(cats, 'b', 'f', locked)).toBeNull()
    expect(moveProblem(cats, 'b', null, locked)).toBeNull()
  })
  it('refuses a main category that still has sub-categories', () => {
    expect(moveProblem(cats, 'f', 'g', locked)).toMatch(/Move those first/)
  })
  it('refuses Other, itself, a sub-category as parent, and no change', () => {
    expect(moveProblem(cats, 'o', 'g', locked)).toMatch(/can't be moved/)
    expect(moveProblem(cats, 'a', 'a', locked)).toBeTruthy()
    expect(moveProblem(cats, 'a', 'b', locked)).toBeTruthy()
    expect(moveProblem(cats, 'b', 'g', locked)).toBeTruthy()
  })
})
