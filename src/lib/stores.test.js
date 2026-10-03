import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { currentExpensesSince } = await import('./stores')

describe('currentExpensesSince', () => {
  it('starts at 1 January for the year view', () => {
    expect(currentExpensesSince(new Date(2026, 9, 3))).toBe('2026-01-01')
  })

  it('reaches back into December when this week started there', () => {
    // Friday 1 January 2027: the week started on Monday 28 December.
    expect(currentExpensesSince(new Date(2027, 0, 1))).toBe('2026-12-28')
  })
})

describe('categoryIdFor', async () => {
  const { categoryIdFor } = await import('../hooks/useInventoryCategories')
  it('makes a readable id from a new category name', () => {
    expect(categoryIdFor('Gluten free!')).toBe('gluten-free')
    expect(categoryIdFor('Caffè & Tè')).toBe('caffe-te')
    expect(categoryIdFor('!!!')).toBe('category')
  })
})
