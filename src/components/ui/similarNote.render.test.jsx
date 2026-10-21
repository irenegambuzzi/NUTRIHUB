// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SimilarNote } from './SimilarNote'

const categories = [
  { id: 'shopping', name: 'Shopping', parent_id: null },
  { id: 'gifts', name: 'Gifts', parent_id: 'shopping' },
  { id: 'cart', name: 'Cart', parent_id: null },
]
afterEach(cleanup)

describe('the similar-name note in Manage', () => {
  it('"Gfits" says which category is similar, as a warning only', () => {
    render(<SimilarNote name="Gfits" categories={categories} />)
    expect(screen.getByText(/Similar category exists: Shopping › Gifts/)).toBeTruthy()
  })

  it('"Car" next to "Cart" warns too (it is never a block)', () => {
    render(<SimilarNote name="Car" categories={categories} />)
    expect(screen.getByText(/Similar category exists: Cart/)).toBeTruthy()
  })

  it('shows nothing for a free name, an empty name or an exactly taken name (the refusal explains that)', () => {
    const { container, rerender } = render(<SimilarNote name="Kefir" categories={categories} />)
    expect(container.innerHTML).toBe('')
    rerender(<SimilarNote name="  " categories={categories} />)
    expect(container.innerHTML).toBe('')
    rerender(<SimilarNote name="gifts" categories={categories} />)
    expect(container.innerHTML).toBe('')
  })

  it('a rename never compares the category with itself', () => {
    const { container } = render(<SimilarNote name="Gifts" categories={categories} exceptId="gifts" />)
    expect(container.innerHTML).toBe('')
  })
})
