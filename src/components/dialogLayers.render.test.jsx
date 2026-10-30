// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'

// A question (confirmDialog / askDialog) asked from inside a sheet comes
// to the front: drawn above the sheet, with the focus, and a tap on it
// never reaches the sheet. Found on the iPhone (30/10): in "Order group",
// "Take out of the group" and "Ungroup" asked behind the sheet, which is
// put on document.body on the same layer. Also the HOME item editor.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
// Orders and groups the screen follows live, so a change shows at once.
const data = vi.hoisted(() => ({ orders: [], groups: [], listeners: new Set() }))
vi.mock('../lib/stores', async (original) => {
  const { useSyncExternalStore } = await import('react')
  const emit = () => data.listeners.forEach((l) => l())
  const subscribe = (l) => (data.listeners.add(l), () => data.listeners.delete(l))
  const live = (key) => ({
    useRows: () => ({ rows: useSyncExternalStore(subscribe, () => data[key]), loaded: true }),
    getSnapshot: () => ({ rows: data[key], loaded: true }),
    upsertLocal: (rows) => {
      const byId = new Map(rows.map((r) => [r.id, r]))
      data[key] = [...data[key].filter((r) => !byId.has(r.id)), ...data[key].filter((r) => byId.has(r.id)).map((r) => ({ ...r, ...byId.get(r.id) })), ...rows.filter((r) => !data[key].some((o) => o.id === r.id))]
      emit()
    },
    removeLocal: (ids) => {
      data[key] = data[key].filter((r) => !ids.includes(r.id))
      emit()
    },
  })
  const none = { useRows: () => ({ rows: [], loaded: true }), getSnapshot: () => ({ rows: [], loaded: true }) }
  return {
    ...(await original()),
    orderStore: live('orders'),
    orderGroupStore: live('groups'),
    allExpenseStores: () => [],
    shopUsageStore: none,
    pantryStore: none,
    groceryStore: none,
    budgetMapStore: none,
    inventoryCategoryStore: none,
  }
})
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: () => {}, rememberBudget: () => {} }),
}))
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useCategoryCreation', () => ({
  useCategoryCreation: () => ({ homeCategories: [], homeMains: [], expenseCategories: [], moneyMains: [], ctx: { expenseCategories: [], inventoryCategories: [], mapRows: [] }, createHome: () => {}, createMoney: () => {} }),
}))

const { Feedback } = await import('./ui/Feedback')
const { OrderGroupSheet } = await import('./expenses/OrderGroupSheet')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { closeDialog, getToasts, dismissToast } = await import('../lib/feedback')

// The full-screen layer (`fixed inset-0`) an element is drawn on.
const layerOf = (el) => el.closest('.fixed.inset-0')
const zOf = (layer) => Number(layer.className.match(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/)[1])
// `a` is drawn in front of `b`: a higher z-index, or the same one and later
// on the page (no layer here makes a stacking of its own around them).
function inFront(a, b) {
  const [la, lb] = [layerOf(a), layerOf(b)]
  if (zOf(la) !== zOf(lb)) return zOf(la) > zOf(lb)
  return Boolean(lb.compareDocumentPosition(la) & Node.DOCUMENT_POSITION_FOLLOWING)
}
// The question, the sheet or editor it was asked from, and what was sent.
const question = () => screen.getByRole('dialog', { name: (name) => name !== 'Order group' })
const sheet = () => screen.getByRole('dialog', { name: 'Order group' })

// A database that does what save_order_group does with the request: the
// orders it lists are in the group with their share, the leaving ones on
// their own again; the group is removed when no order is left in it.
let sent
function fakeDb() {
  sent = []
  client.supabase = {
    rpc: async (name, { payload }) => {
      sent.push({ name, payload })
      const orders = [
        ...payload.orders.map((o) => ({ id: o.id, group_id: payload.id, group_share: o.share, price: Math.round((o.base - o.share) * 100) / 100 })),
        ...payload.leaving.map((o) => ({ id: o.id, group_id: null, group_share: 0, price: o.base })),
      ]
      const group = payload.orders.length
        ? { id: payload.id, shop_id: payload.shop_id, order_date: payload.order_date, paid_by: payload.paid_by, discount_kind: payload.discount_kind, discount_value: payload.discount_value, discount_total: payload.discount_total }
        : null
      return { data: { orders, group, expenses: [], kept: [] }, error: null }
    },
  }
}

// Three orders at one store on 17/10, grouped with −€3.00.
const shops = new Map([['shop', { id: 'shop', name: 'Pet Shop', is_online: true }]])
const order = (i, name, base, share) => ({
  id: `o${i}`,
  item_name: name,
  price: Math.round((base - share) * 100) / 100,
  group_share: share,
  group_id: 'g1',
  shop_id: 'shop',
  order_date: '2026-10-17',
  paid_by: 'shared',
  status: 'on_the_way',
  expense_id: `x${i}`,
  created_at: `2026-10-17T10:00:0${i}Z`,
})
const GROUP = { id: 'g1', shop_id: 'shop', order_date: '2026-10-17', paid_by: 'shared', discount_kind: 'amount', discount_value: 3, discount_total: 3, created_at: '2026-10-17T11:00:00Z' }

beforeEach(() => {
  data.orders = [order(1, 'Dry Food', 30, 1.5), order(2, 'Litter', 20, 1), order(3, 'Toy', 10, 0.5)]
  data.groups = [GROUP]
  fakeDb()
})
afterEach(() => {
  act(() => closeDialog(null))
  getToasts().forEach((t) => dismissToast(t.id))
  cleanup()
})

// The app as it is: <Feedback /> in the layout, the sheet opened from an
// order card's tag and closed by onClose.
function Orders({ onClose }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      {open && (
        <OrderGroupSheet
          groupId="g1"
          shopById={shops}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )}
      <Feedback />
    </>
  )
}
const rows = () => within(screen.getByRole('list', { name: 'Orders of the group' })).getAllByRole('listitem')
const paidLine = () => screen.getByText((_, el) => el.tagName === 'P' && el.textContent.startsWith('Paid €')).textContent
const takeOutOf = (name) => fireEvent.click(within(rows().find((r) => r.textContent.includes(name))).getByText('Take out of the group'))

describe('"Order group": the question comes to the front', () => {
  it('"Take out of the group": in front of the sheet, with the focus; Cancel goes back to the sheet, nothing changed', async () => {
    const onClose = vi.fn()
    render(<Orders onClose={onClose} />)
    const paidBefore = paidLine()
    takeOutOf('Toy')
    const ask = await screen.findByText('Take "Toy" out of the group?')
    expect(inFront(ask, sheet())).toBe(true)
    // On document.body itself, so nothing around it can keep it behind.
    expect(layerOf(ask).parentElement).toBe(document.body)
    expect(question().contains(document.activeElement)).toBe(true)
    expect(document.activeElement.textContent).toBe('Take out')
    fireEvent.click(within(question()).getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Take "Toy" out of the group?')).toBeNull())
    expect(sheet()).toBeTruthy()
    expect(rows()).toHaveLength(3)
    expect(paidLine()).toBe(paidBefore)
    expect(sent).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a tap beside the question (on its dimmed background) only cancels it: it never reaches the sheet behind', async () => {
    const onClose = vi.fn()
    render(<Orders onClose={onClose} />)
    takeOutOf('Toy')
    const ask = await screen.findByText('Take "Toy" out of the group?')
    fireEvent.click(layerOf(ask))
    await waitFor(() => expect(screen.queryByText('Take "Toy" out of the group?')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(sheet()).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it('"Take out": the question closes, the sheet stays with the new numbers, and the toast has Undo', async () => {
    const onClose = vi.fn()
    render(<Orders onClose={onClose} />)
    expect(paidLine()).toBe('Paid €57.00 (order discount −€3.00)')
    takeOutOf('Toy')
    fireEvent.click(within(question()).getByText('Take out'))
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.queryByText('Take "Toy" out of the group?')).toBeNull()
    expect(rows().map((r) => r.textContent.includes('Toy'))).toEqual([false, false])
    // The −€3.00 spread again over the two orders left (€30 + €20).
    expect(paidLine()).toBe('Paid €47.00 (order discount −€3.00)')
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.leaving.map((o) => o.id)).toEqual(['o3'])
    expect(onClose).not.toHaveBeenCalled()
    expect(sheet()).toBeTruthy()
    const toast = screen.getByText('"Toy" taken out of the order group').closest('[role="status"]')
    expect(within(toast).getByText('Undo')).toBeTruthy()
  })

  it('"Ungroup": in front of the sheet; Cancel changes nothing; "Ungroup" closes the question and the sheet, with Undo', async () => {
    const onClose = vi.fn()
    render(<Orders onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Ungroup/ }))
    const ask = await screen.findByText('Ungroup this order?')
    expect(inFront(ask, sheet())).toBe(true)
    expect(document.activeElement.textContent).toBe('Ungroup')
    fireEvent.click(within(question()).getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Ungroup this order?')).toBeNull())
    expect(rows()).toHaveLength(3)
    expect(sent).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Ungroup/ }))
    fireEvent.click(within(question()).getByRole('button', { name: 'Ungroup' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Ungroup this order?')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent).toHaveLength(1)
    expect(data.groups).toHaveLength(0)
    const toast = screen.getByText('Ungrouped — the 3 orders are on their own again').closest('[role="status"]')
    expect(within(toast).getByText('Undo')).toBeTruthy()
  })
})

describe('HOME item editor: the question comes to the front', () => {
  const rice = { id: 'p1', name: 'Rice', category_id: 'pantry-staples', unit: 'gr', current_stock: 500, min_stock: 100, created_at: '2026-10-15T08:00:00Z' }
  const unitSelect = () => [...document.querySelectorAll('select')].find((s) => s.value === 'gr' || s.value === 'kg')

  it('changing the unit asks in front of the editor; Cancel keeps it as it was; "Change unit" converts', async () => {
    const onClose = vi.fn()
    render(
      <>
        <ItemEditor item={rice} parents={[]} subsByParent={new Map()} onSave={() => {}} onClose={onClose} />
        <Feedback />
      </>
    )
    const editor = screen.getByText('Edit item')
    fireEvent.change(unitSelect(), { target: { value: 'kg' } })
    const ask = await screen.findByText('Count "Rice" in kg instead of gr?')
    expect(inFront(ask, editor)).toBe(true)
    expect(layerOf(ask).parentElement).toBe(document.body)
    fireEvent.click(within(question()).getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Count "Rice" in kg instead of gr?')).toBeNull())
    expect(unitSelect().value).toBe('gr')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(unitSelect(), { target: { value: 'kg' } })
    fireEvent.click(within(question()).getByText('Change unit'))
    await waitFor(() => expect(unitSelect().value).toBe('kg'))
    expect(screen.getByText('Converted from gr: stock 0.5 kg, minimum 0.1 kg.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
