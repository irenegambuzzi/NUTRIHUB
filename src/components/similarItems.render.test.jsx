// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PAID_BY_OPTIONS } from '../data/constants'

// The similar-name safety net on the screens (plan 9G and its follow-up of
// 26/10 and 27/10): the SHOP "Add to SHOP list" form (List view and Shop
// mode), MONEY "Add expense" rows, the HOME item editor.

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
  // Five sauces: "Sauce" matches all of them, 3 are shown.
  const sauces = ['Soy Sauce', 'Fish Sauce', 'Oyster Sauce', 'Tomato Sauce', 'Teriyaki Sauce'].map((name, i) => ({ id: `sauce${i}`, name, unit: 'btl', current_stock: 1, min_stock: 0, category_id: 'fresh' }))
  return {
    pumpkin,
    cucumber,
    soap,
    balloons,
    sauces,
    pantry: [pumpkin, cucumber, soap, balloons, ...sauces],
    grocery: [
      { id: 'g-cucumber', name: 'cucumber', quantity: 1, unit: 'pcs', pantry_item_id: 'cucumber', completed: false, in_cart: false },
      { id: 'g-soap', name: 'Dish soap', quantity: 1, unit: 'pcs', pantry_item_id: 'soap', completed: false, in_cart: true },
      // Typed in SHOP, no HOME item.
      { id: 'g-kites', name: 'Paper kites', quantity: 1, unit: 'pcs', pantry_item_id: null, completed: false, in_cart: false },
      { id: 'g-lamp', name: 'Lamp', quantity: 1, unit: 'pcs', pantry_item_id: null, completed: false, in_cart: false, category_id: 'appliances' },
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
const CATEGORY = { pumpkin: 'fresh', pumkin: 'fresh', 'fresh pumpkin': 'fresh', cucumber: 'fresh', cucumbers: 'fresh', 'dish soap': 'cleaning', 'frozen pumpkin cubes': 'fresh', lamp: 'appliances', kites: 'fresh', 'paper kites': 'fresh', sauce: 'fresh' }
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

describe('SHOP "Add to SHOP list" form', () => {
  const form = ({ entries = [], orderedIds = new Set(), homeItems = data.pantry } = {}) => {
    const onAdd = vi.fn(async () => ({ error: null }))
    const onAdded = vi.fn()
    const onGoToCard = vi.fn()
    const pantryByName = new Map(homeItems.filter((p) => !p.is_group).map((p) => [p.name.toLowerCase(), p]))
    render(
      <AddItemForm
        parents={parents}
        subsByParent={subsByParent}
        categoryName={(id) => id}
        pantryByName={pantryByName}
        homeItems={homeItems}
        openEntries={entries}
        orderedIds={orderedIds}
        onAdd={onAdd}
        onAddCategory={vi.fn()}
        onAddSubcategory={vi.fn()}
        onAdded={onAdded}
        onGoToCard={onGoToCard}
      />
    )
    return { onAdd, onAdded, onGoToCard }
  }
  const typeName = (text) => fireEvent.change(screen.getByLabelText('Item name'), { target: { value: text } })
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  const pressAgain = () => fireEvent.click(screen.getByRole('button', { name: 'Save & add another' }))
  const suggestions = () => screen.queryByRole('listbox', { name: 'Suggestions' })

  it('a similar name asks; "Use …" adds the HOME item and closes the form', async () => {
    const { onAdd, onAdded } = form()
    typeName('Pumpkin')
    press()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Fresh Pumpkin', pantryItemId: 'pumpkin', categoryId: 'fresh' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Fresh Pumpkin” · in HOME: 2 pcs' })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('"Create new" keeps the name with a hint; the next press saves it; a changed name is checked again; typing closes a question', async () => {
    const { onAdd } = form()
    typeName('Pumkin')
    press()
    expect(screen.getByRole('button', { name: 'Create new “Pumkin”' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    expect(screen.getByText('Similar names can mix up later — make it clearer, e.g. “Frozen Pumpkin Cubes”.')).toBeTruthy()
    typeName('Pumpkin')
    press()
    expect(screen.getByText('Similar item in HOME:')).toBeTruthy()
    typeName('Pumpkin!')
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    typeName('Frozen Pumpkin Cubes')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Frozen Pumpkin Cubes', pantryItemId: null })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Frozen Pumpkin Cubes”' })
  })

  it('"Create new" then the same name: saved as typed, not linked', async () => {
    const { onAdd } = form()
    typeName('Pumkin')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Create new “Pumkin”' }))
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Pumkin', pantryItemId: null })
  })

  it('the same name as a HOME item uses it without a question; the toast gives its HOME stock', async () => {
    const { onAdd } = form()
    typeName('Cucumbers')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'cucumber', pantryItemId: 'cucumber', categoryId: 'fresh' })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “cucumber” · in HOME: 2 pcs' })
  })

  it('a finished 1× item: "· finished 1× item, it comes back"', async () => {
    const { onAdd } = form()
    typeName('balloons')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Balloons” · finished 1× item, it comes back' })
  })

  it('a similar item already on the list says so on its button', () => {
    form({ entries: [entry({ id: 'g2', name: 'Fresh Pumpkin', pantry_item_id: 'pumpkin' })] })
    typeName('Pumpkin')
    press()
    expect(screen.getByRole('button', { name: 'Use Fresh Pumpkin · 2 pcs at home · already to buy' })).toBeTruthy()
  })

  it('a new name not in HOME: toast "Added “Napkins”" after "Save"', async () => {
    const { onAdd } = form()
    typeName('Napkins')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Napkins”' })
  })

  it('suggestions while typing come from HOME items (variants and groups too) and open SHOP cards, never from this phone’s history', () => {
    localStorage.setItem('nutrihub-quick-add-history', JSON.stringify([{ name: 'Pumpkin seeds', unit: 'pcs', price: 0, payer: 'shared' }]))
    const group = { id: 'chips', name: 'Chips & Snacks', is_group: true, unit: 'pcs', current_stock: 0, category_id: 'fresh' }
    const variant = { id: 'lays', name: 'Lays chips', group_id: 'chips', unit: 'pcs', current_stock: 0, category_id: 'fresh' }
    form({ homeItems: [...data.pantry, group, variant], entries: [entry({ id: 'g-pk', name: 'Pumpkin pie', pantry_item_id: null })] })
    typeName('pum')
    const shown = within(suggestions()).getAllByRole('option').map((o) => o.textContent)
    expect(shown.some((t) => t.startsWith('Fresh Pumpkin'))).toBe(true)
    expect(shown.some((t) => t.startsWith('Pumpkin pie'))).toBe(true)
    expect(shown.some((t) => t.startsWith('Pumpkin seeds'))).toBe(false)
    typeName('chips')
    const chips = within(suggestions()).getAllByRole('option').map((o) => o.textContent)
    expect(chips.some((t) => t.startsWith('Chips & Snacks'))).toBe(true)
    expect(chips.some((t) => t.startsWith('Lays chips'))).toBe(true)
  })

  it('a suggestion is never picked by itself: Save uses the name as typed (and the safety net checks it)', async () => {
    const milk = { ...data.cucumber, id: 'milk', name: 'Milk', unit: 'btl' }
    const { onAdd } = form({ homeItems: [milk] })
    typeName('mil')
    expect(within(suggestions()).getByText('Milk')).toBeTruthy()
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'mil', pantryItemId: null })
  })

  it('tapping a suggestion fills the name, as if typed: the HOME item’s category and unit, then linked', async () => {
    const milk = { ...data.cucumber, id: 'milk', name: 'Milk', unit: 'btl', category_id: 'fresh' }
    const { onAdd } = form({ homeItems: [milk] })
    typeName('mil')
    fireEvent.click(within(suggestions()).getByRole('button', { name: /^Milk/ }))
    expect(screen.getByLabelText('Item name').value).toBe('Milk')
    expect(screen.getByLabelText('Unit').value).toBe('btl')
    expect(suggestions()).toBeNull()
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Milk', pantryItemId: 'milk', unit: 'btl' })
  })

  it('"Save & add another" saves and keeps the form open, every field empty except Paid by', async () => {
    const { onAdd, onAdded } = form()
    const payer = PAID_BY_OPTIONS[0]
    typeName('Paper towels')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'pack' } })
    fireEvent.click(screen.getByRole('button', { name: payer.label }))
    pressAgain()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Paper towels', quantity: 3, unit: 'pack', payer: payer.value })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Paper towels”' })
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Item name').value).toBe('')
    expect(screen.getByLabelText('Quantity').value).toBe('1')
    expect(screen.getByLabelText('Unit').value).toBe('pcs')
    expect(screen.getByRole('button', { name: payer.label }).className).toContain('bg-[var(--color-accent)]')
    typeName('Napkins')
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2))
    expect(onAdd.mock.calls[1][0]).toMatchObject({ name: 'Napkins', payer: payer.value })
    expect(toast).toHaveBeenLastCalledWith({ message: 'Added “Napkins”' })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('"Save & add another" with a HOME item: the toast gives its HOME stock and the form stays open', async () => {
    const { onAdd, onAdded } = form()
    typeName('cucumber')
    pressAgain()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(toast).toHaveBeenCalledWith({ message: 'Added “cucumber” · in HOME: 2 pcs' })
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Item name').value).toBe('')
  })

  it('"Save & add another" asks the same questions; "OK" saves nothing and keeps the form open, emptied', () => {
    const inCart = entry({ in_cart: true })
    const { onAdd, onAdded } = form({ entries: [inCart] })
    typeName('Dish soap')
    pressAgain()
    expect(screen.getByText('Already on your SHOP list: Dish soap — in the cart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Item name').value).toBe('')
  })

  it('"OK" after "Save" closes the form, nothing saved, no toast', () => {
    const { onAdd, onAdded } = form({ entries: [entry()] })
    typeName('Dish soap')
    press()
    expect(screen.getByText('Already on your SHOP list: Dish soap — to buy')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('in the cart: "Change the quantity or price on its card." and "Go to card" (nothing saved, the quantity typed not used) — after either button', () => {
    const inCart = entry({ in_cart: true })
    const { onAdd, onGoToCard } = form({ entries: [inCart] })
    typeName('Dish soap')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    pressAgain()
    expect(screen.getByText('Change the quantity or price on its card.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /more \(now/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to card' }))
    expect(onGoToCard).toHaveBeenCalledWith(inCart)
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('ordered online: "Add anyway" saves a new card to buy with what the form says (quantity, unit, price, payer)', async () => {
    const ordered = entry({ name: 'Paper kites', pantry_item_id: null })
    const { onAdd, onAdded } = form({ entries: [ordered], orderedIds: new Set([ordered.id]) })
    const payer = PAID_BY_OPTIONS[1]
    typeName('Paper kites')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Unit price (€)'), { target: { value: '2,50' } })
    fireEvent.click(screen.getByRole('button', { name: payer.label }))
    press()
    expect(screen.getByText('Already on your SHOP list: Paper kites — ordered online')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Paper kites', quantity: 4, unit: 'pcs', price: 2.5, payer: payer.value, pantryItemId: null })
    expect(toast).toHaveBeenCalledWith({ message: 'Added “Paper kites”' })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('more than 3 similar items: "2 more — type more of the name" under the buttons', () => {
    form()
    typeName('Sauce')
    press()
    expect(screen.getAllByRole('button', { name: /^Use .* Sauce/ })).toHaveLength(3)
    expect(screen.getByText('2 more — type more of the name')).toBeTruthy()
  })

  it('a durable category skips the HOME check (only the SHOP list is checked)', async () => {
    const { onAdd } = form()
    typeName('Pumkin')
    fireEvent.change(screen.getByLabelText('Item category'), { target: { value: 'appliances' } })
    press()
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
  })

  it('a durable already on the list: the SHOP list check still runs', () => {
    const { onAdd } = form({ entries: [entry({ id: 'g-lamp', name: 'Lamp', pantry_item_id: null, category_id: 'appliances' })] })
    typeName('Lamp')
    press()
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    expect(screen.getByText('Already on your SHOP list: Lamp — to buy')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
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

  it('more than 3 similar items: "2 more — type more of the name"', async () => {
    form()
    type('Name', 'Sauce')
    type('Price', '3')
    expect(await screen.findByText('2 more — type more of the name')).toBeTruthy()
  })

  it('a similar (not exact) SHOP card without a HOME item: "Similar on your SHOP list: … — it stays there."; never closed', async () => {
    form()
    type('Name', 'Kites')
    type('Price', '3')
    expect(screen.getByText('Similar on your SHOP list: Paper kites — it stays there.')).toBeTruthy()
    // Not with Add to HOME off.
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    expect(screen.queryByText(/Similar on your SHOP list/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0].list_entry_id ?? null).toBeNull()
  })

  it('the exact name of a SHOP card keeps the existing text, not the similar one', () => {
    form()
    type('Name', 'Paper kites')
    expect(screen.getByText('On your SHOP list — it will leave the list.')).toBeTruthy()
    expect(screen.queryByText(/Similar on your SHOP list/)).toBeNull()
  })

  it('an entry in the cart stays there (existing text)', () => {
    form()
    type('Name', 'Dish soap')
    expect(screen.getByText("It's in the cart in SHOP — it stays there.")).toBeTruthy()
  })

  it('a locked (durable) row: no HOME question, the SHOP list is still checked', async () => {
    form()
    type('Name', 'Lamp')
    type('Price', '3')
    await new Promise((r) => setTimeout(r, 450))
    expect(screen.queryByText('Similar item in HOME:')).toBeNull()
    expect(screen.getByText('On your SHOP list — it stays there (Add to HOME is off).')).toBeTruthy()
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

  it('more than 3 similar items: "2 more — type more of the name"', () => {
    editor()
    typeName('Sauce')
    save()
    expect(screen.getAllByRole('button', { name: /^Go to .* Sauce$/ })).toHaveLength(3)
    expect(screen.getByText('2 more — type more of the name')).toBeTruthy()
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
