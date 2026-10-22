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

describe('MONEY Manage (and Income Manage): A–Z, "Other" last', () => {
  const list = [
    { id: 'trips', name: 'Trips & Holidays', parent_id: null },
    { id: 'other', name: 'Other', parent_id: null },
    { id: 'shop', name: 'Shopping', parent_id: null },
    { id: 'shop:others', name: 'Others', parent_id: 'shop' },
    { id: 'shop:gifts', name: 'Gifts', parent_id: 'shop' },
    { id: 'shop:clothing', name: 'Clothing', parent_id: 'shop' },
    { id: 'bank', name: 'Bank & Fee', parent_id: null },
  ]

  it('lists mains A–Z with Other last, and subs A–Z with Others last', () => {
    const { container } = render(<CategoryManager categories={list} styleFor={() => ({ hex: '#fff' })} onAdd={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onClose={() => {}} />)
    const text = container.querySelector('.divide-y').textContent
    const at = (name) => text.indexOf(name)
    const order = ['Bank & Fee', 'Shopping', 'Clothing', 'Gifts', 'Others', 'Trips & Holidays']
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), order[i]).toBeLessThan(at(order[i]))
    expect(text.lastIndexOf('Other')).toBeGreaterThan(at('Trips & Holidays'))
    const options = [...screen.getByLabelText('Parent category').querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Main category', 'Sub-category of Bank & Fee', 'Sub-category of Shopping', 'Sub-category of Trips & Holidays', 'Sub-category of Other'])
  })
})
