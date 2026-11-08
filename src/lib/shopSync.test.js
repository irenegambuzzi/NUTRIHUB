import { describe, expect, it, vi } from 'vitest'

// The SHOP list kept in step with stock (syncShoppingForItem) for normal
// items, group rows from an older app version and one-time items, against
// a small in-memory database.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)
const { spareEntryIds, syncShoppingForItem, toBuyEntriesOf } = await import('./inventory')
const { PAID_BY_OPTIONS } = await import('../data/constants')
const PERSON = PAID_BY_OPTIONS.find((o) => o.value !== 'shared').value

// Tables are arrays of rows; queries filter them like PostgREST would for
// what these functions use (eq, in, is, not … is true).
function fakeDb(tables, { onInsert = null } = {}) {
  const writes = []
  const from = (table) => {
    const rows = () => (tables[table] ??= [])
    const filters = []
    let op = { kind: 'select' }
    let single = false
    const matches = (r) => filters.every((f) => f(r))
    const q = {
      select: () => q,
      eq: (k, v) => (filters.push((r) => r[k] === v), q),
      in: (k, vs) => (filters.push((r) => vs.includes(r[k])), q),
      is: (k, v) => (filters.push((r) => (r[k] ?? null) === v), q),
      not: (k, _op, v) => (filters.push((r) => (r[k] ?? null) !== v), q),
      maybeSingle: () => ((single = true), q),
      then: (resolve, reject) => {
        let data
        if (op.kind === 'select') data = rows().filter(matches)
        if (op.kind === 'insert') {
          data = op.rows.map((r, i) => ({ id: `new${rows().length + i}`, created_at: `2026-10-20T12:00:0${rows().length + i}Z`, ...r }))
          rows().push(...data)
          onInsert?.(table, data)
        }
        if (op.kind === 'update') {
          data = rows().filter(matches)
          data.forEach((r) => Object.assign(r, op.patch))
        }
        if (op.kind === 'delete') {
          data = rows().filter(matches)
          tables[table] = rows().filter((r) => !matches(r))
        }
        if (op.kind !== 'select') writes.push({ op: op.kind, table, ids: data.map((r) => r.id) })
        return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject)
      },
    }
    return {
      select: () => q,
      insert: (r) => ((op = { kind: 'insert', rows: r }), q),
      update: (patch) => ((op = { kind: 'update', patch }), q),
      delete: () => ((op = { kind: 'delete' }), q),
    }
  }
  client.supabase = { from }
  return writes
}

const group = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'snacks', current_stock: 0 }
const variant = (id, current_stock, extra = {}) => ({ id, name: id, unit: 'pcs', current_stock, min_stock: 0, group_id: 'g', category_id: 'snacks', ...extra })
const open = (id, pantry_item_id, extra = {}) => ({ id, pantry_item_id, name: pantry_item_id, auto_generated: true, completed: false, in_cart: false, created_at: '2026-10-19T10:00:00Z', ...extra })
const listed = (tables) => tables.grocery_items.filter((g) => !g.completed).map((g) => g.pantry_item_id).sort()

describe('a group row from an older app version and its variants on the SHOP list (round 6D stage 5, K138)', () => {
  it('the group row never gets an entry (own stock 0, minimum 4); the variant at 0 gets its own (Out), the one at 5 none', async () => {
    const zero = variant('Pringles', 0, { min_stock: 0, price: 2.49, price_qty: 1, price_unit: 'pcs', payer: PERSON })
    const five = variant('Lays', 5, { min_stock: 1 })
    const tables = { pantry_items: [group, zero, five], grocery_items: [], orders: [] }
    fakeDb(tables)
    for (const item of tables.pantry_items) await syncShoppingForItem(item)
    expect(listed(tables)).toEqual(['Pringles'])
    expect(tables.grocery_items[0]).toMatchObject({ name: 'Pringles', auto_generated: true, quantity: 1, unit: 'pcs', price: 2.49, payer: PERSON, category_id: 'snacks' })
  })

  it('a group row judged alone writes nothing, whatever its stock and minimum', async () => {
    for (const stock of [0, 2, 9]) {
      const tables = { pantry_items: [{ ...group, current_stock: stock }], grocery_items: [], orders: [] }
      const writes = fakeDb(tables)
      await syncShoppingForItem(tables.pantry_items[0])
      expect(writes).toEqual([])
    }
  })

  it('a variant is judged on its own minimum, never on the group: 3 of minimum 4 is low, 0 of minimum 0 is out, 2 of minimum 1 is fine', async () => {
    const low = variant('Tuc', 3, { min_stock: 4 })
    const out = variant('Pringles', 0)
    const fine = variant('Lays', 2, { min_stock: 1 })
    const tables = { pantry_items: [group, low, out, fine], grocery_items: [], orders: [] }
    fakeDb(tables)
    for (const item of [low, out, fine]) await syncShoppingForItem(item)
    expect(listed(tables)).toEqual(['Pringles', 'Tuc'])
  })

  it("an old group-level automatic entry still \"to buy\" goes; in the cart, ordered online, bought or typed by hand it stays; nothing is added for the group", async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5, { min_stock: 1 })],
      grocery_items: [
        open('old1', 'g'),
        open('old2', 'g'),
        open('cart', 'g', { in_cart: true }),
        open('ordered', 'g'),
        open('bought', 'g', { completed: true }),
        open('byHand', 'g', { auto_generated: false }),
      ],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    const writes = fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id).sort()).toEqual(['bought', 'byHand', 'cart', 'ordered'])
    expect(writes.filter((w) => w.op === 'insert')).toEqual([])
  })

  it('a one-time variant at 0 is never listed', async () => {
    const party = variant('Party', 0, { one_time: true })
    const tables = { pantry_items: [group, party], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(party)
    expect(tables.grocery_items).toEqual([])
  })
})

describe('never a second automatic entry for one item', () => {
  const milk = { id: 'm', name: 'Milk', unit: 'btl', current_stock: 0, min_stock: 2, category_id: 'dairy' }

  it('never adds a second entry, however often it runs', async () => {
    const tables = { pantry_items: [milk], grocery_items: [], orders: [] }
    const writes = fakeDb(tables)
    for (let i = 0; i < 3; i++) await syncShoppingForItem(milk)
    expect(listed(tables)).toEqual(['m'])
    expect(writes.filter((w) => w.op === 'insert')).toHaveLength(1)
  })

  it('two automatic entries: the oldest stays', async () => {
    const tables = { pantry_items: [milk], grocery_items: [open('a', 'm'), open('b', 'm', { created_at: '2026-10-20T10:00:00Z' })], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(milk)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['a'])
  })

  it('an entry in the cart (or on the way) wins over a second one still "to buy"', async () => {
    const eggs = { id: 'e', name: 'Eggs', unit: 'pcs', current_stock: 0, min_stock: 6, category_id: 'dairy' }
    const tables = {
      pantry_items: [milk, eggs],
      grocery_items: [open('cart', 'm', { in_cart: true, created_at: '2026-10-20T10:00:00Z' }), open('toBuy', 'm'), open('ordered', 'e'), open('eggs2', 'e')],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    fakeDb(tables)
    await syncShoppingForItem(milk)
    await syncShoppingForItem(eggs)
    expect(tables.grocery_items.map((g) => g.id).sort()).toEqual(['cart', 'ordered'])
  })

  it('both phones adding the same entry at the same moment: one stays', async () => {
    const tables = { pantry_items: [milk], grocery_items: [], orders: [] }
    let once = true
    fakeDb(tables, {
      // The other phone's insert lands right after ours, a moment earlier.
      onInsert: (table) => {
        if (table !== 'grocery_items' || !once) return
        once = false
        tables.grocery_items.push(open('otherPhone', 'm', { created_at: '2026-10-20T11:59:59Z' }))
      },
    })
    await syncShoppingForItem(milk)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['otherPhone'])
  })

  it('spareEntryIds keeps the oldest automatic entry, or none of them next to another entry', () => {
    expect(spareEntryIds([open('b', 'x', { created_at: '2' }), open('a', 'x', { created_at: '1' })])).toEqual(['b'])
    expect(spareEntryIds([open('a', 'x'), open('cart', 'x', { in_cart: true })])).toEqual(['a'])
    expect(spareEntryIds([open('a', 'x'), open('ordered', 'x')], new Set(['ordered']))).toEqual(['a'])
    expect(spareEntryIds([open('a', 'x')])).toEqual([])
  })
})

describe('a one-time item and the SHOP list', () => {
  const sun = { id: 's', name: 'Sun cream', unit: 'pcs', current_stock: 0, min_stock: 1, one_time: true, category_id: 'personal-care' }

  it('never goes on the list by itself, even at 0', async () => {
    const tables = { pantry_items: [sun], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(sun)
    expect(tables.grocery_items).toEqual([])
  })

  it('its automatic entry leaves "to buy", but stays in the cart and when ordered online', async () => {
    const tables = {
      pantry_items: [sun],
      grocery_items: [
        { id: 'toBuy', pantry_item_id: 's', auto_generated: true, completed: false, in_cart: false },
        { id: 'cart', pantry_item_id: 's', auto_generated: true, completed: false, in_cart: true },
        { id: 'ordered', pantry_item_id: 's', auto_generated: true, completed: false, in_cart: false },
      ],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    fakeDb(tables)
    await syncShoppingForItem(sun)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['cart', 'ordered'])
  })

  it('finds what is "to buy" when it is flagged: typed by hand too, never the cart or an order', async () => {
    const tables = {
      grocery_items: [
        { id: 'auto', pantry_item_id: 's', name: 'Sun cream', auto_generated: true, completed: false, in_cart: false },
        { id: 'typed', pantry_item_id: null, name: ' sun CREAM', completed: false, in_cart: false },
        { id: 'other', pantry_item_id: null, name: 'Rice', completed: false, in_cart: false },
        { id: 'cart', pantry_item_id: 's', name: 'Sun cream', completed: false, in_cart: true },
        { id: 'ordered', pantry_item_id: 's', name: 'Sun cream', completed: false, in_cart: false },
        { id: 'bought', pantry_item_id: 's', name: 'Sun cream', completed: true, in_cart: false },
      ],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    fakeDb(tables)
    expect((await toBuyEntriesOf(sun)).map((g) => g.id).sort()).toEqual(['auto', 'typed'])
  })

  it('without the flag, an item at 0 goes on the list like any Out item', async () => {
    const normal = { ...sun, one_time: false }
    const tables = { pantry_items: [normal], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(normal)
    expect(tables.grocery_items).toHaveLength(1)
  })
})
