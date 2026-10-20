// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
const { CategoryManager } = await import('./CategoryManager')
const { ExpenseGroup } = await import('./ExpenseGroup')

afterEach(cleanup)

const categories = [
  { id: 'going', name: 'Going out', parent_id: null },
  { id: 'going:bars', name: 'Bars', parent_id: 'going' },
  { id: 'home', name: 'Home & Appliances', parent_id: null },
  { id: 'other', name: 'Other', parent_id: null },
]
const style = { hex: '#3B82F6' }
const usageStore = { useRows: () => ({ rows: [] }) }
const manager = (extra = {}) =>
  render(<CategoryManager categories={categories} styleFor={() => style} onAdd={() => {}} onDelete={() => {}} onRename={() => {}} onMove={() => {}} onClose={() => {}} usageStore={usageStore} {...extra} />)

describe('MONEY Manage: Home & Appliances', () => {
  it('cannot be deleted, renamed or moved, and says so', () => {
    manager()
    expect(screen.getByLabelText('Delete Home & Appliances').disabled).toBe(true)
    expect(screen.getByLabelText('Rename Home & Appliances').disabled).toBe(true)
    expect(screen.getByLabelText('Move Home & Appliances').disabled).toBe(true)
    const hint = screen.getByText(/Used for home and appliance purchases\./)
    expect(hint.textContent).toContain("Locked: it can't be renamed, moved or deleted.")
  })

  it('leaves other categories deletable', () => {
    manager()
    expect(screen.getByLabelText('Delete Going out').disabled).toBe(false)
    expect(screen.getByLabelText('Delete Bars').disabled).toBe(false)
  })
})

describe('MONEY Manage: sub-category dots', () => {
  it('are half the size of the main dot in the expense list, in the main color', () => {
    const { container } = manager({ smallSubDots: true })
    const mains = container.querySelectorAll('[data-dot="main"]')
    const subs = container.querySelectorAll('[data-dot="sub"]')
    expect(mains).toHaveLength(3)
    expect(subs).toHaveLength(1)
    expect(mains[0].className).toContain('w-2.5 h-2.5')
    expect(subs[0].className).toContain('w-[5px] h-[5px]')
    expect(subs[0].style.background).toBe(mains[0].style.background)
  })

  it('keep the same size as main dots for income (unchanged)', () => {
    const { container } = manager()
    expect(container.querySelectorAll('[data-dot="sub"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-dot="main"]')).toHaveLength(4)
  })
})

describe('an opened expense row', () => {
  const group = {
    date: '2026-10-17',
    main: { id: 'going', name: 'Going out' },
    total: 12,
    items: [{ id: 'e1', category_id: 'going:bars', amount: 12, paid_by: 'irene', expense_date: '2026-10-17', description: 'Beer' }],
  }

  it('shows the sub-category dot at half the size, in the main category color', () => {
    const styleFor = (id) => (id === 'going:bars' ? { hex: '#3B82F6' } : { hex: '#EF4444' })
    const { container } = render(<ExpenseGroup group={group} color={{ hex: '#3B82F6' }} styleFor={styleFor} subName={() => 'Bars'} onEdit={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Going out/ }))
    const sub = container.querySelector('[data-dot="sub"]')
    expect(sub.className).toContain('w-[5px] h-[5px]')
    expect(container.querySelector('[data-dot="main"]').className).toContain('w-2.5 h-2.5')
    expect(sub.style.background).toBe('rgb(59, 130, 246)')
  })
})
