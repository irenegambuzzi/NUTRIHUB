// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Stage 2 of round 6D (plan 9N) on the screens: the grey line on the HOME
// tile, "Other names" in "Edit item", K59 in the editor, other names in the
// SHOP form and MONEY rows, K58 after "Use …" and "Create new", and Home →
// History. An item with no names looks exactly as before, and while
// supabase/032 isn't known to have run nothing new shows.

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../lib/feedback', async (original) => ({ ...(await original()), showToast: toast }))
const words = vi.hoisted(() => ({ kept: [], first: [] }))
vi.mock('../hooks/itemNameActions', () => ({
  keepTypedName: (word, id) => words.kept.push([word, id]),
  keepFirstWord: (word, name) => words.first.push([word, name]),
}))

const data = vi.hoisted(() => {
  const element = (name, extra = {}) => ({ name, packaging_unit: null, quantity_per_pack: null, origin: null, ...extra })
  const chips = {
    id: 'chips',
    name: 'Chips & Snacks',
    unit: 'pcs',
    current_stock: 11,
    min_stock: 0,
    category_id: 'fresh',
    names: [element('Corn Snack', { packaging_unit: 'box', quantity_per_pack: 12 }), element('Nuvole di drago'), element('Tortilla Chips', { origin: { id: 'old' } })],
  }
  const soap = { id: 'soap', name: 'Dish soap', unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'cleaning', names: [element('Svelto')] }
  const pumpkin = { id: 'pumpkin', name: 'Fresh Pumpkin', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh', names: [] }
  const crisps = { id: 'crisps', name: 'Crisps', unit: 'pcs', current_stock: 0, min_stock: 0, category_id: 'fresh', is_group: true, names: [] }
  const lays = { id: 'lays', name: 'Lays', unit: 'pcs', current_stock: 3, min_stock: 0, category_id: 'fresh', group_id: 'crisps', names: [] }
  return { element, chips, soap, pumpkin, crisps, lays, pantry: [chips, soap, pumpkin, crisps, lays], logs: [] }
})
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => data.pantry),
  groceryStore: fake(() => []),
  orderStore: fake(() => []),
  budgetMapStore: fake(() => []),
  stockLogStore: fake(() => data.logs),
  inventoryCategoryStore: fake(() => [{ id: 'fresh', name: 'Fresh' }, { id: 'cleaning', name: 'Cleaning' }]),
}))
vi.mock('../hooks/useInventoryCategories', () => {
  const parents = [
    { id: 'fresh', name: 'Fresh', type: 'parent' },
    { id: 'cleaning', name: 'Cleaning', type: 'parent' },
  ]
  return { useInventoryCategories: () => ({ parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }) }
})
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => ({ categoryId: 'fresh', subcategoryId: null }), suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const recordMoneyPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: (...args) => recordMoneyPurchase(...args) }))
vi.mock('../hooks/useExpenses', () => ({ addExpenseOnce: vi.fn(async () => ({ error: null })) }))

const { AddItemForm } = await import('./grocery/AddItemForm')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { ItemTile } = await import('./inventory/ItemTile')
const { HistoryView } = await import('./inventory/HistoryView')
const { addOtherNames } = await import('../lib/itemNames')
const { setOnlineForTest } = await import('../lib/connection')

afterEach(() => {
  cleanup()
  toast.mockReset()
  recordMoneyPurchase.mockClear()
  words.kept.length = 0
  words.first.length = 0
  data.logs = []
  setOnlineForTest(true)
  localStorage.clear()
})

const parents = [{ id: 'fresh', name: 'Fresh' }, { id: 'cleaning', name: 'Cleaning' }]
const subsByParent = new Map(parents.map((p) => [p.id, []]))

describe('HOME tile (K57)', () => {
  const tile = (item, props = {}) => render(<ItemTile item={item} namesReady onAdjust={vi.fn()} onDiscard={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSendToGrocery={vi.fn()} {...props} />)
  const ten = { ...data.chips, names: ['Corn Snack', 'Nuvole di drago', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((n) => data.element(n)) }

  it('one grey line under the name: "also: Corn Snack, Nuvole di drago… +8", at most 2 lines, wrapped', () => {
    tile(ten)
    const line = screen.getByText('also: Corn Snack, Nuvole di drago…')
    expect(line.parentElement.textContent).toBe('also: Corn Snack, Nuvole di drago… +8')
    expect(line.className).toContain('line-clamp-2')
    expect(line.className).toContain('break-words')
    expect(line.parentElement.className).not.toContain('overflow-x')
  })

  it('an item with no names renders exactly as an item before 032', () => {
    const { pumpkin } = data
    const { names: _names, ...before } = pumpkin
    const now = tile(pumpkin).container.innerHTML
    cleanup()
    expect(tile(before, { namesReady: false }).container.innerHTML).toBe(now)
    expect(screen.queryByText(/^also:/)).toBeNull()
  })

  it('while 032 is not known to have run there is no line', () => {
    tile(ten, { namesReady: false })
    expect(screen.queryByText(/^also:/)).toBeNull()
  })
})

describe('"Edit item" → "Other names"', () => {
  const editor = (item, props = {}) => {
    const onSave = vi.fn(async () => ({ error: null }))
    const onGoTo = vi.fn()
    render(<ItemEditor item={item} parents={parents} subsByParent={subsByParent} onSave={onSave} onClose={vi.fn()} homeItems={data.pantry} onGoTo={onGoTo} namesReady {...props} />)
    return { onSave, onGoTo }
  }
  const press = () => fireEvent.click(screen.getByRole('button', { name: /Save changes|Add to inventory/ }))
  const section = () => screen.queryByText('Other names')

  it('each name with its pack field; a name from a merge has no ×', () => {
    editor(data.chips)
    expect(section()).toBeTruthy()
    const corn = screen.getByRole('group', { name: 'Other name Corn Snack' })
    expect(within(corn).getByText('pcs per box')).toBeTruthy()
    expect(within(corn).getByLabelText('pcs per box of Corn Snack').value).toBe('12')
    expect(within(corn).getByLabelText('Purchase unit of Corn Snack').value).toBe('box')
    expect(screen.getByRole('button', { name: 'Remove Corn Snack' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Nuvole di drago' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Other name Tortilla Chips' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Tortilla Chips' })).toBeNull()
  })

  it('never in "Add an item", for a group, a variant or a durable', () => {
    editor(undefined)
    expect(screen.getByText('Add an item')).toBeTruthy()
    expect(section()).toBeNull()
    cleanup()
    editor(data.crisps)
    expect(screen.getByText('Edit group')).toBeTruthy()
    expect(section()).toBeNull()
    cleanup()
    editor(data.lays, { groups: [data.crisps] })
    expect(section()).toBeNull()
    cleanup()
    editor({ ...data.pumpkin, category_id: 'appliances' })
    expect(section()).toBeNull()
  })

  it('while 032 is not known to have run: no section, and Save sends no names', async () => {
    const { onSave } = editor(data.chips, { namesReady: false })
    expect(section()).toBeNull()
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1]).toEqual({ converted: false })
  })

  it('Save with no change to the names sends none', async () => {
    const { onSave } = editor(data.chips)
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1]).toEqual({ converted: false })
  })

  it('"+ Add a name" with a pack size, × on another: one payload with `was`', async () => {
    const { onSave } = editor(data.chips)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Nuvole di drago' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add a name' }))
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Popcorn' } })
    const box = screen.getByRole('group', { name: 'Other name Popcorn' })
    fireEvent.change(within(box).getByLabelText('Purchase unit of Popcorn'), { target: { value: 'bag' } })
    fireEvent.change(within(box).getByLabelText('pcs per bag of Popcorn'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('pcs per box of Corn Snack'), { target: { value: '10' } })
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1].names).toEqual({
      item_id: 'chips',
      add: [{ name: 'Popcorn', packaging_unit: 'bag', quantity_per_pack: 5, price: null, price_qty: null, price_unit: null }],
      remove: ['Nuvole di drago'],
      edit: [{ name: 'Corn Snack', packaging_unit: 'box', quantity_per_pack: 10 }],
      was: { names: data.chips.names },
    })
  })

  it('K59: a word of another item is stopped before saving, with the note; changing it clears it', async () => {
    const { onSave } = editor(data.pumpkin)
    fireEvent.click(screen.getByRole('button', { name: '+ Add a name' }))
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'svelto' } })
    press()
    expect(await screen.findByText('"svelto" is already a name of "Dish soap" in HOME.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Dish soap' } })
    expect(screen.queryByText(/is already a name of/)).toBeNull()
    press()
    expect(await screen.findByText('"Dish soap" is already a name of "Dish soap" in HOME.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Zucca' } })
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1].names.add[0].name).toBe('Zucca')
  })

  it('K59: renaming to another item\'s other name is stopped with the same note, and "Go to …"', () => {
    const { onSave, onGoTo } = editor(data.pumpkin)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rice/), { target: { value: 'Corn Snack' } })
    press()
    expect(screen.getByText('"Corn Snack" is already a name of "Chips & Snacks" in HOME.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Chips & Snacks' }))
    expect(onGoTo).toHaveBeenCalledWith(data.chips, 'Corn Snack')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('K59: "Add an item" with another item\'s other name follows the exact-name way of 9G', () => {
    const { onSave } = editor(undefined)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rice/), { target: { value: 'nuvole di drago' } })
    press()
    expect(screen.getByText('"nuvole di drago" is already a name of "Chips & Snacks" in HOME.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to Chips & Snacks' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create new/ })).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a similar other name: "Go to Chips & Snacks (Nuvole di drago)" with "Create new"', () => {
    editor(undefined)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rice/), { target: { value: 'Nuvole di dragho' } })
    press()
    expect(screen.getByRole('button', { name: 'Go to Chips & Snacks (Nuvole di drago)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create new “Nuvole di dragho”' })).toBeTruthy()
  })

  it('K58: "Create new" and then another name: the word first typed goes with the new item', async () => {
    const { onSave } = editor(undefined)
    const name = () => screen.getByPlaceholderText(/e\.g\. Rice/)
    fireEvent.change(name(), { target: { value: 'Pumkin' } })
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    fireEvent.change(name(), { target: { value: 'Frozen Pumpkin Cubes' } })
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1]).toEqual({ converted: false, firstWord: 'Pumkin' })
  })

  it('K58: "Create new" with the name as it was: nothing more to keep', async () => {
    const { onSave } = editor(undefined)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rice/), { target: { value: 'Pumkin' } })
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    press()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][1]).toEqual({ converted: false })
  })
})

describe('SHOP "Add to SHOP list"', () => {
  const form = () => {
    const onAdd = vi.fn(async () => ({ error: null }))
    const plain = data.pantry.filter((p) => !p.is_group)
    render(
      <AddItemForm
        parents={parents}
        subsByParent={subsByParent}
        categoryName={(id) => id}
        pantryByName={addOtherNames(new Map(plain.map((p) => [p.name.toLowerCase(), p])), plain)}
        homeItems={data.pantry}
        onAdd={onAdd}
        onAdded={vi.fn()}
      />
    )
    return onAdd
  }
  const typeName = (value) => fireEvent.change(screen.getByLabelText('Item name'), { target: { value } })
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  it.each([[true], [false]])('an exact other name links its item, no question; the entry keeps the name typed (online: %s)', async (online) => {
    setOnlineForTest(online)
    const onAdd = form()
    typeName('corn snack')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'corn snack', pantryItemId: 'chips', categoryId: 'fresh' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “corn snack” · in HOME: 11 pcs' })
    expect(words.kept).toEqual([])
  })

  it.each([[true], [false]])('a similar other name asks; "Use …" takes that name, then the word typed is kept (online: %s)', async (online) => {
    setOnlineForTest(online)
    const onAdd = form()
    typeName('Nuvole di dragho')
    press()
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Chips & Snacks (Nuvole di drago) · 11 pcs at home' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Nuvole di drago', pantryItemId: 'chips' })
    expect(words.kept).toEqual([['Nuvole di dragho', 'chips']])
  })

  it('"Use …" on an own name: the entry takes the item\'s name; the word typed is kept after the entry is saved', async () => {
    const onAdd = form()
    typeName('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Fresh Pumpkin', pantryItemId: 'pumpkin' })
    await waitFor(() => expect(words.kept).toEqual([['Pumkin', 'pumpkin']]))
  })

  it('a failed entry keeps nothing', async () => {
    const onAdd = form()
    onAdd.mockResolvedValueOnce({ error: { message: 'no' } })
    typeName('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(words.kept).toEqual([])
  })

  it('"Create new" keeps no word: the HOME item is made later, at Confirm', async () => {
    const onAdd = form()
    typeName('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    typeName('Pumkin Cubes Frozen')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(words.kept).toEqual([])
    expect(words.first).toEqual([])
  })

  it('a suggestion "Corn Snack · Chips & Snacks": tapped, then saved, it links the item', async () => {
    const onAdd = form()
    typeName('corn')
    fireEvent.click(screen.getByRole('button', { name: /Corn Snack · Chips & Snacks/ }))
    expect(screen.getByLabelText('Item name').value).toBe('Corn Snack')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Corn Snack', pantryItemId: 'chips' })
  })

  it("the item's price never fills in for another name (K55)", () => {
    data.chips.price = 9
    form()
    typeName('Corn Snack')
    expect(screen.queryByDisplayValue('9.00')).toBeNull()
    typeName('Chips & Snacks')
    expect(screen.queryByDisplayValue('9.00')).toBeTruthy()
    delete data.chips.price
  })
})

describe('MONEY "Add expense"', () => {
  const expenseCategories = [{ id: 'groceries', name: 'Groceries', parent_id: null }]
  const form = () =>
    render(
      <PurchaseForm
        expenseCategories={expenseCategories}
        mainCategories={expenseCategories}
        subsOf={() => []}
        addCategory={vi.fn()}
        renameCategory={vi.fn()}
        moveCategory={vi.fn()}
        deleteCategory={vi.fn()}
        styleFor={() => ({ hex: '#000' })}
        onClose={vi.fn()}
      />
    )
  const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const save = () => fireEvent.click(screen.getByRole('button', { name: /Save purchase|Add expense ·/ }))

  it('an exact other name is the item, no question; the row keeps the name', async () => {
    form()
    type('Name', 'Corn Snack')
    type('Price', '1.39')
    expect(screen.getByText('In HOME: 11 pcs')).toBeTruthy()
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ name: 'Corn Snack', pantry_item_id: 'chips', add: 1, line_total: 1.39 })
    await waitFor(() => expect(words.kept).toEqual([]))
  })

  it('"Use …" with a name: the row takes it; only after Save the word typed is kept', async () => {
    form()
    type('Name', 'Nuvole di dragho')
    type('Price', '0.99')
    fireEvent.click(await screen.findByRole('button', { name: 'Use Chips & Snacks (Nuvole di drago) · 11 pcs at home' }))
    expect(screen.getByLabelText('Name').value).toBe('Nuvole di drago')
    expect(words.kept).toEqual([])
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(words.kept).toEqual([['Nuvole di dragho', 'chips']]))
  })

  it('"Use …", then the name typed again by hand: nothing is kept', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '2')
    fireEvent.click(await screen.findByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    type('Name', 'Dish soap')
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve))
    expect(words.kept).toEqual([])
  })

  it('a save that fails keeps nothing', async () => {
    recordMoneyPurchase.mockResolvedValueOnce({ error: { message: 'no' } })
    form()
    type('Name', 'Pumkin')
    type('Price', '2')
    fireEvent.click(await screen.findByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve))
    expect(words.kept).toEqual([])
  })

  it('"Create new", then another name: the item is made in this same action, so the first word goes with it', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create new “Pumkin”' }))
    type('Name', 'Pear Cubes')
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(words.first).toEqual([['Pumkin', 'Pear Cubes']]))
  })

  it('"Create new" with the name as it was: nothing to keep', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create new “Pumkin”' }))
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve))
    expect(words.first).toEqual([])
  })
})

describe('Home → History (report J.2)', () => {
  const log = (id, item_id, item_name, reason, extra = {}) => ({ id, item_id, item_name, reason, change: 1, new_stock: 3, unit: 'pcs', created_at: '2026-11-04T10:00:00Z', ...extra })
  const logs = () => [
    log('a', 'chips', 'Corn Snack', 'purchased'),
    log('b', 'chips', 'Chips & Snacks', 'used', { change: -1 }),
    log('c', 'chips', 'Tortilla Chips', 'merged', { change: 4 }),
    log('d', 'soap', 'Svelto', 'separated', { change: -2 }),
    log('e', 'pumpkin', 'Fresh Pumpkin', 'added'),
    log('f', null, 'Old Tea', 'used', { change: -1 }),
    log('g', null, 'Dish soap', 'used', { change: -1 }),
  ]
  const row = (id) => screen.getByLabelText(`Delete this entry for ${id}`).closest('div.flex')
  const rows = () => [...document.querySelectorAll('div.flex.items-center.gap-3')]
  const show = (props = { items: data.pantry, namesReady: true }) => {
    data.logs = logs()
    render(<HistoryView {...props} />)
  }

  it('title = the item of now, the stored name under it when different', () => {
    show()
    const [bought, used, merged, separated, added] = rows()
    expect(bought.querySelector('p').textContent).toBe('Chips & Snacks')
    expect(bought.querySelectorAll('p')[1].textContent).toMatch(/^Corn Snack · Bought · 4 Nov 2026/)
    expect(used.querySelector('p').textContent).toBe('Chips & Snacks')
    expect(used.querySelectorAll('p')[1].textContent).toMatch(/^Used · 4 Nov 2026/)
    expect(merged.querySelectorAll('p')[1].textContent).toMatch(/^Tortilla Chips · Merged · /)
    expect(separated.querySelector('p').textContent).toBe('Dish soap')
    expect(separated.querySelectorAll('p')[1].textContent).toMatch(/^Svelto · Separated · /)
    expect(added.querySelectorAll('p')[1].textContent).toMatch(/^Added · /)
  })

  it('a deleted item keeps its stored name and "deleted item" (K29)', () => {
    show()
    const tea = rows()[5]
    expect(tea.querySelector('p').textContent).toBe('Old Tea')
    expect(tea.querySelectorAll('p')[1].textContent).toMatch(/^Used · .* · deleted item$/)
  })

  it('the Item filter goes by item_id: one option per item, whatever the stored names', () => {
    show()
    const select = screen.getByLabelText('Item')
    expect([...select.options].map((o) => o.textContent)).toEqual(['All items', 'Chips & Snacks', 'Dish soap', 'Dish soap (deleted item)', 'Fresh Pumpkin', 'Old Tea (deleted item)'])
    fireEvent.change(select, { target: { value: 'id:chips' } })
    expect(rows()).toHaveLength(3)
    fireEvent.change(select, { target: { value: 'id:soap' } })
    expect(rows()).toHaveLength(1)
    fireEvent.change(select, { target: { value: 'Dish soap' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('deleted item')
  })

  it('the new reasons are in the Reason filter', () => {
    show()
    const options = [...screen.getByLabelText('Reason').options].map((o) => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['Merged', 'Separated']))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'merged' } })
    expect(rows()).toHaveLength(1)
  })

  it('while 032 is not known to have run: the stored name, the old filter, no new reason', () => {
    show({ items: data.pantry, namesReady: false })
    expect(rows()[0].querySelector('p').textContent).toBe('Corn Snack')
    expect(rows()[0].querySelectorAll('p')[1].textContent).toMatch(/^Bought · /)
    expect([...screen.getByLabelText('Item').options].map((o) => o.textContent)).toEqual(['All items', 'Chips & Snacks', 'Corn Snack', 'Dish soap', 'Fresh Pumpkin', 'Old Tea', 'Svelto', 'Tortilla Chips'])
    expect([...screen.getByLabelText('Reason').options].map((o) => o.textContent)).not.toContain('Merged')
    expect([...screen.getByLabelText('Reason').options].map((o) => o.textContent)).not.toContain('Separated')
    expect(row('Svelto')).toBeTruthy()
  })
})
