import { describe, expect, it } from 'vitest'
import { checkNewName, defaultNewBudget, mappingToStore, titleCase } from './newCategory'

const home = [
  { id: 'dairy', name: 'Dairy & Eggs', parent_id: null, type: 'parent' },
  { id: 'pets', name: 'Pets', parent_id: null, type: 'parent' },
  { id: 'gifts', name: 'Gifts', parent_id: 'holiday', type: 'sub' },
  { id: 'holiday', name: 'Holiday', parent_id: null, type: 'parent' },
]
// MONEY: "Gifts" lives under Shopping; HOME has its own "Gifts" under Holiday.
const money = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'shopping', name: 'Shopping', parent_id: null },
  { id: 'm-gifts', name: 'Gifts', parent_id: 'shopping' },
  { id: 'm-pets', name: 'pets ', parent_id: null },
  { id: 'trips', name: 'Trips', parent_id: null },
]

describe('naming a new MONEY category', () => {
  it('"Gifts already exists in Shopping" with free names to tap, nothing created', () => {
    const check = checkNewName({ kind: 'money', name: 'Gifts', categories: money, mainName: 'Trips' })
    expect(check.problem).toBe('Gifts already exists in Shopping')
    expect(check.suggestions).toEqual(['Trips Gifts', 'Souvenirs'])
  })

  it('is unique across all levels, ignoring capitals and spaces', () => {
    expect(checkNewName({ kind: 'money', name: ' SHOPPING ', categories: money }).problem).toBe('SHOPPING already exists as a main category')
  })

  it('every suggestion is free', () => {
    const more = [...money, { id: 'x', name: 'Trips Gifts', parent_id: 'trips' }]
    const { suggestions } = checkNewName({ kind: 'money', name: 'Gifts', categories: more, mainName: 'Trips' })
    expect(suggestions).toEqual(['Souvenirs', 'Presents'])
    for (const s of suggestions) expect(checkNewName({ kind: 'money', name: s, categories: more }).problem).toBe('')
  })

  it('a free name has no problem; a similar one is offered as the existing category instead', () => {
    expect(checkNewName({ kind: 'money', name: 'Kefir', categories: money })).toEqual({ problem: '', suggestions: [], similar: null })
    expect(checkNewName({ kind: 'money', name: 'Gift', categories: money }).similar?.id).toBe('m-gifts')
    expect(checkNewName({ kind: 'money', name: '', categories: money }).problem).toBe('Type a name.')
  })
})

describe('naming a new HOME category', () => {
  it('is unique across all HOME levels (the round-2 rule)', () => {
    const check = checkNewName({ kind: 'home', name: 'gifts', categories: home, mainName: 'Dairy & Eggs' })
    expect(check.problem).toBe('gifts already exists in Holiday')
    expect(check.suggestions).toEqual(['Dairy & Eggs gifts', 'Souvenirs'])
  })

  it('HOME and MONEY never check each other', () => {
    // "Trips" exists in MONEY only; "Pets" in HOME only (as "pets " in MONEY too)
    expect(checkNewName({ kind: 'home', name: 'Trips', categories: home }).problem).toBe('')
    expect(checkNewName({ kind: 'money', name: 'Holiday', categories: money }).problem).toBe('')
  })
})

describe('the budget category a new HOME category starts with', () => {
  const ctx = { expenseCategories: money, inventoryCategories: home, mapRows: [] }

  it('is the MONEY main category with exactly the same name (capitals and spaces ignored)', () => {
    expect(defaultNewBudget({ name: 'Pets', ctx })).toBe('m-pets')
    expect(defaultNewBudget({ name: ' TRIPS ', ctx })).toBe('trips')
  })

  it('is Groceries otherwise — no guessing from similar names', () => {
    expect(defaultNewBudget({ name: 'Pet Supplies', ctx })).toBe('groceries')
    expect(defaultNewBudget({ name: 'Pet', ctx })).toBe('groceries')
    expect(defaultNewBudget({ name: 'Gift', ctx })).toBe('groceries')
  })

  it('only a main category counts for the exact-name match', () => {
    expect(defaultNewBudget({ name: 'Gifts', ctx })).toBe('groceries')
  })

  it('a new sub-category follows what its main category is booked to', () => {
    const mapped = { ...ctx, mapRows: [{ id: 'pets', expense_category_id: 'm-pets' }] }
    expect(defaultNewBudget({ name: 'Cat food', parentId: 'pets', ctx: mapped })).toBe('m-pets')
    expect(defaultNewBudget({ name: 'Kefir', parentId: 'dairy', ctx })).toBe('groceries')
  })

  it('a mapping row is stored only when the choice differs from what it gets without one', () => {
    expect(mappingToStore({ chosenId: 'groceries', ctx })).toBeNull()
    expect(mappingToStore({ chosenId: 'm-pets', ctx })).toBe('m-pets')
    const mapped = { ...ctx, mapRows: [{ id: 'pets', expense_category_id: 'm-pets' }] }
    expect(mappingToStore({ chosenId: 'm-pets', parentId: 'pets', ctx: mapped })).toBeNull()
    expect(mappingToStore({ chosenId: 'groceries', parentId: 'pets', ctx: mapped })).toBe('groceries')
    expect(mappingToStore({ chosenId: '', ctx })).toBeNull()
  })
})

describe('titleCase', () => {
  it('capitalises each word of the typed item name', () => {
    expect(titleCase('  test   kefir ')).toBe('Test Kefir')
  })
})
