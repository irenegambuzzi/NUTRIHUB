// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

const creation = vi.hoisted(() => ({ value: null }))
vi.mock('../../hooks/useCategoryCreation', () => ({ useCategoryCreation: () => creation.value }))
const { CategoryChips } = await import('./CategoryChips')

const money = [
  { id: 'groceries', name: 'Groceries', parent_id: null },
  { id: 'shopping', name: 'Shopping', parent_id: null },
  { id: 'm-gifts', name: 'Gifts', parent_id: 'shopping' },
  { id: 'trips', name: 'Trips', parent_id: null },
  { id: 'm-pets', name: 'Pets', parent_id: null },
]
const home = [
  { id: 'dairy', name: 'Dairy & Eggs', parent_id: null, type: 'parent' },
  { id: 'dairy:yogurt', name: 'Yogurt & Desserts', parent_id: 'dairy', type: 'sub' },
  { id: 'misc', name: 'Misc', parent_id: null, type: 'parent' },
]

function setup() {
  creation.value = {
    homeCategories: home,
    homeMains: home.filter((c) => !c.parent_id),
    expenseCategories: money,
    moneyMains: money.filter((c) => !c.parent_id),
    ctx: { expenseCategories: money, inventoryCategories: home, mapRows: [] },
    createHome: vi.fn(async ({ name, parentId }) => ({ error: null, pick: { categoryId: parentId || 'new-id', subcategoryId: parentId ? 'new-id' : null, expenseCategoryId: null, name } })),
    createMoney: vi.fn(async () => ({ error: null, pick: { categoryId: null, subcategoryId: null, expenseCategoryId: 'new-money' } })),
  }
  return creation.value
}
afterEach(cleanup)

const open = () => fireEvent.click(screen.getByRole('button', { name: /New category/ }))
const nameField = () => screen.getByLabelText('New category name')
const typeName = (value) => fireEvent.change(nameField(), { target: { value } })
const homeChip = (categoryId, subcategoryId, label) => ({ categoryId, subcategoryId, expenseCategoryId: null, source: 'keywords', label })

describe('category chips', () => {
  it('show nothing until a name is typed', () => {
    setup()
    const { container } = render(<CategoryChips name="  " chips={[]} onPick={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('tapping a chip picks it; the one the form has is pressed', () => {
    setup()
    const onPick = vi.fn()
    const chips = [homeChip('dairy', 'dairy:yogurt', 'Dairy & Eggs › Yogurt & Desserts'), homeChip('misc', null, 'Misc')]
    render(<CategoryChips name="kefir" chips={chips} selected={{ categoryId: 'misc', subcategoryId: '' }} onPick={onPick} />)
    expect(screen.getByRole('button', { name: 'Misc' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Dairy & Eggs › Yogurt & Desserts' }))
    expect(onPick).toHaveBeenCalledWith(chips[0])
  })

  it('with nothing that matches there is no guessed chip, only "+ New category", which opens an inline row (not a popup)', () => {
    setup()
    render(<CategoryChips name="zorblax" chips={[]} onPick={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    open()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('group', { name: 'New category' })).toBeTruthy()
    expect(nameField().value).toBe('Zorblax')
  })

  it('a "✚ New" chip with a proposed name exists but is OFF: nothing passes one yet', () => {
    setup()
    const { rerender } = render(<CategoryChips name="kefir" chips={[]} onPick={vi.fn()} />)
    expect(screen.queryByText(/✚/)).toBeNull()
    rerender(<CategoryChips name="kefir" chips={[]} proposals={[{ parentId: 'dairy', name: 'Kefir' }]} onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /✚ Kefir/ }))
    expect(nameField().value).toBe('Kefir')
    expect(screen.getByLabelText('Where the new category goes').value).toBe('dairy')
  })
})

describe('a name already used (a budget category, Add to HOME off)', () => {
  it('says so before Create, offers free names, never renames by itself, and creates only a MONEY category', async () => {
    const c = setup()
    const onPick = vi.fn()
    render(<CategoryChips mode="budget" name="present" chips={[]} onPick={onPick} />)
    open()
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(false)
    typeName('Gifts')
    expect(screen.getByText('Gifts already exists in Shopping')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
    // the name stays exactly as typed
    expect(nameField().value).toBe('Gifts')
    // under another main: "<main> <name>" and a synonym, both free
    fireEvent.change(screen.getByLabelText('Where the new category goes'), { target: { value: 'trips' } })
    expect(screen.getByRole('button', { name: 'Trips Gifts' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Souvenirs' }))
    expect(nameField().value).toBe('Souvenirs')
    expect(screen.queryByText(/already exists/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(c.createMoney).toHaveBeenCalledWith({ name: 'Souvenirs', parentId: 'trips' }))
    expect(c.createHome).not.toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ expenseCategoryId: 'new-money', categoryId: null }))
    expect(screen.queryByRole('group', { name: 'New category' })).toBeNull()
  })

  it('a similar existing category is offered instead of a near-duplicate', () => {
    setup()
    const onPick = vi.fn()
    render(<CategoryChips mode="budget" name="gift" chips={[]} onPick={onPick} />)
    open()
    typeName('Gift')
    fireEvent.click(screen.getByRole('button', { name: 'Use Shopping › Gifts' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ expenseCategoryId: 'm-gifts' }))
  })

  it('a typo ("Gfits") shows "Similar category exists: Use Shopping › Gifts" and Create stays enabled', () => {
    const c = setup()
    render(<CategoryChips mode="budget" name="gfits" chips={[]} onPick={vi.fn()} />)
    open()
    typeName('Gfits')
    expect(screen.getByText('Similar category exists:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use Shopping › Gifts' })).toBeTruthy()
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(c.createMoney).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gfits' }))
  })

  it('"Car" next to an existing "Cart" warns but can still be created', () => {
    const c = setup()
    c.expenseCategories.push({ id: 'cart', name: 'Cart', parent_id: null })
    c.moneyMains.push({ id: 'cart', name: 'Cart', parent_id: null })
    render(<CategoryChips mode="budget" name="car" chips={[]} onPick={vi.fn()} />)
    open()
    typeName('Car')
    expect(screen.getByRole('button', { name: 'Use Cart' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(false)
  })

  it('the exact name still blocks Create', () => {
    setup()
    render(<CategoryChips mode="budget" name="gifts" chips={[]} onPick={vi.fn()} />)
    open()
    typeName('gifts')
    expect(screen.getByText('gifts already exists in Shopping')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
  })

  it('cancel adds nothing', () => {
    const c = setup()
    render(<CategoryChips mode="budget" name="gifts" chips={[]} onPick={vi.fn()} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'New category' })).toBeNull()
    expect(c.createMoney).not.toHaveBeenCalled()
  })
})

describe('a new HOME category (from SHOP, or a MONEY row with Add to HOME on)', () => {
  it('creates a sub-category under the main picked, with its budget category from the mapping', async () => {
    const c = setup()
    const onPick = vi.fn()
    render(<CategoryChips name="Test Sub" chips={[]} onPick={onPick} />)
    open()
    fireEvent.change(screen.getByLabelText('Where the new category goes'), { target: { value: 'dairy' } })
    expect(screen.getByLabelText('Budget category of the new category').value).toBe('groceries')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(c.createHome).toHaveBeenCalledWith({ name: 'Test Sub', parentId: 'dairy', budgetId: 'groceries' }))
    expect(c.createMoney).not.toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'dairy', subcategoryId: 'new-id' }))
  })

  it('the budget category starts as the MONEY main with exactly the same name, else Groceries — and can be changed', () => {
    setup()
    render(<CategoryChips name="Pets" chips={[]} onPick={vi.fn()} />)
    open()
    expect(screen.getByLabelText('Budget category of the new category').value).toBe('m-pets')
    typeName('Pet Supplies')
    expect(screen.getByLabelText('Budget category of the new category').value).toBe('groceries')
    fireEvent.change(screen.getByLabelText('Budget category of the new category'), { target: { value: 'shopping' } })
    typeName('Pet Stuff')
    expect(screen.getByLabelText('Budget category of the new category').value).toBe('shopping')
  })

  it('a taken HOME name is explained with free names (HOME rule: all levels)', () => {
    setup()
    render(<CategoryChips name="misc" chips={[]} onPick={vi.fn()} />)
    open()
    expect(screen.getByText('Misc already exists as a main category')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
  })

  it('starts under the main of the first chip', () => {
    setup()
    render(<CategoryChips name="kefir" chips={[homeChip('dairy', 'dairy:yogurt', 'Dairy & Eggs › Yogurt & Desserts')]} onPick={vi.fn()} />)
    open()
    expect(screen.getByLabelText('Where the new category goes').value).toBe('dairy')
  })
})
