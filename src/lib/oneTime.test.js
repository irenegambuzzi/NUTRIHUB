import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { becameFinished, entryIsOneTime, isFinished, isOneTime, splitFinished } = await import('./oneTime')
const { firstOutVariant, listedOutVariants, variantOrder, withGroupTotals } = await import('./groups')
const { displayReason, restockReason, shopReason, shownStatus } = await import('./inventory')
const { byCartOrder, inCartOrder, PRIORITY, sortGroceryItems } = await import('./grocery')
const { purchaseLine } = await import('./purchase')
const { matchesStatus } = await import('./pantryFilters')

const item = (extra = {}) => ({ id: 'p1', name: 'Sun cream', unit: 'pcs', current_stock: 1, min_stock: 2, category_id: 'personal-care', ...extra })

describe('one-time purchases (1×)', () => {
  it('is never a group, and is finished at stock 0 (worked out, not stored)', () => {
    expect(isOneTime(item({ one_time: true }))).toBe(true)
    expect(isOneTime(item({ one_time: null }))).toBe(false)
    expect(isOneTime(item())).toBe(false)
    expect(isOneTime({ ...item({ one_time: true }), is_group: true })).toBe(false)
    expect(isFinished(item({ one_time: true, current_stock: 0 }))).toBe(true)
    expect(isFinished(item({ one_time: true, current_stock: 1 }))).toBe(false)
    expect(isFinished(item({ current_stock: 0 }))).toBe(false)
  })

  it('splits finished items off (A–Z), keeping every other item', () => {
    const rows = [item({ id: 'a', name: 'Party hats', one_time: true, current_stock: 0 }), item({ id: 'b', name: 'Rice' }), item({ id: 'c', name: 'Balloons', one_time: true, current_stock: 0 })]
    const { active, finished } = splitFinished(rows)
    expect(active.map((i) => i.id)).toEqual(['b'])
    expect(finished.map((i) => i.name)).toEqual(['Balloons', 'Party hats'])
  })

  it('tells when a stock change just finished an item', () => {
    expect(becameFinished(item({ one_time: true }), item({ one_time: true, current_stock: 0 }))).toBe(true)
    expect(becameFinished(item({ one_time: true, current_stock: 0 }), item({ one_time: true, current_stock: 0 }))).toBe(false)
    expect(becameFinished(item(), item({ current_stock: 0 }))).toBe(false)
  })

  it('never turns yellow or red and never needs buying by itself', () => {
    for (const stock of [0, 1, 2]) {
      const sun = item({ one_time: true, current_stock: stock })
      expect(restockReason(sun)).toBeNull()
      expect(shopReason(sun)).toBeNull()
      expect(displayReason(sun)).toBeNull()
      expect(shownStatus(sun)).toBe('ok')
    }
    // Purple when expired is still shown, but it doesn't go on the list.
    const expired = item({ one_time: true, expiry_date: '2020-01-01' })
    expect(displayReason(expired)).toBe('expired')
    expect(restockReason(expired)).toBeNull()
  })

  it("isn't Low or Out for the HOME filters", () => {
    expect(matchesStatus(item({ one_time: true }), 'low')).toBe(false)
    expect(matchesStatus(item({ one_time: true }), 'attention')).toBe(false)
    expect(matchesStatus(item(), 'low')).toBe(true)
  })

  it('becomes a normal item again without the flag: at 0 it is Out and needs buying', () => {
    expect(restockReason(item({ one_time: false, current_stock: 0 }))).toBe('out')
  })

  it('shows the HOME flag on a linked SHOP entry, else the entry\'s own', () => {
    expect(entryIsOneTime({ one_time: false }, item({ one_time: true }))).toBe(true)
    expect(entryIsOneTime({ one_time: true }, item())).toBe(false)
    expect(entryIsOneTime({ one_time: true }, null)).toBe(true)
    expect(entryIsOneTime({}, null)).toBe(false)
  })

  it('a finished item is still found by name when bought again (one item, no duplicate)', () => {
    const hats = item({ id: 'hats', name: 'Party hats', one_time: true, current_stock: 0 })
    const line = purchaseLine({ id: 'g1', name: 'party hats', quantity: 2, unit: 'pcs' }, [hats])
    expect(line.target?.id).toBe('hats')
    expect(line.add).toBe(2)
  })
})

// Chips & Snacks, min 4.
const chips = (stocks, extra = {}) =>
  withGroupTotals([
    { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'snacks' },
    ...Object.entries(stocks).map(([name, current_stock]) => ({ id: name, name, unit: 'pcs', current_stock, min_stock: 0, group_id: 'g', category_id: 'snacks', ...(extra[name] ?? {}) })),
  ])[0]

describe('group variants on the SHOP list', () => {
  it('total above the minimum but variants at 0 → one sky "Not urgent" row listing them', () => {
    const group = chips({ Lays: 5, Pringles: 0, Tuc: 0 })
    expect(restockReason(group)).toBeNull()
    expect(shopReason(group)).toBe('not-urgent')
    expect(listedOutVariants(group.variants).map((v) => v.name)).toEqual(['Pringles', 'Tuc'])
  })

  it('total at or below the minimum → yellow; total 0 → red; the out ones are listed too', () => {
    const low = chips({ Lays: 3, Pringles: 0 })
    expect(shopReason(low)).toBe('low')
    expect(listedOutVariants(low.variants).map((v) => v.name)).toEqual(['Pringles'])
    expect(shopReason(chips({ Lays: 0, Pringles: 0 }))).toBe('out')
  })

  it('no variant at 0 and total above the minimum → not on the list', () => {
    expect(shopReason(chips({ Lays: 5, Pringles: 1 }))).toBeNull()
  })

  it('never lists a one-time variant; an old "taken off" mark (shop_dismissed_at) no longer hides one', () => {
    const group = chips({ Lays: 5, Pringles: 0, Tuc: 0, Party: 0 }, { Party: { one_time: true }, Tuc: { shop_dismissed_at: '2026-10-20T10:00:00Z' } })
    expect(listedOutVariants(group.variants).map((v) => v.name)).toEqual(['Pringles', 'Tuc'])
    const onlyOneTime = chips({ Lays: 5, Party: 0 }, { Party: { one_time: true } })
    expect(shopReason(onlyOneTime)).toBeNull()
  })

  it('a variant at 0 never needs buying by itself: only the group does', () => {
    const group = chips({ Lays: 5, Pringles: 0 })
    expect(restockReason(group.variants.find((v) => v.name === 'Pringles'))).toBeNull()
  })

  it('puts variants at 0 first, then from the lowest to the highest stock', () => {
    const group = chips({ Lays: 5, Doritos: 2, Pringles: 0, Amica: 0, Tuc: 1 })
    expect(variantOrder(group.variants).map((v) => v.name)).toEqual(['Amica', 'Pringles', 'Tuc', 'Doritos', 'Lays'])
  })

  it('Confirm purchase of a group-level entry from before takes the first out variant until the user chooses', () => {
    const group = chips({ Lays: 5, Pringles: 0, Amica: 0 })
    const pantry = [group, ...group.variants]
    const entry = { id: 'e1', name: 'Chips & Snacks', pantry_item_id: 'g', quantity: 2, unit: 'pcs' }
    expect(firstOutVariant(group.variants).name).toBe('Amica')
    expect(purchaseLine(entry, pantry).target.name).toBe('Amica')
    expect(purchaseLine(entry, pantry).needsVariant).toBe(false)
    // The user's choice wins, also "none".
    expect(purchaseLine(entry, pantry, { variantId: 'Lays' }).target.name).toBe('Lays')
    expect(purchaseLine(entry, pantry, { variantId: null }).needsVariant).toBe(true)
    // Stock goes to the variant, never to the group.
    expect(purchaseLine(entry, pantry).target.is_group).toBeFalsy()
  })

  it('pre-selects nothing when no variant is out (the group is just low)', () => {
    const group = chips({ Lays: 3, Pringles: 1 })
    const entry = { id: 'e1', name: 'Chips & Snacks', pantry_item_id: 'g', quantity: 2, unit: 'pcs' }
    expect(purchaseLine(entry, [group, ...group.variants]).needsVariant).toBe(true)
  })
})

describe('the SHOP list order', () => {
  const reasons = { a: 'stocked', b: 'not-urgent', c: 'out', d: 'low', e: 'new' }
  const list = Object.keys(reasons).map((id, i) => ({ id, name: id.toUpperCase(), created_at: `2026-10-0${i + 1}` }))
  const ctx = { reasonOf: (g) => reasons[g.id], costOf: () => 1 }

  it('priority: red and yellow on top, "Not urgent" at the bottom', () => {
    expect(PRIORITY.at(-1)).toBe('not-urgent')
    expect(sortGroceryItems(list, 'priority', ctx).map((g) => g.id)).toEqual(['c', 'd', 'e', 'a', 'b'])
    expect(sortGroceryItems(list, 'low', ctx).map((g) => g.id).at(-1)).toBe('b')
  })

  it('A–Z and recent keep their own order', () => {
    expect(sortGroceryItems(list, 'az', ctx).map((g) => g.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(sortGroceryItems(list, 'recent', ctx).map((g) => g.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })
})

describe('the cart order', () => {
  const entry = (id, cart_added_at, created_at = '2026-10-01T00:00:00Z') => ({ id, name: id, in_cart: true, cart_added_at, created_at })

  it('oldest in the cart first (Bread, Milk, Eggs), whatever order they were made in', () => {
    const cart = [entry('Eggs', '2026-10-20T10:00:03Z', '2026-09-01'), entry('Bread', '2026-10-20T10:00:01Z', '2026-10-15'), entry('Milk', '2026-10-20T10:00:02Z', '2026-10-01')]
    expect(cart.sort(byCartOrder).map((g) => g.id)).toEqual(['Bread', 'Milk', 'Eggs'])
  })

  it('two phones 2 s apart: Milk then Bread on both', () => {
    const cart = [entry('Bread', '2026-10-20T10:00:02.000Z'), entry('Milk', '2026-10-20T10:00:00.000Z')]
    expect(inCartOrder(cart).map((g) => g.id)).toEqual(['Milk', 'Bread'])
  })

  it('compares times written differently by phone and database', () => {
    expect([entry('B', '2026-10-20T10:00:01+00:00'), entry('A', '2026-10-20T10:00:00.500Z')].sort(byCartOrder).map((g) => g.id)).toEqual(['A', 'B'])
  })

  it('items put back by Reopen share a time and keep the order they were made in', () => {
    const at = '2026-10-20T12:00:00Z'
    const cart = [entry('C', at, '2026-10-03'), entry('A', at, '2026-10-01'), entry('B', at, '2026-10-02')]
    expect(cart.sort(byCartOrder).map((g) => g.id)).toEqual(['A', 'B', 'C'])
  })

  it('an entry without a cart time goes last', () => {
    const cart = [entry('none', null, '2026-01-01'), entry('Milk', '2026-10-20T10:00:00Z')]
    expect(cart.sort(byCartOrder).map((g) => g.id)).toEqual(['Milk', 'none'])
  })

  it('leaves what is to buy out, and sinks the cart to the bottom of the list in cart order', () => {
    const list = [
      { id: 'x', name: 'X', in_cart: false, created_at: '2026-10-05' },
      entry('second', '2026-10-20T10:00:02Z'),
      entry('first', '2026-10-20T10:00:01Z'),
    ]
    expect(inCartOrder(list).map((g) => g.id)).toEqual(['first', 'second'])
    const sorted = sortGroceryItems(list, 'az', { reasonOf: () => 'new', costOf: () => 0 })
    expect(sorted.map((g) => g.id)).toEqual(['x', 'first', 'second'])
  })
})
