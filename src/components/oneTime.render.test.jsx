// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({ useCategorySuggestions: () => ({ suggest: () => null, remember: () => {} }) }))
vi.mock('../hooks/usePurchase', () => ({ usePurchase: () => ({ confirmPurchase: vi.fn(async () => ({ error: null })) }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useShopOrder', () => ({ useShopOrder: () => ({ positions: new Map(), savePositions: vi.fn() }) }))
const { ItemEditor } = await import('./inventory/ItemEditor')
const { ItemTile } = await import('./inventory/ItemTile')
const { GroupTile } = await import('./inventory/GroupTile')
const { FinishedItems } = await import('./inventory/FinishedItems')
const { GroceryItemTile } = await import('./grocery/GroceryItemTile')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { ShoppingMode } = await import('./grocery/ShoppingMode')
const { withGroupTotals } = await import('../lib/groups')
const { normName } = await import('../lib/grocery')

afterEach(cleanup)

const parents = [{ id: 'misc', name: 'Misc' }]
const subsByParent = new Map()
const sun = { id: 's', name: 'Sun cream', unit: 'pcs', current_stock: 1, min_stock: 3, one_time: true, category_id: 'misc', created_at: '2026-10-01T00:00:00Z' }

describe('HOME editor: one-time purchase (1×)', () => {
  const editor = (props) => render(<ItemEditor parents={parents} subsByParent={subsByParent} onClose={() => {}} {...props} />)

  it('a new item can be 1×: the minimum field disappears and the item is saved with 1× and no minimum', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    editor({ onSave, prefill: { name: 'Test 1x' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Item category' }), { target: { value: 'misc' } })
    expect(screen.getByText(/Minimum stock/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /One-time purchase/ }))
    expect(screen.queryByText(/Minimum stock/)).toBeNull()
    fireEvent.submit(screen.getByRole('button', { name: 'Add to inventory' }).closest('form'))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Test 1x', one_time: true, min_stock: 0 })
  })

  it('editing a 1× item hides the minimum but keeps the stored one; turning 1× off says what happens', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    editor({ item: sun, onSave })
    expect(screen.queryByText(/Minimum stock/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /One-time purchase/ }))
    expect(screen.getByText(/at 0 it is Out and goes on the SHOP list/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /One-time purchase/ }))
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ one_time: true, min_stock: 3 })
  })

  it('a group has no 1× switch and never sends the flag', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    editor({ asGroup: true, onSave, prefill: { name: 'Chips' } })
    expect(screen.queryByRole('checkbox', { name: /One-time purchase/ })).toBeNull()
  })

  it('a variant can be 1×', () => {
    editor({ group: { id: 'g', name: 'Chips & Snacks', unit: 'pcs', category_id: 'misc' }, onSave: vi.fn() })
    expect(screen.getByRole('checkbox', { name: /One-time purchase/ })).toBeTruthy()
  })
})

describe('HOME tiles', () => {
  const tile = (item) => render(<ItemTile item={item} onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} />)

  it('a 1× item shows the grey "1×", no Low/Out and no minimum, and never turns yellow or red', () => {
    const { container } = tile({ ...sun, current_stock: 1 })
    expect(screen.getByText('1×').className).toContain('bg-zinc-500/25')
    expect(screen.queryByText('Low')).toBeNull()
    expect(screen.queryByText(/^min /)).toBeNull()
    expect(container.firstChild.className).toContain('34,197,94')
    expect(container.firstChild.className).not.toContain('234,179,8')
  })

  it('a normal item is unchanged', () => {
    tile({ ...sun, one_time: false })
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText(/min 3 pcs/)).toBeTruthy()
    expect(screen.queryByText('1×')).toBeNull()
  })

  it('a 1× variant shows the grey label inside its group', () => {
    const group = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'misc', current_stock: 1 }
    render(
      <GroupTile group={group} variants={[{ ...sun, group_id: 'g' }]} newIds={new Set()} onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} onAddVariant={() => {}} onTakeOut={() => {}} onRestock={() => {}} />
    )
    fireEvent.click(screen.getByRole('button', { name: /Variants/ }))
    expect(screen.getByText('1×')).toBeTruthy()
  })
})

describe('Finished one-time items', () => {
  const finished = [
    { ...sun, current_stock: 0 },
    { ...sun, id: 'v', name: 'Party chips', current_stock: 0, group_id: 'g' },
  ]

  it('is closed at first with its count, lists the items (a variant with its group) and offers "Not one-time"', () => {
    const onNotOneTime = vi.fn()
    render(<FinishedItems items={finished} groupName={() => 'Chips & Snacks'} onNotOneTime={onNotOneTime} onEdit={() => {}} onDelete={() => {}} />)
    const header = screen.getByRole('button', { name: /Finished one-time items \(2\)/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Sun cream')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('Sun cream')).toBeTruthy()
    expect(screen.getByText('in Chips & Snacks')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Not one-time' })[0])
    expect(onNotOneTime).toHaveBeenCalledWith(finished[0])
    expect(screen.getAllByText(/at 0 it is Out and goes on the SHOP list/).length).toBeGreaterThan(0)
  })

  it('shows nothing when nothing is finished', () => {
    const { container } = render(<FinishedItems items={[]} onNotOneTime={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})

const chips = withGroupTotals([
  { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'misc' },
  { id: 'lays', name: 'Lays', unit: 'pcs', current_stock: 5, group_id: 'g', category_id: 'misc' },
  { id: 'pr', name: 'Patatine teriyaki', unit: 'pcs', current_stock: 0, group_id: 'g', category_id: 'misc' },
  { id: 'cv', name: 'Chips - di verdure al sale marino', unit: 'pcs', current_stock: 0, group_id: 'g', category_id: 'misc' },
])
const row = { id: 'e1', name: 'Chips & Snacks', category_id: 'misc', quantity: 1, unit: 'pcs', pantry_item_id: 'g', in_cart: false, completed: false, created_at: '2026-10-01' }

describe('SHOP list tiles', () => {
  const tile = (props) =>
    render(<GroceryItemTile item={row} reason="not-urgent" categoryName={() => 'Misc'} onToggle={() => {}} onDelete={() => {}} onUpdatePricing={() => {}} onUpdatePayer={() => {}} {...props} />)

  it('a group row lists its variants at 0, light sky "Not urgent", each with ×', () => {
    const onDismissVariant = vi.fn()
    const { container } = tile({ outVariants: chips[0].variants.filter((v) => v.current_stock === 0).sort((a, b) => a.name.localeCompare(b.name)), onDismissVariant })
    expect(container.textContent).toContain('— out: Chips - di verdure al sale marino, Patatine teriyaki')
    expect(screen.getByText('Not urgent').className).toContain('sky')
    expect(container.firstChild.className).toContain('56,189,248')
    // Not the blue of "New Item".
    expect(container.firstChild.className).not.toContain('59,130,246')
    fireEvent.click(screen.getByRole('button', { name: 'Take Patatine teriyaki off the SHOP list' }))
    expect(onDismissVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'pr' }))
  })

  it('a 1× entry shows the grey "1×", in "to buy" and in the cart', () => {
    tile({ item: { ...row, pantry_item_id: null, name: 'Balloons' }, reason: 'new', oneTime: true })
    expect(screen.getByText('1×')).toBeTruthy()
    cleanup()
    tile({ item: { ...row, pantry_item_id: null, name: 'Balloons', in_cart: true }, reason: 'new', oneTime: true })
    expect(screen.getByText('1×')).toBeTruthy()
  })
})

describe('SHOP add form (More options)', () => {
  const form = (pantryByName = new Map()) => {
    const onAdd = vi.fn(async () => ({ error: null }))
    render(<AddItemForm parents={parents} subsByParent={subsByParent} categoryName={() => 'Misc'} pantryByName={pantryByName} onAdd={onAdd} initialName="Balloons" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Item category' }), { target: { value: 'misc' } })
    return onAdd
  }

  it('a new item not in HOME can be marked 1×', async () => {
    const onAdd = form()
    fireEvent.click(screen.getByRole('checkbox', { name: /One-time purchase/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }))
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Balloons', oneTime: true, pantryItemId: null })
  })

  it('an item already in HOME (also a finished 1× one) links to it and shows its flag instead', async () => {
    const hats = { ...sun, id: 'hats', name: 'Balloons', current_stock: 0 }
    const onAdd = form(new Map([[normName('Balloons'), hats]]))
    expect(screen.queryByRole('checkbox', { name: /One-time purchase/ })).toBeNull()
    expect(screen.getByText(/is a one-time purchase \(1×\) in HOME/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }))
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(onAdd.mock.calls[0][0]).toMatchObject({ pantryItemId: 'hats', oneTime: false })
  })
})

describe('Confirm purchase', () => {
  const confirm = (cartItems, pantryItems) =>
    render(<ConfirmPurchase cartItems={cartItems} pantryItems={pantryItems} categoryName={() => 'Misc'} totalOf={() => 0} updatePricing={vi.fn()} updatePayer={vi.fn()} toggleCart={vi.fn()} onClose={() => {}} />)

  it('lists a group\'s variants at 0 first, then by stock, with the first out one picked', () => {
    confirm([{ ...row, in_cart: true }], [...chips, ...chips[0].variants])
    const select = screen.getByRole('combobox', { name: 'Variant for Chips & Snacks' })
    const names = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['Choose a variant…', 'Chips - di verdure al sale marino (0 pcs)', 'Patatine teriyaki (0 pcs)', 'Lays (5 pcs)', 'New variant…'])
    expect(select.value).toBe('cv')
  })

  it('shows the grey "1×" on a one-time line', () => {
    confirm([{ ...row, id: 'e2', name: 'Balloons', pantry_item_id: null, one_time: true, in_cart: true }], [])
    expect(screen.getByText('1×')).toBeTruthy()
  })

  it('lists the cart in the order it was given (oldest in the cart first)', () => {
    const cart = ['First', 'Second', 'Third'].map((name, i) => ({ ...row, id: name, name, pantry_item_id: null, in_cart: true, cart_added_at: `2026-10-20T10:00:0${i}Z` }))
    confirm(cart, [])
    const names = screen.getAllByLabelText(/^Take .* out of the cart$/).map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Take First out of the cart', 'Take Second out of the cart', 'Take Third out of the cart'])
  })
})

describe('Shopping mode', () => {
  it('shows "In the cart" oldest first, whatever order the list is in', () => {
    const items = [
      { ...row, id: 'c', name: 'Third', pantry_item_id: null, in_cart: true, cart_added_at: '2026-10-20T10:00:03Z', created_at: '2026-09-01' },
      { ...row, id: 'a', name: 'First', pantry_item_id: null, in_cart: true, cart_added_at: '2026-10-20T10:00:01Z', created_at: '2026-10-09' },
      { ...row, id: 'b', name: 'Second', pantry_item_id: null, in_cart: true, cart_added_at: '2026-10-20T10:00:02Z', created_at: '2026-10-05' },
    ]
    const { container } = render(<ShoppingMode items={items} parents={parents} categoryName={() => 'Misc'} totalOf={() => 0} costOf={() => 0} budget={null} onCheck={() => {}} onConfirm={() => {}} />)
    const text = container.textContent
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Third'))
  })

  it('a group tile says which variants are out', () => {
    const { container } = render(
      <ShoppingMode items={[row]} parents={parents} categoryName={() => 'Misc'} totalOf={() => 0} costOf={() => 0} budget={null} pantryFor={() => chips[0]} onCheck={() => {}} onConfirm={() => {}} />
    )
    expect(container.textContent).toContain('— out: Chips - di verdure al sale marino, Patatine teriyaki')
    expect(container.textContent).toContain('Not urgent')
  })
})
