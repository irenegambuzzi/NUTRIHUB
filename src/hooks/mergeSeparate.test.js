// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Stage 4 of round 6D (plan 9N, K111, K115, K116): the merge and separate
// actions and the delete question, against the small database of
// arrivalDb.fixture.js. merge_pantry_items and separate_item_name are played
// here only as far as the screen needs (stock, rows gone or made); what 032
// really writes with these payloads is proven in supabase/migrations.test.js.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { arrivalDb } = await import('./arrivalDb.fixture')
const { mergeItems, separateName } = await import('./itemNameActions')
const { usePantryItems } = await import('./usePantryItems')
const { closeDialog, dismissToast, getDialog, getToasts, runToastAction } = await import('../lib/feedback')
const { pantryStore } = await import('../lib/stores')
const { setOnlineForTest } = await import('../lib/connection')
const { reopenNotes } = await import('../lib/reopenUnits')

let db
let sent
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
  sent = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.functions.merge_pantry_items = ({ payload }) => {
    sent.push(['merge', payload])
    const target = db.row('pantry_items', payload.into_id)
    const sources = payload.from_ids.map((id) => db.row('pantry_items', id))
    if (sources.some((s) => !s)) return { already_merged: true, stock: target.current_stock }
    for (const [id, was] of Object.entries(payload.was)) {
      const row = db.row('pantry_items', id)
      if (Number(row.current_stock) !== was.current_stock) throw Object.assign(new Error(`"${row.name}" changed meanwhile (on the other phone?) — open it again. Nothing was changed.`), { code: 'P0001' })
    }
    target.current_stock += sources.reduce((sum, s) => sum + s.current_stock, 0)
    target.is_group = false
    target.names = [...(target.names ?? []), ...sources.map((s) => ({ name: s.name, origin: { ...s }, from_item_id: s.id }))]
    db.tables.pantry_items = db.tables.pantry_items.filter((r) => !payload.from_ids.includes(r.id))
    return { already_merged: false, stock: target.current_stock }
  }
  db.functions.separate_item_name = ({ payload }) => {
    sent.push(['separate', payload])
    const parent = db.row('pantry_items', payload.item_id)
    const element = parent.names.find((n) => n.name === payload.name)
    parent.current_stock -= payload.stock_moved
    parent.names = parent.names.filter((n) => n !== element)
    const made = element.origin
      ? db.add('pantry_items', { ...element.origin, current_stock: payload.stock_moved, names: [] })
      : db.add('pantry_items', { name: element.name, unit: parent.unit, category_id: parent.category_id, current_stock: payload.stock_moved, min_stock: 0, names: [] })
    return { item_id: made.id, stock: made.current_stock }
  }
})
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
  setOnlineForTest(true)
  vi.restoreAllMocks()
})

const add = (name, extra = {}) => db.add('pantry_items', { name, unit: 'pcs', category_id: 'snacks', names: [], updated_at: '2026-11-08T10:00:00+00:00', ...extra })
const tick = () => new Promise((resolve) => setTimeout(resolve))
const messages = () => getToasts().map((t) => t.message)
// Starts `action`, answers its question with `answer` (null = Cancel).
async function answering(action, answer) {
  await pantryStore.refresh()
  const running = action()
  await tick()
  const asked = getDialog()
  closeDialog(answer)
  return { asked, done: await running }
}

describe('merge (K111)', () => {
  it('test 1: T 1 pcs, A 2 pcs + B 3 pcs → 6 pcs; the question; the toast; A and B gone', async () => {
    const t = add('TEST T', { current_stock: 1, min_stock: 1 })
    const a = add('TEST A', { current_stock: 2 })
    const b = add('TEST B', { current_stock: 3 })
    const { asked, done } = await answering(() => mergeItems(t.id, [a.id, b.id]), {})
    expect(asked.title).toBe('Merge 2 items into "TEST T"?')
    expect(asked.confirmLabel).toBe('Merge')
    expect(asked.message[0]).toBe('TEST A · 2 pcs')
    expect(done).toBe(true)
    expect(sent).toEqual([['merge', { into_id: t.id, from_ids: [a.id, b.id], was: { [t.id]: { current_stock: 1, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' }, [a.id]: { current_stock: 2, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' }, [b.id]: { current_stock: 3, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' } } }]])
    expect(db.row('pantry_items', t.id).current_stock).toBe(6)
    expect([db.row('pantry_items', a.id), db.row('pantry_items', b.id)]).toEqual([null, null])
    expect(pantryStore.getSnapshot().rows.map((r) => r.name)).toEqual(['TEST T'])
    expect(messages()).toEqual(['Merged 2 items into "TEST T" · 6 pcs'])
    expect(getToasts()[0].action).toBeNull()
  })

  it('test 2: a group sends its STORED 0 (HOME shows the total 3); 10 items → 11 pcs; a normal item afterwards', async () => {
    const group = add('Chips & Snacks', { is_group: true, current_stock: 0, min_stock: 1 })
    const variants = [0, 1, 1, 1, 0].map((s, k) => add(`TEST Variant ${k}`, { group_id: group.id, current_stock: s }))
    const sources = [1, 1, 2, 3, 1].map((s, k) => add(`TEST Source ${k}`, { current_stock: s }))
    const ids = [...variants, ...sources].map((r) => r.id)
    const { asked } = await answering(() => mergeItems(group.id, ids), {})
    expect(asked.title).toBe('Merge 10 items into "Chips & Snacks"?')
    expect(asked.message).toContain('Together: 11 pcs in "Chips & Snacks".')
    expect(sent[0][1].was[group.id]).toEqual({ current_stock: 0, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' })
    expect(db.row('pantry_items', group.id)).toMatchObject({ current_stock: 11, is_group: false })
    expect(messages()).toEqual(['Merged 10 items into "Chips & Snacks" · 11 pcs'])
  })

  it('Cancel: nothing sent', async () => {
    const t = add('TEST T')
    const a = add('TEST A', { current_stock: 2 })
    const { done } = await answering(() => mergeItems(t.id, [a.id]), null)
    expect(done).toBe(false)
    expect(sent).toEqual([])
    expect(messages()).toEqual([])
  })

  it('test 5: changed meanwhile on the other phone → the database\'s message, nothing changed, no "Merged"', async () => {
    const t = add('TEST T', { current_stock: 1 })
    const a = add('TEST A', { current_stock: 2 })
    await pantryStore.refresh()
    const running = mergeItems(t.id, [a.id])
    await tick()
    db.row('pantry_items', a.id).current_stock = 5
    closeDialog({})
    expect(await running).toBe(false)
    expect(db.row('pantry_items', t.id).current_stock).toBe(1)
    expect(getToasts()).toMatchObject([{ message: '"TEST A" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', tone: 'error', action: null }])
  })

  it('test 5: offline → refused before anything is asked or sent', async () => {
    const t = add('TEST T')
    const a = add('TEST A', { current_stock: 2 })
    await pantryStore.refresh()
    setOnlineForTest(false)
    expect(await mergeItems(t.id, [a.id])).toBe(false)
    expect(getDialog()).toBeNull()
    expect(sent).toEqual([])
    expect(messages()).toEqual(["You're offline — this needs a connection."])
  })

  it('"already merged" (the other phone was first): nothing extra is said, the lists are read again', async () => {
    const t = add('TEST T', { current_stock: 4 })
    const a = add('TEST A', { current_stock: 2 })
    await pantryStore.refresh()
    const running = mergeItems(t.id, [a.id])
    await tick()
    db.tables.pantry_items = db.tables.pantry_items.filter((r) => r.id !== a.id)
    closeDialog({})
    expect(await running).toBe(true)
    expect(messages()).toEqual([])
    expect(pantryStore.getSnapshot().rows.map((r) => r.name)).toEqual(['TEST T'])
  })

  it('a stock that can\'t be converted is never asked: the same refusal as 032, nothing sent', async () => {
    const t = add('TEST Meat Snacks')
    const j = add('TEST Jerky', { unit: 'pack', current_stock: 1 })
    await pantryStore.refresh()
    expect(await mergeItems(t.id, [j.id])).toBe(false)
    expect(getDialog()).toBeNull()
    expect(sent).toEqual([])
    expect(messages()).toEqual(['"TEST Jerky" is counted in pack, "TEST Meat Snacks" in pcs, and they can\'t be converted — change the unit first. Nothing was changed.'])
  })

  it('the SHOP list is judged again for the target: low after the merge → an automatic entry', async () => {
    const t = add('TEST Low', { current_stock: 0, min_stock: 5 })
    const a = add('TEST Bit', { current_stock: 1 })
    await answering(() => mergeItems(t.id, [a.id]), {})
    expect(db.tables.grocery_items.filter((g) => g.pantry_item_id === t.id)).toHaveLength(1)
  })
})

describe('separate (K115)', () => {
  it('test 7: with origin, 1 of 11 pcs → "Corn Snack" is its own item again · 1 pcs; the payload', async () => {
    const origin = { id: 'corn-old', name: 'Corn Snack', unit: 'pcs', category_id: 'snacks', min_stock: 0, price: 0.99, current_stock: 1 }
    const parent = add('Chips & Snacks', { current_stock: 11, names: [{ name: 'Corn Snack', origin, from_item_id: 'corn-old' }] })
    const { asked, done } = await answering(() => separateName(parent.id, 'Corn Snack', { place: 'Snacks' }), { stock: 1 })
    expect(asked.title).toBe('Separate "Corn Snack" into its own item?')
    expect(asked.fields[0].label).toBe('Stock that goes with it (pcs)')
    expect(asked.fields[0].help({ stock: '' })).toEqual(['When it was merged it brought 1 pcs.', '"Chips & Snacks" has 11 pcs now.', ''])
    expect(asked.note).toBe("This can't be undone — to put it back, merge it again.")
    expect(asked.confirmLabel).toBe('Separate')
    expect(done).toBe(true)
    expect(sent).toEqual([['separate', { item_id: parent.id, name: 'Corn Snack', stock_moved: 1, was: { current_stock: 11, unit: 'pcs', updated_at: '2026-11-08T10:00:00+00:00' } }]])
    expect(db.row('pantry_items', parent.id).current_stock).toBe(10)
    expect(db.row('pantry_items', 'corn-old')).toMatchObject({ current_stock: 1, price: 0.99 })
    expect(messages()).toEqual(['"Corn Snack" is its own item again · 1 pcs'])
  })

  it('test 8: without origin, 0 → a new item at 0 pcs, on the SHOP list as the real rule says; Cancel sends nothing', async () => {
    const parent = add('TEST Crisps', { current_stock: 4, names: [{ name: 'TEST Lime Twist', origin: null }] })
    const cancelled = await answering(() => separateName(parent.id, 'TEST Lime Twist', { place: 'Snacks' }), null)
    expect(cancelled.done).toBe(false)
    expect(sent).toEqual([])
    const { asked } = await answering(() => separateName(parent.id, 'TEST Lime Twist', { place: 'Snacks' }), { stock: 0 })
    expect(asked.message).toBe('It becomes a new item in Snacks, counted in pcs, minimum 0. Its purchases, orders and history under "TEST Lime Twist" go with it. MONEY doesn\'t change.')
    expect(asked.fields[0].help({ stock: '0' })[2]).toBe('With 0 pcs it goes on the SHOP list as out of stock.')
    const made = db.tables.pantry_items.find((r) => r.name === 'TEST Lime Twist')
    expect(made).toMatchObject({ current_stock: 0, min_stock: 0, unit: 'pcs', category_id: 'snacks' })
    expect(db.tables.grocery_items.filter((g) => g.pantry_item_id === made.id)).toMatchObject([{ name: 'TEST Lime Twist', auto_generated: true }])
    expect(messages()).toEqual(['"TEST Lime Twist" is now its own item · 0 pcs'])
  })

  it('offline: refused, nothing asked or sent', async () => {
    const parent = add('TEST Crisps', { current_stock: 4, names: [{ name: 'TEST Lime', origin: null }] })
    await pantryStore.refresh()
    setOnlineForTest(false)
    expect(await separateName(parent.id, 'TEST Lime')).toBe(false)
    expect(getDialog()).toBeNull()
    expect(sent).toEqual([])
  })
})

describe('the delete question (K116)', () => {
  const merged = (n) => Array.from({ length: n }, (_, k) => ({ name: ['Corn Snack', 'Tortilla Chips'][k] ?? `TEST Name ${k}`, origin: { id: `o${k}` }, from_item_id: `o${k}` }))
  const hook = async () => {
    await pantryStore.refresh()
    return renderHook(() => usePantryItems()).result
  }

  it('test 11: 10 merged names; Cancel changes nothing; Delete + Undo as today', async () => {
    const target = add('Chips & Snacks', { current_stock: 11, names: merged(10) })
    const result = await hook()
    let running = result.current.deleteItem(pantryStore.getSnapshot().rows.find((r) => r.id === target.id))
    await tick()
    expect(getDialog()).toMatchObject({
      title: 'Delete "Chips & Snacks"?',
      message: "It holds the names of 10 merged items (Corn Snack, Tortilla Chips +8). Once deleted, they can't be separated again.",
      confirmLabel: 'Delete',
    })
    closeDialog(null)
    await running
    expect(db.row('pantry_items', target.id)).not.toBeNull()
    expect(messages()).toEqual([])
    running = result.current.deleteItem(pantryStore.getSnapshot().rows.find((r) => r.id === target.id))
    await tick()
    closeDialog({})
    await running
    expect(db.row('pantry_items', target.id)).toBeNull()
    expect(messages()).toEqual(['Deleted "Chips & Snacks"'])
    await runToastAction(getToasts()[0].id)
    expect(db.row('pantry_items', target.id).names).toHaveLength(10)
  })

  it('1 merged name: its own sentence; no merged name: no question, as today', async () => {
    const one = add('TEST One', { names: merged(1) })
    const plain = add('TEST Plain', { names: [{ name: 'Svelto', origin: null }] })
    const result = await hook()
    const running = result.current.deleteItem(pantryStore.getSnapshot().rows.find((r) => r.id === one.id))
    await tick()
    expect(getDialog().message).toBe("It holds the name of 1 merged item (Corn Snack). Once deleted, it can't be separated again.")
    closeDialog(null)
    await running
    await result.current.deleteItem(pantryStore.getSnapshot().rows.find((r) => r.id === plain.id))
    expect(getDialog()).toBeNull()
    expect(db.row('pantry_items', plain.id)).toBeNull()
  })
})

describe('Reopen after a merge (K96, test 10)', () => {
  it('an old purchase of B that created B, now on T: stock only, no "stays in HOME" note', () => {
    const line = { id: 'l1', pantry_item_id: 't', pantry_created: true, merged_from: 'b', stock_added: 3, stock_unit: 'pcs', unit: 'pcs', position: 1 }
    const before = [{ id: 't', name: 'TEST T', unit: 'pcs', current_stock: 6 }]
    const after = [{ id: 't', name: 'TEST T', unit: 'pcs', current_stock: 3 }]
    expect(reopenNotes({ lines: [line], before, after })).toEqual([])
    // The same line without merged_from would say it.
    expect(reopenNotes({ lines: [{ ...line, merged_from: null }], before, after })).toEqual(['"TEST T" stays in HOME — it also got stock or an order from elsewhere; this purchase\'s 3 pcs were taken out.'])
  })
})
