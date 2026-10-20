import { describe, expect, it, vi } from 'vitest'

// The SHOP list kept in step with stock (syncShoppingForItem) for groups,
// variants and one-time items, against a small in-memory database.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)
const { setVariantsDismissed, syncShoppingForItem, toBuyEntriesOf } = await import('./inventory')

// Tables are arrays of rows; queries filter them like PostgREST would for
// what these functions use (eq, in, is, not … is true).
function fakeDb(tables) {
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
          data = op.rows.map((r, i) => ({ id: `new${rows().length + i}`, ...r }))
          rows().push(...data)
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

describe('a group on the SHOP list', () => {
  it('gets one entry when the total is fine but a variant is at 0 ("Not urgent")', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0), variant('Tuc', 0)], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toHaveLength(1)
    expect(tables.grocery_items[0]).toMatchObject({ pantry_item_id: 'g', auto_generated: true, name: 'Chips & Snacks' })
  })

  it('variants never get entries of their own; a variant change judges the group', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Pringles', 0)], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(tables.pantry_items[2])
    expect(tables.grocery_items.map((g) => g.pantry_item_id)).toEqual(['g'])
  })

  it('a variant taken off by hand is not listed: the row goes when nothing else needs buying', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 5), variant('Tuc', 0)],
      grocery_items: [{ id: 'e1', pantry_item_id: 'g', auto_generated: true, completed: false }],
      orders: [],
    }
    fakeDb(tables)
    await setVariantsDismissed(group, ['Tuc'], '2026-10-20T10:00:00Z')
    expect(tables.pantry_items.find((p) => p.id === 'Tuc').shop_dismissed_at).toBe('2026-10-20T10:00:00Z')
    expect(tables.grocery_items).toEqual([])
    // Undo: the mark is cleared and the row comes back.
    await setVariantsDismissed(group, ['Tuc'], null)
    expect(tables.grocery_items).toHaveLength(1)
  })

  it('a dismissed variant comes back once restocked and out again (the database clears the mark on restock)', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Tuc', 0, { shop_dismissed_at: '2026-10-20T10:00:00Z' })], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toEqual([])
    // Restocked: the trigger pantry_items_shop_dismissed clears the mark.
    Object.assign(tables.pantry_items[2], { current_stock: 2, shop_dismissed_at: null })
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toEqual([])
    // Used up again: listed again.
    tables.pantry_items[2].current_stock = 0
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toHaveLength(1)
  })

  it('a dismissed variant does not take away a row the group needs (total at or below the minimum)', async () => {
    const tables = {
      pantry_items: [group, variant('Lays', 3), variant('Tuc', 0, { shop_dismissed_at: '2026-10-20T10:00:00Z' })],
      grocery_items: [{ id: 'e1', pantry_item_id: 'g', auto_generated: true, completed: false }],
      orders: [],
    }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toHaveLength(1)
  })

  it('a one-time variant at 0 is never listed', async () => {
    const tables = { pantry_items: [group, variant('Lays', 5), variant('Party', 0, { one_time: true })], grocery_items: [], orders: [] }
    fakeDb(tables)
    await syncShoppingForItem(group)
    expect(tables.grocery_items).toEqual([])
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
