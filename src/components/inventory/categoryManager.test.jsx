// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const main = (id, name) => ({ id, name, parent_id: null, type: 'parent' })
const sub = (id, name, parent_id) => ({ id, name, parent_id, type: 'sub' })

const categories = [
  main('produce', 'Fruit & Vegetables'),
  sub('hand-veg', 'Frozen Vegetables', 'produce'),
  main('frozen', 'Frozen Food'),
  sub('frozen:vegetables', 'Frozen Vegetables', 'frozen'),
  sub('frozen:fish', 'Frozen Fish', 'frozen'),
  main('snacks', 'Snacks'),
  main('empty', 'Empty one'),
  main('appliances', 'Home & Appliances'),
]
const items = [
  { id: 1, category_id: 'produce', subcategory_id: 'hand-veg' },
  { id: 2, category_id: 'produce', subcategory_id: 'hand-veg' },
  { id: 3, category_id: 'frozen', subcategory_id: 'frozen:vegetables' },
]

const api = vi.hoisted(() => ({ addSubcategory: vi.fn(), addCategory: vi.fn(), renameCategory: vi.fn(), moveSubcategory: vi.fn(), deleteCategory: vi.fn() }))

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => {
    const parents = categories.filter((c) => !c.parent_id)
    const subsByParent = new Map(parents.map((p) => [p.id, categories.filter((c) => c.parent_id === p.id)]))
    return { categories, parents, subsByParent, byId: new Map(categories.map((c) => [c.id, c])), ...api }
  },
}))
vi.mock('../../lib/stores', () => ({
  pantryStore: { useRows: () => ({ rows: items }) },
  groceryStore: { useRows: () => ({ rows: [] }) },
  categoryMemoryStore: { useRows: () => ({ rows: [] }) },
}))
const { InventoryCategoryManager } = await import('./InventoryCategoryManager')

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: {}, error: null })
})
afterEach(cleanup)

const open = () => render(<InventoryCategoryManager onClose={() => {}} />)

describe('HOME Manage categories', () => {
  it('shows the item count of every category', () => {
    open()
    // Fruit & Vegetables counts its sub-category's items; Snacks has none.
    expect(screen.getByLabelText('Rename Fruit & Vegetables').closest('div').textContent).toContain('2 items')
    expect(screen.getByLabelText('Rename Snacks').closest('div').textContent).toContain('0 items')
    expect(screen.getByLabelText('Rename Frozen Food').closest('div').textContent).toContain('1 item')
  })

  it('locks Rename, Move and Delete for Home & Appliances and explains it like MONEY', () => {
    open()
    expect(screen.getByLabelText('Move Home & Appliances').disabled).toBe(true)
    expect(screen.getByLabelText('Delete Home & Appliances').disabled).toBe(true)
    expect(screen.getByLabelText('Rename Home & Appliances').disabled).toBe(true)
    expect(screen.getByText(/Used for home and appliance purchases\. Locked: it can't be renamed, moved or deleted\./)).toBeTruthy()
  })

  it('warns about a similar name or a typo while typing, and Add stays possible', async () => {
    open()
    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\./), { target: { value: 'Snaks' } })
    expect(screen.getByText(/Similar category exists: Snacks/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    await waitFor(() => expect(api.addCategory).toHaveBeenCalledWith('Snaks'))
  })

  it('warns while renaming too, without comparing with the category itself', () => {
    open()
    fireEvent.click(screen.getByLabelText('Rename Snacks'))
    fireEvent.change(screen.getByLabelText('New name for Snacks'), { target: { value: 'Snacs' } })
    expect(screen.queryByText(/Similar category exists/)).toBeNull()
    fireEvent.change(screen.getByLabelText('New name for Snacks'), { target: { value: 'Frozen Fsh' } })
    expect(screen.getByText(/Similar category exists: Frozen Food › Frozen Fish/)).toBeTruthy()
  })

  it('refuses to add a name that exists, with the place, without calling the database', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText(/Name \(e\.g\./), { target: { value: 'frozen fish' } })
    fireEvent.change(screen.getByLabelText('Parent category'), { target: { value: 'snacks' } })
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    expect(screen.getByText('"Frozen Fish" already exists in Frozen Food.')).toBeTruthy()
    expect(api.addSubcategory).not.toHaveBeenCalled()
  })

  it('renames a category, also when only the capitals change', async () => {
    open()
    fireEvent.click(screen.getByLabelText('Rename Snacks'))
    fireEvent.change(screen.getByLabelText('New name for Snacks'), { target: { value: 'snacks' } })
    fireEvent.click(screen.getByLabelText('Save'))
    await waitFor(() => expect(api.renameCategory).toHaveBeenCalledWith('snacks', 'snacks'))
  })

  it("refuses renaming to another category's name", () => {
    open()
    fireEvent.click(screen.getByLabelText('Rename Snacks'))
    fireEvent.change(screen.getByLabelText('New name for Snacks'), { target: { value: 'Frozen Fish' } })
    fireEvent.click(screen.getByLabelText('Save'))
    expect(screen.getByText('"Frozen Fish" already exists in Frozen Food.')).toBeTruthy()
    expect(api.renameCategory).not.toHaveBeenCalled()
  })

  it('explains why a main with sub-categories cannot become a sub-category', () => {
    open()
    fireEvent.click(screen.getByLabelText('Move Frozen Food'))
    expect(screen.getByText(/can't become a sub-category/)).toBeTruthy()
  })

  it('deletes an empty category after one confirm, without choosing a target', async () => {
    open()
    fireEvent.click(screen.getByLabelText('Delete Empty one'))
    expect(screen.getByText(/Nothing uses it/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith('empty', null))
  })

  it('asks where the items go for a category in use, and merges only when a target is picked', async () => {
    open()
    // Two subs are called "Frozen Vegetables": the list tells them apart by their main.
    fireEvent.click(screen.getByLabelText('Delete Fruit & Vegetables › Frozen Vegetables'))
    const move = screen.getByRole('button', { name: 'Move & delete' })
    expect(move.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Move the items of Fruit & Vegetables › Frozen Vegetables to'), { target: { value: 'frozen:vegetables' } })
    expect(move.disabled).toBe(false)
    fireEvent.click(move)
    await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith('hand-veg', 'frozen:vegetables'))
  })

  it('blocks a main-into-main merge whose subs clash by name, before anything is sent', () => {
    open()
    fireEvent.click(screen.getByLabelText('Delete Fruit & Vegetables'))
    fireEvent.change(screen.getByLabelText('Move the items of Fruit & Vegetables to'), { target: { value: 'frozen' } })
    expect(screen.getByText('"Frozen Vegetables" already exists in Frozen Food — merge or rename that sub first.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move & delete' }).disabled).toBe(true)
    expect(api.deleteCategory).not.toHaveBeenCalled()
  })
})
