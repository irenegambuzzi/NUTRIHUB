import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { becameFinished, entryIsOneTime, isFinished, isOneTime, splitFinished } = await import('./oneTime')
const { OLD_GROUP_NOTE, oldGroupLineText } = await import('./groups')
const { displayReason, restockReason, shownStatus, stockStatus } = await import('./inventory')
const { RESTOCK_LABELS, STATUS_STYLES } = await import('./inventoryStyles')
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

describe('every item is judged on its own stock and minimum (round 6D stage 5, K135)', () => {
  it('minimum 1: stock 2 → not on the list; 1 → yellow "Low Stock"; 0 → red "Out of Stock"', () => {
    for (const [name, unit] of [['Milk', 'btl'], ['Rice', 'kg'], ['Corn Bites TEST', 'pcs']]) {
      const at = (current_stock) => item({ name, unit, min_stock: 1, current_stock })
      expect(restockReason(at(2))).toBeNull()
      expect(restockReason(at(1))).toBe('low')
      expect(restockReason(at(0))).toBe('out')
      expect(displayReason(at(1))).toBe('low')
      expect(displayReason(at(0))).toBe('out')
    }
    expect(RESTOCK_LABELS.low).toMatchObject({ label: 'Low Stock', className: STATUS_STYLES.low.badge })
    expect(RESTOCK_LABELS.out).toMatchObject({ label: 'Out of Stock', className: STATUS_STYLES.out.badge })
  })

  it('minimum 3 and stock 3 → low; 3.5 → fine; expired with plenty → purple', () => {
    expect(restockReason(item({ min_stock: 3, current_stock: 3 }))).toBe('low')
    expect(restockReason(item({ min_stock: 3, current_stock: 3.5 }))).toBeNull()
    expect(restockReason(item({ min_stock: 3, current_stock: 8, expiry_date: '2020-01-01' }))).toBe('expired')
  })

  it('"Not urgent" exists nowhere: no reason, no colour, no label, not in any sort', () => {
    expect(PRIORITY).toEqual(['out', 'low', 'expired', 'new', 'stocked'])
    expect(Object.keys(STATUS_STYLES)).toEqual(['ok', 'low', 'out', 'expired', 'new'])
    expect(Object.keys(RESTOCK_LABELS)).toEqual(['out', 'low', 'expired', 'new'])
  })
})

describe('a group row from an older app version and its variants (round 6D stage 5, K138)', () => {
  const group = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', current_stock: 0, min_stock: 4, is_group: true, category_id: 'snacks' }
  const zero = { id: 'v0', name: 'Pringles', unit: 'pcs', current_stock: 0, min_stock: 0, group_id: 'g', category_id: 'snacks' }
  const five = { id: 'v5', name: 'Lays', unit: 'pcs', current_stock: 5, min_stock: 1, group_id: 'g', category_id: 'snacks' }

  it('the group row is never Low or Out and never needs buying (own stock 0, minimum 4); purple only when expired', () => {
    expect(stockStatus(group)).toBe('out')
    expect(restockReason(group)).toBeNull()
    expect(displayReason(group)).toBeNull()
    expect(shownStatus(group)).toBe('ok')
    expect(matchesStatus(group, 'out')).toBe(false)
    expect(displayReason({ ...group, expiry_date: '2020-01-01' })).toBe('expired')
    expect(OLD_GROUP_NOTE).toBe('Item group from an older app version — merge its variants into it: Edit item → Merge other items into this one…')
  })

  it('its variants are normal items: at 0 → Out, at 5 with minimum 1 → fine, at 1 with minimum 1 → Low', () => {
    expect(restockReason(zero)).toBe('out')
    expect(restockReason(five)).toBeNull()
    expect(restockReason({ ...five, current_stock: 1 })).toBe('low')
    expect(displayReason(zero)).toBe('out')
  })

  it('Confirm purchase: a card linked to the group row is never ready and never sends stock to it; a variant\'s card restocks the variant', () => {
    const pantry = [group, zero, five]
    const old = purchaseLine({ id: 'e1', name: 'Chips & Snacks', pantry_item_id: 'g', quantity: 2, unit: 'pcs' }, pantry)
    expect(old).toMatchObject({ target: null, pantry: null, isNew: false, add: 0, ready: false, groupProblem: oldGroupLineText(group) })
    expect(old.groupProblem).toBe('"Chips & Snacks" is an item group from an older app version and can\'t get stock — merge its variants into it first (Home → Edit item → Merge other items into this one…), or take this card out of the cart.')
    const line = purchaseLine({ id: 'e2', name: 'Pringles', pantry_item_id: 'v0', quantity: 2, unit: 'pcs' }, pantry)
    expect(line).toMatchObject({ add: 2, ready: true, groupProblem: '' })
    expect(line.target.id).toBe('v0')
    // A typed name equal to the group's makes a normal item (as 022 does).
    const typed = purchaseLine({ id: 'e3', name: 'chips & snacks', quantity: 1, unit: 'pcs' }, pantry)
    expect(typed).toMatchObject({ target: null, isNew: true, ready: true })
  })
})

describe('the SHOP list order', () => {
  const reasons = { a: 'stocked', c: 'out', d: 'low', e: 'new', f: 'expired' }
  const list = Object.keys(reasons).map((id, i) => ({ id, name: id.toUpperCase(), created_at: `2026-10-0${i + 1}` }))
  const ctx = { reasonOf: (g) => reasons[g.id], costOf: () => 1 }

  it('priority: red, then yellow, then purple, then a card added by hand (blue "New Item"), then the rest', () => {
    expect(sortGroceryItems(list, 'priority', ctx).map((g) => g.id)).toEqual(['c', 'd', 'f', 'e', 'a'])
    expect(sortGroceryItems(list, 'low', ctx).map((g) => g.id)).toEqual(['d', 'c', 'f', 'e', 'a'])
    expect(sortGroceryItems(list, 'new', ctx).map((g) => g.id)).toEqual(['e', 'c', 'd', 'f', 'a'])
  })

  it('A–Z and recent keep their own order', () => {
    expect(sortGroceryItems(list, 'az', ctx).map((g) => g.id)).toEqual(['a', 'c', 'd', 'e', 'f'])
    expect(sortGroceryItems(list, 'recent', ctx).map((g) => g.id)).toEqual(['f', 'e', 'd', 'c', 'a'])
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
