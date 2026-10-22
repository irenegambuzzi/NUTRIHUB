// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../lib/stores', () => ({ expenseUsageStore: { useRows: () => ({ rows: [] }) } }))
const { CategoryManager } = await import('./CategoryManager')

const categories = [
  { id: 'shopping', name: 'Shopping', parent_id: null },
  { id: 'gifts', name: 'Gifts', parent_id: 'shopping' },
  { id: 'trips', name: 'Trips', parent_id: null },
]
afterEach(cleanup)

const open = (extra = {}) => {
  const onAdd = vi.fn(async () => ({ error: null }))
  render(<CategoryManager categories={categories} styleFor={() => ({ hex: '#fff' })} onAdd={onAdd} onDelete={vi.fn()} onRename={vi.fn(async () => ({ error: null }))} onClose={() => {}} {...extra} />)
  return { onAdd }
}

describe('MONEY Manage: similar names', () => {
  it('warns about a typo while adding, and Add still works', async () => {
    const { onAdd } = open()
    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\./), { target: { value: 'Gfits' } })
    expect(screen.getByText(/Similar category exists: Shopping › Gifts/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Gfits', null))
  })

  it('an exactly taken name is still refused', () => {
    const { onAdd } = open()
    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\./), { target: { value: 'gifts' } })
    expect(screen.queryByText(/Similar category exists/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    expect(screen.getByText('"gifts" already exists.')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('warns while renaming', () => {
    open({ onMove: vi.fn() })
    fireEvent.click(screen.getByLabelText('Rename Trips'))
    fireEvent.change(screen.getByLabelText('New name for Trips'), { target: { value: 'Shoping' } })
    expect(screen.getByText(/Similar category exists: Shopping/)).toBeTruthy()
  })
})
