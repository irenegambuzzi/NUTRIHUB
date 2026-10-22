import { describe, expect, it } from 'vitest'
import { deleteProblem, moveProblem, renameProblem } from './categoryEdit'

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

describe('deleteProblem', () => {
  const withHome = [...cats, { id: 'h', name: 'Home & Appliances', parent_id: null }, { id: 'hs', name: 'Home & Appliances', parent_id: 'g' }]

  it("refuses Home & Appliances (Confirm purchase books durable items under it)", () => {
    expect(deleteProblem(withHome, 'h', ['Home & Appliances'])).toBe('"Home & Appliances" can\'t be deleted.')
  })

  it('refuses any locked main category, but not a sub-category with the same name', () => {
    expect(deleteProblem(withHome, 'o', ['Other'])).toMatch(/can't be deleted/)
    expect(deleteProblem(withHome, 'hs', ['Home & Appliances'])).toBeNull()
  })

  it('lets other categories be deleted, and reports a missing one', () => {
    expect(deleteProblem(withHome, 'a', ['Home & Appliances'])).toBeNull()
    expect(deleteProblem(withHome, 'nope', [])).toBe('This category no longer exists.')
  })
})

describe('round 6C2: the Trips main is found by id (rename free, move and delete locked)', () => {
  const TRIPS = 'dc79f604-19fd-4bdd-817e-335816c4afe7'
  const withTrips = [...cats, { id: TRIPS, name: 'Travel', parent_id: null }, { id: 'flights', name: 'Flights', parent_id: TRIPS }]

  it('refuses moving or deleting it, whatever its name is now', () => {
    expect(moveProblem(withTrips, TRIPS, 'g', locked, [TRIPS])).toBe('"Travel" can\'t be moved.')
    expect(deleteProblem(withTrips, TRIPS, ['Home & Appliances'], [TRIPS])).toBe('"Travel" can\'t be deleted.')
  })

  it('allows renaming it', () => {
    expect(renameProblem(withTrips, TRIPS, 'Trips & Holidays', locked)).toBeNull()
  })

  it('its sub-categories stay free, and others can still move under it', () => {
    expect(moveProblem(withTrips, 'flights', 'g', locked, [TRIPS])).toBeNull()
    expect(deleteProblem(withTrips, 'flights', [], [TRIPS])).toBeNull()
    expect(moveProblem(withTrips, 'a', TRIPS, locked, [TRIPS])).toBeNull()
  })
})
