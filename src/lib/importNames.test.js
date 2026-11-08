import { describe, expect, it } from 'vitest'
import { csvRowsToItems, importedText, importPlan, itemsToCsv, parseCsv, restorePlan, restoredText } from './inventoryBackup'

// Round 6D stage 4 second follow-up (plan 9N K126, K128): a row of an item
// now whose name in the file belongs to another item keeps its current
// name; a target keeps its last bought date.
const categories = [{ id: 'drinks', name: 'Drinks', type: 'parent', parent_id: null }]
const item = (id, name, extra = {}) => ({
  id,
  name,
  unit: 'pcs',
  category_id: 'drinks',
  subcategory_id: null,
  current_stock: 0,
  min_stock: 0,
  is_group: false,
  group_id: null,
  ...extra,
})
const merged = (id, name) => ({ name, from_item_id: id, origin: { id, name } })
const csvOf = (items) => csvRowsToItems(parseCsv(itemsToCsv(items, (id) => categories.find((c) => c.id === id)?.name ?? '')), categories)
const backupOf = (items) => ({ app: 'nutrihub-inventory', items })
const ONE = ' 1 item kept its current name: the name in the file belongs to another item.'

// File of 1 Nov: X "TEST Corn Bites". On 3 Nov X renamed "TEST Lime Soda";
// on 5 Nov another "TEST Corn Bites" (id a) merged into T.
const fileX = item('x', 'TEST Corn Bites', { current_stock: 2, notes: 'file note' })
const xNow = item('x', 'TEST Lime Soda', { current_stock: 5, notes: 'new note' })
const tNow = item('t', 'TEST Nacho Tray', { current_stock: 6, names: [merged('a', 'TEST Corn Bites')] })

describe('a name in the file that belongs to another item (K126)', () => {
  it('test 1, CSV: X stays "TEST Lime Soda", its note and stock from the file; the line', () => {
    const plan = importPlan(csvOf([fileX]), [xNow, tNow])
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({ id: 'x', name: 'TEST Lime Soda', notes: 'file note', current_stock: 2 })
    expect(plan.keptName.map((r) => r.id)).toEqual(['x'])
    expect(importedText(plan)).toBe(`Imported 1 item.${ONE}`)
  })

  it('test 2, JSON restore: the same', () => {
    const plan = restorePlan(backupOf([fileX]), [xNow, tNow])
    expect(plan.backup.items).toEqual([{ ...fileX, name: 'TEST Lime Soda' }])
    expect(restoredText(plan)).toBe(`Restored 1 items.${ONE}`)
  })

  it('test 3: the file name is another item\'s own name now ("TEST Mango" is Z) → X stays "TEST Kiwi"', () => {
    const file = [item('x', 'TEST Mango', { notes: 'file note' })]
    const now = [item('x', 'TEST Kiwi'), item('z', 'TEST Mango')]
    expect(importPlan(csvOf(file), now).items[0]).toMatchObject({ name: 'TEST Kiwi', notes: 'file note' })
    expect(restorePlan(backupOf(file), now).backup.items[0]).toMatchObject({ name: 'TEST Kiwi', notes: 'file note' })
  })

  it('test 4: the row\'s own name now, or one of its own other names (also when another item has it too) → imported as today, no line', () => {
    const own = item('x', 'TEST Kiwi', { names: [{ name: 'TEST Kiwifruit', origin: null }, { name: 'TEST Green Fruit', origin: null }] })
    const other = item('z', 'TEST Mango', { names: [{ name: 'TEST Green Fruit', origin: null }] })
    for (const name of ['test kiwis', 'TEST Kiwifruit', 'TEST Green Fruit']) {
      const file = [item('x', name)]
      const csv = importPlan(csvOf(file), [own, other])
      expect(csv.items[0].name).toBe(name)
      expect(importedText(csv)).toBe('Imported 1 item.')
      const json = restorePlan(backupOf(file), [own, other])
      expect(json.backup.items[0]).toBe(file[0])
      expect(restoredText(json)).toBe('Restored 1 items.')
    }
  })

  it('test 5: two rows in conflict → the plural line', () => {
    const file = [fileX, item('y', 'TEST Mango'), item('w', 'TEST Plum')]
    const now = [xNow, tNow, item('y', 'TEST Peach'), item('z', 'TEST Mango'), item('w', 'TEST Plum')]
    const two = ' 2 items kept their current name: the names in the file belong to other items.'
    const csv = importPlan(csvOf(file), now)
    expect(csv.items.map((r) => r.name)).toEqual(['TEST Lime Soda', 'TEST Peach', 'TEST Plum'])
    expect(importedText(csv)).toBe(`Imported 3 items.${two}`)
    expect(restoredText(restorePlan(backupOf(file), now))).toBe(`Restored 3 items.${two}`)
  })

  it('a row whose id is no item now is not touched (not covered)', () => {
    const plan = restorePlan(backupOf([item('gone', 'TEST Mango')]), [item('z', 'TEST Mango')])
    expect(plan.backup.items[0].name).toBe('TEST Mango')
    expect(plan.keptName).toEqual([])
  })

  describe('test 6: a target row whose file name is now P\'s name', () => {
    // File: T "TEST Pretzel Mix", 1 pcs, old expiry and batch. Now: T
    // renamed, A merged into it, 10 pcs; P is "TEST Pretzel Mix".
    const fileT = item('t', 'TEST Pretzel Mix', { current_stock: 1, notes: 'file note', expiry_date: '2026-11-20', batch_lot: 'L-OLD' })
    const t = item('t', 'TEST Nacho Tray', {
      current_stock: 10,
      notes: 'new note',
      expiry_date: '2027-03-01',
      batch_lot: 'L-NEW',
      names: [merged('a', 'TEST Corn Bites')],
    })
    const now = [t, item('p', 'TEST Pretzel Mix')]
    const result = ' 1 item kept its merged names and stock: TEST Nacho Tray.' + ONE

    it('JSON restore: its name, stock, expiry and batch as now, no group, its note from the file', () => {
      const plan = restorePlan(backupOf([fileT]), now)
      expect(plan.backup.items[0]).toEqual({ ...fileT, name: 'TEST Nacho Tray', current_stock: 10, expiry_date: '2027-03-01', batch_lot: 'L-NEW', last_purchased_at: null })
      expect(restoredText(plan)).toBe(`Restored 1 items.${result}`)
    })

    it('CSV import: the same, and no column the file doesn\'t carry (names, group)', () => {
      const rows = csvOf([fileT])
      const plan = importPlan(rows, now)
      expect(plan.items[0]).toMatchObject({ name: 'TEST Nacho Tray', current_stock: 10, expiry_date: '2027-03-01', batch_lot: 'L-NEW', notes: 'file note' })
      expect(Object.keys(plan.items[0]).sort()).toEqual(Object.keys(rows[0]).sort())
      expect(importedText(plan)).toBe(`Imported 1 item.${result}`)
    })
  })
})

describe('a target keeps its last bought date (K128)', () => {
  const fileT = item('t', 'TEST Nacho Tray', { current_stock: 1, last_purchased_at: '2026-10-28T09:00:00+00:00' })
  const fileC = item('c', 'TEST Oat Milk', { current_stock: 3, last_purchased_at: '2026-10-20T09:00:00+00:00' })
  const t = { ...fileT, current_stock: 6, last_purchased_at: '2026-11-12T09:00:00+00:00', names: [merged('a', 'TEST Corn Bites')] }
  const c = { ...fileC, current_stock: 1, last_purchased_at: '2026-11-05T09:00:00+00:00' }

  it('test 7, JSON restore: T stays 12/11; C, a normal item, gets the file\'s 20/10', () => {
    const [restoredT, restoredC] = restorePlan(backupOf([fileT, fileC]), [t, c]).backup.items
    expect(restoredT.last_purchased_at).toBe('2026-11-12T09:00:00+00:00')
    expect(restoredC).toBe(fileC)
  })

  it('CSV import: the column is never read, so never written', () => {
    const plan = importPlan(csvOf([fileT, fileC]), [t, c])
    expect(plan.items.some((r) => 'last_purchased_at' in r)).toBe(false)
  })
})
