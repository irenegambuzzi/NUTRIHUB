// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { CategoryFields } = await import('./CategoryFields')

afterEach(cleanup)

const parents = [{ id: 'misc', name: 'Miscellaneous / Seasonal' }]
const subsByParent = new Map([['misc', [{ id: 'misc:gifts', name: 'Gifts' }]]])
const refused = (message) => ({ data: null, error: Object.assign(new Error(message), { nameProblem: true }) })

function setup(onAddSubcategory) {
  const onChange = vi.fn()
  render(<CategoryFields categoryId="misc" subcategoryId="" parents={parents} subsByParent={subsByParent} onChange={onChange} onAddCategory={vi.fn()} onAddSubcategory={onAddSubcategory} />)
  fireEvent.change(screen.getByLabelText('Sub-category'), { target: { value: '__new__' } })
  return onChange
}

describe('"+ New sub-category…" in the item editor and the SHOP add form', () => {
  it('says on the spot that the name exists, and where', async () => {
    const onChange = setup(vi.fn(async () => refused('"Gifts" already exists in Miscellaneous / Seasonal.')))
    fireEvent.change(screen.getByPlaceholderText('New sub-category name'), { target: { value: 'gifts' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await waitFor(() => expect(screen.getByText('"Gifts" already exists in Miscellaneous / Seasonal.')).toBeTruthy())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears the message as soon as the name is edited, and picks the new category when it is saved', async () => {
    const add = vi.fn().mockResolvedValueOnce(refused('"Gifts" already exists in Miscellaneous / Seasonal.')).mockResolvedValueOnce({ data: { id: 'misc:cards' }, error: null })
    const onChange = setup(add)
    const input = screen.getByPlaceholderText('New sub-category name')
    fireEvent.change(input, { target: { value: 'gifts' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy())
    fireEvent.change(input, { target: { value: 'Cards' } })
    expect(screen.queryByText(/already exists/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ categoryId: 'misc', subcategoryId: 'misc:cards' }))
  })
})
