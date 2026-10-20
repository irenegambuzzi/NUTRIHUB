// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const rows = vi.hoisted(() => [
  { id: 'home', name: 'Home & Appliances', parent_id: null, type: 'parent' },
  { id: 'other', name: 'Other', parent_id: null, type: 'parent' },
  { id: 'going', name: 'Going out', parent_id: null, type: 'parent' },
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

  it('still deletes an ordinary category, moving its expenses to Other', async () => {
    const { result } = renderHook(() => useExpenseCategories())
    const answer = await result.current.deleteCategory('going')
    expect(answer.error).toBeNull()
    expect(touched).toContain('expense_categories')
  })
})
