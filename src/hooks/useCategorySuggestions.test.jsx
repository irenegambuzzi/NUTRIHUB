// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const db = vi.hoisted(() => ({ memory: [], pantry: [], upserts: [], offline: false }))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      upsert: (row) => {
        db.upserts.push(row)
        return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) }
      },
    }),
  },
}))
vi.mock('../lib/connection', () => ({ isOffline: () => db.offline }))
vi.mock('../lib/stores', () => ({
  categoryMemoryStore: { useRows: () => ({ rows: db.memory }), upsertLocal: vi.fn() },
  pantryStore: { useRows: () => ({ rows: db.pantry }) },
}))
const { useCategorySuggestions } = await import('./useCategorySuggestions')

afterEach(() => {
  db.memory = []
  db.pantry = []
  db.upserts = []
  db.offline = false
})

const parents = [
  { id: 'dairy', name: 'Dairy & Eggs' },
  { id: 'snacks', name: 'Snacks' },
]
const subsByParent = new Map([['dairy', [{ id: 'dairy:yogurt', name: 'Yogurt & Desserts' }]], ['snacks', []]])
const setup = () => renderHook(() => useCategorySuggestions({ parents, subsByParent })).result.current
const chip = (categoryId, subcategoryId = null) => ({ categoryId, subcategoryId, expenseCategoryId: null })

describe('learning from what the user picks', () => {
  it('remembers a pick other than the first chip, as "user", with the name in lower case as its id', async () => {
    const { remember } = setup()
    await remember('Test Kefir', 'snacks', null, { chips: [chip('dairy', 'dairy:yogurt')] })
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0]).toMatchObject({ id: 'test kefir', name: 'Test Kefir', category_id: 'snacks', subcategory_id: null, source: 'user' })
    expect(db.upserts[0]).not.toHaveProperty('expense_category_id')
  })

  it('does not remember the first chip (it would have been given anyway)', async () => {
    const { remember } = setup()
    await remember('Test kefir', 'dairy', 'dairy:yogurt', { chips: [chip('dairy', 'dairy:yogurt'), chip('snacks')] })
    expect(db.upserts).toEqual([])
  })

  it('the chosen category is the first chip next time (memory comes first)', async () => {
    const first = setup()
    const before = first.suggestions('Test kefir')
    expect(before[0]).toMatchObject({ categoryId: 'dairy', subcategoryId: 'dairy:yogurt', source: 'keywords' })
    await first.remember('Test kefir', 'snacks', null, { chips: before })
    db.memory = [{ id: 'test kefir', category_id: 'snacks', subcategory_id: null, expense_category_id: null }]
    const after = setup().suggestions('Test kefir')
    expect(after[0]).toMatchObject({ categoryId: 'snacks', source: 'memory', label: 'Snacks' })
    expect(after[1]).toMatchObject({ categoryId: 'dairy', source: 'keywords' })
  })

  it('a budget pick for a row not added to HOME is saved as expense_category_id only', async () => {
    const { rememberBudget } = setup()
    await rememberBudget('Birthday present', 'exp-gifts', { chips: [{ categoryId: null, subcategoryId: null, expenseCategoryId: 'exp-other' }] })
    expect(db.upserts[0]).toMatchObject({ id: 'birthday present', expense_category_id: 'exp-gifts', source: 'user' })
    expect(db.upserts[0]).not.toHaveProperty('category_id')
  })

  it('writes nothing offline or without a name', async () => {
    db.offline = true
    const { remember, rememberBudget } = setup()
    await remember('Kefir', 'snacks', null, { chips: [] })
    await rememberBudget('Kefir', 'exp', { chips: [] })
    db.offline = false
    await setup().remember('  ', 'snacks', null, { chips: [] })
    expect(db.upserts).toEqual([])
  })
})
