// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Round 9L on screen: "Count it at home in" in SHOP Confirm purchase and
// MONEY "+ Add expense" for a NEW HOME item bought in a package (K1–K4),
// hidden before supabase/030 and checked first while that isn't known
// (K10); a line whose total can't be worked out blocks Confirm (K9); the
// SHOP form's price unit as plain text and no warning for a package (K6,
// K7); the HOME editor's "Convert with the pack size" and the price
// warning (K8); the history row "→ 8 pcs" (K11).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

// Cola is counted in pcs with a usual pack of 4; Tuna in pcs without one.
const data = vi.hoisted(() => ({
  pantry: [
    { id: 'cola', name: 'Cola', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'beverages', packaging_unit: 'pack', quantity_per_pack: 4 },
    { id: 'tuna', name: 'Tuna', unit: 'pcs', current_stock: 2, min_stock: 0, category_id: 'canned', packaging_unit: null, quantity_per_pack: null },
  ],
  logs: [],
}))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => data.pantry),
  groceryStore: fake(() => []),
  orderStore: fake(() => []),
  budgetMapStore: fake(() => []),
  stockLogStore: fake(() => data.logs),
  inventoryCategoryStore: fake(() => [
    { id: 'beverages', name: 'Beverages' },
    { id: 'canned', name: 'Canned' },
    { id: 'appliances', name: 'Durables' },
  ]),
}))
const parents = [
  { id: 'beverages', name: 'Beverages', type: 'parent' },
  { id: 'canned', name: 'Canned', type: 'parent' },
  { id: 'appliances', name: 'Durables', type: 'parent' },
]
const subsByParent = new Map(parents.map((p) => [p.id, []]))
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents, pantryParents: parents, subsByParent, addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const confirmPurchase = vi.fn(async () => ({ error: null }))
const recordMoneyPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', () => ({ recordMoneyPurchase: (...args) => recordMoneyPurchase(...args), usePurchase: () => ({ confirmPurchase: (...args) => confirmPurchase(...args) }) }))
vi.mock('../hooks/useExpenses', () => ({ addExpenseOnce: vi.fn() }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false, missing: false, mapRows: [] }) }))
const net = vi.hoisted(() => ({ offline: false }))
vi.mock('../lib/connection', async (original) => ({ ...(await original()), isOffline: () => net.offline }))

const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { AddItemForm } = await import('./grocery/AddItemForm')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { HistoryView } = await import('./inventory/HistoryView')
const { Feedback } = await import('./ui/Feedback')
const { confirmationPayload } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')
const { arrivalPrefill } = await import('../lib/newItemUnit')
const { dismissToast, getToasts } = await import('../lib/feedback')

afterEach(() => {
  cleanup()
  confirmPurchase.mockClear()
  recordMoneyPurchase.mockClear()
  getToasts().forEach((t) => dismissToast(t.id))
  net.offline = false
})

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const text = () => document.body.textContent
const toastTexts = () => getToasts().map((t) => t.message)

describe('SHOP Confirm purchase: "Count it at home in" (K1–K4)', () => {
  const entry = (fields) => ({ id: fields.name, quantity: 1, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack', payer: 'shared', in_cart: true, category_id: 'beverages', pantry_item_id: null, ...fields })
  const confirm = (cartItems, props = {}) =>
    render(
      <ConfirmPurchase
        cartItems={cartItems}
        pantryItems={data.pantry}
        categoryName={(id) => id}
        totalOf={(i) => lineTotal(i, data.pantry.find((p) => p.id === i.pantry_item_id))}
        updatePricing={async () => ({})}
        updatePayer={async () => ({})}
        toggleCart={async () => ({})}
        onClose={() => {}}
        partsReady={false}
        unitsReady
        {...props}
      />
    )
  const button = () => screen.getByRole('button', { name: /Confirm purchase · / })
  const sent = () => confirmationPayload({ ...confirmPurchase.mock.calls[0][0], expenseCategoryFor: () => 'groceries' }).items

  it('soft drink "1 pack" not in HOME: no default, Confirm locked with "Choose how to count it at home."; pcs → "pcs per pack" required; 4 → "= 4 pcs", saved as the usual size; sent pcs + 4, add 1', async () => {
    confirm([entry({ name: 'Soft drink' })])
    expect(text()).toContain('new in the pantry')
    expect(text()).toContain('Count it at home in')
    const pills = screen.getAllByRole('radio')
    expect(pills.map((p) => [p.textContent, p.getAttribute('aria-checked')])).toEqual([
      ['pack', 'false'],
      ['pcs', 'false'],
    ])
    expect([...screen.getByLabelText('Other unit to count Soft drink in').options].map((o) => o.value)).toEqual(['', 'btl', 'can', 'roll', 'jar', 'tube', 'sachet', 'tablet', 'capsule', 'sheet', 'set', 'pair', 'shaker'])
    expect(text()).toContain('Choose how to count it at home.')
    expect(text()).toContain('Answer the question above to confirm.')
    expect(button().disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'pcs' }))
    expect(screen.getByLabelText('pcs per pack for Soft drink').value).toBe('')
    expect(text()).toContain('Type how many pcs are in 1 pack.')
    expect(button().disabled).toBe(true)
    type('pcs per pack for Soft drink', '4')
    expect(text()).toContain('= 4 pcs')
    expect(text()).toContain('It will be saved as the usual size for next time.')
    expect(text()).not.toContain('Choose how to count it at home.')
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ add: 1, line_total: 3, pantry_item_id: null, new_stock_unit: 'pcs', new_pack_size: 4 })
  })

  it('beef slices "1 pack" kept in "pack": exactly today (no field, nothing extra sent); tissues → roll from the drop-down, 6', async () => {
    confirm([entry({ name: 'Beef slices', category_id: 'canned' }), entry({ name: 'Tissues', price: 2.4, category_id: 'canned' })])
    fireEvent.click(screen.getAllByRole('radio', { name: 'pack' })[0])
    expect(screen.queryByLabelText('pcs per pack for Beef slices')).toBeNull()
    type('Other unit to count Tissues in', 'roll')
    type('roll per pack for Tissues', '6')
    expect(text()).toContain('= 6 roll')
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const items = sent()
    expect(items[0]).not.toHaveProperty('new_stock_unit')
    expect(items[1]).toMatchObject({ new_stock_unit: 'roll', new_pack_size: 6, add: 1 })
  })

  it('K15: "Other…" offers sheet, set, pair and shaker; gelatin sheets "1 pack" → sheet 10: "= 10 sheet", sent sheet + 10, add 1', async () => {
    confirm([entry({ name: 'Gelatin Sheets', price: 2.2, category_id: 'canned' })])
    const others = [...screen.getByLabelText('Other unit to count Gelatin Sheets in').options].map((o) => o.value)
    for (const u of ['sheet', 'set', 'pair', 'shaker']) expect(others).toContain(u)
    type('Other unit to count Gelatin Sheets in', 'sheet')
    expect(screen.getByLabelText('sheet per pack for Gelatin Sheets').value).toBe('')
    expect(text()).toContain('Type how many sheet are in 1 pack.')
    expect(button().disabled).toBe(true)
    type('sheet per pack for Gelatin Sheets', '10')
    expect(text()).toContain('= 10 sheet')
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ add: 1, new_stock_unit: 'sheet', new_pack_size: 10 })
  })

  it('eggs "1 box" → pcs 10: "= 10 pcs"; two packs × 4 = "= 8 pcs"', () => {
    confirm([entry({ name: 'Eggs', unit: 'box', price_unit: 'box', price: 2.9 }), entry({ name: 'Soft drink', quantity: 2, price: 6, price_qty: 2 })])
    const [eggsPcs, sodaPcs] = screen.getAllByRole('radio', { name: 'pcs' })
    fireEvent.click(eggsPcs)
    type('pcs per box for Eggs', '10')
    expect(text()).toContain('= 10 pcs')
    fireEvent.click(sodaPcs)
    type('pcs per pack for Soft drink', '4')
    expect(text()).toContain('= 8 pcs')
  })

  it('the same name twice in the cart: both in pcs → fine (each its own size); the second kept in packs → Confirm blocked with what to choose', async () => {
    confirm([entry({ name: 'Soft drink', id: 'a' }), entry({ name: 'Soft drink', id: 'b', quantity: 2, price: 6, price_qty: 2 })])
    const [first, second] = screen.getAllByRole('radio', { name: 'pcs' })
    fireEvent.click(first)
    screen.getAllByLabelText('pcs per pack for Soft drink').forEach((f) => fireEvent.change(f, { target: { value: '4' } }))
    fireEvent.click(screen.getAllByRole('radio', { name: 'pack' })[1])
    expect(text()).toContain('"Soft drink" is in this purchase twice — count it in pcs at home here too.')
    expect(button().disabled).toBe(true)
    fireEvent.click(second)
    fireEvent.change(screen.getAllByLabelText('pcs per pack for Soft drink')[1], { target: { value: '6' } })
    expect(text()).not.toContain('is in this purchase twice')
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().map((i) => [i.add, i.new_stock_unit, i.new_pack_size])).toEqual([
      [1, 'pcs', 4],
      [2, 'pcs', 6],
    ])
  })

  it('never asked: water "1 btl", "500 gr", a durable, a restock (the 9H field as today)', () => {
    confirm([
      entry({ name: 'Water', unit: 'btl', price_unit: 'btl' }),
      entry({ name: 'Flour', unit: 'gr', quantity: 500, price_unit: 'gr', price: 0.002 }),
      entry({ name: 'Lamp', unit: 'box', price_unit: 'box', category_id: 'appliances' }),
      entry({ name: 'Cola', pantry_item_id: 'cola' }),
    ])
    expect(text()).not.toContain('Count it at home in')
    expect(screen.getByLabelText('pcs per pack for Cola').value).toBe('4')
    expect(text()).toContain('expense only')
  })

  it('before 030 (false): no question, confirmed exactly as today', async () => {
    confirm([entry({ name: 'Soft drink' })], { unitsReady: false })
    expect(text()).not.toContain('Count it at home in')
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).not.toHaveProperty('new_stock_unit')
  })

  it('not known yet (K10): Confirm reads first — 030 there → the question shows, nothing saved; not there → saved as today; no answer → nothing saved, the usual message', async () => {
    const there = vi.fn(async () => true)
    confirm([entry({ name: 'Soft drink' })], { unitsReady: undefined, checkUnits: there })
    expect(text()).not.toContain('Count it at home in')
    fireEvent.click(button())
    await waitFor(() => expect(text()).toContain('Count it at home in'))
    expect(there).toHaveBeenCalledTimes(1)
    expect(confirmPurchase).not.toHaveBeenCalled()
    expect(button().disabled).toBe(true)
    cleanup()

    const missing = vi.fn(async () => false)
    confirm([entry({ name: 'Soft drink' })], { unitsReady: undefined, checkUnits: missing })
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent()[0]).not.toHaveProperty('new_stock_unit')
    cleanup()
    confirmPurchase.mockClear()

    const unknown = vi.fn(async () => null)
    confirm([entry({ name: 'Soft drink' })], { unitsReady: undefined, checkUnits: unknown })
    fireEvent.click(button())
    await waitFor(() => expect(unknown).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastTexts()).toContain("Couldn't save — check your connection."))
    expect(confirmPurchase).not.toHaveBeenCalled()
    cleanup()

    net.offline = true
    confirm([entry({ name: 'Soft drink' })], { unitsReady: undefined, checkUnits: unknown })
    fireEvent.click(button())
    await waitFor(() => expect(toastTexts()).toContain("You're offline — this needs a connection."))
    expect(confirmPurchase).not.toHaveBeenCalled()
  })

  it('not known yet, but no line would be asked (a restock, "1 btl"): nothing is read, confirmed at once', async () => {
    const check = vi.fn(async () => true)
    confirm([entry({ name: 'Cola', pantry_item_id: 'cola' }), entry({ name: 'Water', unit: 'btl', price_unit: 'btl' })], { unitsReady: undefined, checkUnits: check })
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(check).not.toHaveBeenCalled()
  })
})

describe('SHOP Confirm purchase: a total that can\'t be worked out (K9)', () => {
  const confirm = (cartItems) =>
    render(
      <ConfirmPurchase
        cartItems={cartItems}
        pantryItems={data.pantry}
        categoryName={(id) => id}
        totalOf={(i) => lineTotal(i, data.pantry.find((p) => p.id === i.pantry_item_id))}
        updatePricing={async () => ({})}
        updatePayer={async () => ({})}
        toggleCart={async () => ({})}
        onClose={() => {}}
        partsReady={false}
        unitsReady={false}
      />
    )
  const button = () => screen.getByRole('button', { name: /Confirm purchase · / })
  const tuna = (fields = {}) => ({ id: 'tuna-entry', name: 'Tuna', quantity: 2, unit: 'pack', price: 0.75, price_qty: 1, price_unit: 'pcs', payer: 'shared', in_cart: true, category_id: 'canned', pantry_item_id: 'tuna', ...fields })

  it('"2 pack" at €0.75 per pcs with no usual size: "?" — Confirm blocked until the total is typed', async () => {
    confirm([tuna()])
    type('pcs per pack for Tuna', '4')
    expect(screen.getAllByText("The total can't be worked out from the price's unit — type the total paid.").length).toBeGreaterThan(0)
    expect(text()).toContain('1 without a total')
    expect(button().disabled).toBe(true)
    type('Total for Tuna', '6')
    expect(text()).not.toContain("The total can't be worked out")
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
  })

  it('a line without any price is not blocked (as today: stock only, no expense)', async () => {
    confirm([tuna({ unit: 'pcs', price: 0, price_unit: null })])
    expect(text()).not.toContain("The total can't be worked out")
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
  })
})

describe('MONEY "+ Add expense": "Count it at home in" (K1–K4, K10)', () => {
  const form = (props = {}) =>
    render(
      <>
        <PurchaseForm
          expenseCategories={[{ id: 'groceries', name: 'Groceries', parent_id: null }]}
          mainCategories={[{ id: 'groceries', name: 'Groceries', parent_id: null }]}
          subsOf={() => []}
          addCategory={vi.fn()}
          renameCategory={vi.fn()}
          moveCategory={vi.fn()}
          deleteCategory={vi.fn()}
          styleFor={() => ({ hex: '#000' })}
          onClose={vi.fn()}
          unitsReady
          {...props}
        />
        <Feedback />
      </>
    )
  const softDrink = () => {
    type('Name', 'Soft drink')
    type('Price', '3')
    type('Unit', 'pack')
    type('Item category', 'beverages')
  }
  const save = () => fireEvent.click(screen.getByRole('button', { name: /Save purchase · €3\.00/ }))

  it('a new row "1 pack": the question under the row, Save blocked "Choose how to count it at home."; pcs + 4 → saved with pcs / 4, add 1; "Min … pcs" follows', async () => {
    form()
    softDrink()
    expect(text()).toContain('New in HOME (shown as New Item).')
    expect(text()).toContain('Count it at home in')
    expect(text()).toContain('pack — below this it goes on the SHOP list')
    save()
    await waitFor(() => expect(screen.getAllByText('Choose how to count it at home.').length).toBeGreaterThan(1))
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'pcs' }))
    expect(text()).toContain('pcs — below this it goes on the SHOP list')
    save()
    await waitFor(() => expect(text()).toContain('Type how many pcs are in 1 pack.'))
    type('pcs per pack for Soft drink', '4')
    expect(text()).toContain('= 4 pcs')
    type('Minimum stock', '2')
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ name: 'Soft drink', unit: 'pack', quantity: 1, price: 3, add: 1, min_stock: 2, new_stock_unit: 'pcs', new_pack_size: 4 })
  })

  it('K15: "Other…" offers sheet, set, pair and shaker; "1 pack" → sheet 10 → saved with sheet / 10, add 1', async () => {
    form()
    softDrink()
    type('Name', 'Gelatin Sheets')
    const others = [...screen.getByLabelText('Other unit to count Gelatin Sheets in').options].map((o) => o.value)
    expect(others).toEqual(['', 'btl', 'can', 'roll', 'jar', 'tube', 'sachet', 'tablet', 'capsule', 'sheet', 'set', 'pair', 'shaker'])
    type('Other unit to count Gelatin Sheets in', 'sheet')
    expect(text()).toContain('sheet — below this it goes on the SHOP list')
    type('sheet per pack for Gelatin Sheets', '10')
    expect(text()).toContain('= 10 sheet')
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ name: 'Gelatin Sheets', unit: 'pack', quantity: 1, add: 1, new_stock_unit: 'sheet', new_pack_size: 10 })
  })

  it('never asked: Add to HOME off, "1 btl", an existing item (the 9H field)', () => {
    form()
    softDrink()
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    expect(text()).toContain('Expense only')
    expect(text()).not.toContain('Count it at home in')
    fireEvent.click(screen.getByLabelText('Add to HOME'))
    type('Unit', 'btl')
    expect(text()).not.toContain('Count it at home in')
    type('Name', 'Cola')
    type('Unit', 'pack')
    expect(text()).not.toContain('Count it at home in')
    expect(screen.getByLabelText('pcs per pack').value).toBe('4')
  })

  it('not known yet: Save reads first — there → the question shows, nothing saved; not there → saved as today; no answer → nothing saved', async () => {
    const there = vi.fn(async () => true)
    form({ unitsReady: undefined, checkUnits: there })
    softDrink()
    expect(text()).not.toContain('Count it at home in')
    save()
    await waitFor(() => expect(text()).toContain('Count it at home in'))
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
    cleanup()

    form({ unitsReady: undefined, checkUnits: vi.fn(async () => false) })
    softDrink()
    save()
    await waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).not.toHaveProperty('new_stock_unit')
    expect(recordMoneyPurchase.mock.calls[0][0].payload.items[0]).toMatchObject({ unit: 'pack', add: 1 })
    cleanup()
    recordMoneyPurchase.mockClear()

    form({ unitsReady: undefined, checkUnits: vi.fn(async () => null) })
    softDrink()
    save()
    await waitFor(() => expect(toastTexts()).toContain("Couldn't save — check your connection."))
    expect(recordMoneyPurchase).not.toHaveBeenCalled()
  })
})

describe('SHOP "+ Add to SHOP list" (K6, K7)', () => {
  const form = (pantryByName = new Map()) =>
    render(<AddItemForm parents={parents} subsByParent={subsByParent} categoryName={(id) => parents.find((p) => p.id === id)?.name ?? id} pantryByName={pantryByName} onAdd={vi.fn(async () => ({ error: null }))} onAddCategory={vi.fn()} onAddSubcategory={vi.fn()} />)

  it('a name not in HOME: the price unit is plain text ("pack"), the same value is saved; no "unusual" warning for a package, still for another unit', () => {
    form()
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Soft drink' } })
    type('Item category', 'beverages')
    type('Unit', 'pack')
    const per = screen.getByLabelText('Price per unit')
    expect(per.tagName).toBe('SPAN')
    expect(per.textContent).toBe('pack')
    expect(text()).not.toContain('is unusual for')
    type('Unit', 'jar')
    expect(text()).toContain('"jar" is unusual for Beverages (usually btl, can, ml, L).')
    type('Unit', 'case')
    expect(text()).not.toContain('is unusual for')
  })

  it('kg (two price units) and a HOME item with a usual pack keep the select', () => {
    form(new Map([['cola', data.pantry[0]]]))
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Cola' } })
    type('Unit', 'pack')
    expect(screen.getByLabelText('Price per unit').tagName).toBe('SELECT')
    expect([...screen.getByLabelText('Price per unit').options].map((o) => o.value)).toEqual(['pack', 'pcs'])
    fireEvent.change(screen.getByPlaceholderText(/Item name/), { target: { value: 'Flour' } })
    type('Unit', 'kg')
    expect(screen.getByLabelText('Price per unit').tagName).toBe('SELECT')
  })
})

describe('HOME editor (K5, K8, K11)', () => {
  const unitSelect = () => screen.getByText('Unit (what you count stock in)').parentElement.querySelector('select')
  const fieldUnder = (label) => {
    let box = screen.getByText(label, { selector: 'label' }).parentElement
    while (!box.querySelector('input')) box = box.parentElement
    return box.querySelector('input')
  }
  const editor = (props) => {
    const onSave = vi.fn(async () => ({ error: null }))
    render(
      <>
        <ItemEditor parents={parents} subsByParent={subsByParent} onSave={onSave} onClose={() => {}} {...props} />
        <Feedback />
      </>
    )
    return onSave
  }
  const soft = { id: 's', name: 'Soft drink', category_id: 'beverages', unit: 'pack', current_stock: 2, min_stock: 1, price: 3, price_qty: 1, price_unit: 'pack', packaging_unit: null, quantity_per_pack: null }

  it('K8: pack → pcs offers "Convert with the pack size" with "pcs in 1 pack"; 4 → 8 pcs, min 4 pcs, usual pack 4, the price still €3.00 per 1 pack; saved as converted', async () => {
    const onSave = editor({ item: soft })
    fireEvent.change(unitSelect(), { target: { value: 'pcs' } })
    await screen.findByText('Count "Soft drink" in pcs instead of pack?')
    expect(screen.getByText('Keep the numbers as they are')).toBeTruthy()
    fireEvent.click(screen.getByText('Convert with the pack size'))
    const per = screen.getByLabelText('pcs in 1 pack')
    expect(per.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    expect(await screen.findByText('Enter a number above 0.')).toBeTruthy()
    fireEvent.change(per, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    await waitFor(() => expect(unitSelect().value).toBe('pcs'))
    expect(text()).toContain('Converted from pack: stock 8 pcs, minimum 4 pcs. 1 pack = 4 pcs.')
    expect(text()).toContain('Bought in a different unit')
    expect(text()).toContain('1 pack = 4 pcs')
    expect(text()).not.toContain('The price was')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ unit: 'pcs', current_stock: 8, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 3, price_qty: 1, price_unit: 'pack' })
    expect(onSave.mock.calls[0][1]).toEqual({ converted: true })
  })

  it('K8: "Keep the numbers as they are" → the yellow price warning before saving; saved as today (not converted)', async () => {
    const onSave = editor({ item: soft })
    fireEvent.change(unitSelect(), { target: { value: 'pcs' } })
    await screen.findByText('Convert with the pack size')
    fireEvent.click(screen.getByText('Keep the numbers as they are'))
    expect(screen.queryByLabelText('pcs in 1 pack')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    await waitFor(() => expect(unitSelect().value).toBe('pcs'))
    expect(text()).toContain('The price was €3.00 per 1 pack — it will be saved as €3.00 per 1 pcs. Check it.')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ unit: 'pcs', current_stock: 2, min_stock: 1, price_unit: 'pcs', packaging_unit: null })
    expect(onSave.mock.calls[0][1]).toEqual({ converted: false })
  })

  it('K8: kg → gr keeps "Convert the numbers" (no pack choice); pcs → btl neither; a variant\'s unit stays locked', async () => {
    editor({ item: { ...soft, unit: 'kg', current_stock: 2, min_stock: 1, price_unit: 'kg' } })
    fireEvent.change(unitSelect(), { target: { value: 'gr' } })
    await screen.findByText('Convert the numbers')
    expect(screen.queryByText('Convert with the pack size')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    await waitFor(() => expect(unitSelect().value).toBe('gr'))
    cleanup()
    editor({ item: { ...soft, unit: 'pcs' } })
    fireEvent.change(unitSelect(), { target: { value: 'btl' } })
    await screen.findByText('Keep the numbers as they are')
    expect(screen.queryByText('Convert with the pack size')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    cleanup()
    editor({ item: { ...soft, group_id: 'g' }, groups: [{ id: 'g', name: 'Drinks', unit: 'pack' }] })
    expect(unitSelect().disabled).toBe(true)
  })

  it('K5: an order "1 pack" (€3.00): multipack on, purchase unit pack, "pcs per pack" empty and required, stock 1 counted in packs; 4 → 4 pcs, usual pack 4, €3.00 per 1 pack', async () => {
    const onSave = editor({ prefill: arrivalPrefill({ item_name: 'Soft drink', quantity: 1, unit: 'pack', price: 3 }) })
    type('Item category', 'beverages')
    expect(text()).toContain('Bought in a different unit')
    expect(unitSelect().value).toBe('pcs')
    expect(screen.getByText('Purchase unit').parentElement.querySelector('select').value).toBe('pack')
    expect(fieldUnder('pcs per pack').value).toBe('')
    expect(text()).toContain('in pack ⇄')
    expect(fieldUnder('Current stock').value).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    expect(await screen.findByText('Quantity per pack must be more than 0.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(fieldUnder('pcs per pack'), { target: { value: '4' } })
    expect(text()).toContain('1 pack × 4 = 4 pcs')
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Soft drink', unit: 'pcs', current_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 3, price_qty: 1, price_unit: 'pack' })
  })

  it('K5: turning the multipack section off counts it in the package ("1 pack"); an order "3 pcs" starts in pcs with stock 3', async () => {
    const onSave = editor({ prefill: arrivalPrefill({ item_name: 'Soft drink', quantity: 1, unit: 'pack', price: 3 }) })
    type('Item category', 'beverages')
    fireEvent.click(screen.getByRole('button', { name: 'Bought in a different unit' }))
    expect(unitSelect().value).toBe('pack')
    expect(text()).toContain('Counted in pack at home.')
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ unit: 'pack', current_stock: 1, packaging_unit: null, price_unit: 'pack' })
    cleanup()
    editor({ prefill: arrivalPrefill({ item_name: 'Lemons', quantity: 3, unit: 'pcs', price: 2.4 }) })
    expect(unitSelect().value).toBe('pcs')
    expect(fieldUnder('Current stock').value).toBe('3')
    expect(text()).not.toContain('Bought in a different unit (')
  })

  it('K14: an order "1 bag": "Bought in a different unit" can\'t be turned off (with the reason), "pcs per bag" required; 1 bag = 10 pcs → 10 pcs', async () => {
    const onSave = editor({ prefill: arrivalPrefill({ item_name: 'Rice cakes', quantity: 1, unit: 'bag', price: 5 }) })
    type('Item category', 'canned')
    const toggle = screen.getByRole('button', { name: 'Bought in a different unit' })
    expect(toggle.disabled).toBe(true)
    expect(text()).toContain("bag can't be a HOME unit — type how many pcs are in 1 bag.")
    fireEvent.click(toggle)
    expect(unitSelect().value).toBe('pcs')
    expect(screen.getByText('Purchase unit').parentElement.querySelector('select').value).toBe('bag')
    expect(fieldUnder('pcs per bag').value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    expect(await screen.findByText('Quantity per pack must be more than 0.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(fieldUnder('pcs per bag'), { target: { value: '10' } })
    expect(text()).toContain('1 bag × 10 = 10 pcs')
    fireEvent.click(screen.getByRole('button', { name: 'Add to inventory' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Rice cakes', unit: 'pcs', current_stock: 10, packaging_unit: 'bag', quantity_per_pack: 10, price: 5, price_qty: 1, price_unit: 'bag' })
  })

  it('K14: an order "1 case" is locked the same way; an order "1 pack" can still be turned off (no reason shown)', () => {
    editor({ prefill: arrivalPrefill({ item_name: 'Water', quantity: 1, unit: 'case', price: 4 }) })
    expect(screen.getByRole('button', { name: 'Bought in a different unit' }).disabled).toBe(true)
    expect(text()).toContain("case can't be a HOME unit — type how many pcs are in 1 case.")
    cleanup()
    editor({ prefill: arrivalPrefill({ item_name: 'Soft drink', quantity: 1, unit: 'pack', price: 3 }) })
    const toggle = screen.getByRole('button', { name: 'Bought in a different unit' })
    expect(toggle.disabled).toBe(false)
    expect(text()).not.toContain("can't be a HOME unit")
    fireEvent.click(toggle)
    expect(unitSelect().value).toBe('pack')
  })

  it('K15: "Gelatin Sheets" and "Color Fade Prevention Sheet" in pack → "Convert with the pack size" to sheet: 2 pack × 10 = 20 sheet, minimum 1 pack → 10 sheet', async () => {
    for (const name of ['Gelatin Sheets', 'Color Fade Prevention Sheet']) {
      const onSave = editor({ item: { ...soft, id: name, name, category_id: 'canned', price: 2.2 } })
      fireEvent.change(unitSelect(), { target: { value: 'sheet' } })
      await screen.findByText(`Count "${name}" in sheet instead of pack?`)
      fireEvent.click(screen.getByText('Convert with the pack size'))
      fireEvent.change(screen.getByLabelText('sheet in 1 pack'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
      await waitFor(() => expect(unitSelect().value).toBe('sheet'))
      expect(text()).toContain('Converted from pack: stock 20 sheet, minimum 10 sheet. 1 pack = 10 sheet.')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(onSave.mock.calls[0][0]).toMatchObject({ name, unit: 'sheet', current_stock: 20, min_stock: 10, packaging_unit: 'pack', quantity_per_pack: 10, price: 2.2, price_unit: 'pack' })
      expect(onSave.mock.calls[0][1]).toEqual({ converted: true })
      cleanup()
    }
  })

  it('K19: kg → gr "Convert the numbers": "€2.50 per 1 kg" stays per 1 kg, also a price saved without a unit; no warning', async () => {
    for (const priceUnit of ['kg', null]) {
      const onSave = editor({ item: { ...soft, name: 'Flour', unit: 'kg', current_stock: 2, min_stock: 1, price: 2.5, price_qty: 1, price_unit: priceUnit } })
      fireEvent.change(unitSelect(), { target: { value: 'gr' } })
      fireEvent.click(await screen.findByText('Convert the numbers'))
      fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
      await waitFor(() => expect(unitSelect().value).toBe('gr'))
      expect(text()).toContain('Converted from kg: stock 2000 gr, minimum 1000 gr.')
      expect(screen.getByLabelText('Price per unit').value).toBe('kg')
      expect(text()).not.toContain('The price was')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(onSave.mock.calls[0][0]).toMatchObject({ unit: 'gr', current_stock: 2000, min_stock: 1000, price: 2.5, price_qty: 1, price_unit: 'kg' })
      expect(onSave.mock.calls[0][1]).toEqual({ converted: true })
      cleanup()
    }
  })

  it('K19: L → ml keeps "€1.20 per 1 L"; pack → pcs without a pack size ("Keep the numbers as they are") still shows the warning', async () => {
    const onSave = editor({ item: { ...soft, name: 'Milk', unit: 'L', current_stock: 1, min_stock: 1, price: 1.2, price_qty: 1, price_unit: null } })
    fireEvent.change(unitSelect(), { target: { value: 'ml' } })
    fireEvent.click(await screen.findByText('Convert the numbers'))
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    await waitFor(() => expect(unitSelect().value).toBe('ml'))
    expect(text()).not.toContain('The price was')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ unit: 'ml', current_stock: 1000, min_stock: 1000, price: 1.2, price_unit: 'L' })
    cleanup()
    editor({ item: soft })
    fireEvent.change(unitSelect(), { target: { value: 'pcs' } })
    fireEvent.click(await screen.findByText('Keep the numbers as they are'))
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }))
    await waitFor(() => expect(unitSelect().value).toBe('pcs'))
    expect(text()).toContain('The price was €3.00 per 1 pack — it will be saved as €3.00 per 1 pcs. Check it.')
  })

  it('K11: a converted unit change shows one history row with the new stock only ("→ 8 pcs", "Unit changed"); other rows as before', () => {
    data.logs = [
      { id: 'l1', item_name: 'Soft drink', change: 6, new_stock: 8, unit: 'pcs', reason: 'converted', created_at: '2026-11-01T10:00:00Z' },
      { id: 'l2', item_name: 'Soft drink', change: 1, new_stock: 2, unit: 'pack', reason: 'purchased', created_at: '2026-10-30T10:00:00Z' },
    ]
    render(<HistoryView />)
    const rows = screen.getAllByText('Soft drink', { selector: 'p' }).map((n) => n.closest('div.flex').textContent)
    expect(rows[0]).toContain('Unit changed')
    expect(rows[0]).toContain('→ 8 pcs')
    expect(rows[0]).not.toContain('+6')
    expect(rows[1]).toContain('+1 pack')
    expect(rows[1]).toContain('→ 2 pack')
    data.logs = []
  })
})
