import { describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('./supabaseClient', () => client)

const { checkMoveIntoGroup, groupsReady, newVariantFields, withGroupTotals } = await import('./groups')
const { displayReason, formatPurchaseQuantity, restockReason, stockStatus, suggestedPurchase, syncShoppingForItem, toBaseQuantity } = await import('./inventory')
const { confirmationPayload, purchaseLine } = await import('./purchase')
const { SORTS, matchesExpiryDeep, searchRank } = await import('./pantryFilters')
const { formatStockUnitPrice, lineTotal } = await import('./pricing')
const { matchesGrocerySearch, variantHint } = await import('./grocerySearch')

const chips = { id: 'g', name: 'Chips & Snacks', unit: 'pcs', min_stock: 4, is_group: true, category_id: 'snacks', current_stock: 0, created_at: '1' }
const lays = { id: 'v1', name: 'Lays', unit: 'pcs', current_stock: 3, min_stock: 10, group_id: 'g', category_id: 'snacks', expiry_date: '2020-01-01' }
const pringles = { id: 'v2', name: 'Pringles', unit: 'pcs', current_stock: 0.5, min_stock: 1, group_id: 'g', category_id: 'snacks' }
const rice = { id: 'r', name: 'Rice', unit: 'gr', current_stock: 1250.5, min_stock: 500, category_id: 'pantry-staples' }

describe('items without groups are untouched', () => {
  it('returns the very same rows, with the same stock and colours', () => {
    const rows = [rice, { id: 'm', name: 'Milk', unit: 'btl', current_stock: 0, min_stock: 2 }]
    expect(withGroupTotals(rows)).toBe(rows)
    expect(restockReason(rows[0])).toBeNull()
    expect(restockReason(rows[1])).toBe('out')
    expect(displayReason(rows[1])).toBe('out')
    expect(groupsReady(rows)).toBe(false) // no column yet: groups say so instead of failing
    expect(groupsReady([])).toBe(true)
    expect(groupsReady([{ ...rice, is_group: false, group_id: null }])).toBe(true)
  })
})

describe('a group and its variants', () => {
  const rows = withGroupTotals([chips, lays, pringles, rice])

  it("shows the total of the variants, counted in the group's unit, and leaves the others as they are", () => {
    const group = rows.find((r) => r.id === 'g')
    expect(group.current_stock).toBe(3.5)
    expect(group.variants.map((v) => v.name)).toEqual(['Lays', 'Pringles'])
    expect(rows.find((r) => r.id === 'v1')).toBe(lays)
    expect(rows.find((r) => r.id === 'r')).toBe(rice)
  })

  it("follows the normal colour rules on the total and the group's threshold", () => {
    const at = (stock) => withGroupTotals([chips, { ...lays, current_stock: stock }]).find((r) => r.id === 'g')
    expect(stockStatus(at(10))).toBe('ok')
    expect(restockReason(at(10))).toBeNull()
    expect(restockReason(at(4))).toBe('low')
    expect(restockReason(at(0))).toBe('out')
  })

  it("a variant's own threshold never puts it on the list; the card still shows out / expired", () => {
    expect(restockReason(lays)).toBeNull() // 3 is below its own minimum of 10
    expect(displayReason(lays)).toBe('expired')
    expect(displayReason({ ...pringles, current_stock: 0 })).toBe('out')
    expect(displayReason(pringles)).toBeNull()
  })

  it('suggests buying for the group from its total', () => {
    expect(suggestedPurchase(rows.find((r) => r.id === 'g'))).toEqual({ quantity: 4.5, unit: 'pcs' })
  })
})

describe('moving an item into a group', () => {
  it('same unit goes straight in', () => {
    expect(checkMoveIntoGroup(lays, chips)).toEqual({ ok: true })
  })
  it('a convertible unit asks for a confirmed conversion', () => {
    const grams = { ...chips, unit: 'gr' }
    expect(checkMoveIntoGroup({ id: 'k', name: 'Crisps', unit: 'kg' }, grams)).toEqual({ convert: { factor: 1000, from: 'kg', to: 'gr' } })
  })
  it('an unconvertible unit is blocked with a clear message', () => {
    const { blocked } = checkMoveIntoGroup({ id: 'k', name: 'Crisps', unit: 'pack' }, chips)
    expect(blocked).toMatch(/counted in pack.*counts in pcs/)
  })
  it("a group can't go inside a group", () => {
    expect(checkMoveIntoGroup(chips, { ...chips, id: 'h' }).blocked).toMatch(/group/)
  })
  it('a new variant starts in the group category and unit', () => {
    expect(newVariantFields(chips, ' Doritos ', { current_stock: 2 })).toEqual({
      name: 'Doritos',
      category_id: 'snacks',
      subcategory_id: null,
      unit: 'pcs',
      min_stock: 0,
      group_id: 'g',
      current_stock: 2,
    })
  })
})

// A stand-in database with a few tables: reads return rows matching the
// .eq() filters, writes are recorded.
function fakeDb(tables) {
  const writes = []
  client.supabase = {
    from: (table) => {
      const filters = []
      const result = () => ({ data: (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v))), error: null })
      const q = {
        eq: (k, v) => (filters.push([k, v]), q),
        in: (k, v) => (filters.push([k, v]), q),
        select: () => q,
        maybeSingle: () => Promise.resolve({ data: result().data[0] ?? null, error: null }),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      }
      return {
        select: () => q,
        insert: (rows) => (writes.push({ op: 'insert', table, rows }), { select: () => Promise.resolve({ data: rows, error: null }), then: (r) => r({ data: rows, error: null }) }),
        delete: () => ({ in: (k, ids) => (writes.push({ op: 'delete', table, ids }), Promise.resolve({ error: null })) }),
      }
    },
  }
  return writes
}

describe('the shopping list works per variant', () => {
  const grocery = (rows) => ({ grocery_items: rows, pantry_items: [chips, lays, pringles] })

  it('a group going low with no variant at 0 lists the variant with the least (1 of its unit), never the group', async () => {
    const writes = fakeDb(grocery([]))
    await syncShoppingForItem(chips)
    const inserts = writes.filter((w) => w.op === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].rows[0]).toMatchObject({ name: 'Pringles', pantry_item_id: 'v2', auto_generated: true, quantity: 1, unit: 'pcs' })
  })

  it('a variant changing checks its group; its own entry is the group\'s row now', async () => {
    const writes = fakeDb(grocery([{ id: 'own', pantry_item_id: 'v2', auto_generated: true, completed: false }]))
    await syncShoppingForItem(lays)
    expect(writes).toEqual([])
  })

  it('a group that is fine again loses its automatic entries (old group-level ones too); manual ones stay', async () => {
    const full = [chips, { ...lays, current_stock: 20 }]
    const writes = fakeDb({
      pantry_items: full,
      grocery_items: [
        { id: 'auto', pantry_item_id: 'g', auto_generated: true, completed: false },
        { id: 'variant', pantry_item_id: 'v1', auto_generated: true, completed: false },
        { id: 'manual', pantry_item_id: 'g', auto_generated: false, completed: false },
      ],
    })
    await syncShoppingForItem(chips)
    expect(writes).toEqual([{ op: 'delete', table: 'grocery_items', ids: ['auto', 'variant'] }])
  })

  it('an automatic entry ordered online stays when the group is fine again (it leaves when the order arrives)', async () => {
    const full = [chips, { ...lays, current_stock: 20 }]
    const writes = fakeDb({
      pantry_items: full,
      grocery_items: [
        { id: 'auto', pantry_item_id: 'v1', auto_generated: true, completed: false },
        { id: 'ordered', pantry_item_id: 'v1', auto_generated: true, completed: false },
      ],
      orders: [{ id: 'o', grocery_item_id: 'ordered', status: 'on_the_way' }],
    })
    await syncShoppingForItem(chips)
    expect(writes).toEqual([{ op: 'delete', table: 'grocery_items', ids: ['auto'] }])
  })

  it('a low group with an entry on the way gets no second entry', async () => {
    const writes = fakeDb({
      pantry_items: [chips, lays, pringles],
      grocery_items: [{ id: 'ordered', pantry_item_id: 'v2', auto_generated: true, completed: false }],
      orders: [{ id: 'o', grocery_item_id: 'ordered', status: 'on_the_way' }],
    })
    await syncShoppingForItem(chips)
    expect(writes).toEqual([])
  })

  it('a group with no variants yet is not "out of stock"', async () => {
    const writes = fakeDb({ pantry_items: [chips], grocery_items: [] })
    await syncShoppingForItem(chips)
    expect(writes).toEqual([])
  })

  it('a variant taken out of its group is judged on its own again', async () => {
    const writes = fakeDb({ pantry_items: [chips], grocery_items: [] })
    await syncShoppingForItem({ ...pringles, group_id: null, current_stock: 0 })
    expect(writes.filter((w) => w.op === 'insert').map((w) => w.rows[0].name)).toEqual(['Pringles'])
  })
})

describe('buying a group-level entry from before', () => {
  const pantry = withGroupTotals([chips, lays, pringles, rice])
  const entry = { id: 'e', name: 'Chips & Snacks', pantry_item_id: 'g', quantity: 5, unit: 'pcs', payer: 'shared', category_id: 'snacks' }

  it('asks which variant gets the stock until it is chosen', () => {
    expect(purchaseLine(entry, pantry)).toMatchObject({ needsVariant: true, ready: false, add: 5 })
    expect(purchaseLine(entry, pantry, { variantId: 'v2' })).toMatchObject({ needsVariant: false, ready: true, add: 5 })
    expect(purchaseLine(entry, pantry, { newVariantName: ' Doritos ' })).toMatchObject({ needsVariant: false, ready: true, newVariant: 'Doritos' })
    expect(purchaseLine(entry, pantry, { newVariantName: '  ' })).toMatchObject({ needsVariant: true })
  })

  it("won't send the stock to a variant of another group", () => {
    expect(purchaseLine(entry, pantry, { variantId: 'r' })).toMatchObject({ needsVariant: true })
  })

  it('restocks the chosen variant (or the one made on the spot), recorded like any purchase', () => {
    const pay = (answers, variantIds) =>
      confirmationPayload({
        id: 't', date: '2026-10-20', at: 'x', lines: [purchaseLine(entry, pantry, answers)], answers: { e: answers }, totalOf: () => 6, expenseCategoryFor: () => 'cat', variantIds,
      }).items[0]
    expect(pay({ variantId: 'v2' })).toMatchObject({ pantry_item_id: 'v2', add: 5, line_total: 6, durable: false })
    expect(pay({ newVariantName: 'Doritos' }, new Map([['e', 'new-id']]))).toMatchObject({ pantry_item_id: 'new-id', add: 5 })
  })

  it("an expired chosen variant asks about its stock, like any item", () => {
    expect(purchaseLine(entry, pantry, { variantId: 'v1' })).toMatchObject({ expired: true, needsExpiryChoice: true, ready: false })
  })

  it('an ordinary item is bought exactly as before', () => {
    const line = purchaseLine({ id: 'x', name: 'Rice', quantity: 1, unit: 'kg' }, pantry)
    expect(line).toMatchObject({ add: 1000, ready: true, needsVariant: false, group: null })
    expect(line.target).toBe(rice)
  })
})

describe('searching finds variants and shows their group', () => {
  const names = (id) => (id === 'category' ? 'Snacks' : null)
  it('HOME: a variant is found by its name or brand, and by the group name', () => {
    expect(searchRank(lays, 'lay', names, 'Chips & Snacks')).toBe(1)
    expect(searchRank(lays, 'chips', names, 'Chips & Snacks')).toBe(3)
    expect(searchRank(lays, 'chips', names, null)).toBe(-1)
    expect(searchRank(rice, 'chips', names)).toBe(-1)
  })
  it('HOME: a group matches an expiry filter through its variants', () => {
    const group = withGroupTotals([chips, lays, pringles]).find((r) => r.id === 'g')
    expect(matchesExpiryDeep(group, 'expired')).toBe(true)
    expect(matchesExpiryDeep(group, 'none')).toBe(false)
    expect(matchesExpiryDeep(rice, 'none')).toBe(true)
    expect(SORTS.az.fn(lays, pringles)).toBeLessThan(0)
  })
  it('SHOP: the group line is found by a variant, with a hint', () => {
    const line = { name: 'Chips & Snacks', category_id: 'snacks' }
    const cat = () => 'Snacks'
    expect(matchesGrocerySearch(line, 'lays', cat, ['Lays', 'Pringles'])).toBe(true)
    expect(matchesGrocerySearch(line, 'doritos', cat, ['Lays', 'Pringles'])).toBe(false)
    expect(variantHint(line, 'lay', ['Lays', 'Pringles'])).toBe('In it: Lays')
    expect(variantHint(line, 'chips', ['Lays'])).toBeNull()
  })
})

describe('purchase unit with a decimal conversion', () => {
  const bottle = { unit: 'L', packaging_unit: 'btl', quantity_per_pack: 1.5, current_stock: 1, min_stock: 3 }
  const pack = { unit: 'pcs', packaging_unit: 'pack', quantity_per_pack: 12, current_stock: 0, min_stock: 6, price: 3, price_qty: 1, price_unit: 'pack' }

  it('converts what is bought into the stock unit', () => {
    expect(toBaseQuantity(bottle, 2, 'btl')).toBe(3)
    expect(toBaseQuantity(bottle, 2, 'L')).toBe(2)
    expect(toBaseQuantity({ unit: 'gr', packaging_unit: 'bag', quantity_per_pack: 500 }, 3, 'bag')).toBe(1500)
    expect(toBaseQuantity({ unit: 'pcs', packaging_unit: 'pack', quantity_per_pack: 0.5 }, 3, 'pack')).toBe(1.5)
  })

  it('suggests whole purchase units, rounded up', () => {
    // needs 2 * 3 - 1 = 5 L → 3.33 bottles → 4
    expect(suggestedPurchase(bottle)).toEqual({ quantity: 4, unit: 'btl' })
    // needs 12 pcs exactly → 1 pack; 13 → 2
    expect(suggestedPurchase(pack)).toEqual({ quantity: 1, unit: 'pack' })
    expect(suggestedPurchase({ ...pack, current_stock: 0, min_stock: 6.5 })).toEqual({ quantity: 2, unit: 'pack' })
  })

  it('shows "2 pack (24 pcs)" next to the purchase unit, and nothing extra otherwise', () => {
    expect(formatPurchaseQuantity(2, 'pack', pack)).toBe('2 pack (24 pcs)')
    expect(formatPurchaseQuantity(2, 'btl', bottle)).toBe('2 btl (3 L)')
    expect(formatPurchaseQuantity(12, 'pcs', pack)).toBe('12 pcs')
    expect(formatPurchaseQuantity(3, 'pcs', { unit: 'pcs' })).toBe('3 pcs')
    expect(formatPurchaseQuantity(3, 'pcs', null)).toBe('3 pcs')
  })

  it('shows the price per stock unit, and leaves expenses alone', () => {
    const entry = { quantity: 2, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack' }
    expect(formatStockUnitPrice(entry, pack)).toBe('€0.25 / pcs')
    expect(lineTotal(entry, pack)).toBe(6)
    expect(formatStockUnitPrice({ quantity: 1, unit: 'pcs', price: 0.25, price_qty: 1, price_unit: 'pcs' }, pack)).toBeNull()
    expect(formatStockUnitPrice(entry, null)).toBeNull()
  })

  it('confirming a purchase in purchase units or in stock units adds the converted amount', () => {
    const line = (quantity, unit) => purchaseLine({ id: 'e', name: 'Water', quantity, unit, pantry_item_id: 'w' }, [{ id: 'w', name: 'Water', ...bottle }])
    expect(line(2, 'btl').add).toBe(3)
    expect(line(2, 'L').add).toBe(2)
    expect(line(2, 'ml').add).toBe(0)
  })
})
