// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PAID_BY_OPTIONS } from '../data/constants'

// Plan 9N, stage 3 on screen: name lines in SHOP "Confirm purchase" (K50–K53,
// K55, K56, K59/K94, K60, K71, K92, K96, J.1, J.5, J.9), the SHOP card
// title (K53) and MONEY "It's another name of…" (K54). Before 032 is known
// nothing new shows and the payload is today's. The payers come from
// PAID_BY_OPTIONS (never written out here).
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

const element = (name, extra = {}) => ({ name, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null, from_item_id: null, origin: null, added_at: '2026-11-01T10:00:00Z', added_by_trip: null, pack_by_trip: null, ...extra })
const data = vi.hoisted(() => ({ pantry: [], lastPrices: {} }))
const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }) })
vi.mock('../lib/stores', async (original) => ({
  ...(await original()),
  pantryStore: fake(() => data.pantry),
  groceryStore: fake(() => []),
  orderStore: fake(() => []),
  budgetMapStore: fake(() => []),
  tripStore: fake(() => []),
  tripItemStore: fake(() => []),
  shopStore: fake(() => []),
  inventoryCategoryStore: fake(() => []),
}))
vi.mock('../hooks/useInventoryCategories', () => ({
  useInventoryCategories: () => ({ parents: [], pantryParents: [], subsByParent: new Map(), addCategory: vi.fn(), addSubcategory: vi.fn() }),
}))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))
// The last normal price of a name (report F), by name.
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: (name) => data.lastPrices[String(name).trim()] ?? null }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
vi.mock('../hooks/useShopOrder', () => ({ useShopOrder: () => ({ positions: new Map(), savePositions: vi.fn() }) }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: vi.fn(), createMoney: vi.fn() }),
}))
const confirmPurchase = vi.fn(async () => ({ error: null }))
const recordMoneyPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', () => ({
  recordMoneyPurchase: (...args) => recordMoneyPurchase(...args),
  usePurchase: () => ({ confirmPurchase: (...args) => confirmPurchase(...args) }),
  askUndoPurchase: vi.fn(),
  reopenTrip: vi.fn(),
}))

const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { GroceryItemTile } = await import('./grocery/GroceryItemTile')
const { ShoppingMode } = await import('./grocery/ShoppingMode')
const { PurchaseForm } = await import('./expenses/PurchaseForm')
const { RestockForm } = await import('./inventory/RestockForm')
const { confirmationPayload } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label
const SHARED = label('shared')

const item = (id, name, names = [], extra = {}) => ({ id, name, unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'snacks', names: names.map((n) => (typeof n === 'string' ? element(n) : n)), ...extra })
const chips = item('chips', 'Chips & Snacks', ['Corn Snack', 'Nuvole di drago'], { min_stock: 2 })
const crackers = item('crackers', 'Crackers', ['Tuc'])
const yogurt = item('yogurt', 'Yogurt Pots', ['Yogurt Greco'], { category_id: 'dairy', current_stock: 3, expiry_date: '2020-01-01' })
const tea = item('tea', 'Tea Tin', [], { category_id: 'beverages' })
const group = item('g', 'Teas', [], { is_group: true })
const trail = item('trail', 'Trail Mix', ['Frutta secca'], { unit: 'gr', current_stock: 200 })
data.pantry = [chips, crackers, yogurt, tea, group, trail]

const card = (id, name, pantryId, extra = {}) => ({ id, name, pantry_item_id: pantryId, quantity: 1, unit: 'pcs', price: 0, price_qty: 1, price_unit: 'pcs', payer: 'shared', category_id: 'snacks', in_cart: true, ...extra })

afterEach(() => {
  cleanup()
  confirmPurchase.mockClear()
  recordMoneyPurchase.mockClear()
  data.lastPrices = {}
})

const confirmScreen = (items, props = {}) =>
  render(
    <ConfirmPurchase
      cartItems={items}
      pantryItems={data.pantry}
      categoryName={(id) => id}
      totalOf={(i) => lineTotal(i)}
      updatePricing={async () => ({})}
      updatePayer={async () => ({})}
      toggleCart={async () => ({})}
      onClose={() => {}}
      partsReady={false}
      unitsReady={false}
      namesReady
      {...props}
    />
  )
const confirmButton = () => screen.getByRole('button', { name: /^Confirm purchase · / })
const sent = () => {
  const args = confirmPurchase.mock.calls.at(-1)[0]
  return confirmationPayload({ ...args, at: 'now', expenseCategoryFor: () => 'groceries' })
}
const typeIn = (labelText, value) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } })

// Corn Snack €1.39 on the card, then Nuvole di drago (last bought 2 for
// €1.98 → €0.99 for 1) and a new name, Patatine paprika €1.49.
function threeLines(payer = P1) {
  data.lastPrices = { 'Nuvole di drago': { price: 1.98, quantity: 2, unit: 'pcs', source: 'trip', at: 1 } }
  confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39, payer })])
  fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Names for line 2 of Corn Snack' })).getByRole('button', { name: 'Nuvole di drago' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
  typeIn('Name of line 3 of Corn Snack', 'Patatine paprika')
  typeIn('Total for line 3 of Corn Snack', '1,49')
}

describe('Confirm purchase: name lines (stage 3)', () => {
  it('K53: the card is titled with the HOME item, its own name under it; line 1 keeps the card\'s name and quantity', () => {
    confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39, quantity: 1 })])
    expect(screen.getByText('Chips & Snacks', { selector: 'span.truncate' })).toBeTruthy()
    expect(screen.getByText('Corn Snack', { selector: 'p' }).className).toContain('text-[10px]')
    expect(screen.getByLabelText('Name of Corn Snack').value).toBe('Corn Snack')
    expect(screen.getByLabelText('Quantity of Corn Snack').value).toBe('1')
    expect(within(screen.getByRole('group', { name: 'Names for Corn Snack' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Chips & Snacks', 'Corn Snack', 'Nuvole di drago'])
  })

  it('€1.39 + €0.99 + €1.49 = €3.87: three lines, "3 items", "= 3 pcs added to the stock"; one payer (K92); the new name is noted and sent with add_name', async () => {
    threeLines()
    expect(screen.getByLabelText('Total for line 2 of Corn Snack').value).toBe('0.99')
    expect(screen.getByText('New name of Chips & Snacks — it will be remembered.')).toBeTruthy()
    expect(screen.getByText('= 3 pcs added to the stock')).toBeTruthy()
    expect(screen.getByText(/^3 items · /)).toBeTruthy()
    // A name on another line is no chip any more (K56).
    expect(within(screen.getByRole('group', { name: 'Names for line 2 of Corn Snack' })).queryByRole('button', { name: 'Corn Snack' })).toBeNull()
    // One payer pill on the card.
    expect(screen.getAllByRole('button', { name: label(P1) }).length).toBeGreaterThan(0)
    expect(confirmButton().textContent).toContain('Confirm purchase · €3.87')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const items = sent().items
    expect(items.map((l) => [l.grocery_item_id, l.name, l.line_total, l.add, l.payer, Boolean(l.add_name)])).toEqual([
      ['e1', 'Corn Snack', 1.39, 1, P1, false],
      ['e1', 'Nuvole di drago', 0.99, 1, P1, false],
      ['e1', 'Patatine paprika', 1.49, 1, P1, true],
    ])
  })

  it('× takes a line out; the price follows the quantity while it was filled in', () => {
    threeLines()
    typeIn('Quantity of line 2 of Corn Snack', '3')
    expect(screen.getByLabelText('Total for line 2 of Corn Snack').value).toBe('2.97')
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 3 of Corn Snack' }))
    expect(screen.queryByLabelText('Name of line 3 of Corn Snack')).toBeNull()
    expect(confirmButton().textContent).toContain('€4.36')
  })

  it('K94: a name of another item is refused under the line and locks Confirm until changed; an empty name too', () => {
    confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39 })])
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    expect(screen.getByText('Type the name of this line.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
    typeIn('Name of line 2 of Corn Snack', 'Tuc')
    expect(screen.getByText('"Tuc" is already a name of "Crackers" in HOME.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Use other item/ })).toBeNull()
    expect(confirmButton().disabled).toBe(true)
    typeIn('Name of line 2 of Corn Snack', 'Tuc Bacon')
    expect(screen.queryByText(/is already a name of/)).toBeNull()
    expect(confirmButton().disabled).toBe(false)
    typeIn('Name of Corn Snack', 'Crackers')
    expect(screen.getByText('"Crackers" is already a name of "Crackers" in HOME.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
  })

  it('a new name that looks durable gets the HOME editor\'s warning, not blocking', () => {
    const parents = [{ id: 'snacks', name: 'Snacks', type: 'parent' }, { id: 'appliances', name: 'Durables', type: 'parent' }]
    const subsByParent = new Map([['snacks', []], ['appliances', [{ id: 'appliances:footwear', name: 'Footwear', parent_id: 'appliances' }]]])
    confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39 })], { homeCategories: { parents, subsByParent } })
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    typeIn('Name of line 2 of Corn Snack', 'sandali')
    expect(screen.getByText('“sandali” looks like a durable item (Durables › Footwear). Durable items don\'t go into HOME stock — record it in MONEY instead.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(false)
  })

  it('K71: expired stock is asked once, on the item\'s first line, also with two lines and a second card of the item', async () => {
    confirmScreen([card('y1', 'Yogurt Pots', 'yogurt', { price: 1, category_id: 'dairy' }), card('y2', 'Yogurt Greco', 'yogurt', { price: 1.2, category_id: 'dairy' })])
    fireEvent.click(screen.getAllByRole('button', { name: 'Add another name' })[0])
    typeIn('Name of line 2 of Yogurt Pots', 'Yogurt Bianco')
    typeIn('Total for line 2 of Yogurt Pots', '0,90')
    expect(screen.getAllByText('The 3 pcs of "Yogurt Pots" in the pantry have expired.')).toHaveLength(1)
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Throw them away' }))
    expect(screen.getByText(/^3 items · /)).toBeTruthy()
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().items.map((l) => [l.grocery_item_id, l.discard_expired])).toEqual([['y1', true], ['y1', undefined], ['y2', undefined]])
  })

  it('J.9: Shared with name lines — the box counts the lines; €2.00 of €3.87 → 0.72 + 0.51 + 0.77, the rest 0.67 + 0.48 + 0.72', async () => {
    data.lastPrices = { 'Nuvole di drago': { price: 0.99, quantity: 1, unit: 'pcs', source: 'name', at: 1 } }
    confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39 })], { partsReady: true })
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    typeIn('Name of line 2 of Corn Snack', 'Nuvole di drago')
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    typeIn('Name of line 3 of Corn Snack', 'Patatine paprika')
    typeIn('Total for line 3 of Corn Snack', '1.49')
    expect(screen.getByText(`What each one paid of the 3 ${SHARED} items (€3.87).`)).toBeTruthy()
    typeIn(`${label(P1)} paid (€)`, '2')
    expect(screen.getByLabelText(`${label(P2)} paid (€)`).value).toBe('1.87')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const items = sent().items
    expect(items.map((l) => l[`part_${P1}`])).toEqual([0.72, 0.51, 0.77])
    expect(items.map((l) => l[`part_${P2}`])).toEqual([0.67, 0.48, 0.72])
  })

  it('J.1: a new item, "Biscotti" 1 pack counted in pcs (10), then "Gocciole" 1 pack with its own required "pcs per pack" (12) → "= 22 pcs added to the stock"', async () => {
    confirmScreen([card('b1', 'Biscotti', null, { unit: 'pack', price: 2.2, price_unit: 'pack', category_id: 'sweets' })], { unitsReady: true })
    fireEvent.click(screen.getByRole('radio', { name: 'pcs' }))
    typeIn('pcs per pack for Biscotti', '10')
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    expect(screen.getByLabelText('Unit of line 2 of Biscotti').value).toBe('pack')
    typeIn('Name of line 2 of Biscotti', 'Gocciole')
    typeIn('Total for line 2 of Biscotti', '2,90')
    expect(screen.getByText('Type how many pcs are in 1 pack.')).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
    typeIn('pcs per pack for line 2 of Biscotti', '12')
    expect(screen.getByText('= 22 pcs added to the stock')).toBeTruthy()
    expect(screen.getAllByText('Count it at home in')).toHaveLength(1)
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const items = sent().items
    expect(items[0]).toMatchObject({ grocery_item_id: 'b1', name: 'Biscotti', add: 1, new_stock_unit: 'pcs', new_pack_size: 10 })
    expect(items[1]).toMatchObject({ grocery_item_id: 'b1', name: 'Gocciole', add: 12, add_name: true, name_pack: { packaging_unit: 'pack', quantity_per_pack: 12 } })
  })

  it('never on a group-level line or a durable line (K93)', () => {
    confirmScreen([card('d1', 'Kettle', null, { category_id: 'appliances', price: 30 })])
    expect(screen.queryByRole('button', { name: 'Add another name' })).toBeNull()
    expect(screen.queryByLabelText('Name of Kettle')).toBeNull()
  })

  it('before 032 is known: no name field, no "+ Add another name", the card\'s own title, today\'s payload', async () => {
    confirmScreen([card('e1', 'Corn Snack', 'chips', { price: 1.39 })], { namesReady: false })
    expect(screen.queryByRole('button', { name: 'Add another name' })).toBeNull()
    expect(screen.queryByLabelText('Name of Corn Snack')).toBeNull()
    expect(screen.queryByText('Chips & Snacks')).toBeNull()
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const [line] = sent().items
    expect(['name', 'add_name', 'name_pack', 'quantity'].some((k) => k in line)).toBe(false)
    expect(line).toMatchObject({ grocery_item_id: 'e1', pantry_item_id: 'chips', add: 1, line_total: 1.39 })
  })

  it('every new button is at least 36 px (h-9 / min-h-9) and wraps instead of scrolling sideways', () => {
    threeLines()
    const add = screen.getByRole('button', { name: 'Add another name' })
    expect(add.className).toContain('min-h-9')
    expect(screen.getByRole('button', { name: 'Remove line 3 of Corn Snack' }).className).toMatch(/\bw-9\b.*\bh-9\b/)
    for (const chip of within(screen.getByRole('group', { name: 'Names for line 2 of Corn Snack' })).getAllByRole('button')) {
      expect(chip.className).toContain('min-h-9')
      expect(chip.className).toContain('break-words')
    }
    for (const input of [screen.getByLabelText('Name of Corn Snack'), screen.getByLabelText('Name of line 2 of Corn Snack')]) expect(input.className).toContain('min-w-0')
    expect(screen.getByLabelText('Quantity of line 2 of Corn Snack').closest('.flex-wrap')).toBeTruthy()
  })
})

describe('K53: the SHOP card in the List view, in Shop mode and in the cart', () => {
  const entry = card('e1', 'Corn Snack', 'chips', { in_cart: false, price: 1.39 })
  const tile = (props) =>
    render(<GroceryItemTile item={entry} pack={chips} total={1.39} categoryName={(id) => id} onToggle={() => {}} onDelete={() => {}} onUpdatePricing={() => {}} onUpdatePayer={() => {}} {...props} />)

  it('List: the HOME item\'s name, the card\'s name under it in grey; not before 032', () => {
    tile({ namesReady: true })
    expect(screen.getByText('Chips & Snacks')).toBeTruthy()
    expect(screen.getByText('Corn Snack').className).toContain('text-[10px]')
    cleanup()
    tile({ namesReady: false })
    expect(screen.queryByText('Chips & Snacks')).toBeNull()
  })

  it('Shop mode and its cart: the same', () => {
    const items = [entry, card('e2', 'Tuc', 'crackers', { in_cart: true, price: 2 }), card('e3', 'Napkins', null, { in_cart: false })]
    const pantryFor = (g) => data.pantry.find((p) => p.id === g.pantry_item_id) ?? null
    render(<ShoppingMode items={items} shopOrder={[]} categoryName={(id) => id} totalOf={(i) => lineTotal(i)} costOf={(i) => lineTotal(i)} pantryFor={pantryFor} onCheck={() => {}} onConfirm={() => {}} namesReady />)
    expect(screen.getByText('Chips & Snacks')).toBeTruthy()
    expect(screen.getByText('Corn Snack')).toBeTruthy()
    const cart = screen.getByText(/In the cart \(1\)/).closest('section')
    expect(within(cart).getByText('Crackers')).toBeTruthy()
    expect(within(cart).getByText('Tuc')).toBeTruthy()
    expect(screen.getByText('Napkins')).toBeTruthy()
  })
})

describe('MONEY "Add expense": "It\'s another name of…" (K54)', () => {
  const form = (namesReady = true) =>
    render(
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
        unitsReady={false}
        namesReady={namesReady}
      />
    )

  const typeRow = () => {
    typeIn('Name', 'Darjeeling Tin')
    typeIn('Price', '4,50')
    fireEvent.click(screen.getByLabelText('Add to HOME'))
  }

  it('a row whose name is no HOME item: the link, a search of normal items, the note, "Not this item", then saved with add_name', async () => {
    form()
    typeRow()
    fireEvent.click(screen.getByRole('button', { name: "It's another name of…" }))
    typeIn('Search your items…', 'te')
    const picks = within(screen.getByRole('group', { name: 'Which HOME item?' })).getAllByRole('button').map((b) => b.textContent)
    expect(picks).toContain('Tea Tin (1 pcs)')
    expect(picks.some((t) => t.startsWith('Teas'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Tea Tin (1 pcs)' }))
    expect(screen.getByText('Adds to "Tea Tin" in HOME (+1 pcs) — new name, it will be remembered.')).toBeTruthy()
    expect(screen.getByLabelText('Name').value).toBe('Darjeeling Tin')
    fireEvent.click(screen.getByRole('button', { name: 'Not this item' }))
    expect(screen.getByText('New in HOME (shown as New Item).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "It's another name of…" }))
    typeIn('Search your items…', 'tea t')
    fireEvent.click(screen.getByRole('button', { name: 'Tea Tin (1 pcs)' }))
    fireEvent.click(screen.getByRole('button', { name: /^Save purchase · €4\.50/ }))
    await vi.waitFor(() => expect(recordMoneyPurchase).toHaveBeenCalledTimes(1))
    const [line] = recordMoneyPurchase.mock.calls[0][0].payload.items
    expect(line).toMatchObject({ name: 'Darjeeling Tin', pantry_item_id: 'tea', add: 1, add_name: true, line_total: 4.5 })
  })

  it('typing the name again forgets the item chosen', () => {
    form()
    typeRow()
    fireEvent.click(screen.getByRole('button', { name: "It's another name of…" }))
    typeIn('Search your items…', 'tea')
    fireEvent.click(screen.getByRole('button', { name: 'Tea Tin (1 pcs)' }))
    typeIn('Name', 'Darjeeling Tins')
    expect(screen.queryByRole('button', { name: 'Not this item' })).toBeNull()
  })

  it('not before 032, not with Add to HOME off, not for a name HOME knows', () => {
    form(false)
    typeRow()
    expect(screen.queryByRole('button', { name: "It's another name of…" })).toBeNull()
    cleanup()
    form()
    typeIn('Name', 'Darjeeling Tin')
    expect(screen.queryByRole('button', { name: "It's another name of…" })).toBeNull()
    cleanup()
    form()
    typeIn('Name', 'Tuc')
    expect(screen.queryByRole('button', { name: "It's another name of…" })).toBeNull()
  })
})

describe('Arrived under another name (K90): the pack field of the name', () => {
  const cat = item('cat', 'Cat Wet Food', ['Felix', element('Gourmet', { packaging_unit: 'pack', quantity_per_pack: 6 })], { category_id: 'pets', packaging_unit: 'box', quantity_per_pack: 48 })
  const arrived = (boughtAs, onSubmit = vi.fn(async () => ({}))) => {
    render(<RestockForm item={cat} initial={{ quantity: 1, unit: 'pack', packSize: null }} packs canSaveUsual boughtAs={boughtAs} submitLabel="Arrived — add to HOME" onSubmit={onSubmit} onClose={() => {}} />)
    return onSubmit
  }

  it('"Felix" (no size): "pcs per pack" empty and required; 4 → saved on the name ("It will be saved as the usual size for next time.")', async () => {
    const onSubmit = arrived('Felix')
    expect(screen.getByLabelText('pcs per pack').value).toBe('')
    expect(screen.getByText('Type how many pcs are in 1 pack.')).toBeTruthy()
    typeIn('pcs per pack', '4')
    expect(screen.getByText('It will be saved as the usual size for next time.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Arrived — add to HOME' }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({ delta: 4, pack: { unit: 'pack', value: 4, firstTime: true, onName: true } })
  })

  it('"Gourmet" (pack 6): starts at 6, nothing to save', () => {
    arrived('Gourmet')
    expect(screen.getByLabelText('pcs per pack').value).toBe('6')
    expect(screen.queryByText('It will be saved as the usual size for next time.')).toBeNull()
  })
})

// Follow-up of 07/11 (K98, K101).
const chipOf = (cardName, name) => within(screen.getByRole('group', { name: `Names for ${cardName}` })).getByRole('button', { name })
const totalOn = (cardName) => screen.getByLabelText(`Total for ${cardName}`).value
const NUVOLE = { price: 1.49, quantity: 1, unit: 'pcs', source: 'trip', at: 2 }

describe('K98: line 1 takes the price of its name, only while it was not typed by hand here', () => {
  it('card €1.20 for 1 pcs, chip "Nuvole di drago" (last €1.49 per 1 pcs) → €1.49; quantity and unit unchanged; sent and saved on the card exactly like a typed €1.49', async () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE }
    confirmScreen([card('k1', 'Chips & Snacks', 'chips', { price: 1.2 })])
    expect(totalOn('Chips & Snacks')).toBe('1.20')
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('1.49')
    expect(screen.getByLabelText('Quantity of Chips & Snacks').value).toBe('1')
    expect(screen.getByLabelText('Unit of Chips & Snacks').value).toBe('pcs')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €1.49')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    const filled = confirmPurchase.mock.calls[0][0].patches
    expect(filled).toEqual([{ id: 'k1', patch: { price: 1.49 } }])
    expect(sent().items[0]).toMatchObject({ name: 'Nuvole di drago', price: 1.49, price_qty: 1, price_unit: 'pcs', quantity: 1, unit: 'pcs', line_total: 1.49 })
    // The same price typed by hand: the same patch, the same line.
    const autoLine = sent().items[0]
    cleanup()
    confirmScreen([card('k1', 'Chips & Snacks', 'chips', { price: 1.2 })])
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    typeIn('Total for Chips & Snacks', '1,49')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(2))
    expect(confirmPurchase.mock.calls[1][0].patches).toEqual(filled)
    expect(sent().items[0]).toEqual(autoLine)
  })

  it('2 pcs at €1.20 = €2.40 → chip → €2.98 (2 × 1.49); 3 pcs → €4.47 (it follows while filled in)', () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE }
    confirmScreen([card('k2', 'Chips & Snacks', 'chips', { price: 1.2, quantity: 2 })])
    expect(totalOn('Chips & Snacks')).toBe('2.40')
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('2.98')
    expect(screen.getByLabelText('Quantity of Chips & Snacks').value).toBe('2')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €2.98')
    typeIn('Quantity of Chips & Snacks', '3')
    expect(totalOn('Chips & Snacks')).toBe('4.47')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €4.47')
  })

  it('a price typed by hand (€1.10) is never overwritten: chip, card name, chip again → €1.10', () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE }
    confirmScreen([card('k3', 'Chips & Snacks', 'chips', { price: 1.2 })])
    typeIn('Total for Chips & Snacks', '1,10')
    fireEvent.blur(screen.getByLabelText('Total for Chips & Snacks'))
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('1.10')
    fireEvent.click(chipOf('Chips & Snacks', 'Chips & Snacks'))
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('1.10')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €1.10')
  })

  it('back on the card\'s name (chip or emptied), or the item\'s own name without a price → the price of the opening (€1.35); the item\'s own name with a price (€2.10) → that price', () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE }
    confirmScreen([card('k4', 'Corn Snack', 'chips', { price: 1.35 })])
    fireEvent.click(chipOf('Corn Snack', 'Nuvole di drago'))
    expect(totalOn('Corn Snack')).toBe('1.49')
    fireEvent.click(chipOf('Corn Snack', 'Corn Snack'))
    expect(totalOn('Corn Snack')).toBe('1.35')
    fireEvent.click(chipOf('Corn Snack', 'Nuvole di drago'))
    typeIn('Name of Corn Snack', '')
    expect(totalOn('Corn Snack')).toBe('1.35')
    fireEvent.click(chipOf('Corn Snack', 'Nuvole di drago'))
    fireEvent.click(chipOf('Corn Snack', 'Chips & Snacks'))
    expect(totalOn('Corn Snack')).toBe('1.35')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €1.35')
    cleanup()
    data.lastPrices = { 'Chips & Snacks': { price: 2.1, quantity: 1, unit: 'pcs', source: 'pantry', at: 1 } }
    confirmScreen([card('k4', 'Corn Snack', 'chips', { price: 1.35 })])
    fireEvent.click(chipOf('Corn Snack', 'Chips & Snacks'))
    expect(totalOn('Corn Snack')).toBe('2.10')
  })

  it('a name with no price leaves the total as it is: €1.20 stays; after a fill €1.49 stays', () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE }
    confirmScreen([card('k5', 'Chips & Snacks', 'chips', { price: 1.2 })])
    typeIn('Name of Chips & Snacks', 'Patatine Lime')
    expect(totalOn('Chips & Snacks')).toBe('1.20')
    fireEvent.click(chipOf('Chips & Snacks', 'Corn Snack'))
    expect(totalOn('Chips & Snacks')).toBe('1.20')
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    typeIn('Name of Chips & Snacks', 'Patatine Lime')
    expect(totalOn('Chips & Snacks')).toBe('1.49')
  })

  it('a price that can\'t be converted (€5.40 per pack, line in pcs) leaves €1.20; kg → gr converts: 500 gr at €3.00, "Frutta secca" €8.00 per 1 kg → €4.00, still 500 gr', () => {
    data.lastPrices = { 'Nuvole di drago': { price: 5.4, quantity: 1, unit: 'pack', source: 'trip', at: 2 }, 'Frutta secca': { price: 8, quantity: 1, unit: 'kg', source: 'trip', at: 2 } }
    confirmScreen([card('k6', 'Chips & Snacks', 'chips', { price: 1.2 }), card('t1', 'Trail Mix', 'trail', { quantity: 500, unit: 'gr', price: 3, price_qty: 500, price_unit: 'gr' })])
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('1.20')
    expect(totalOn('Trail Mix')).toBe('3.00')
    fireEvent.click(chipOf('Trail Mix', 'Frutta secca'))
    expect(totalOn('Trail Mix')).toBe('4.00')
    expect(screen.getByLabelText('Quantity of Trail Mix').value).toBe('500')
    expect(screen.getByLabelText('Unit of Trail Mix').value).toBe('gr')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €5.20')
  })

  it('lines 2…N are unchanged: line 2 Corn Snack €1.35 (its own last price), line 3 €0.80 typed; line 1 → Nuvole €1.49; 1.49 + 1.35 + 0.80 = €3.64', async () => {
    data.lastPrices = { 'Nuvole di drago': NUVOLE, 'Corn Snack': { price: 2.7, quantity: 2, unit: 'pcs', source: 'trip', at: 3 } }
    confirmScreen([card('k7', 'Chips & Snacks', 'chips', { price: 1.2, payer: P2 })])
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Names for line 2 of Chips & Snacks' })).getByRole('button', { name: 'Corn Snack' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    typeIn('Name of line 3 of Chips & Snacks', 'Patatine Lime')
    typeIn('Total for line 3 of Chips & Snacks', '0,80')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €3.35')
    fireEvent.click(chipOf('Chips & Snacks', 'Nuvole di drago'))
    expect(totalOn('Chips & Snacks')).toBe('1.49')
    expect(screen.getByLabelText('Total for line 2 of Chips & Snacks').value).toBe('1.35')
    expect(screen.getByLabelText('Total for line 3 of Chips & Snacks').value).toBe('0,80')
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €3.64')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().items.map((l) => [l.name, l.line_total, l.payer])).toEqual([
      ['Nuvole di drago', 1.49, P2],
      ['Corn Snack', 1.35, P2],
      ['Patatine Lime', 0.8, P2],
    ])
  })
})

describe('K101: a new name only once in a purchase', () => {
  const TWICE = (name) => `"${name}" is also another line of this purchase — use it only once.`
  const lineGroup = (n, cardName) => screen.getByRole('group', { name: `Line ${n} of ${cardName}` })
  const addLine = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: 'Add another name' })[index])
  const locked = () => {
    expect(confirmButton().disabled).toBe(true)
    expect(screen.getByText('Answer the question above to confirm.')).toBeTruthy()
  }
  const free = () => {
    expect(screen.queryByText(/is also another line of this purchase/)).toBeNull()
    expect(confirmButton().disabled).toBe(false)
  }

  it('(1) the name of another card that makes a new HOME item: refused under the name line, never on that card; Confirm locked; another name or × frees it', () => {
    const cart = [card('p1', 'Patatine Paprika', null, { price: 1.8 }), card('c1', 'Chips & Snacks', 'chips', { price: 1.2 })]
    confirmScreen(cart)
    addLine(1)
    typeIn('Name of line 2 of Chips & Snacks', 'patatine paprika')
    expect(within(lineGroup(2, 'Chips & Snacks')).getByText(TWICE('patatine paprika'))).toBeTruthy()
    expect(screen.getAllByText(/is also another line of this purchase/)).toHaveLength(1)
    expect(within(lineGroup(2, 'Chips & Snacks')).queryByText('New name of Chips & Snacks — it will be remembered.')).toBeNull()
    locked()
    fireEvent.click(confirmButton())
    expect(confirmPurchase).not.toHaveBeenCalled()
    typeIn('Name of line 2 of Chips & Snacks', 'Patatine Lime')
    free()
    typeIn('Name of line 2 of Chips & Snacks', 'Patatine Paprika')
    locked()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2 of Chips & Snacks' }))
    free()
    expect(confirmButton().textContent.trim()).toBe('Confirm purchase · €3.00')
  })

  it('(1) also on line 1, and with the new card after it; untick the new card ("Not in this trip") and the name is free', () => {
    confirmScreen([card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), card('p2', 'Popcorn Caramel', null, { price: 2.5 })], { splitTrips: true })
    typeIn('Name of Chips & Snacks', 'Popcorn Caramel')
    const field = screen.getByLabelText('Name of Chips & Snacks').closest('.space-y-1')
    expect(within(field).getByText(TWICE('Popcorn Caramel'))).toBeTruthy()
    expect(screen.getAllByText(/is also another line of this purchase/)).toHaveLength(1)
    locked()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    free()
  })

  it('(2) the same new name on two cards: refused on the later one in screen order; renaming or removing a line frees it', () => {
    confirmScreen([card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), card('r1', 'Crackers', 'crackers', { price: 2.1 })])
    addLine(0)
    typeIn('Name of line 2 of Chips & Snacks', 'Pop Paprika')
    addLine(1)
    typeIn('Name of line 2 of Crackers', 'POP PAPRIKA ')
    expect(within(lineGroup(2, 'Crackers')).getByText(TWICE('POP PAPRIKA'))).toBeTruthy()
    expect(within(lineGroup(2, 'Chips & Snacks')).getByText('New name of Chips & Snacks — it will be remembered.')).toBeTruthy()
    expect(screen.getAllByText(/is also another line of this purchase/)).toHaveLength(1)
    locked()
    typeIn('Name of line 2 of Crackers', 'Pop Lime')
    free()
    typeIn('Name of line 2 of Crackers', 'Pop Paprika')
    locked()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2 of Chips & Snacks' }))
    free()
    expect(within(lineGroup(2, 'Crackers')).getByText('New name of Crackers — it will be remembered.')).toBeTruthy()
  })

  it('(2) the cards the other way round: the refusal moves to the later card', () => {
    confirmScreen([card('r1', 'Crackers', 'crackers', { price: 2.1 }), card('c1', 'Chips & Snacks', 'chips', { price: 1.2 })])
    addLine(1)
    typeIn('Name of line 2 of Chips & Snacks', 'Pop Paprika')
    addLine(0)
    typeIn('Name of line 2 of Crackers', 'Pop Paprika')
    expect(within(lineGroup(2, 'Chips & Snacks')).getByText(TWICE('Pop Paprika'))).toBeTruthy()
    expect(within(lineGroup(2, 'Crackers')).queryByText(/is also another line/)).toBeNull()
    locked()
  })

  it('different names: no refusal; the same name twice in ONE card: no refusal, both lines sent with add_name (as built)', async () => {
    confirmScreen([card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), card('r1', 'Crackers', 'crackers', { price: 2.1 })])
    addLine(0)
    typeIn('Name of line 2 of Chips & Snacks', 'Pop Paprika')
    addLine(1)
    typeIn('Name of line 2 of Crackers', 'Tuc Rosmarino')
    free()
    addLine(0)
    typeIn('Name of line 3 of Chips & Snacks', 'pop paprika')
    typeIn('Total for line 3 of Chips & Snacks', '0,90')
    free()
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().items.map((l) => [l.grocery_item_id, l.name, Boolean(l.add_name), l.line_total])).toEqual([
      ['c1', 'Chips & Snacks', false, 1.2],
      ['c1', 'Pop Paprika', true, 0],
      ['c1', 'pop paprika', true, 0.9],
      ['r1', 'Crackers', false, 2.1],
      ['r1', 'Tuc Rosmarino', true, 0],
    ])
  })

  it('K94 stays for a name HOME has: "Corn Snack" on Crackers, "Tuc" on Chips', () => {
    confirmScreen([card('c1', 'Chips & Snacks', 'chips', { price: 1.2 }), card('r1', 'Crackers', 'crackers', { price: 2.1 })])
    addLine(1)
    typeIn('Name of line 2 of Crackers', 'Corn Snack')
    expect(within(lineGroup(2, 'Crackers')).getByText('"Corn Snack" is already a name of "Chips & Snacks" in HOME.')).toBeTruthy()
    addLine(0)
    typeIn('Name of line 2 of Chips & Snacks', 'Tuc')
    expect(within(lineGroup(2, 'Chips & Snacks')).getByText('"Tuc" is already a name of "Crackers" in HOME.')).toBeTruthy()
    expect(screen.queryByText(/is also another line of this purchase/)).toBeNull()
    expect(confirmButton().disabled).toBe(true)
  })
})

describe('the real data after the merge of 08/11 (round 6D stage 5)', () => {
  // "Snack Box TEST" stands for the row that was the only group row: a
  // normal item now, with 10 other names, 11 pcs and minimum 1.
  const NAMES = ['Corn Bites TEST', 'Nuvole TEST', 'Teriyaki TEST', 'Peperoncino TEST', 'Sale olive TEST', 'Verdure TEST', 'Kiss Burn TEST', 'Miele TEST', 'Sale Pepe TEST', 'Tortilla TEST']
  const box = item('box', 'Snack Box TEST', NAMES, { current_stock: 11, min_stock: 1, is_group: false, group_id: null })
  const withBox = (run) => {
    const before = data.pantry
    data.pantry = [...before, box]
    try {
      run()
    } finally {
      data.pantry = before
    }
  }

  it('Confirm purchase: name lines like any item, no variant select; an other name on line 2 is a plain line; stock goes to the item itself', async () => {
    withBox(() => confirmScreen([card('e9', 'Corn Bites TEST', 'box', { price: 1.2 })]))
    expect(screen.getByLabelText('Name of Corn Bites TEST').value).toBe('Corn Bites TEST')
    expect(screen.getByText(/restocks "Snack Box TEST"/)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Variant/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/variant|Which group/i)
    withBox(() => fireEvent.click(screen.getByRole('button', { name: 'Add another name' })))
    typeIn('Name of line 2 of Corn Bites TEST', 'Tortilla TEST')
    typeIn('Total for line 2 of Corn Bites TEST', '0,90')
    expect(screen.queryByText(/New name of Snack Box TEST/)).toBeNull()
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalled())
    const items = sent().items
    expect(items.map((i) => [i.pantry_item_id, i.grocery_item_id, i.name, i.add_name ?? false])).toEqual([
      ['box', 'e9', 'Corn Bites TEST', false],
      ['box', 'e9', 'Tortilla TEST', false],
    ])
  })

  it('SHOP list: judged on its own 11 pcs and minimum 1 — not listed; at 1 "Low Stock", at 0 "Out of Stock"; titled with the item, the card name under it', async () => {
    const { restockReason } = await import('../lib/inventory')
    const { RESTOCK_LABELS } = await import('../lib/inventoryStyles')
    expect(restockReason(box)).toBeNull()
    for (const [stock, reason, text] of [
      [1, 'low', 'Low Stock'],
      [0, 'out', 'Out of Stock'],
    ]) {
      const now = { ...box, current_stock: stock }
      expect(restockReason(now)).toBe(reason)
      expect(RESTOCK_LABELS[reason].label).toBe(text)
      render(<GroceryItemTile item={card('e10', 'Nuvole TEST', 'box', { in_cart: false })} reason={reason} pack={now} total={0} categoryName={() => 'Snacks'} onToggle={() => {}} onDelete={() => {}} onUpdatePricing={() => {}} onUpdatePayer={() => {}} namesReady />)
      expect(screen.getByText(text)).toBeTruthy()
      expect(screen.getByText('Snack Box TEST')).toBeTruthy()
      expect(screen.getByText('Nuvole TEST')).toBeTruthy()
      cleanup()
    }
  })
})
