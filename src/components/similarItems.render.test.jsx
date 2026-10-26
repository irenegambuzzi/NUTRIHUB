// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The similar-name safety net on the screens (plan 9G): SHOP quick add and
// More options, MONEY "Add expense" rows, the HOME item editor.

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../lib/feedback', async (original) => ({ ...(await original()), showToast: toast }))

const data = vi.hoisted(() => {
  const pumpkin = { id: 'pumpkin', name: 'Fresh Pumpkin', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh' }
  const cucumber = { id: 'cucumber', name: 'cucumber', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'fresh' }
  const soap = { id: 'soap', name: 'Dish soap', unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'cleaning' }
  const balloons = { id: 'balloons', name: 'Balloons', unit: 'pcs', current_stock: 0, min_stock: 0, one_time: true, category_id: 'misc' }
  return {
    pumpkin,
    cucumber,
    soap,
    balloons,
    pantry: [pumpkin, cucumber, soap, balloons],
    grocery: [
      { id: 'g-cucumber', name: 'cucumber', quantity: 1, unit: 'pcs', pantry_item_id: 'cucumber', completed: false, in_cart: false },
      { id: 'g-soap', name: 'Dish soap', quantity: 1, unit: 'pcs', pantry_item_id: 'soap', completed: false, in_cart: true },
    ],
  }
})
const fake = (rows) => ({ useRows: () => ({ rows, loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(data.pantry),
  groceryStore: fake(data.grocery),
  orderStore: fake([]),
  budgetMapStore: fake([]),
  inventoryCategoryStore: fake([{ id: 'fresh', name: 'Fresh' }, { id: 'cleaning', name: 'Cleaning' }]),
}))
vi.mock('../hooks/useInventoryCategories', () => {
  const parents = [
    { id: 'fresh', name: 'Fresh', type: 'parent' },
    { id: 'cleaning', name: 'Cleaning', type: 'parent' },
  ]
  return { useInventoryCategories: () => ({ parents, subsByParent: new Map(parents.map((p) => [p.id, []])), addCategory: vi.fn(), addSubcategory: vi.fn() }) }
})
// Names that get a HOME category from the suggestion door (it has its own tests).
const CATEGORY = { pumpkin: 'fresh', pumkin: 'fresh', 'fresh pumpkin': 'fresh', cucumber: 'fresh', cucumbers: 'fresh', 'dish soap': 'cleaning', 'frozen pumpkin cubes': 'fresh', lamp: 'appliances' }
vi.mock('../hooks/useCategorySuggestions', () => {
  const pick = (name) => CATEGORY[name.trim().toLowerCase()]
  return {
    useCategorySuggestions: () => ({
      suggest: (name) => (pick(name) ? { categoryId: pick(name), subcategoryId: null } : null),
      suggestions: () => [],
      budgetSuggestions: () => [],
      remember: () => {},
      rememberBudget: () => {},
    }),
  }
})
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const recordMoneyPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: (...args) => recordMoneyPurchase(...args) }))
vi.mock('../hooks/useExpenses', () => ({ addExpenseOnce: vi.fn(async () => ({ error: null })) }))

const { QuickAdd } = await import('./grocery/QuickAdd')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { ItemEditor } = await import('./inventory/ItemEditor')

afterEach(() => {
  cleanup()
  toast.mockReset()
  recordMoneyPurchase.mockClear()
  localStorage.clear()
})

const parents = [{ id: 'fresh', name: 'Fresh' }, { id: 'cleaning', name: 'Cleaning' }, { id: 'appliances', name: 'Durables' }]
const subsByParent = new Map(parents.map((p) => [p.id, []]))
const entry = (extra) => ({ id: 'g1', name: 'Dish soap', quantity: 1, unit: 'pcs', pantry_item_id: 'soap', completed: false, in_cart: false, created_at: '2026-10-26T08:00:00Z', ...extra })

describe('SHOP quick add', () => {
  // `listed`: what the suggestion list under the box is built from.
  const quickAdd = ({ entries = [], orderedIds = new Set(), homeItems = data.pantry, listed = homeItems } = {}) => {
    const addItem = vi.fn(async () => ({ error: null }))
    const updatePricing = vi.fn(async () => ({ error: null }))
    const open = entries.filter((e) => !orderedIds.has(e.id))
    render(
      <QuickAdd
        items={open}
        pantryItems={listed}
        homeItems={homeItems}
        openEntries={entries}
        orderedIds={orderedIds}
        parents={parents}
        subsByParent={subsByParent}
        categoryName={(id) => id}
        addItem={addItem}
        updatePricing={updatePricing}
        totalFor={() => 0}
        onMoreOptions={vi.fn()}
      />
    )
    return { addItem, updatePricing }
  }
  const typeIn = (text) => fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: text } })
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'Add' }))

  it('a similar name saves nothing and asks; "Use …" adds the HOME item with its name', async () => {
    const { addItem } = quickAdd()
    typeIn('Pumkin')
    press()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create new “Pumkin”' })).toBeTruthy()
    expect(addItem).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Fresh Pumpkin', pantryItemId: 'pumpkin' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Fresh Pumpkin” · in HOME: 2 pcs' })
  })

  it('"Create new" keeps the name with a hint; the next press adds it; a changed name is checked again; typing closes a question', async () => {
    const { addItem } = quickAdd()
    typeIn('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    expect(screen.getByText('Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.')).toBeTruthy()
    typeIn('Pumpkin')
    press()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    typeIn('Pumpkin!')
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    typeIn('Frozen Pumpkin Cubes')
    press()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Frozen Pumpkin Cubes', pantryItemId: null })
  })

  it('"Create new" then the same name: added as typed, not linked', async () => {
    const { addItem } = quickAdd()
    typeIn('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    press()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Pumkin', pantryItemId: null })
  })

  it('the same name as a HOME item uses it without a question', async () => {
    const { addItem } = quickAdd()
    typeIn('Cucumbers')
    press()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'cucumber', pantryItemId: 'cucumber', categoryId: 'fresh' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “cucumber” · in HOME: 2 pcs' })
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })

  it('nothing alike: as before, the first suggestion listed under the box is added ("mil" → Milk)', async () => {
    const milk = { ...data.cucumber, id: 'milk', name: 'Milk', unit: 'btl' }
    const { addItem } = quickAdd({ homeItems: [milk] })
    typeIn('mil')
    press()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Milk', pantryItemId: 'milk' })
  })

  it('a finished 1× item: "· finished 1× item, it comes back"', async () => {
    const { addItem } = quickAdd()
    typeIn('balloons')
    press()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Balloons” · finished 1× item, it comes back' })
  })

  it('already in the cart: no second entry; "OK" changes nothing, "Add 1 more (now 2 pcs)" adds to the entry', async () => {
    const inCart = entry({ in_cart: true })
    const { addItem, updatePricing } = quickAdd({ entries: [inCart] })
    typeIn('dish soap')
    press()
    expect(screen.getByText('Already on your SHOP list: Dish soap — in the cart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByText(/Already on your SHOP list/)).toBeNull()
    expect(addItem).not.toHaveBeenCalled()
    expect(updatePricing).not.toHaveBeenCalled()
    typeIn('dish soap')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 more (now 2 pcs)' }))
    await waitFor(() => expect(updatePricing).toHaveBeenCalledTimes(1))
    expect(updatePricing.mock.calls[0][0]).toBe(inCart)
    expect(updatePricing.mock.calls[0][1]).toEqual({ quantity: 2 })
    expect(addItem).not.toHaveBeenCalled()
  })

  it('ordered online: "Add anyway" makes a new entry to buy', async () => {
    const ordered = entry()
    const { addItem } = quickAdd({ entries: [ordered], orderedIds: new Set([ordered.id]) })
    typeIn('Dish soap')
    press()
    expect(screen.getByText('Already on your SHOP list: Dish soap — ordered online')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Dish soap', pantryItemId: 'soap' })
  })

  it('a similar item already on the list says so on its button', () => {
    quickAdd({ entries: [entry({ id: 'g2', name: 'Fresh Pumpkin', pantry_item_id: 'pumpkin' })] })
    typeIn('Pumpkin')
    press()
    expect(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home · already to buy' })).toBeTruthy()
  })

  it('a durable (its category in the Durables tree) skips the HOME check; the SHOP list is still checked', async () => {
    // (Not in the suggestion list here: a suggestion picked by Enter would
    // be added as before.)
    const { addItem } = quickAdd({ homeItems: [{ ...data.pumpkin, id: 'shade', name: 'Lamp Shade' }], listed: [] })
    typeIn('Lamp')
    press()
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1))
    expect(addItem.mock.calls[0][0]).toMatchObject({ name: 'Lamp', categoryId: 'appliances', pantryItemId: null })
  })
})

describe('SHOP More options', () => {
  const form = ({ entries = [] } = {}) => {
    const onAdd = vi.fn(async () => ({ error: null }))
    const onAddMore = vi.fn(async () => ({ error: null }))
    const pantryByName = new Map(data.pantry.map((p) => [p.name.toLowerCase(), p]))
    render(
      <AddItemForm
        parents={parents}
        subsByParent={subsByParent}
        categoryName={(id) => id}
        pantryByName={pantryByName}
        homeItems={data.pantry}
        openEntries={entries}
        onAdd={onAdd}
        onAddMore={onAddMore}
        onAddCategory={vi.fn()}
        onAddSubcategory={vi.fn()}
      />
    )
    return { onAdd, onAddMore }
  }
  const typeName = (text) => fireEvent.change(screen.getByLabelText('Item name'), { target: { value: text } })
  const press = () => fireEvent.click(screen.getByRole('button', { name: /Add to list/ }))

  it('a similar name asks; "Use …" adds the HOME item', async () => {
    const { onAdd } = form()
    typeName('Pumpkin')
    press()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Fresh Pumpkin', pantryItemId: 'pumpkin', categoryId: 'fresh' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Fresh Pumpkin” · in HOME: 2 pcs' })
  })

  it('already in the cart: "Add 3 more (now 4 pcs)" uses the quantity typed', async () => {
    const inCart = entry({ in_cart: true })
    const { onAdd, onAddMore } = form({ entries: [inCart] })
    typeName('Dish soap')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    press()
    expect(screen.getByText('Already on your SHOP list: Dish soap — in the cart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 more (now 4 pcs)' }))
    await waitFor(() => expect(onAddMore).toHaveBeenCalledWith(inCart, 4))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('a durable category skips the HOME check (only the SHOP list is checked)', async () => {
    const { onAdd } = form()
    typeName('Pumkin')
    fireEvent.change(screen.getByLabelText('Item category'), { target: { value: 'appliances' } })
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })
})

describe('MONEY Add expense: rows with Add to HOME on', () => {
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

  it('a similar name asks when typing pauses; Save is blocked until answered; "Create new" saves it as typed', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '3')
    expect(await screen.findByText('Similar item in HOME:')).toBeTruthy()
    save()
    expect(await screen.findAllByText('Choose “Use …” or “Create new” for this item.')).not.toHaveLength(0)
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    expect(screen.getByText('Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.')).toBeTruthy()
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ name: 'Pumkin', pantry_item_id: null })
  })

  it('Save checks the name at once, even before the pause; a changed name after "Create new" asks again', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '3')
    save()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    type('Name', 'Pumpkin')
    save()
    expect(screen.getByRole('button', { name: 'Create new “Pumpkin”' })).toBeTruthy()
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
  })

  it('"Use …" makes the row that HOME item (its name, its stock)', async () => {
    form()
    type('Name', 'Pumkin')
    type('Price', '3')
    fireEvent.click(await screen.findByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    expect(screen.getByLabelText('Name').value).toBe('Fresh Pumpkin')
    expect(screen.getByText('In HOME: 2 pcs')).toBeTruthy()
    expect(screen.getByText('Adds to "Fresh Pumpkin" in HOME (+1 pcs).')).toBeTruthy()
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ name: 'Fresh Pumpkin', pantry_item_id: 'pumpkin' })
  })

  it('the same name (a plural too) uses the HOME item with its stock note; its SHOP entry still leaves the list', async () => {
    form()
    type('Name', 'Cucumbers')
    type('Price', '1')
    expect(screen.getByText('In HOME: 2 pcs')).toBeTruthy()
    expect(screen.getByText('On your SHOP list — it will leave the list.')).toBeTruthy()
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ pantry_item_id: 'cucumber', list_entry_id: 'g-cucumber' })
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })

  it('an entry in the cart stays there (existing text)', () => {
    form()
    type('Name', 'Dish soap')
    expect(screen.getByText("It's in the cart in SHOP — it stays there.")).toBeTruthy()
  })

  it('a row with Add to HOME off asks nothing', async () => {
    form()
    type('Name', 'Pumkin')
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    type('Price', '3')
    await new Promise((r) => setTimeout(r, 450))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })
})

describe('HOME item editor', () => {
  const editor = (props = {}) => {
    const onSave = vi.fn(async () => ({ error: null }))
    const onGoTo = vi.fn()
    render(<ItemEditor parents={parents} subsByParent={subsByParent} onSave={onSave} onClose={vi.fn()} homeItems={data.pantry} onGoTo={onGoTo} {...props} />)
    return { onSave, onGoTo }
  }
  const nameField = () => screen.getByDisplayValue((value, el) => el.tagName === 'INPUT' && el.getAttribute('placeholder')?.startsWith('e.g. Rice'))
  const typeName = (text) => fireEvent.change(nameField(), { target: { value: text } })
  const save = (label = 'Add to inventory') => fireEvent.click(screen.getByRole('button', { name: label }))

  it('the same name is refused: "“cucumber” is already in HOME" with "Go to cucumber"', () => {
    const { onSave, onGoTo } = editor()
    typeName('Cucumber')
    save()
    expect(screen.getByText('“cucumber” is already in HOME')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Go to cucumber' }))
    expect(onGoTo).toHaveBeenCalledWith(data.cucumber)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a finished 1× item: "Go to Balloons (finished 1×)"', () => {
    editor()
    typeName('balloons')
    fireEvent.change(screen.getByLabelText('Item category'), { target: { value: 'fresh' } })
    save()
    expect(screen.getByRole('button', { name: 'Go to Balloons (finished 1×)' })).toBeTruthy()
  })

  it('a similar name asks; "Create new" saves the name as it is', async () => {
    const { onSave } = editor()
    typeName('Pumpkin')
    save()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to Fresh Pumpkin' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumpkin”' }))
    expect(screen.getByText('Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.')).toBeTruthy()
    save()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Pumpkin' })
  })

  it('a rename is checked (never against the item itself); an unchanged name is not', async () => {
    const { onSave } = editor({ item: data.pumpkin })
    typeName('Cucumber')
    save('Save changes')
    expect(screen.getByText('“cucumber” is already in HOME')).toBeTruthy()
    typeName('fresh pumpkins')
    save('Save changes')
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })
})
