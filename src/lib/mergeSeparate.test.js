import { describe, expect, it } from 'vitest'
import {
  canMergeInto,
  mergeButtonText,
  mergePayload,
  mergeQuestion,
  mergeRows,
  mergedNamesDeleteText,
  mergedToast,
  separatePayload,
  separateQuestion,
  separatedToast,
  separationCheck,
} from './itemNames'
import { restockReason } from './inventory'
import { restorePlan, restoredText, skippedQuestionLine } from './inventoryBackup'
import { purchasedQuantityLabel } from './packSize'

// Stage 4 of round 6D (plan 9N, K107–K118): the pure rules of the merge and
// separate actions, the delete question, the restore guard and the
// quantity line of Receipts. Every name here is a TEST name.
const item = (id, name, extra = {}) => ({ id, name, unit: 'pcs', current_stock: 0, min_stock: 0, category_id: 'snacks', ...extra })

describe('the merge picker rows (K109, K110)', () => {
  const pcsTarget = item('t', 'TEST Meat Snacks', { packaging_unit: 'pack', quantity_per_pack: 4 })

  it('a source in another unit with stock shows the converted amount: 500 gr (= 0.5 kg); 1 pack (= 4 pcs)', () => {
    const flour = item('f', 'TEST Flour', { unit: 'kg', current_stock: 1 })
    const [row] = mergeRows(flour, [flour, item('s', 'Flour 00', { unit: 'gr', current_stock: 500 })])
    expect(row).toMatchObject({ label: 'Flour 00 · 500 gr (= 0.5 kg)', blocked: '', factor: 0.001 })
    const [felix] = mergeRows(pcsTarget, [item('x', 'Felix', { unit: 'pack', current_stock: 1 })])
    expect(felix).toMatchObject({ label: 'Felix · 1 pack (= 4 pcs)', blocked: '' })
  })

  it('stock that can\'t be converted: greyed with the K110 text; at 0 it is tickable, "0 pack"', () => {
    const target = item('t', 'Meat Snacks')
    const [jerky] = mergeRows(target, [item('j', 'TEST Jerky', { unit: 'pack', current_stock: 1 })])
    expect(jerky.blocked).toBe('Counted in pack (1 pack at home); "Meat Snacks" counts in pcs — convert it first (Edit item → Unit).')
    const [empty] = mergeRows(target, [item('j', 'TEST Jerky', { unit: 'pack', current_stock: 0 })])
    expect(empty).toMatchObject({ label: 'TEST Jerky · 0 pack', blocked: '' })
  })

  it('never the target, a durable, a group row or a variant of another group; a finished 1× item and the target\'s variants are in, A–Z', () => {
    const group = item('g', 'TEST Chips', { is_group: true })
    const rows = mergeRows(group, [
      group,
      item('z', 'zucchini chips'),
      item('d', 'TEST Toaster', { category_id: 'appliances' }),
      item('o', 'Other group', { is_group: true }),
      item('ov', 'Other variant', { group_id: 'o' }),
      item('v', 'Corn Snack', { group_id: 'g', current_stock: 1 }),
      item('one', 'Party chips', { one_time: true, current_stock: 0 }),
    ])
    expect(rows.map((r) => [r.item.name, r.variant])).toEqual([['Corn Snack', true], ['Party chips', false], ['zucchini chips', false]])
  })

  it('the button: "Merge 1 item…", "Merge 3 items…"; the merge button never for a variant, a durable or a new item', () => {
    expect([mergeButtonText(1), mergeButtonText(3)]).toEqual(['Merge 1 item…', 'Merge 3 items…'])
    expect(canMergeInto(item('a', 'A'))).toBe(true)
    expect(canMergeInto(item('g', 'G', { is_group: true }))).toBe(true)
    expect(canMergeInto(item('v', 'V', { group_id: 'g' }))).toBe(false)
    expect(canMergeInto(item('d', 'D', { category_id: 'appliances' }))).toBe(false)
    expect(canMergeInto(undefined)).toBe(false)
  })
})

describe('the merge question, payload and toast (K111)', () => {
  it('test 1: T 1 pcs + A 2 pcs + B 3 pcs → "Together: 6 pcs"; the toast', () => {
    const t = item('t', 'T', { current_stock: 1, min_stock: 1, updated_at: '2026-11-08T10:00:00+00:00' })
    const a = item('a', 'A', { current_stock: 2, updated_at: '2026-11-08T10:01:00+00:00' })
    const b = item('b', 'B', { current_stock: 3 })
    expect(mergeQuestion(t, [a, b])).toEqual({
      title: 'Merge 2 items into "T"?',
      message: [
        'A · 2 pcs',
        'B · 3 pcs',
        'Together: 6 pcs in "T".',
        'Their names stay as other names of "T", and their purchases, history and orders move with them. MONEY doesn\'t change.',
        '"T" keeps its own price, pack size, payer, notes, store and minimum (1 pcs).',
        "This can't be undone. A name can be separated again later: Edit item → Other names → Separate.",
      ],
    })
    expect(mergePayload(t, [a, b])).toEqual({
      into_id: 't',
      from_ids: ['a', 'b'],
      was: { t: { current_stock: 1, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' }, a: { current_stock: 2, unit: 'pcs', updated_at: '2026-11-08T10:01:00+00:00' }, b: { current_stock: 3, unit: 'pcs' } },
    })
    expect(mergedToast(2, t, { stock: 6 })).toBe('Merged 2 items into "T" · 6 pcs')
    expect(mergedToast(1, t, { stock: 3 })).toBe('Merged 1 item into "T" · 3 pcs')
  })

  it('test 2: a group as stored (its own 0, never the total 3): "was" 0, variants marked, 11 pcs', () => {
    const group = item('g', 'Chips & Snacks', { is_group: true, current_stock: 0, min_stock: 1 })
    const variants = [0, 1, 1, 1, 0].map((s, k) => item(`v${k}`, `TEST Variant ${k}`, { group_id: 'g', current_stock: s }))
    const sources = [1, 1, 2, 3, 1].map((s, k) => item(`s${k}`, `TEST Source ${k}`, { current_stock: s }))
    const q = mergeQuestion(group, [...variants, ...sources])
    expect(q.title).toBe('Merge 10 items into "Chips & Snacks"?')
    expect(q.message.slice(0, 2)).toEqual(['TEST Variant 0 · 0 pcs (variant)', 'TEST Variant 1 · 1 pcs (variant)'])
    expect(q.message).toContain('Together: 11 pcs in "Chips & Snacks".')
    expect(q.message).toContain('"Chips & Snacks" keeps its own price, pack size, payer, notes, store and minimum (1 pcs).')
    expect(mergePayload(group, [...variants, ...sources]).was.g).toEqual({ current_stock: 0, unit: 'pcs' })
    expect(mergedToast(10, group, { stock: 11 })).toBe('Merged 10 items into "Chips & Snacks" · 11 pcs')
  })

  it('test 3 and 4: conversions in the question; a 1× source says so, "(one-time)" when the target is 1× itself', () => {
    const flour = item('t', 'TEST Flour', { unit: 'kg', current_stock: 1 })
    const q = mergeQuestion(flour, [item('s', 'Flour 00', { unit: 'gr', current_stock: 500, one_time: true })])
    expect(q.message).toEqual([
      'Flour 00 · 500 gr (= 0.5 kg)',
      'Together: 1.5 kg in "TEST Flour".',
      'Their names stay as other names of "TEST Flour", and their purchases, history and orders move with them. MONEY doesn\'t change.',
      '"TEST Flour" keeps its own price, pack size, payer, notes, store and minimum (0 kg).',
      '"Flour 00" is a one-time (1×) item — after merging it follows "TEST Flour" (not one-time).',
      "This can't be undone. A name can be separated again later: Edit item → Other names → Separate.",
    ])
    expect(q.title).toBe('Merge 1 item into "TEST Flour"?')
    const pcs = item('t', 'TEST Cat Food', { packaging_unit: 'pack', quantity_per_pack: 4, one_time: true, current_stock: 2 })
    const felix = mergeQuestion(pcs, [item('f', 'Felix', { unit: 'pack', current_stock: 1, one_time: true })])
    expect(felix.message).toContain('Felix · 1 pack (= 4 pcs)')
    expect(felix.message).toContain('Together: 6 pcs in "TEST Cat Food".')
    expect(felix.message).toContain('"Felix" is a one-time (1×) item — after merging it follows "TEST Cat Food" (one-time).')
  })
})

describe('separating a name (K115)', () => {
  const origin = { id: 'c', name: 'Corn Snack', unit: 'pcs', current_stock: 1, min_stock: 0, one_time: false, price: 0.99, category_id: 'snacks' }
  const parent = item('p', 'Chips & Snacks', {
    current_stock: 11,
    updated_at: '2026-11-08T11:00:00+00:00',
    names: [{ name: 'Corn Snack', origin, from_item_id: 'c' }, { name: 'Lime Twist' }],
  })
  const ask = (name, of = parent, listsAtZero = restockReason) => separateQuestion({ item: of, name, place: 'Snacks › Savory', listsAtZero })

  it('test 7: with origin — the texts, the hints, the field', () => {
    const q = ask('corn snack')
    expect(q.title).toBe('Separate "Corn Snack" into its own item?')
    expect(q.message).toBe('It comes back as its own item, as it was before the merge (category, unit, price, minimum). Its purchases, orders and history under "Corn Snack" go with it. MONEY doesn\'t change.')
    expect(q.field).toMatchObject({ label: 'Stock that goes with it (pcs)', value: '', required: true })
    expect(q.field.help({ stock: '1' })).toEqual(['When it was merged it brought 1 pcs.', '"Chips & Snacks" has 11 pcs now.', ''])
    expect(q.note).toBe("This can't be undone — to put it back, merge it again.")
    expect(separatePayload(parent, 'Corn Snack', 1)).toEqual({ item_id: 'p', name: 'Corn Snack', stock_moved: 1, was: { current_stock: 11, unit: 'pcs', updated_at: '2026-11-08T11:00:00+00:00' } })
    expect(separatedToast('Corn Snack', origin, 1, 'pcs')).toBe('"Corn Snack" is its own item again · 1 pcs')
  })

  it('test 8: without origin — a new item there, minimum 0; the field\'s errors; the SHOP line only at 0 and only when the real rule lists it', () => {
    const q = ask('Lime Twist')
    expect(q.message).toBe('It becomes a new item in Snacks › Savory, counted in pcs, minimum 0. Its purchases, orders and history under "Lime Twist" go with it. MONEY doesn\'t change.')
    expect(q.field.check('', NaN)).toBe('Type how much stock goes with it — 0 is fine.')
    expect(q.field.check('12', 12)).toBe("It can't be more than 11 pcs.")
    expect(q.field.check('-1', -1)).toBe('Enter a valid number.')
    expect(q.field.check('0', 0)).toBe('')
    expect(q.field.check('11', 11)).toBe('')
    expect(q.field.help({ stock: '0' })).toEqual(['', '"Chips & Snacks" has 11 pcs now.', 'With 0 pcs it goes on the SHOP list as out of stock.'])
    expect(q.field.help({ stock: '' })[2]).toBe('')
    expect(q.field.help({ stock: '2' })[2]).toBe('')
    expect(q.atZero).toBe(true)
    // A rule that wouldn't list it: no line.
    expect(ask('Lime Twist', parent, () => null).field.help({ stock: '0' })[2]).toBe('')
    // A 1× item back from its origin is never listed at 0 by the real rule.
    const oneTime = { ...parent, names: [{ name: 'Party Chips', origin: { ...origin, name: 'Party Chips', one_time: true }, from_item_id: 'x' }] }
    expect(ask('Party Chips', oneTime).atZero).toBe(false)
    expect(separatedToast('Lime Twist', null, 0, 'pcs')).toBe('"Lime Twist" is now its own item · 0 pcs')
    const noSub = separateQuestion({ item: parent, name: 'Lime Twist', place: 'Snacks', listsAtZero: restockReason })
    expect(noSub.message).toContain('a new item in Snacks, counted in pcs')
  })

  it('test 9 (K75): 1 pack merged into pcs with the usual pack × 3 → separating 3 pcs gives 1 pack; "it brought 3 pcs"', () => {
    const cat = item('p', 'TEST Cat Food', {
      current_stock: 5,
      packaging_unit: 'pack',
      quantity_per_pack: 3,
      names: [{ name: 'TEST Felix', origin: { id: 'f', unit: 'pack', current_stock: 1 }, from_item_id: 'f', packaging_unit: null, quantity_per_pack: null }],
    })
    expect(separationCheck({ item: cat, name: 'TEST Felix', stockMoved: 3, items: [cat] })).toMatchObject({ problem: null, unit: 'pack', stock: 1, stockLeft: 2 })
    expect(separationCheck({ item: cat, name: 'TEST Felix', stockMoved: 2, items: [cat] })).toMatchObject({ unit: 'pack', stock: 0.667 })
    const q = separateQuestion({ item: cat, name: 'TEST Felix', place: '', listsAtZero: restockReason })
    expect(q.field.help({ stock: '3' })[0]).toBe('When it was merged it brought 3 pcs.')
    expect(q.field.help({ stock: '0' })[2]).toBe('With 0 pack it goes on the SHOP list as out of stock.')
    expect(separatedToast('TEST Felix', {}, 1, 'pack')).toBe('"TEST Felix" is its own item again · 1 pack')
  })

  it('a name that brought nothing: "it brought 0 pcs"', () => {
    const p = item('p', 'P', { current_stock: 4, names: [{ name: 'Jerky', origin: { unit: 'pack', current_stock: 0 }, from_item_id: 'j' }] })
    expect(separateQuestion({ item: p, name: 'Jerky', place: '', listsAtZero: restockReason }).field.help({ stock: '' })[0]).toBe('When it was merged it brought 0 pcs.')
  })
})

describe('the delete question (K116)', () => {
  const names = (n) => Array.from({ length: n }, (_, k) => ({ name: ['Corn Snack', 'Tortilla Chips'][k] ?? `TEST Name ${k}`, origin: { id: `o${k}` }, from_item_id: `o${k}` }))
  it('1, 2 and 10 merged names; a plain name never counts', () => {
    expect(mergedNamesDeleteText({ names: names(1) })).toBe("It holds the name of 1 merged item (Corn Snack). Once deleted, they can't be separated again.")
    expect(mergedNamesDeleteText({ names: names(2) })).toBe("It holds the names of 2 merged items (Corn Snack, Tortilla Chips). Once deleted, they can't be separated again.")
    expect(mergedNamesDeleteText({ names: names(10) })).toBe("It holds the names of 10 merged items (Corn Snack, Tortilla Chips +8). Once deleted, they can't be separated again.")
    expect(mergedNamesDeleteText({ names: [{ name: 'Svelto', origin: null }] })).toBe('')
    expect(mergedNamesDeleteText({})).toBe('')
  })
})

describe('the restore guard (K117, K118)', () => {
  // A backup before test 1: T 1 pcs at €1.00, A, B and their history; now T 6 pcs at €1.20 with names A and B.
  const backup = {
    app: 'nutrihub-inventory',
    items: [
      item('t', 'T', { current_stock: 1, price: 1, price_qty: 1, price_unit: 'pcs', is_group: true, notes: 'old note' }),
      item('a', 'A', { current_stock: 2 }),
      item('b', 'B', { current_stock: 3 }),
      item('n', 'TEST Unrelated', { current_stock: 7 }),
    ],
    stock_logs: [
      { id: 'la', item_id: 'a', item_name: 'A', change: 2 },
      { id: 'lb', item_id: 'b', item_name: 'B', change: 3 },
      { id: 'lt', item_id: 't', item_name: 'T', change: 1 },
    ],
  }
  const now = [
    item('t', 'T', { current_stock: 6, price: 1.2, price_qty: 1, price_unit: 'pcs', is_group: false, group_id: null, names: [{ name: 'A', from_item_id: 'a', origin: { id: 'a' } }, { name: 'B', from_item_id: 'b', origin: { id: 'b' } }] }),
    item('n', 'TEST Unrelated', { current_stock: 1 }),
  ]

  it('test 12: A and B skipped, their history on T; T keeps 6 pcs, its names, no group; its price comes back; the texts with m = 2, k = 1', () => {
    const plan = restorePlan(backup, now)
    expect(plan.skipped.map((r) => r.id)).toEqual(['a', 'b'])
    expect(plan.kept.map((r) => r.name)).toEqual(['T'])
    expect(plan.backup.items.map((r) => r.id)).toEqual(['t', 'n'])
    expect(plan.backup.items[0]).toMatchObject({ current_stock: 6, unit: 'pcs', is_group: false, group_id: null, price: 1, notes: 'old note' })
    expect('names' in plan.backup.items[0]).toBe(false)
    expect(plan.backup.items[1]).toEqual(backup.items[3])
    expect(plan.backup.stock_logs.map((l) => [l.id, l.item_id])).toEqual([['la', 't'], ['lb', 't'], ['lt', 't']])
    expect(skippedQuestionLine(2)).toBe('2 of these items were merged into another item since this backup — they are skipped, and their history goes to that item.')
    expect(skippedQuestionLine(1)).toBe('1 of these items was merged into another item since this backup — it is skipped, and its history goes to that item.')
    expect(skippedQuestionLine(0)).toBe('')
    expect(restoredText(plan)).toBe('Restored 2 items. 2 skipped: merged into another item. 1 item kept its merged names and stock: T.')
  })

  it('without merges: everything as in the backup, today\'s text; two kept: plural', () => {
    const plain = restorePlan(backup, [item('t', 'T', { current_stock: 9 })])
    expect(plain.backup.items).toEqual(backup.items)
    expect(plain.backup.stock_logs).toEqual(backup.stock_logs)
    expect(restoredText(plain)).toBe('Restored 4 items.')
    const two = { backup: { items: [1, 2] }, skipped: [], kept: [{ name: 'T' }, { name: 'U' }] }
    expect(restoredText(two)).toBe('Restored 2 items. 2 items kept their merged names and stock: T, U.')
  })

  it('a backup counted in another unit: every field counted in the unit stays as it is now', () => {
    const was = { app: 'x', items: [item('t', 'T', { unit: 'pack', current_stock: 1, min_stock: 1, packaging_unit: 'box', quantity_per_pack: 2, price: 5, price_qty: 1, price_unit: 'pack', notes: 'n' })] }
    const current = [item('t', 'T', { unit: 'pcs', current_stock: 8, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 1.2, price_qty: 1, price_unit: 'pcs', names: [{ name: 'A', from_item_id: 'a' }] })]
    expect(restorePlan(was, current).backup.items[0]).toMatchObject({ unit: 'pcs', current_stock: 8, min_stock: 4, packaging_unit: 'pack', quantity_per_pack: 4, price: 1.2, price_qty: 1, price_unit: 'pcs', notes: 'n' })
  })
})

describe('Receipts and Money read the same quantity (K107)', () => {
  it('"2 pcs", "1 pcs", "1 pack · 4 pcs"; an old line without quantity: nothing', () => {
    const pcs = { unit: 'pcs' }
    expect(purchasedQuantityLabel({ quantity: 2, unit: 'pcs', stock_added: 2 }, pcs)).toBe('2 pcs')
    expect(purchasedQuantityLabel({ quantity: 1, unit: 'pcs', stock_added: 1 }, pcs)).toBe('1 pcs')
    expect(purchasedQuantityLabel({ quantity: 1, unit: 'pack', stock_added: 4, stock_unit: 'pcs' }, pcs)).toBe('1 pack · 4 pcs')
    expect(purchasedQuantityLabel({ quantity: null, unit: 'pcs' }, pcs)).toBeNull()
    expect(purchasedQuantityLabel(null, pcs)).toBeNull()
    expect(purchasedQuantityLabel({ quantity: 1.5, unit: null }, null)).toBe('1.5 pcs')
  })
})
