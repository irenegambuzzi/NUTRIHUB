import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const {
  addsToHome,
  budgetOf,
  closesEntry,
  defaultBudget,
  emptyRow,
  homeItemFor,
  homeNote,
  listEntryFor,
  listEntryNote,
  moneyPurchasePayload,
  purchaseTotal,
  rowLine,
  rowProblem,
  savesAsPlainExpense,
} = await import('./moneyPurchase')

const row = (patch) => ({ ...emptyRow(1), ...patch })
const pantry = [
  { id: 'milk', name: 'Milk', unit: 'btl', current_stock: 1, min_stock: 2 },
  { id: 'rice', name: 'Rice', unit: 'gr', current_stock: 500 },
  { id: 'cream', name: 'Sun cream', unit: 'pcs', current_stock: 0, one_time: true },
  { id: 'chips', name: 'Chips', unit: 'pack', is_group: true, current_stock: 2, variants: [{ id: 'lays', name: 'Lays', unit: 'pack', current_stock: 2, group_id: 'chips' }, { id: 'tuc', name: 'Tuc', unit: 'pack', current_stock: 0, group_id: 'chips' }] },
  { id: 'lays', name: 'Lays', unit: 'pack', current_stock: 2, group_id: 'chips' },
  { id: 'tuc', name: 'Tuc', unit: 'pack', current_stock: 0, group_id: 'chips' },
]
const ctx = {
  expenseCategories: [
    { id: 'groceries', name: 'Groceries', parent_id: null },
    { id: 'home', name: 'Home & Appliances', parent_id: null },
    { id: 'pets', name: 'Pets', parent_id: null },
  ],
  inventoryCategories: [{ id: 'dairy', name: 'Dairy' }, { id: 'pet', name: 'Pet' }, { id: 'appliances', name: 'Home & Appliances' }],
  mapRows: [{ id: 'pet', expense_category_id: 'pets' }],
}

describe('Add to HOME', () => {
  it('is on by default with a HOME category, off without one, and can be switched off', () => {
    expect(addsToHome(row({ categoryId: 'dairy' }))).toBe(true)
    expect(addsToHome(row({ categoryId: '' }))).toBe(false)
    expect(addsToHome(row({ categoryId: 'dairy', addToHome: false }))).toBe(false)
    expect(addsToHome(row({ categoryId: '', addToHome: true }))).toBe(true)
  })

  it('is always off for Home & Appliances (no stock), whatever is chosen', () => {
    expect(addsToHome(row({ categoryId: 'appliances' }))).toBe(false)
    expect(addsToHome(row({ categoryId: 'appliances', addToHome: true }))).toBe(false)
    expect(homeNote(rowLine(row({ name: 'Laptop', priceText: '900', categoryId: 'appliances' }), pantry))).toMatch(/never go into HOME/)
  })
})

describe('which HOME item a row is', () => {
  it('matches a normal item by name (a finished 1× item too), else a group', () => {
    expect(homeItemFor(' milk ', pantry).id).toBe('milk')
    expect(homeItemFor('Sun cream', pantry).id).toBe('cream')
    expect(homeItemFor('chips', pantry).id).toBe('chips')
    expect(homeItemFor('Bread', pantry)).toBeNull()
  })

  it('an existing item: stock in its own unit; a finished 1× item comes back', () => {
    const milk = rowLine(row({ name: 'Milk', priceText: '2,40', quantityText: '2', unit: 'btl', categoryId: 'dairy' }), pantry)
    expect(milk).toMatchObject({ home: true, isNew: false, add: 2, total: 2.4, quantity: 2 })
    expect(milk.target.id).toBe('milk')
    const rice = rowLine(row({ name: 'Rice', priceText: '3', quantityText: '1', unit: 'kg', categoryId: 'pantry-staples' }), pantry)
    expect(rice.add).toBe(1000)
    const cream = rowLine(row({ name: 'Sun cream', priceText: '9', categoryId: 'personal-care' }), pantry)
    expect(cream.revives).toBe(true)
    expect(homeNote(cream)).toMatch(/comes back from Finished one-time items/)
  })

  it('says to check an expired item in HOME (no question here, unlike SHOP)', () => {
    const old = [{ id: 'yog', name: 'Yogurt', unit: 'pcs', current_stock: 2, expiry_date: '2020-01-01' }]
    expect(homeNote(rowLine(row({ name: 'Yogurt', priceText: '1', categoryId: 'dairy' }), old))).toBe('Adds to "Yogurt" in HOME (+1 pcs). Its stock in HOME has expired — check it there after saving.')
  })

  it('asks the pack size when the units do not convert', () => {
    const line = rowLine(row({ name: 'Rice', priceText: '3', quantityText: '2', unit: 'pack', categoryId: 'pantry-staples' }), pantry)
    expect(line).toMatchObject({ needsPackSize: true, add: null })
    expect(rowProblem(line)).toBe('Say how many gr are in 1 pack.')
    const answered = rowLine(row({ name: 'Rice', priceText: '3', quantityText: '2', unit: 'pack', categoryId: 'pantry-staples', packSizeText: '500' }), pantry)
    expect(answered).toMatchObject({ needsPackSize: false, add: 1000 })
  })

  it('a group: the stock goes to a variant (the first at 0 until one is picked), never to the group', () => {
    const line = rowLine(row({ name: 'Chips', priceText: '1.99', unit: 'pack', categoryId: 'snacks' }), pantry)
    expect(line.group.id).toBe('chips')
    expect(line.target.id).toBe('tuc')
    const picked = rowLine(row({ name: 'Chips', priceText: '1.99', unit: 'pack', categoryId: 'snacks', variantId: 'lays' }), pantry)
    expect(picked.target.id).toBe('lays')
    const none = rowLine(row({ name: 'Chips', priceText: '1.99', unit: 'pack', categoryId: 'snacks', variantId: null }), pantry)
    expect(none.needsVariant).toBe(true)
    expect(rowProblem(none)).toBe('Choose which variant of "Chips" gets the stock.')
    const payload = moneyPurchasePayload({ id: 't', date: '2026-10-20', paidBy: 'irene', lines: [picked], budgetFor: () => 'groceries' })
    expect(payload.items[0].pantry_item_id).toBe('lays')
  })

  it('a new item: made in HOME with 1× and Min (Min 0 while 1× is on)', () => {
    const line = rowLine(row({ name: 'Balloons', priceText: '3', categoryId: 'misc', minText: '2' }), pantry)
    expect(line).toMatchObject({ isNew: true, add: 1, minStock: 2 })
    expect(rowLine(row({ name: 'Balloons', priceText: '3', categoryId: 'misc', minText: '2', oneTime: true }), pantry).minStock).toBe(0)
    expect(rowProblem(rowLine(row({ name: 'Balloons', priceText: '3', addToHome: true }), pantry))).toBe('Pick a HOME item category, or turn Add to HOME off.')
  })
})

describe('the SHOP entry of a row', () => {
  const ordered = new Set(['g-ordered'])
  const milk = pantry[0]
  it('closes only an entry still "to buy", and only when stock really goes in', () => {
    const grocery = [{ id: 'g-cart', pantry_item_id: 'milk', in_cart: true, completed: false }, { id: 'g-buy', pantry_item_id: 'milk', in_cart: false, completed: false }]
    const entry = listEntryFor('Milk', milk, grocery, ordered)
    expect(entry).toMatchObject({ state: 'to-buy', entry: { id: 'g-buy' } })
    const on = rowLine(row({ name: 'Milk', priceText: '1', unit: 'btl', categoryId: 'dairy' }), pantry)
    const off = rowLine(row({ name: 'Milk', priceText: '1', unit: 'btl', categoryId: 'dairy', addToHome: false }), pantry)
    expect(closesEntry(on, entry)).toBe(true)
    expect(closesEntry(off, entry)).toBe(false)
    expect(listEntryNote(on, entry)).toBe('On your SHOP list — it will leave the list.')
    expect(listEntryNote(off, entry)).toMatch(/stays there \(Add to HOME is off\)/)
    const payload = moneyPurchasePayload({ id: 't', date: '2026-10-20', paidBy: 'irene', lines: [on, off], budgetFor: () => 'groceries', entryOf: () => entry })
    expect(payload.items[0].list_entry_id).toBe('g-buy')
    expect(payload.items[1]).not.toHaveProperty('list_entry_id')
  })

  it('never closes an entry in the cart or ordered online, and says so', () => {
    const line = rowLine(row({ name: 'Milk', priceText: '1', unit: 'btl', categoryId: 'dairy' }), pantry)
    const cart = listEntryFor('Milk', milk, [{ id: 'g-cart', pantry_item_id: 'milk', in_cart: true, completed: false }], ordered)
    const away = listEntryFor('Milk', milk, [{ id: 'g-ordered', pantry_item_id: 'milk', in_cart: false, completed: false }], ordered)
    expect([cart.state, away.state]).toEqual(['in-cart', 'ordered'])
    expect(closesEntry(line, cart) || closesEntry(line, away)).toBe(false)
    expect(listEntryNote(line, cart)).toBe("It's in the cart in SHOP — it stays there.")
    expect(listEntryNote(line, away)).toMatch(/ordered online/)
    const payload = moneyPurchasePayload({ id: 't', date: '2026-10-20', paidBy: 'irene', lines: [line], budgetFor: () => 'g', entryOf: () => cart })
    expect(payload.items[0]).not.toHaveProperty('list_entry_id')
  })

  it('finds an entry typed by hand with the same name for a new item; bought ones never count', () => {
    const grocery = [{ id: 'g-done', name: 'Balloons', pantry_item_id: null, completed: true }, { id: 'g-new', name: 'balloons ', pantry_item_id: null, in_cart: false, completed: false }]
    expect(listEntryFor('Balloons', null, grocery).entry.id).toBe('g-new')
    expect(listEntryFor('Kites', null, grocery)).toBeNull()
  })
})

describe('the budget category of a row', () => {
  it('follows the HOME category through the mapping, else Groceries; none without a HOME category', () => {
    expect(defaultBudget(row({ categoryId: 'pet' }), ctx)).toBe('pets')
    expect(defaultBudget(row({ categoryId: 'dairy' }), ctx)).toBe('groceries')
    expect(defaultBudget(row({ categoryId: 'appliances' }), ctx)).toBe('home')
    expect(defaultBudget(row({ categoryId: '' }), ctx)).toBe('')
  })
  it('a pick by hand wins', () => {
    expect(budgetOf(row({ categoryId: 'pet', budgetId: 'groceries', budgetTouched: true }), ctx)).toBe('groceries')
    expect(budgetOf(row({ categoryId: 'pet', budgetId: 'groceries' }), ctx)).toBe('pets')
  })
})

describe('the payload for confirm_shopping_trip', () => {
  it('one expense per row; Add to HOME off = expense only (durable); the typed price is the price for the quantity', () => {
    const lines = [
      rowLine(row({ name: 'Cat food', priceText: '20', categoryId: 'pet', addToHome: false }), pantry),
      rowLine(row({ name: 'Milk', priceText: '2,40', quantityText: '2', unit: 'btl', categoryId: 'dairy' }), pantry),
      rowLine(row({ name: 'Balloons', priceText: '3', categoryId: 'misc', oneTime: true }), pantry),
    ]
    const payload = moneyPurchasePayload({ id: 'trip-1', date: '2026-10-14', at: 'now', shopId: 'conad', paidBy: 'irene', lines, budgetFor: (l) => budgetOf(l.row, ctx) })
    expect(payload).toMatchObject({ id: 'trip-1', source: 'money', trip_date: '2026-10-14', shop_id: 'conad', paid_by: 'irene', photo_ids: [] })
    expect(payload.items).toEqual([
      { name: 'Cat food', category_id: 'pet', subcategory_id: null, quantity: 1, unit: 'pcs', price: 20, price_qty: 1, price_unit: 'pcs', line_total: 20, payer: 'irene', expense_category_id: 'pets', durable: true },
      { name: 'Milk', category_id: 'dairy', subcategory_id: null, quantity: 2, unit: 'btl', price: 2.4, price_qty: 2, price_unit: 'btl', line_total: 2.4, payer: 'irene', expense_category_id: 'groceries', durable: false, pantry_item_id: 'milk', add: 2 },
      { name: 'Balloons', category_id: 'misc', subcategory_id: null, quantity: 1, unit: 'pcs', price: 3, price_qty: 1, price_unit: 'pcs', line_total: 3, payer: 'irene', expense_category_id: 'groceries', durable: false, pantry_item_id: null, add: 1, one_time: true, min_stock: 0 },
    ])
    expect(purchaseTotal(lines)).toBe(25.4)
  })

  it('keeps a pack size given for an existing item', () => {
    const line = rowLine(row({ name: 'Rice', priceText: '3', quantityText: '2', unit: 'pack', categoryId: 'pantry-staples', packSizeText: '500' }), pantry)
    const [item] = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'shared', lines: [line], budgetFor: () => 'g' }).items
    expect(item).toMatchObject({ add: 1000, packaging_unit: 'pack', quantity_per_pack: 500 })
  })
})

describe('one row = one normal expense', () => {
  it('a single row that is only an expense is saved as a plain expense (no name needed, as before)', () => {
    const plain = [rowLine(row({ name: '', priceText: '13,60' }), pantry)]
    expect(savesAsPlainExpense(plain)).toBe(true)
    expect(rowProblem(plain[0], { plain: true })).toBe('')
    expect(savesAsPlainExpense([rowLine(row({ name: 'Milk', priceText: '1', categoryId: 'dairy' }), pantry)])).toBe(false)
    expect(savesAsPlainExpense([rowLine(row({ priceText: '1' }), pantry), rowLine(row({ priceText: '2' }), pantry)])).toBe(false)
  })

  it('refuses what can\'t be saved, with the reason', () => {
    expect(rowProblem(rowLine(row({ name: '', priceText: '2' }), pantry))).toBe('Type what you bought.')
    expect(rowProblem(rowLine(row({ name: 'Bread', priceText: '' }), pantry))).toBe('Enter the price.')
    expect(rowProblem(rowLine(row({ name: 'Bread', priceText: '0' }), pantry))).toBe('Enter a price above 0.')
    expect(rowProblem(rowLine(row({ name: 'Bread', priceText: '2a' }), pantry))).toBe('Fix the numbers in red.')
    expect(rowProblem(rowLine(row({ name: 'Bread', priceText: '2', quantityText: '0' }), pantry))).toBe('Enter a quantity above 0.')
    // Free, but into HOME: stock only.
    expect(rowProblem(rowLine(row({ name: 'Milk', priceText: '0', unit: 'btl', categoryId: 'dairy' }), pantry))).toBe('')
  })
})
