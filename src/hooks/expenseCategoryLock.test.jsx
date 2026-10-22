// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const rows = vi.hoisted(() => [
  { id: 'home', name: 'Home & Appliances', parent_id: null, type: 'parent' },
  { id: 'other', name: 'Other', parent_id: null, type: 'parent' },
  { id: 'going', name: 'Going out', parent_id: null, type: 'parent' },
  // The Trips main, renamed by hand: it is found by id.
  { id: 'dc79f604-19fd-4bdd-817e-335816c4afe7', name: 'Travel', parent_id: null, type: 'parent' },
  { id: 'flights', name: 'Flights', parent_id: 'dc79f604-19fd-4bdd-817e-335816c4afe7', type: 'sub' },
])
const touched = vi.hoisted(() => [])

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: (table) => (touched.push(table), { update: () => ({ in: async () => ({ error: null }) }), delete: () => ({ in: async () => ({ error: null }) }) }) },
}))
vi.mock('../lib/stores', () => ({
  expenseCategoryStore: { useRows: () => ({ rows }), refresh: async () => {}, upsertLocal() {} },
  allExpenseStores: () => [],
  orderStore: { isStarted: () => false },
}))
const { useExpenseCategories } = await import('./useExpenses')

describe('deleting a MONEY category', () => {
  it('never deletes Home & Appliances (Confirm purchase of durable items needs it)', async () => {
    const { result } = renderHook(() => useExpenseCategories())
    const answer = await result.current.deleteCategory('home')
    expect(answer.error.message).toBe('"Home & Appliances" can\'t be deleted.')
    expect(touched).toEqual([])
  })

  it('never deletes or moves the Trips main (found by id, so after a rename too)', async () => {
    const { result } = renderHook(() => useExpenseCategories())
    expect((await result.current.deleteCategory('dc79f604-19fd-4bdd-817e-335816c4afe7')).error.message).toBe('"Travel" can\'t be deleted.')
    expect((await result.current.moveCategory('dc79f604-19fd-4bdd-817e-335816c4afe7', 'going')).error.message).toBe('"Travel" can\'t be moved.')
    expect(touched).toEqual([])
  })

  it('still deletes an ordinary category, moving its expenses to Other', async () => {
    const { result } = renderHook(() => useExpenseCategories())
    const answer = await result.current.deleteCategory('going')
    expect(answer.error).toBeNull()
    expect(touched).toContain('expense_categories')
  })
})
