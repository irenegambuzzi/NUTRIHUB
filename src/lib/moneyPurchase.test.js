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
  pricedLines,
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
    expect(homeNote(rowLine(row({ name: 'Laptop', priceText: '900', categoryId: 'appliances' }), pantry, ctx))).toBe('Durable item (Home & Appliances) — expense only, never in HOME stock.')
  })
})

describe('round 9F: the durable lock', () => {
  // `shoes` is a durable MONEY category only by its id (Shopping main).
  const SHOPPING = '654a80a3-2e6f-4ada-b214-0486d91d869c'
  const WORK = '6faa75ea-ece5-40c9-9e44-75785f59568e'
  const c = {
    ...ctx,
    expenseCategories: [...ctx.expenseCategories, { id: SHOPPING, name: 'Shopping', parent_id: null }, { id: 'shoes', name: 'Footwear', parent_id: SHOPPING }, { id: WORK, name: 'Work', parent_id: null }],
    inventoryCategories: [...ctx.inventoryCategories, { id: 'appliances:footwear', name: 'Footwear', parent_id: 'appliances' }],
  }

  it('locks by the HOME category or by the budget category; changing the durable one to a consumable releases it', () => {
    const sandals = row({ name: 'Sandali', priceText: '20', categoryId: 'appliances', subcategoryId: 'appliances:footwear' })
    expect(rowLine(sandals, pantry, c)).toMatchObject({ home: false, lock: { source: 'home', name: 'Footwear' } })
    const byBudget = row({ name: 'Sandali', priceText: '20', categoryId: 'dairy', budgetId: 'shoes', budgetTouched: true })
    expect(rowLine(byBudget, pantry, c)).toMatchObject({ home: false, lock: { source: 'money', name: 'Footwear' } })
    expect(homeNote(rowLine(byBudget, pantry, c))).toBe('Durable item (Footwear) — expense only, never in HOME stock.')
    // Both consumable: unlocked, and Add to HOME is back to its default (on).
    expect(rowLine({ ...byBudget, budgetId: 'groceries' }, pantry, c)).toMatchObject({ home: true, lock: null })
    expect(rowLine({ ...sandals, categoryId: 'dairy', subcategoryId: '' }, pantry, c)).toMatchObject({ home: true, lock: null })
    // An auto-filled durable budget locks too, while Add to HOME is off.
    expect(rowLine(row({ name: 'Zara', priceText: '30', autoBudgetId: 'shoes' }), pantry, c).lock).toEqual({ source: 'money', kind: 'durable', name: 'Footwear' })
  })

  it('a locked row is never 1× and adds nothing to HOME, whatever was ticked before', () => {
    const line = rowLine(row({ name: 'Sandali', priceText: '20', categoryId: 'appliances', subcategoryId: 'appliances:footwear', addToHome: true, oneTime: true }), pantry, c)
    const payload = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines: [line, line], budgetFor: () => 'shoes' })
    expect(payload.items[0]).toMatchObject({ durable: true })
    expect(payload.items[0]).not.toHaveProperty('one_time')
    expect(payload.items[0]).not.toHaveProperty('add')
  })

  it('a purpose budget (Work) is filled in even with Add to HOME on, and does not lock; a pick by hand still wins', () => {
    const ink = row({ name: 'Work Printer Ink', priceText: '9', categoryId: 'dairy', autoBudgetId: WORK })
    expect(budgetOf(ink, c)).toBe(WORK)
    expect(rowLine(ink, pantry, c)).toMatchObject({ home: true, lock: null })
    expect(budgetOf({ ...ink, budgetId: 'groceries', budgetTouched: true }, c)).toBe('groceries')
    // Not a purpose: with Add to HOME on the mapping decides, as before.
    expect(budgetOf(row({ name: 'Cat food', categoryId: 'pet', autoBudgetId: 'groceries' }), c)).toBe('pets')
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
  it('round 6C2: a row not added to HOME shows the budget its name filled in (the first chip); a pick by hand still wins', () => {
    expect(budgetOf(row({ name: 'Ryanair', autoBudgetId: 'flights' }), ctx)).toBe('flights')
    expect(budgetOf(row({ name: 'Ryanair', autoBudgetId: 'flights', budgetId: 'other', budgetTouched: true }), ctx)).toBe('other')
    expect(budgetOf(row({ name: 'Cat food', categoryId: 'pet', addToHome: false, autoBudgetId: 'groceries' }), ctx)).toBe('groceries')
    expect(budgetOf(row({ name: '', autoBudgetId: '' }), ctx)).toBe('')
  })
  it('round 6C2: with Add to HOME on the mapping decides, as before', () => {
    expect(budgetOf(row({ name: 'Cat food', categoryId: 'pet', autoBudgetId: 'groceries' }), ctx)).toBe('pets')
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

describe('discounts in the purchase form', () => {
  const discounted = (patch, coupon = null, more = []) => pricedLines([rowLine(row(patch), pantry), ...more.map((p) => rowLine(row(p), pantry))], coupon)

  it('Sneakers €80 −30% → the expense is €56; the normal price €80 is what the item keeps', () => {
    const { lines, priced } = discounted({ name: 'Test sneakers', priceText: '80', discountKind: 'percent', discountText: '30', addToHome: false })
    expect(lines[0].paid).toBe(56)
    expect(purchaseTotal(lines)).toBe(56)
    const [item] = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines, budgetFor: () => 'g', priced }).items
    expect(item).toMatchObject({ price: 80, price_qty: 1, line_total: 56, list_total: 80, item_discount_kind: 'percent', item_discount_value: 30 })
    expect(item.coupon_share).toBeUndefined()
  })

  it('Jacket €120 −€25 → €95', () => {
    const { lines } = discounted({ name: 'Jacket', priceText: '120', discountKind: 'amount', discountText: '25', addToHome: false })
    expect(lines[0].paid).toBe(95)
  })

  it('a discount larger than the price (or above 100%) is refused with the reason, and nothing can be saved', () => {
    const big = discounted({ name: 'Jacket', priceText: '20', discountKind: 'amount', discountText: '25', addToHome: false }).lines[0]
    expect(rowProblem(big)).toBe('The discount (€25) is bigger than the price (€20).')
    const over = discounted({ name: 'Jacket', priceText: '20', discountKind: 'percent', discountText: '120', addToHome: false }).lines[0]
    expect(rowProblem(over)).toBe("A discount can't be more than 100%.")
  })

  it('100% off with Add to HOME off pays nothing, so it is refused; with Add to HOME on it is stock only', () => {
    const off = discounted({ name: 'Gift', priceText: '10', discountKind: 'percent', discountText: '100', addToHome: false }).lines[0]
    expect(rowProblem(off)).toMatch(/Nothing is paid/)
    const on = discounted({ name: 'Milk', priceText: '10', unit: 'btl', categoryId: 'dairy', discountKind: 'percent', discountText: '100' }).lines[0]
    expect(rowProblem(on)).toBe('')
    expect(on.paid).toBe(0)
  })

  it('€200 = Groceries €120 + Groceries €60 + Pets €20, coupon −€50 → €90 + €45 + €15 = €150, sent as shares', () => {
    const { lines, priced } = discounted(
      { name: 'Pasta set', priceText: '120', categoryId: 'dairy' },
      { kind: 'amount', text: '50' },
      [
        { name: 'Cheese', priceText: '60', categoryId: 'dairy' },
        { name: 'Cat food', priceText: '20', categoryId: 'pet', addToHome: false },
      ]
    )
    expect(lines.map((l) => l.paid)).toEqual([90, 45, 15])
    expect(purchaseTotal(lines)).toBe(150)
    const payload = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines, budgetFor: (l) => budgetOf(l.row, ctx), priced })
    expect(payload).toMatchObject({ coupon_kind: 'amount', coupon_value: 50, coupon_total: 50 })
    expect(payload.items.map((i) => [i.price, i.list_total, i.line_total, i.coupon_share])).toEqual([
      [120, 120, 90, 30],
      [60, 60, 45, 15],
      [20, 20, 15, 5],
    ])
  })

  it('item discounts first, then the coupon over what is left', () => {
    const { lines } = discounted(
      { name: 'Pasta set', priceText: '10', addToHome: false },
      { kind: 'amount', text: '5' },
      [{ name: 'Sun lotion', priceText: '12', discountKind: 'percent', discountText: '30', addToHome: false }, { name: 'Dinner', priceText: '20', addToHome: false }]
    )
    expect(lines.map((l) => l.paid)).toEqual([8.7, 7.31, 17.39])
    expect(purchaseTotal(lines)).toBe(33.4)
  })

  it('a coupon needs two items or more: with one row it is ignored (the row has its own discount)', () => {
    const { lines, priced } = discounted({ name: 'Jacket', priceText: '100', addToHome: false }, { kind: 'amount', text: '10' })
    expect(lines[0].paid).toBe(100)
    expect(priced.couponTotal).toBe(0)
  })

  it('a single expense with a discount is saved as a one-line purchase, so its history has a line; without one it stays plain', () => {
    const withDiscount = discounted({ name: 'Sneakers', priceText: '80', discountKind: 'percent', discountText: '30', addToHome: false }).lines
    expect(savesAsPlainExpense(withDiscount)).toBe(false)
    const plain = discounted({ name: 'Sneakers', priceText: '80', addToHome: false }).lines
    expect(savesAsPlainExpense(plain)).toBe(true)
  })

  it('the HOME item keeps the NORMAL price: Nutella €6.00 −50% records €3.00 but sends price 6', () => {
    const { lines, priced } = discounted({ name: 'Nutella', priceText: '6', categoryId: 'dairy', discountKind: 'percent', discountText: '50' })
    const [item] = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines, budgetFor: () => 'g', priced }).items
    expect(item).toMatchObject({ price: 6, price_qty: 1, line_total: 3, list_total: 6 })
  })

  it('with a coupon too: Nutella recorded €4.50, price still 6', () => {
    const { lines, priced } = discounted(
      { name: 'Nutella', priceText: '6', categoryId: 'dairy', discountKind: 'percent', discountText: '50' },
      { kind: 'amount', text: '1,5' },
      [{ name: 'Bread', priceText: '3', categoryId: 'dairy' }]
    )
    // after the item discount: 3 + 3 = 6; coupon 1.50 → 0.75 each; Nutella pays 2.25
    expect(lines[0].paid).toBe(2.25)
    expect(moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines, budgetFor: () => 'g', priced }).items[0]).toMatchObject({ price: 6, line_total: 2.25, list_total: 6, coupon_share: 0.75 })
  })

  it('a purchase without any discount sends the same as before, plus its normal price', () => {
    const { lines, priced } = discounted({ name: 'Cat food', priceText: '20', categoryId: 'pet', addToHome: false })
    const [item] = moneyPurchasePayload({ id: 't', date: 'd', paidBy: 'irene', lines, budgetFor: () => 'pets', priced }).items
    expect(item).toEqual({ name: 'Cat food', category_id: 'pet', subcategory_id: null, quantity: 1, unit: 'pcs', price: 20, price_qty: 1, price_unit: 'pcs', line_total: 20, list_total: 20, payer: 'irene', expense_category_id: 'pets', durable: true })
  })
})
