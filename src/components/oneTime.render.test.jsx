// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({ useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }) }))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
vi.mock('../hooks/usePurchase', () => ({ usePurchase: () => ({ confirmPurchase: vi.fn(async () => ({ error: null })) }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useShopOrder', () => ({ useShopOrder: () => ({ positions: new Map(), savePositions: vi.fn() }) }))
const { ItemEditor } = await import('./inventory/ItemEditor')
const { ItemTile } = await import('./inventory/ItemTile')
const { FinishedItems } = await import('./inventory/FinishedItems')
const { GroceryItemTile } = await import('./grocery/GroceryItemTile')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { ShoppingMode } = await import('./grocery/ShoppingMode')
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

  it('a group row from an older app version (K138) is "Edit item" with no 1× switch and no stock, expiry or batch, and never sends them', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    editor({ item: { id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'misc' }, onSave })
    expect(screen.getByText('Edit item')).toBeTruthy()
    expect(screen.queryByText(/Edit group|Add a group|Create group/)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /One-time purchase/ })).toBeNull()
    expect(screen.queryByText('Current stock')).toBeNull()
    expect(screen.queryByText('Expiry date')).toBeNull()
    expect(screen.queryByText(/Batch \/ lot/)).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull()
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    for (const key of ['current_stock', 'expiry_date', 'batch_lot', 'one_time', 'is_group', 'group_id']) expect(onSave.mock.calls[0][0]).not.toHaveProperty(key)
  })

  it('a variant of a group row is edited as a normal item: 1× switch, its own stock, its unit free, no group select', () => {
    editor({ item: { id: 'v', name: 'Lays', unit: 'pcs', current_stock: 2, min_stock: 1, group_id: 'g', category_id: 'misc' }, onSave: vi.fn() })
    expect(screen.getByRole('checkbox', { name: /One-time purchase/ })).toBeTruthy()
    expect(screen.getByText('Current stock')).toBeTruthy()
    expect(screen.getByText('It goes on the grocery list automatically when stock falls to the minimum or below.')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull()
    expect(screen.queryByText(/unit of its group|group's minimum/)).toBeNull()
  })
})

describe('HOME tiles', () => {
  const tile = (item) => render(<ItemTile item={item} onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} />)

  it('a 1× item shows the grey "1× purchase", no Low/Out and no minimum, and never turns yellow or red', () => {
    const { container } = tile({ ...sun, current_stock: 1 })
    expect(screen.getByText('1× purchase').className).toContain('bg-zinc-500/25')
    expect(screen.queryByText('Low')).toBeNull()
    expect(screen.queryByText(/^min /)).toBeNull()
    expect(container.firstChild.className).toContain('34,197,94')
    expect(container.firstChild.className).not.toContain('234,179,8')
  })

  it('a normal item is unchanged', () => {
    tile({ ...sun, one_time: false })
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText(/min 3 pcs/)).toBeTruthy()
    expect(screen.queryByText('1× purchase')).toBeNull()
  })

  it('"1× purchase" has exactly the size, weight and padding of "New Item" (only the colour differs)', () => {
    render(<ItemTile item={{ ...sun, current_stock: 1 }} isNew onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} />)
    const shape = (el) => el.className.split(/\s+/).filter((c) => /^(text-\[|font-|uppercase|px-|py-|rounded-|leading-)/.test(c)).sort()
    const oneTime = screen.getByText('1× purchase')
    const fresh = screen.getByText('New Item')
    expect(shape(oneTime)).toEqual(shape(fresh))
    expect(shape(oneTime)).toEqual(['font-bold', 'px-1.5', 'py-0.5', 'rounded-full', 'text-[9px]', 'uppercase'])
    expect(oneTime.className).toContain('zinc')
  })

  it('a 1× variant of a group row shows the grey label on its own tile', () => {
    tile({ ...sun, group_id: 'g' })
    expect(screen.getByText('1× purchase')).toBeTruthy()
    expect(screen.getByTitle('Add to grocery list')).toBeTruthy()
  })

  it('a group row from an older app version (K138): its own stock 0 (not its variants\' 5), the grey note, nothing that changes stock or lists it', () => {
    const { container } = tile({ id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'misc', created_at: '2026-10-01T00:00:00Z' })
    expect(screen.getByText('Item group from an older app version — merge its variants into it: Edit item → Merge other items into this one…')).toBeTruthy()
    expect(screen.getByText('0 pcs')).toBeTruthy()
    expect(screen.queryByText('5 pcs')).toBeNull()
    expect(screen.queryByText('Out')).toBeNull()
    for (const title of ['Add to grocery list', 'Add bought stock', 'Use 1 pcs', 'Add 1 pcs']) expect(screen.queryByTitle(title)).toBeNull()
    expect(screen.getByTitle('Edit')).toBeTruthy()
    expect(screen.getByTitle('Delete')).toBeTruthy()
    expect(container.firstChild.className).not.toContain('239,68,68')
  })

  it('the K138 note comes after the "also:" line of other names', () => {
    render(<ItemTile item={{ id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'misc', names: [{ name: 'Corn Snack' }] }} namesReady onAdjust={() => {}} onDiscard={() => {}} onEdit={() => {}} onDelete={() => {}} onSendToGrocery={() => {}} />)
    const text = document.body.textContent
    expect(text.indexOf('also: Corn Snack')).toBeGreaterThan(-1)
    expect(text.indexOf('also: Corn Snack')).toBeLessThan(text.indexOf('Item group from an older app version'))
  })

  it('a variant at 0 is red "Out" with its own cart button, like any item', () => {
    const { container } = tile({ id: 'v0', name: 'Pringles', unit: 'pcs', current_stock: 0, min_stock: 0, group_id: 'g', category_id: 'misc' })
    expect(screen.getByText('Out')).toBeTruthy()
    expect(screen.getByTitle('Add to grocery list')).toBeTruthy()
    expect(container.firstChild.className).toContain('239,68,68')
    expect(screen.queryByText(/in Chips/)).toBeNull()
  })
})

describe('Finished one-time items', () => {
  const finished = [
    { ...sun, current_stock: 0 },
    { ...sun, id: 'v', name: 'Party chips', current_stock: 0, group_id: 'g' },
  ]

  it('is closed at first with its count, lists the items (no "in {group}" any more) and offers "Not one-time"', () => {
    const onNotOneTime = vi.fn()
    render(<FinishedItems items={finished} onNotOneTime={onNotOneTime} onEdit={() => {}} onDelete={() => {}} />)
    const header = screen.getByRole('button', { name: /Finished one-time items \(2\)/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Sun cream')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('Sun cream')).toBeTruthy()
    expect(screen.getByText('Party chips')).toBeTruthy()
    expect(screen.queryByText(/^in /)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Not one-time' })[0])
    expect(onNotOneTime).toHaveBeenCalledWith(finished[0])
    expect(screen.getAllByText(/at 0 it is Out and goes on the SHOP list/).length).toBeGreaterThan(0)
  })

  it('shows nothing when nothing is finished', () => {
    const { container } = render(<FinishedItems items={[]} onNotOneTime={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})

// A group row an older app version made (K138), stored as it is (own stock
// 0), and its variants: normal items now.
const chipsGroup = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'misc' }
const variants = [
  { id: 'lays', name: 'Lays', unit: 'pcs', current_stock: 5, min_stock: 1, group_id: 'g', category_id: 'misc' },
  { id: 'pr', name: 'Patatine teriyaki', unit: 'pcs', current_stock: 0, min_stock: 0, group_id: 'g', category_id: 'misc' },
  { id: 'cv', name: 'Chips - di verdure al sale marino', unit: 'pcs', current_stock: 0, min_stock: 0, group_id: 'g', category_id: 'misc' },
]
const chips = [chipsGroup, ...variants]
const row = { id: 'e1', name: 'Chips & Snacks', category_id: 'misc', quantity: 1, unit: 'pcs', pantry_item_id: 'g', in_cart: false, completed: false, created_at: '2026-10-01' }

const variantEntry = (variant, extra = {}) => ({ id: `e-${variant.id}`, name: variant.name, category_id: 'misc', quantity: 1, unit: 'pcs', price: 0, pantry_item_id: variant.id, auto_generated: true, in_cart: false, completed: false, created_at: '2026-10-01', ...extra })
const variantById = new Map(variants.map((v) => [v.id, v]))
const pantryOfEntry = (e) => variantById.get(e.pantry_item_id) ?? (e.pantry_item_id === 'g' ? chipsGroup : null)

describe('SHOP list tiles', () => {
  const tile = (props) =>
    render(<GroceryItemTile item={row} reason="new" categoryName={() => 'Misc'} onToggle={() => {}} onDelete={() => {}} onUpdatePricing={() => {}} onUpdatePayer={() => {}} {...props} />)

  it('a 1× entry shows the grey "1× purchase", in "to buy" and in the cart', () => {
    tile({ item: { ...row, pantry_item_id: null, name: 'Balloons' }, reason: 'new', oneTime: true })
    expect(screen.getByText('1× purchase')).toBeTruthy()
    cleanup()
    tile({ item: { ...row, pantry_item_id: null, name: 'Balloons', in_cart: true }, reason: 'new', oneTime: true })
    expect(screen.getByText('1× purchase')).toBeTruthy()
  })
})

describe('SHOP list: a variant of a group row is a normal card (round 6D stage 5)', () => {
  it('one card per entry, red "Out of Stock", its own remove; no group card, no "Not urgent", no "Add another variant"', () => {
    const onDelete = vi.fn()
    const entry = variantEntry(variantById.get('pr'), { price: 2.49 })
    const { container } = render(
      <GroceryItemTile item={entry} reason="out" pack={variantById.get('pr')} total={2.49} categoryName={() => 'Misc'} onToggle={() => {}} onDelete={onDelete} onUpdatePricing={() => {}} onUpdatePayer={() => {}} />
    )
    expect(screen.getByText('Out of Stock')).toBeTruthy()
    expect(container.firstChild.className).toContain('239,68,68')
    expect(screen.queryByRole('region', { name: /\(group\)/ })).toBeNull()
    expect(screen.queryByText('Not urgent')).toBeNull()
    expect(screen.queryByText(/Add another variant|You choose the variant/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Patatine teriyaki' }))
    expect(onDelete).toHaveBeenCalledWith(entry)
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Balloons', oneTime: true, pantryItemId: null })
  })

  it('an item already in HOME (also a finished 1× one) links to it and shows its flag instead', async () => {
    const hats = { ...sun, id: 'hats', name: 'Balloons', current_stock: 0 }
    const onAdd = form(new Map([[normName('Balloons'), hats]]))
    expect(screen.queryByRole('checkbox', { name: /One-time purchase/ })).toBeNull()
    expect(screen.getByText(/is a one-time purchase \(1×\) in HOME/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(onAdd.mock.calls[0][0]).toMatchObject({ pantryItemId: 'hats', oneTime: false })
  })
})

describe('Confirm purchase', () => {
  const confirm = (cartItems, pantryItems) =>
    render(<ConfirmPurchase cartItems={cartItems} pantryItems={pantryItems} categoryName={() => 'Misc'} totalOf={() => 0} updatePricing={vi.fn()} updatePayer={vi.fn()} toggleCart={vi.fn()} onClose={() => {}} />)

  it('a card linked to a group row (older app version): no variant select, the K138 text, Confirm locked (K138 b)', () => {
    confirm([{ ...row, in_cart: true }], chips)
    expect(screen.queryByRole('combobox', { name: /Variant/ })).toBeNull()
    expect(screen.queryByText(/Which variant|Choose a variant|New variant/)).toBeNull()
    expect(screen.getByText('"Chips & Snacks" is an item group from an older app version and can\'t get stock — merge its variants into it first (Home → Edit item → Merge other items into this one…), or take this card out of the cart.')).toBeTruthy()
    expect(screen.queryByText(/restocks "Chips & Snacks"/)).toBeNull()
    expect(screen.getByRole('button', { name: /^Confirm purchase · / }).disabled).toBe(true)
  })

  it('shows the grey "1× purchase" on a one-time line', () => {
    confirm([{ ...row, id: 'e2', name: 'Balloons', pantry_item_id: null, one_time: true, in_cart: true }], [])
    expect(screen.getByText('1× purchase')).toBeTruthy()
  })

  it("each variant's card is its own line with its own price, in no group box; Confirm open", () => {
    const cart = [variantEntry(variantById.get('cv'), { in_cart: true, price: 1.99 }), variantEntry(variantById.get('pr'), { in_cart: true, price: 2.49 })]
    render(<ConfirmPurchase cartItems={cart} pantryItems={chips} categoryName={() => 'Misc'} totalOf={(e) => Number(e.price)} updatePricing={vi.fn()} updatePayer={vi.fn()} toggleCart={vi.fn()} onClose={() => {}} />)
    expect(screen.queryByRole('group', { name: /\(group\)/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Total for Patatine teriyaki' }).value).toBe('2.49')
    expect(screen.getByRole('textbox', { name: 'Total for Chips - di verdure al sale marino' }).value).toBe('1.99')
    expect(screen.queryByRole('combobox', { name: /Variant/ })).toBeNull()
    expect(screen.getByText(/restocks "Patatine teriyaki"/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm purchase · €4.48' }).disabled).toBe(false)
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
    const { container } = render(<ShoppingMode items={items} shopOrder={parents.map((p) => p.id)} categoryName={() => 'Misc'} totalOf={() => 0} costOf={() => 0} budget={null} onCheck={() => {}} onConfirm={() => {}} />)
    const text = container.textContent
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Third'))
  })

  it('one tile per entry, no group card and no "Not urgent"; a tap puts only that one in the cart', () => {
    const entries = [variantEntry(variantById.get('pr')), variantEntry(variantById.get('cv'))]
    const onCheck = vi.fn()
    render(<ShoppingMode items={entries} shopOrder={parents.map((p) => p.id)} categoryName={() => 'Misc'} totalOf={() => 0} costOf={() => 0} budget={null} pantryFor={pantryOfEntry} onCheck={onCheck} onConfirm={() => {}} />)
    expect(screen.queryByRole('region', { name: /\(group\)/ })).toBeNull()
    expect(screen.queryByText('Not urgent')).toBeNull()
    fireEvent.click(screen.getByText('Patatine teriyaki'))
    expect(onCheck).toHaveBeenCalledWith(entries[0])
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
})
