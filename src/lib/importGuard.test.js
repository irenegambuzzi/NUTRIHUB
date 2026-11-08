import { describe, expect, it } from 'vitest'
import { csvRowsToItems, importedText, importPlan, itemsToCsv, parseCsv, restorePlan, skippedImportLine } from './inventoryBackup'
import { mergedNamesDeleteText } from './itemNames'

// Round 6D stage 4 follow-up (plan 9N K119–K125): the import guard, the
// group of a restored row, a target's expiry and batch, and K116 with one
// name.
const categories = [{ id: 'snacks', name: 'Snacks', type: 'parent', parent_id: null }]
const item = (id, name, extra = {}) => ({
  id,
  name,
  unit: 'pcs',
  category_id: 'snacks',
  subcategory_id: null,
  current_stock: 0,
  min_stock: 0,
  is_group: false,
  group_id: null,
  ...extra,
})
const merged = (id, name) => ({ name, from_item_id: id, origin: { id, name } })
const csvOf = (items) => csvRowsToItems(parseCsv(itemsToCsv(items, (id) => categories.find((c) => c.id === id)?.name ?? '')), categories)

// Made before the merge: T 1 pcs with "old note", A 2 pcs, B 3 pcs.
const before = [
  item('t', 'TEST Nacho Tray', { current_stock: 1, notes: 'old note', expiry_date: '2026-11-20', batch_lot: 'L-OLD', payer: 'shared' }),
  item('a', 'TEST Corn Bites', { current_stock: 2 }),
  item('b', 'TEST Puff Rings', { current_stock: 3 }),
]
// After A and B were merged into T and T was bought +4: 10 pcs.
const t = item('t', 'TEST Nacho Tray', {
  current_stock: 10,
  min_stock: 4,
  notes: 'new note',
  expiry_date: '2027-03-01',
  batch_lot: 'L-NEW',
  price: 1.2,
  price_qty: 1,
  price_unit: 'pcs',
  packaging_unit: 'pack',
  quantity_per_pack: 4,
  names: [merged('a', 'TEST Corn Bites'), merged('b', 'TEST Puff Rings')],
})

describe('Import CSV / Excel after a merge (K119)', () => {
  it('test 1: A and B skipped; T stays 10 pcs, keeps its names, no group; its note from the file; the texts with m = 2, k = 1', () => {
    const rows = csvOf(before)
    const plan = importPlan(rows, [t])
    expect(plan.skipped.map((r) => r.id)).toEqual(['a', 'b'])
    expect(plan.kept.map((r) => r.name)).toEqual(['TEST Nacho Tray'])
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({ id: 't', current_stock: 10, unit: 'pcs', notes: 'old note' })
    // Nothing the file doesn't carry is added: names, group and price_qty stay as they are now.
    expect(Object.keys(plan.items[0]).sort()).toEqual(Object.keys(rows[0]).sort())
    expect(['names', 'is_group', 'group_id'].some((f) => f in plan.items[0])).toBe(false)
    expect(skippedImportLine(2)).toBe('2 of these items were merged into another item since this file was made — they are skipped.')
    expect(skippedImportLine(1)).toBe('1 of these items was merged into another item since this file was made — it is skipped.')
    expect(skippedImportLine(0)).toBe('')
    expect(importedText(plan)).toBe('Imported 1 item. 2 skipped: merged into another item. 1 item kept its merged names and stock: TEST Nacho Tray.')
  })

  it('without merges: every row as in the file, exactly today\'s text (the durable note too)', () => {
    const rows = csvOf(before)
    const plan = importPlan(rows, [item('t', 'TEST Nacho Tray', { current_stock: 9 })])
    expect(plan.items).toEqual(rows)
    expect(importedText(plan)).toBe('Imported 3 items.')
    expect(importedText(importPlan(rows.slice(0, 1), []), ' 1 durable row skipped (durable items don\'t go into HOME stock).')).toBe(
      'Imported 1 item. 1 durable row skipped (durable items don\'t go into HOME stock).'
    )
    const two = { items: [], skipped: [{}], kept: [{ name: 'T' }, { name: 'U' }] }
    expect(importedText(two)).toBe('Imported 0 items. 1 skipped: merged into another item. 2 items kept their merged names and stock: T, U.')
  })

  it('test 2 (K124): the file counts T in pack (2 pack, €5.00 per pack), now 10 pcs at €1.20 per pcs → unit, stock, minimum, pack size and price as now', () => {
    const file = csvOf([{ ...before[0], unit: 'pack', current_stock: 2, min_stock: 1, packaging_unit: 'box', quantity_per_pack: 2, price: 5, payer: 'shared' }])
    const [row] = importPlan(file, [t]).items
    expect(row).toMatchObject({ unit: 'pcs', current_stock: 10, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 1.2 })
    expect(row).toMatchObject({ name: 'TEST Nacho Tray', category_id: 'snacks', notes: 'old note', payer: 'shared' })
    expect(Object.keys(row).sort()).toEqual(Object.keys(file[0]).sort())
  })

  it('test 5: a new row named like a merged name of T (plural, capitals) is skipped; a plain other name or a row of an item now is not', () => {
    const withPlain = { ...t, names: [...t.names, { name: 'TEST Snack Tray', origin: null }] }
    const n = item('n', 'TEST Lime Soda', { current_stock: 1 })
    const rows = csvRowsToItems(
      [
        { name: 'test corn bite', current_stock: '4' },
        { name: 'TEST Snack Tray', current_stock: '1' },
        { id: 'gone', name: 'TEST PUFF RINGS', current_stock: '2' },
        { id: 'n', name: 'TEST Lime Soda', current_stock: '5' },
      ],
      categories
    )
    const plan = importPlan(rows, [withPlain, n])
    expect(plan.skipped.map((r) => r.name)).toEqual(['test corn bite', 'TEST PUFF RINGS'])
    expect(plan.items.map((r) => r.name)).toEqual(['TEST Snack Tray', 'TEST Lime Soda'])
    expect(plan.kept).toEqual([])
    expect(importedText(plan)).toBe('Imported 2 items. 2 skipped: merged into another item.')
  })
})

describe('a target keeps its expiry and batch (K125)', () => {
  // C is a normal item in the same file: stock and expiry from the file.
  const c = item('c', 'TEST Oat Milk', { unit: 'L', current_stock: 3, expiry_date: '2026-12-05', batch_lot: 'C-OLD' })
  const cNow = { ...c, current_stock: 1, expiry_date: '2027-01-10', batch_lot: 'C-NEW' }

  it('test 3, JSON restore: T stays 10 pcs with expiry 01/03/2027 and batch L-NEW; C back to 3 L, 05/12/2026, C-OLD', () => {
    const plan = restorePlan({ app: 'nutrihub-inventory', items: [before[0], c] }, [t, cNow])
    expect(plan.backup.items[0]).toMatchObject({ current_stock: 10, expiry_date: '2027-03-01', batch_lot: 'L-NEW', notes: 'old note', is_group: false, group_id: null })
    expect(plan.backup.items[1]).toEqual(c)
  })

  it('test 3, CSV import: the same', () => {
    const plan = importPlan(csvOf([before[0], c]), [t, cNow])
    expect(plan.items[0]).toMatchObject({ current_stock: 10, expiry_date: '2027-03-01', batch_lot: 'L-NEW', notes: 'old note' })
    expect(plan.items[1]).toMatchObject({ current_stock: 3, unit: 'L', expiry_date: '2026-12-05', batch_lot: 'C-OLD' })
  })
})

describe('a restored row keeps its group only when that group is still one (K120)', () => {
  // Backup (1 Nov): X a variant of G; Y of G2; Z of H; W of K.
  const backup = {
    app: 'nutrihub-inventory',
    items: [
      item('g', 'TEST Gummies', { is_group: true }),
      item('x', 'TEST Gummy Bears', { group_id: 'g', current_stock: 2 }),
      item('g2', 'TEST Crackers', { is_group: true }),
      item('y', 'TEST Rice Crackers', { group_id: 'g2', current_stock: 1 }),
      item('h', 'TEST Wafers', { is_group: true }),
      item('z', 'TEST Lemon Wafers', { group_id: 'h', current_stock: 4 }),
      item('w', 'TEST Green Tea', { group_id: 'k', current_stock: 5 }),
    ],
  }
  // Now: X was taken out of G, then G was merged (a normal item holding a
  // name); G2 and Y deleted; H merged into U; K still a group (not in the file).
  const now = [
    item('g', 'TEST Gummies', { current_stock: 3, names: [merged('q', 'TEST Jelly Rings')] }),
    item('x', 'TEST Gummy Bears', { current_stock: 2 }),
    item('u', 'TEST Biscuits', { current_stock: 6, names: [merged('h', 'TEST Wafers')] }),
    item('k', 'TEST Tea', { is_group: true }),
  ]

  it('test 4: G merged → X with no group; G2 deleted but in the file → Y keeps G2; H skipped → Z with no group; K a group now → W keeps it', () => {
    const plan = restorePlan(backup, now)
    const byId = Object.fromEntries(plan.backup.items.map((r) => [r.id, r]))
    expect(plan.skipped.map((r) => r.id)).toEqual(['h'])
    expect(byId.g).toMatchObject({ is_group: false, group_id: null, current_stock: 3 })
    expect(byId.x.group_id).toBeNull()
    expect(byId.g2).toMatchObject({ is_group: true })
    expect(byId.y.group_id).toBe('g2')
    expect(byId.z.group_id).toBeNull()
    expect(byId.w.group_id).toBe('k')
    expect(byId.y).toBe(backup.items[3])
  })

  it('a group gone and not in the file → no group, so nothing points to a missing item', () => {
    const plan = restorePlan({ app: 'nutrihub-inventory', items: [backup.items[1]] }, [])
    expect(plan.backup.items[0]).toMatchObject({ id: 'x', group_id: null, current_stock: 2 })
  })
})

describe('K116 with one name (K123)', () => {
  it('test 6: "it" for one name; two or more names unchanged', () => {
    expect(mergedNamesDeleteText({ names: [merged('a', 'Corn Snack')] })).toBe("It holds the name of 1 merged item (Corn Snack). Once deleted, it can't be separated again.")
    expect(mergedNamesDeleteText({ names: [merged('a', 'Corn Snack'), merged('b', 'Tortilla Chips')] })).toBe(
      "It holds the names of 2 merged items (Corn Snack, Tortilla Chips). Once deleted, they can't be separated again."
    )
  })
})
