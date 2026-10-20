import { describe, expect, it, vi } from 'vitest'

// The SHOP list kept in step with stock (syncShoppingForItem) for groups,
// variants and one-time items, against a small in-memory database.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)
const { syncShoppingForItem, toBuyEntriesOf } = await import('./inventory')

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

describe('a group on the SHOP list: one entry per variant at 0', () => {
  it('each variant at 0 gets its own entry (1 of its unit, its last price); the group gets none', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0, { price: 2.49, price_qty: 1, price_unit: 'pcs', payer: 'irene' }), variant('Tuc', 0)], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Pringles', 'Tuc'])
    expect(tables.grocery_items.find((g) => g.pantry_item_id === 'Pringles')).toMatchObject({ name: 'Pringles', auto_generated: true, quantity: 1, unit: 'pcs', price: 2.49, price_qty: 1, price_unit: 'pcs', payer: 'irene', category_id: 'snacks' })
  })

  it("asks for 1 of the variant's purchase unit (its pack) when it has one", async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0, { packaging_unit: 'pack', quantity_per_pack: 6 })], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items[0]).toMatchObject({ quantity: 1, unit: 'pack' })
  })

  it('a variant changing judges its whole group', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0), variant('Tuc', 0)], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(tables.pantry_items[2])
    expect(listed(tables)).toEqual(['Pringles', 'Tuc'])
  })

  it('never adds a second entry, however often it runs', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0)], grocery_items: [], orders: [] }
    const writes = fakeDb(tables)
    await syncShoppingForItem(group)
    await syncShoppingForItem(tables.pantry_items[2])
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Pringles'])
    expect(writes.filter((w) => w.op === 'insert')).toHaveLength(1)
  })

  it('a variant restocked leaves the list; one added by hand ("+ Add another variant") stays', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5), variant('Pringles', 2)],
      grocery_items: [open('auto', 'Pringles'), open('byHand', 'Lays', { auto_generated: false })],
      orders: [],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['byHand'])
  })

  it('a one-time variant at 0 is never listed', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Party', 0, { one_time: true })], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toEqual([])
  })

  it('a variant at 0 stays listed: nothing takes it away while it is at 0 (shop_dismissed_at is ignored)', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Tuc', 0, { shop_dismissed_at: '2026-10-20T10:00:00Z' })], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Tuc'])
  })

  it('a variant ordered online gets no second entry; a variant in the cart neither', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 0), variant('Pringles', 0)],
      grocery_items: [open('ordered', 'Lays'), open('cart', 'Pringles', { in_cart: true })],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    const writes = fakeDb(tables)
    await syncShoppingForItem(group)
    expect(writes).toEqual([])
  })

  it('a group at or below its minimum with no variant at 0 lists the variant with the least, and keeps it', async () => {
    const tables = { pantry_items: [group, variant('Lays', 3), variant('Pringles', 1)], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Pringles'])
    // Lays drops below Pringles: the row doesn't jump to Lays.
    tables.pantry_items[1].current_stock = 0.5
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Pringles'])
    // Back above the minimum: it goes.
    tables.pantry_items[1].current_stock = 10
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual([])
  })
})

describe('tidying old group entries and duplicates', () => {
  it('group-level entries still "to buy" (the two "Chips & Snacks") are replaced by one entry per variant at 0', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5), variant('Peperoncino', 0), variant('Teriyaki', 0)],
      grocery_items: [open('old1', 'g'), open('old2', 'g')],
      orders: [],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(listed(tables)).toEqual(['Peperoncino', 'Teriyaki'])
  })

  it('never touches a group-level entry in the cart, ordered online or bought', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5), variant('Teriyaki', 0)],
      grocery_items: [
        open('cart', 'g', { in_cart: true }),
        open('ordered', 'g'),
        open('bought', 'g', { completed: true }),
        open('byHand', 'g', { auto_generated: false }),
      ],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id).sort()).toEqual(['bought', 'byHand', 'cart', 'new4', 'ordered'])
    expect(tables.grocery_items.find((g) => g.id === 'new4').pantry_item_id).toBe('Teriyaki')
  })

  it('two entries for the same variant: the oldest stays', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5), variant('Teriyaki', 0)],
      grocery_items: [open('newer', 'Teriyaki', { created_at: '2026-10-20T10:00:00Z' }), open('older', 'Teriyaki', { created_at: '2026-10-19T10:00:00Z' })],
      orders: [],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['older'])
  })

  it('an entry in the cart (or on the way) wins over a second one still "to buy"', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 0), variant('Teriyaki', 0)],
      grocery_items: [open('cart', 'Teriyaki', { in_cart: true, created_at: '2026-10-20T10:00:00Z' }), open('toBuy', 'Teriyaki'), open('ordered', 'Lays'), open('lays2', 'Lays')],
      orders: [{ grocery_item_id: 'ordered', status: 'on_the_way' }],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id).sort()).toEqual(['cart', 'ordered'])
  })

  it('both phones adding the same entry at the same moment: one stays', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Teriyaki', 0)], grocery_items: [], orders: [] }
    let once = true
    fakeDb(tables, {
      // The other phone's insert lands right after ours, a moment earlier.
      onInsert: (table) => {
        if (table !== 'grocery_items' || !once) return
        once = false
        tables.grocery_items.push(open('otherPhone', 'Teriyaki', { created_at: '2026-10-20T11:59:59Z' }))
      },
    })
    await syncShoppingForItem(group)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['otherPhone'])
  })

  it('a normal item with two automatic entries keeps one', async () => {
    const milk = { id: 'm', name: 'Milk', unit: 'btl', current_stock: 0, min_stock: 2, category_id: 'dairy' }
    const tables = { pantry_items: [milk], grocery_items: [open('a', 'm'), open('b', 'm', { created_at: '2026-10-20T10:00:00Z' })], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(milk)
    expect(tables.grocery_items.map((g) => g.id)).toEqual(['a'])
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
