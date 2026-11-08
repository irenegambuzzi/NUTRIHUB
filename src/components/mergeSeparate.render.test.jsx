// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Stage 4 of round 6D (plan 9N, K108–K115) on the screen: "Merge other items
// into this one…" in "Edit item" / "Edit group", the picker, the question
// and the toast; "Separate" in "Other names"; K113; Home → History after a
// merge and a separation. The database is arrivalDb.fixture.js with the two
// 032 functions played as far as the screen needs.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }),
}))

const { arrivalDb } = await import('../hooks/arrivalDb.fixture')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { HistoryView } = await import('./inventory/HistoryView')
const { Feedback } = await import('./ui/Feedback')
const { mergeItems, separateName } = await import('../hooks/itemNameActions')
const { closeDialog, dismissToast, getToasts } = await import('../lib/feedback')
const { pantryStore, stockLogStore } = await import('../lib/stores')

const parents = [
  { id: 'snacks', name: 'Snacks', type: 'parent' },
  { id: 'baking', name: 'Baking', type: 'parent' },
]
const subsByParent = new Map(parents.map((p) => [p.id, []]))
const categoryName = (id) => parents.find((p) => p.id === id)?.name ?? ''

let db
beforeEach(() => {
  db = arrivalDb()
  client.supabase = db.supabase
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db.functions.merge_pantry_items = ({ payload }) => {
    const target = db.row('pantry_items', payload.into_id)
    const sources = payload.from_ids.map((id) => db.row('pantry_items', id))
    for (const s of sources) {
      const moved = s.unit === target.unit ? s.current_stock : s.current_stock * (s.unit === 'gr' ? 0.001 : 1)
      target.current_stock = Math.round((target.current_stock + moved) * 1000) / 1000
      if (moved > 0) db.add('stock_logs', { item_id: target.id, item_name: s.name, change: moved, new_stock: target.current_stock, unit: target.unit, reason: 'merged' })
    }
    target.is_group = false
    target.names = [...target.names, ...sources.map((s) => ({ name: s.name, origin: { ...s }, from_item_id: s.id }))]
    db.tables.pantry_items = db.tables.pantry_items.filter((r) => !payload.from_ids.includes(r.id))
    return { already_merged: false, stock: target.current_stock }
  }
  db.functions.separate_item_name = ({ payload }) => {
    const parent = db.row('pantry_items', payload.item_id)
    const element = parent.names.find((n) => n.name === payload.name)
    parent.current_stock -= payload.stock_moved
    parent.names = parent.names.filter((n) => n !== element)
    const made = db.add('pantry_items', { ...(element.origin ?? { name: element.name, unit: parent.unit, category_id: parent.category_id, min_stock: 0 }), current_stock: payload.stock_moved, names: [] })
    if (payload.stock_moved > 0) {
      db.add('stock_logs', { item_id: parent.id, item_name: element.name, change: -payload.stock_moved, new_stock: parent.current_stock, unit: parent.unit, reason: 'separated' })
      db.add('stock_logs', { item_id: made.id, item_name: element.name, change: payload.stock_moved, new_stock: payload.stock_moved, unit: made.unit, reason: 'separated' })
    }
    return { item_id: made.id, stock: made.current_stock }
  }
})
afterEach(() => {
  cleanup()
  getToasts().forEach((t) => dismissToast(t.id))
  closeDialog(null)
  vi.restoreAllMocks()
})

const add = (name, extra = {}) => db.add('pantry_items', { name, unit: 'pcs', category_id: 'snacks', min_stock: 0, names: [], ...extra })
const rowOf = (id) => pantryStore.getSnapshot().rows.find((r) => r.id === id)

// "Edit item" as HOME opens it: closed when a merge or separation is done.
function Home({ itemId, editorProps = {} }) {
  const [open, setOpen] = useState(true)
  const { rows } = pantryStore.useRows()
  const item = rows.find((r) => r.id === itemId)
  if (!open || !item) return <Feedback />
  return (
    <>
      <ItemEditor
        item={item}
        parents={parents}
        subsByParent={subsByParent}
        onSave={vi.fn(async () => ({ error: null }))}
        onClose={() => setOpen(false)}
        homeItems={rows}
        namesReady
        categoryName={categoryName}
        onMerge={async (ids) => {
          const done = await mergeItems(itemId, ids)
          if (done) setOpen(false)
          return done
        }}
        onSeparate={async (name) => {
          if (await separateName(itemId, name, { place: 'Snacks' })) setOpen(false)
        }}
        {...editorProps}
      />
      <Feedback />
    </>
  )
}
async function openHome(itemId, editorProps) {
  await pantryStore.refresh()
  const view = render(<Home itemId={itemId} editorProps={editorProps} />)
  // The list's own first read (when it starts) ends before anything else.
  await act(() => new Promise((resolve) => setTimeout(resolve)))
  return view
}
const mergeButton = () => screen.queryByRole('button', { name: 'Merge other items into this one…' })
const picker = () => screen.getByRole('dialog', { name: /^Merge into/ })

describe('the merge button (K108)', () => {
  it('in "Edit item", after "Other names" and before Notes; not for a variant, a durable, a new item or before 032', async () => {
    const t = add('TEST Target', { names: [{ name: 'TEST Alias' }] })
    const variant = add('TEST Variant', { group_id: 'g' })
    const durable = add('TEST Toaster', { category_id: 'appliances' })
    const { container, unmount } = await openHome(t.id)
    const text = container.textContent
    expect(text.indexOf('Other names')).toBeLessThan(text.indexOf('Merge other items into this one…'))
    expect(text.indexOf('Merge other items into this one…')).toBeLessThan(text.indexOf('Notes'))
    expect(mergeButton().className).toContain('min-h-9')
    unmount()
    for (const id of [variant.id, durable.id]) {
      const view = await openHome(id)
      expect(mergeButton()).toBeNull()
      view.unmount()
    }
    const before = await openHome(t.id, { namesReady: false })
    expect(mergeButton()).toBeNull()
    before.unmount()
    render(<ItemEditor parents={parents} subsByParent={subsByParent} onSave={vi.fn()} onClose={vi.fn()} namesReady onMerge={vi.fn()} />)
    expect(screen.getByText('Add an item')).toBeTruthy()
    expect(mergeButton()).toBeNull()
  })

  it('in "Edit group" too, in the same place (before Notes)', async () => {
    const group = add('TEST Crisps', { is_group: true })
    const { container } = await openHome(group.id)
    expect(screen.getByText('Edit group')).toBeTruthy()
    expect(container.textContent).not.toContain('Other names')
    expect(container.textContent.indexOf('Merge other items into this one…')).toBeLessThan(container.textContent.indexOf('Notes'))
  })

  it('K113: an unsaved change disables Merge and every Separate with "Save changes first."; nothing is thrown away', async () => {
    const t = add('TEST Target', { names: [{ name: 'TEST Alias' }, { name: 'TEST Merged', origin: { id: 'x' }, from_item_id: 'x' }] })
    await openHome(t.id)
    const separate = () => screen.getAllByRole('button', { name: /^Separate .* into its own item$/ })
    expect(mergeButton().disabled).toBe(false)
    expect(separate().map((b) => b.disabled)).toEqual([false, false])
    expect(screen.queryByText('Save changes first.')).toBeNull()
    const name = screen.getByDisplayValue('TEST Target')
    fireEvent.change(name, { target: { value: 'TEST Target 2' } })
    expect(mergeButton().disabled).toBe(true)
    expect(separate().map((b) => b.disabled)).toEqual([true, true])
    expect(screen.getAllByText('Save changes first.')).toHaveLength(2)
    fireEvent.click(mergeButton())
    expect(screen.queryByRole('dialog', { name: /^Merge into/ })).toBeNull()
    expect(screen.getByDisplayValue('TEST Target 2')).toBeTruthy()
    // Typed back as it was: nothing unsaved any more.
    fireEvent.change(name, { target: { value: 'TEST Target' } })
    expect(mergeButton().disabled).toBe(false)
  })
})

describe('the picker (K109–K112)', () => {
  it('empty search: the same main category, A–Z; typing: every item, other names too; Chosen on top; greyed rows; the button', async () => {
    const t = add('TEST Flour', { unit: 'kg', current_stock: 1, category_id: 'baking' })
    add('TEST Zest', { category_id: 'baking', current_stock: 1, unit: 'kg' })
    add('Flour 00', { unit: 'gr', current_stock: 500, category_id: 'baking' })
    add('TEST Yeast', { unit: 'pack', current_stock: 2, category_id: 'baking' })
    add('TEST Crackers', { category_id: 'snacks', names: [{ name: 'TEST Farina' }] })
    add('TEST Toaster', { category_id: 'appliances' })
    await openHome(t.id)
    fireEvent.click(mergeButton())
    const sheet = picker()
    expect(within(sheet).getByText('Merge into "TEST Flour"')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeTruthy()
    const boxes = () => within(sheet).queryAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))
    expect(boxes()).toEqual(['Merge Flour 00 into TEST Flour', 'Merge TEST Yeast into TEST Flour', 'Merge TEST Zest into TEST Flour'])
    expect(sheet.textContent).toContain('Flour 00 · 500 gr (= 0.5 kg)')
    // Greyed: stock in a unit that can't be converted.
    const yeast = within(sheet).getByRole('checkbox', { name: 'Merge TEST Yeast into TEST Flour' })
    expect(yeast.disabled).toBe(true)
    expect(sheet.textContent).toContain('Counted in pack (2 pack at home); "TEST Flour" counts in kg — convert it first (Edit item → Unit).')
    const go = within(sheet).getByRole('button', { name: 'Merge 0 items…' })
    expect(go.disabled).toBe(true)
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Merge Flour 00 into TEST Flour' }))
    expect(within(sheet).getByRole('group', { name: 'Chosen' }).textContent).toContain('Chosen (1)')
    expect(within(sheet).getByRole('button', { name: 'Merge 1 item…' }).disabled).toBe(false)
    // Typing searches every item, by its other names too; the chosen one stays on top.
    fireEvent.change(within(sheet).getByLabelText('Search your items…'), { target: { value: 'farina' } })
    expect(boxes()).toEqual(['Merge Flour 00 into TEST Flour', 'Merge TEST Crackers into TEST Flour'])
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Merge TEST Crackers into TEST Flour' }))
    expect(within(sheet).getByRole('button', { name: 'Merge 2 items…' })).toBeTruthy()
    expect(sheet.textContent).not.toContain('TEST Toaster')
    // Unticked: back in the list.
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Merge TEST Crackers into TEST Flour' }))
    expect(within(sheet).getByRole('group', { name: 'Chosen' }).textContent).toContain('Chosen (1)')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: /^Merge into/ })).toBeNull()
    expect(screen.getByText('Edit item')).toBeTruthy()
  })

  it('test 1 on the screen: T 1 pcs + A 2 + B 3 → the question, "Merge", the toast, the editor closes; T 6 pcs', async () => {
    const t = add('TEST T', { current_stock: 1, min_stock: 1 })
    const a = add('TEST A', { current_stock: 2 })
    const b = add('TEST B', { current_stock: 3 })
    await openHome(t.id)
    fireEvent.click(mergeButton())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Merge TEST A into TEST T' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Merge TEST B into TEST T' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge 2 items…' }))
    await waitFor(() => expect(screen.getByText('Merge 2 items into "TEST T"?')).toBeTruthy())
    const asked = screen.getByText('Merge 2 items into "TEST T"?').closest('form')
    expect(asked.textContent).toContain('TEST A · 2 pcs')
    expect(asked.textContent).toContain('Together: 6 pcs in "TEST T".')
    expect(within(asked).getByRole('button', { name: 'Cancel' })).toBeTruthy()
    await act(async () => fireEvent.click(within(asked).getByRole('button', { name: 'Merge' })))
    await waitFor(() => expect(screen.queryByText('Edit item')).toBeNull())
    expect(screen.getByText('Merged 2 items into "TEST T" · 6 pcs')).toBeTruthy()
    expect(rowOf(t.id).current_stock).toBe(6)
    expect([rowOf(a.id), rowOf(b.id)]).toEqual([undefined, undefined])
  })

  it('test 2 on the screen: a group target — all its variants chosen and locked, the note; others can be added', async () => {
    const group = add('Chips & Snacks', { is_group: true, current_stock: 0, min_stock: 1 })
    ;[0, 1, 1, 1, 0].forEach((s, k) => add(`TEST Variant ${k}`, { group_id: group.id, current_stock: s, one_time: k === 4 }))
    add('TEST Source', { current_stock: 1 })
    add('TEST Elsewhere', { group_id: 'other-group', current_stock: 1 })
    await openHome(group.id)
    fireEvent.click(mergeButton())
    const sheet = picker()
    expect(sheet.textContent).toContain('All 5 variants of "Chips & Snacks" are always merged together.')
    const chosen = within(sheet).getByRole('group', { name: 'Chosen' })
    expect(chosen.textContent).toContain('Chosen (5)')
    expect(chosen.textContent).toContain('TEST Variant 1 · 1 pcs (variant)')
    expect(within(chosen).getAllByRole('checkbox').every((c) => c.checked && c.disabled)).toBe(true)
    expect(sheet.textContent).not.toContain('TEST Elsewhere')
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Merge TEST Source into Chips & Snacks' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Merge 6 items…' }))
    await waitFor(() => expect(screen.getByText('Merge 6 items into "Chips & Snacks"?')).toBeTruthy())
    expect(screen.getByText('Together: 4 pcs in "Chips & Snacks".')).toBeTruthy()
    expect(screen.getByText('"TEST Variant 4" is a one-time (1×) item — after merging it follows "Chips & Snacks" (not one-time).')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Merge' })))
    await waitFor(() => expect(screen.getByText('Merged 6 items into "Chips & Snacks" · 4 pcs')).toBeTruthy())
    expect(rowOf(group.id).is_group).toBe(false)
  })
})

describe('Separate (K114, K115)', () => {
  it('every saved name has "Separate"; a merged name has no ×', async () => {
    const t = add('TEST Target', { names: [{ name: 'TEST Alias' }, { name: 'TEST Merged', origin: { id: 'x' }, from_item_id: 'x' }] })
    await openHome(t.id)
    expect(screen.getByRole('button', { name: 'Separate TEST Alias into its own item' }).className).toContain('min-h-9')
    expect(screen.getByRole('button', { name: 'Remove TEST Alias' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Separate TEST Merged into its own item' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove TEST Merged' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add a name' }))
    expect(screen.queryByRole('button', { name: 'Separate the new name into its own item' })).toBeNull()
  })

  it('test 8 on the screen: the errors, the 0 line, "Separate", the toast; the new item', async () => {
    const t = add('TEST Crisps', { current_stock: 4, names: [{ name: 'TEST Lime Twist' }] })
    await openHome(t.id)
    fireEvent.click(screen.getByRole('button', { name: 'Separate TEST Lime Twist into its own item' }))
    await waitFor(() => expect(screen.getByText('Separate "TEST Lime Twist" into its own item?')).toBeTruthy())
    const field = screen.getByLabelText('Stock that goes with it (pcs)')
    expect(field.value).toBe('')
    expect(screen.getByText('"TEST Crisps" has 4 pcs now.')).toBeTruthy()
    expect(screen.queryByText(/When it was merged/)).toBeNull()
    expect(screen.getByText("This can't be undone — to put it back, merge it again.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Separate' }))
    expect(screen.getByText('Type how much stock goes with it — 0 is fine.')).toBeTruthy()
    fireEvent.change(field, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Separate' }))
    expect(screen.getByText("It can't be more than 4 pcs.")).toBeTruthy()
    expect(screen.queryByText('With 0 pcs it goes on the SHOP list as out of stock.')).toBeNull()
    fireEvent.change(field, { target: { value: '0' } })
    expect(screen.getByText('With 0 pcs it goes on the SHOP list as out of stock.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Separate' })))
    await waitFor(() => expect(screen.getByText('"TEST Lime Twist" is now its own item · 0 pcs')).toBeTruthy())
    expect(screen.queryByText('Edit item')).toBeNull()
    const made = pantryStore.getSnapshot().rows.find((r) => r.name === 'TEST Lime Twist')
    expect(made).toMatchObject({ current_stock: 0, min_stock: 0 })
    expect(db.tables.grocery_items.filter((g) => g.pantry_item_id === made.id)).toHaveLength(1)
  })

  it('test 7 on the screen: with origin, "When it was merged it brought 1 pcs.", typed 1 → its own item again', async () => {
    const origin = { id: 'corn-old', name: 'Corn Snack', unit: 'pcs', category_id: 'snacks', min_stock: 0, price: 0.99, current_stock: 1 }
    const t = add('Chips & Snacks', { current_stock: 11, names: [{ name: 'Corn Snack', origin, from_item_id: 'corn-old' }] })
    await openHome(t.id)
    fireEvent.click(screen.getByRole('button', { name: 'Separate Corn Snack into its own item' }))
    await waitFor(() => expect(screen.getByText('When it was merged it brought 1 pcs.')).toBeTruthy())
    expect(screen.getByText(/^It comes back as its own item, as it was before the merge/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Stock that goes with it (pcs)'), { target: { value: '1' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Separate' })))
    await waitFor(() => expect(screen.getByText('"Corn Snack" is its own item again · 1 pcs')).toBeTruthy())
    expect(rowOf(t.id).current_stock).toBe(10)
    expect(rowOf('corn-old')).toMatchObject({ current_stock: 1, price: 0.99 })
  })
})

describe('Home → History after a merge and a separation (stage 2 reasons)', () => {
  it('"Merged" and "Separated" with the line\'s name under the item\'s name', async () => {
    const t = add('TEST T', { current_stock: 1 })
    const corn = add('Corn Snack', { current_stock: 2 })
    await pantryStore.refresh()
    const merging = mergeItems(t.id, [corn.id])
    await new Promise((resolve) => setTimeout(resolve))
    closeDialog({})
    await merging
    const separating = separateName(t.id, 'Corn Snack', { place: 'Snacks' })
    await new Promise((resolve) => setTimeout(resolve))
    closeDialog({ stock: 1 })
    await separating
    await stockLogStore.refresh()
    const { container } = render(<HistoryView items={pantryStore.getSnapshot().rows} namesReady />)
    const rows = [...container.querySelectorAll('div.flex.items-center')].map((r) => r.textContent)
    expect(rows.some((r) => r.startsWith('TEST TCorn Snack · Merged ·') && r.endsWith('+2 pcs→ 3 pcs'))).toBe(true)
    expect(rows.some((r) => r.startsWith('TEST TCorn Snack · Separated ·') && r.endsWith('-1 pcs→ 2 pcs'))).toBe(true)
    // The separated item's own row: its own name, so no line under it.
    expect(rows.some((r) => r.startsWith('Corn SnackSeparated ·') && r.endsWith('+1 pcs→ 1 pcs'))).toBe(true)
  })
})
