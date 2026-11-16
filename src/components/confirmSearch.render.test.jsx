// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PAID_BY_OPTIONS } from '../data/constants'

// Plan 9P, update round prompt 1, on the "Confirm purchase" screen:
// - the search (NOTE 1, K201–K203, report B.6): "Search this purchase…"
//   only hides cards; every count, total and what is sent stays the same;
// - the database cart checked when Confirm is pressed (K214, report A2.9
//   part 3), with the real confirmCart against a small fake database.
// The payers come from PAID_BY_OPTIONS (never written out here).
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))

// This device's SHOP list: live, so rows put on it (upsertLocal) reach the
// open screen like they do in the app.
const list = vi.hoisted(() => ({ state: { rows: [], loaded: true }, listeners: new Set() }))
const data = vi.hoisted(() => ({ pantry: [] }))
vi.mock('../lib/stores', async (original) => {
  const { useSyncExternalStore } = await import('react')
  const set = (rows) => {
    list.state = { rows, loaded: true }
    list.listeners.forEach((l) => l())
  }
  const subscribe = (l) => {
    list.listeners.add(l)
    return () => list.listeners.delete(l)
  }
  const snap = () => list.state
  const fake = (get) => ({ useRows: () => ({ rows: get(), loaded: true }), getSnapshot: () => ({ rows: get(), loaded: true }), isStarted: () => false, refresh: async () => {} })
  return {
    ...(await original()),
    groceryStore: {
      useRows: () => useSyncExternalStore(subscribe, snap, snap),
      getSnapshot: snap,
      isStarted: () => false,
      refresh: async () => {},
      upsertLocal: (rows) => set([...list.state.rows.filter((r) => !rows.some((n) => n.id === r.id)), ...rows]),
      patchLocal: (ids, fields) => set(list.state.rows.map((r) => (ids.includes(r.id) ? { ...r, ...fields } : r))),
      removeLocal: (ids) => set(list.state.rows.filter((r) => !ids.includes(r.id))),
      set,
    },
    pantryStore: fake(() => data.pantry),
    orderStore: fake(() => []),
    budgetMapStore: fake(() => []),
    tripStore: fake(() => []),
    tripItemStore: fake(() => []),
    shopStore: fake(() => []),
    inventoryCategoryStore: fake(() => []),
  }
})
vi.mock('../hooks/useLastPrice', () => ({ useLastPrice: () => null }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
// The search tests send through a stand-in; the K214 tests through the
// real confirmCart (`mode.real`).
const mode = vi.hoisted(() => ({ real: false }))
const confirmPurchase = vi.fn(async () => ({ error: null }))
vi.mock('../hooks/usePurchase', async (original) => {
  const real = await original()
  return { ...real, usePurchase: () => ({ confirmPurchase: (args) => (mode.real ? real.confirmCart(args) : confirmPurchase(args)) }) }
})

const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { SearchBox } = await import('./ui/SearchBox')
const { groceryStore } = await import('../lib/stores')
const { inCartOrder } = await import('../lib/grocery')
const { confirmationPayload } = await import('../lib/purchase')
const { lineTotal } = await import('../lib/pricing')
const { dismissToast, getToasts } = await import('../lib/feedback')
const { setOnlineForTest } = await import('../lib/connection')

const [P1, P2] = PAID_BY_OPTIONS.map((o) => o.value).filter((v) => v !== 'shared')
const label = (code) => PAID_BY_OPTIONS.find((o) => o.value === code).label

const element = (name) => ({ name, packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null, from_item_id: null, origin: null, added_at: '2026-11-01T10:00:00Z', added_by_trip: null, pack_by_trip: null })
const item = (id, name, names = [], extra = {}) => ({ id, name, unit: 'pcs', current_stock: 1, min_stock: 0, category_id: 'snacks', names: names.map(element), ...extra })
let cartTime = 0
const card = (id, name, price, extra = {}) => ({
  id,
  name,
  pantry_item_id: null,
  quantity: 1,
  unit: 'pcs',
  price,
  price_qty: 1,
  price_unit: 'pcs',
  payer: P1,
  category_id: 'herbs',
  in_cart: true,
  completed: false,
  cart_added_at: `2026-11-07T10:00:${String(++cartTime).padStart(2, '0')}Z`,
  created_at: '2026-11-07T09:00:00Z',
  ...extra,
})

// Report A.2: 10 single-line cards, €3.39, 5 of them without a price.
const RECEIPT = () => [
  card('c1', 'Latte', 1, { category_id: 'basics' }),
  card('c2', 'Pane', 0.89),
  card('c3', 'Sale', 0, { category_id: 'basics' }),
  card('c4', 'Uova', 0),
  card('c5', 'Basilico', 0.5),
  card('c6', 'Limone', 0.3),
  card('c7', 'Zenzero', 0.7),
  card('c8', 'Prezzemolo', 0),
  card('c9', 'Aglio', 0),
  card('c10', 'Peperoncino', 0),
]
// "Basics" holds "bas" too: the category is never searched (K201).
const CATEGORY_NAMES = { basics: 'Basics', herbs: 'Herbs', snacks: 'Snacks', dairy: 'Dairy' }

afterEach(() => {
  cleanup()
  confirmPurchase.mockClear()
  mode.real = false
  setOnlineForTest(true)
  getToasts().forEach((t) => dismissToast(t.id))
  data.pantry = []
  groceryStore.set([])
})

function Screen(props) {
  const { rows } = groceryStore.useRows()
  return (
    <ConfirmPurchase
      cartItems={inCartOrder(rows.filter((r) => !r.completed))}
      pantryItems={data.pantry}
      categoryName={(id) => CATEGORY_NAMES[id] ?? id}
      totalOf={(i) => lineTotal(i, data.pantry.find((p) => p.id === i.pantry_item_id))}
      updatePricing={async () => ({})}
      updatePayer={async () => ({})}
      toggleCart={async () => ({})}
      onClose={() => {}}
      partsReady={false}
      unitsReady={false}
      namesReady
      {...props}
    />
  )
}
const open = (cards, props) => {
  groceryStore.set(cards)
  return render(<Screen {...props} />)
}
const search = (text) => fireEvent.change(screen.getByRole('textbox', { name: 'Search this purchase…' }), { target: { value: text } })
// The cards shown (hidden cards are not in the accessibility tree).
const shownCards = () =>
  screen
    .queryAllByRole('textbox', { name: /^Quantity of (?!line )/ })
    .map((el) => el.getAttribute('aria-label').replace('Quantity of ', ''))
    .sort()
const confirmButton = () => screen.getByRole('button', { name: /^Confirm purchase · / })
const sent = () => confirmationPayload({ ...confirmPurchase.mock.calls.at(-1)[0], at: 'now', expenseCategoryFor: () => 'groceries' })
const typeIn = (labelText, value) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } })

describe('"Search this purchase…" (K201, K202)', () => {
  it('10 cards, "bas" → 1 card (Basilico; "Basics" is a category, never searched); totals, counts and what is sent unchanged', async () => {
    open(RECEIPT())
    expect(shownCards()).toHaveLength(10)
    search('bas')
    expect(shownCards()).toEqual(['Basilico'])
    expect(screen.getByText('1 of 10 shown — the total counts all 10.')).toBeTruthy()
    expect(confirmButton().textContent).toContain('Confirm purchase · €3.39')
    expect(screen.getByText(/^10 items · /)).toBeTruthy()
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().items).toHaveLength(10)
    expect(sent().items.reduce((sum, l) => sum + l.line_total, 0)).toBeCloseTo(3.39, 2)
  })

  it('capitals and accents don\'t count, a part of a word is enough; nothing matching → 0 of 10; × clears it', () => {
    open([...RECEIPT(), card('c11', 'Café crème', 0)])
    search('  CAFE ')
    expect(shownCards()).toEqual(['Café crème'])
    expect(screen.getByText('1 of 11 shown — the total counts all 11.')).toBeTruthy()
    search('zzz')
    expect(shownCards()).toEqual([])
    expect(screen.getByText('0 of 11 shown — the total counts all 11.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(shownCards()).toHaveLength(11)
    expect(screen.queryByText(/shown — the total counts all/)).toBeNull()
  })

  it('finds a card by the small grey card name under the title, and by a name typed on line 2; whole cards', () => {
    data.pantry = [item('chips', 'Chips & Snacks', ['Corn Snack', 'Nuvole di drago']), item('tea', 'Tea Tin')]
    open([card('e1', 'Corn Snack', 1.39, { pantry_item_id: 'chips', category_id: 'snacks' }), card('e2', 'Tea Tin', 2, { pantry_item_id: 'tea' }), card('e3', 'Limone', 0.3)])
    // The title is the HOME item (K53), the card's own name small under it.
    search('corn')
    expect(shownCards()).toEqual(['Corn Snack'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add another name' })[0])
    typeIn('Name of line 2 of Corn Snack', 'Patatine paprika')
    search('paprika')
    expect(shownCards()).toEqual(['Corn Snack'])
    // The whole card, with its line 2.
    expect(screen.getByRole('textbox', { name: 'Quantity of line 2 of Corn Snack' })).toBeTruthy()
    // Not by a name of the item that isn't shown on the card.
    search('nuvole')
    expect(shownCards()).toEqual([])
  })

  it('a card never vanishes while typing in it; "+ Add another name" keeps it shown; only a new search text decides', () => {
    data.pantry = [item('chips', 'Chips & Snacks', ['Corn Snack'])]
    open([card('e1', 'Corn Snack', 1.39, { pantry_item_id: 'chips', category_id: 'snacks' }), card('e2', 'Limone', 0.3)])
    search('corn')
    typeIn('Name of Corn Snack', 'Patatine')
    fireEvent.click(screen.getByRole('button', { name: 'Add another name' }))
    typeIn('Name of line 2 of Corn Snack', 'Paprika')
    expect(shownCards()).toEqual(['Corn Snack'])
    // The search text changes: now it is worked out again, on what is typed.
    search('limo')
    expect(shownCards()).toEqual(['Limone'])
    search('patat')
    expect(shownCards()).toEqual(['Corn Snack'])
    search('paprika')
    expect(shownCards()).toEqual(['Corn Snack'])
    // Typing on the card so it no longer matches: it stays under the finger.
    typeIn('Name of line 2 of Corn Snack', 'Salt')
    expect(shownCards()).toEqual(['Corn Snack'])
    expect(screen.getByText('1 of 2 shown — the total counts all 2.')).toBeTruthy()
  })

  it('a hidden card that still needs an answer (expired stock): "1 of them is hidden by the search." + "Show all" (36 px) clears the search', () => {
    data.pantry = [item('yogurt', 'Yogurt Pots', [], { category_id: 'dairy', current_stock: 3, expiry_date: '2020-01-01' })]
    open([card('y1', 'Yogurt Pots', 1, { pantry_item_id: 'yogurt', category_id: 'dairy' }), card('l1', 'Limone', 0.3)])
    expect(screen.getByText('Answer the question above to confirm.', { exact: false })).toBeTruthy()
    search('limone')
    expect(shownCards()).toEqual(['Limone'])
    expect(screen.getByText('1 of them is hidden by the search.')).toBeTruthy()
    const showAll = screen.getByRole('button', { name: 'Show all' })
    expect(showAll.className).toContain('min-h-9')
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(showAll)
    expect(shownCards()).toEqual(['Limone', 'Yogurt Pots'])
    expect(screen.getByRole('textbox', { name: 'Search this purchase…' }).value).toBe('')
    expect(screen.queryByText(/hidden by the search/)).toBeNull()
    // Answered: nothing hidden needs anything any more.
    fireEvent.click(screen.getByRole('radio', { name: 'Keep them' }))
    search('limone')
    expect(screen.queryByText(/hidden by the search/)).toBeNull()
  })

  it('two hidden cards needing something → "2 of them are hidden by the search."', () => {
    data.pantry = [item('yogurt', 'Yogurt Pots', [], { category_id: 'dairy', current_stock: 3, expiry_date: '2020-01-01' })]
    open([card('y1', 'Yogurt Pots', 1, { pantry_item_id: 'yogurt', category_id: 'dairy' }), card('l1', 'Limone', 0.3), card('a1', 'Aglio', 0.4)])
    typeIn('Quantity of Aglio', '1,2,3')
    search('limone')
    expect(screen.getByText('2 of them are hidden by the search.')).toBeTruthy()
  })

  it('a half-typed number is kept while hidden and after clearing, and still blocks Confirm while hidden', () => {
    open(RECEIPT())
    typeIn('Quantity of Pane', '1,2,3')
    expect(screen.getByText('Fix the numbers in red above to confirm.', { exact: false })).toBeTruthy()
    search('bas')
    expect(shownCards()).toEqual(['Basilico'])
    expect(confirmButton().disabled).toBe(true)
    expect(screen.getByText('Fix the numbers in red above to confirm.', { exact: false })).toBeTruthy()
    expect(screen.getByText('1 of them is hidden by the search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('textbox', { name: 'Quantity of Pane' }).value).toBe('1,2,3')
  })

  it('the × to clear has a 36 px target on this screen only (other screens keep the small one)', () => {
    open(RECEIPT())
    search('lat')
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear.className).toContain('min-w-9')
    expect(clear.className).toContain('min-h-9')
    cleanup()
    render(<SearchBox value="x" onChange={() => {}} placeholder="Search your items…" />)
    const small = screen.getByRole('button', { name: 'Clear search' })
    expect(small.className).not.toContain('min-h-9')
    expect(small.className).toBe('absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-icon-muted)]')
  })

  it('K203: "Paid by (everything)" while searching changes every card, hidden ones too', async () => {
    open(RECEIPT())
    search('bas')
    const everything = screen.getByText('Paid by (everything)').parentElement
    fireEvent.click(within(everything).getByRole('button', { name: label(P2) }))
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(sent().items.map((l) => l.payer)).toEqual(Array(10).fill(P2))
  })

  it('a card that comes into the cart while searching (another device) is shown, never hidden (K200)', () => {
    open(RECEIPT())
    search('bas')
    expect(shownCards()).toEqual(['Basilico'])
    act(() => groceryStore.upsertLocal([card('c11', 'Mozzarella', 1.19)]))
    expect(shownCards()).toEqual(['Basilico', 'Mozzarella'])
    expect(screen.getByText('2 of 11 shown — the total counts all 11.')).toBeTruthy()
    expect(confirmButton().textContent).toContain('Confirm purchase · €4.58')
  })

  it('after a refused Confirm the search stays', async () => {
    confirmPurchase.mockImplementationOnce(async () => ({ error: { message: 'Failed to fetch' } }))
    open(RECEIPT())
    search('bas')
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: 'Search this purchase…' }).value).toBe('bas')
    expect(shownCards()).toEqual(['Basilico'])
  })
})

// K214: the database has every card; this device's list missed some.
const BOUGHT_SEPARATELY = () => [
  card('b1', 'Latte', 1.2),
  card('b2', 'Pane', 0.89),
  card('b3', 'Uova', 2.49),
  card('b4', 'Mozzarella', 1.19),
  card('b5', 'Pomodori', 3.1),
  card('b6', 'Zucchine', 2.4),
  card('b7', 'Insalata', 0.99),
  card('b8', 'Yogurt', 9.68),
]
const MISSING = () => [card('b9', 'Vesuvio pizza', 1.58), card('b10', 'ASADO / LA-style short ribs', 24.92)]

// A small database for the real confirmCart: `tables` and every request.
function fakeDatabase(tables, { fail = () => false } = {}) {
  const calls = []
  const from = (table) => {
    const filters = []
    const call = { table, op: 'select', columns: '*' }
    const q = {
      select: (columns = '*') => ((call.columns = columns), q),
      update: (patch) => ((call.op = 'update'), (call.patch = patch), q),
      eq: (k, v) => (filters.push((r) => r[k] === v), q),
      in: (k, vs) => (filters.push((r) => vs.includes(r[k])), q),
      order: () => q,
      limit: () => q,
      maybeSingle: () => ((call.single = true), q),
      then: (resolve, reject) => {
        calls.push(call)
        if (fail(call)) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(resolve, reject)
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (call.op === 'update') rows.forEach((r) => Object.assign(r, call.patch))
        const data = call.columns === 'id' ? rows.map((r) => ({ id: r.id })) : rows.map((r) => ({ ...r }))
        return Promise.resolve({ data: call.single ? data[0] ?? null : data, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  client.supabase = {
    from,
    rpc: (name, args) => {
      calls.push({ op: 'rpc', name, args })
      const total = Math.round(args.payload.items.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100
      return Promise.resolve({ data: { id: args.payload.id, total }, error: null })
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
  }
  return calls
}
const rpcs = (calls) => calls.filter((c) => c.op === 'rpc')

describe('Confirm checks the database cart first (K214)', () => {
  it('the database cart has 2 cards more than the screen → nothing sent, both appear, the 2-card line; pressing again sends all 10 (€48.44)', async () => {
    mode.real = true
    const calls = fakeDatabase({ grocery_items: [...BOUGHT_SEPARATELY(), ...MISSING()] })
    open(BOUGHT_SEPARATELY())
    expect(confirmButton().textContent).toContain('€21.94')
    fireEvent.click(confirmButton())
    await screen.findByText(
      '2 items in the cart were not shown here: Vesuvio pizza, ASADO / LA-style short ribs. They are shown now — check them and press Confirm again.',
      { exact: false }
    )
    expect(rpcs(calls)).toEqual([])
    expect(calls.filter((c) => c.op === 'update')).toEqual([])
    expect(shownCards()).toHaveLength(10)
    expect(shownCards()).toEqual(expect.arrayContaining(['Vesuvio pizza', 'ASADO / LA-style short ribs']))
    expect(confirmButton().textContent).toContain('Confirm purchase · €48.44')
    expect(screen.getByText(/^10 items · /)).toBeTruthy()
    fireEvent.click(confirmButton())
    // The line goes at the next press.
    expect(screen.queryByText(/were not shown here/)).toBeNull()
    await vi.waitFor(() => expect(rpcs(calls)).toHaveLength(1))
    const payload = rpcs(calls)[0].args.payload
    expect(payload.items).toHaveLength(10)
    expect(Math.round(payload.items.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100).toBe(48.44)
    expect(getToasts().find((t) => t.message.startsWith('Purchase confirmed')).message).toBe('Purchase confirmed · 10 items · €48.44')
  })

  it('1 card → the 1-card line', async () => {
    mode.real = true
    const calls = fakeDatabase({ grocery_items: [...BOUGHT_SEPARATELY(), MISSING()[0]] })
    open(BOUGHT_SEPARATELY())
    fireEvent.click(confirmButton())
    await screen.findByText('1 item in the cart was not shown here: Vesuvio pizza. It is shown now — check it and press Confirm again.', { exact: false })
    expect(rpcs(calls)).toEqual([])
  })

  it('compared with every card on the screen, "Not in this trip — stays in the cart" too: no difference → confirmed as today', async () => {
    mode.real = true
    const calls = fakeDatabase({ grocery_items: BOUGHT_SEPARATELY() })
    open(BOUGHT_SEPARATELY(), { splitTrips: true })
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'In this trip' })[0])
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(rpcs(calls)).toHaveLength(1))
    expect(rpcs(calls)[0].args.payload.items).toHaveLength(7)
    expect(screen.queryByText(/were not shown here/)).toBeNull()
  })

  it('with a search on: the search is cleared, the new cards are shown', async () => {
    mode.real = true
    fakeDatabase({ grocery_items: [...BOUGHT_SEPARATELY(), ...MISSING()] })
    open(BOUGHT_SEPARATELY())
    search('latte')
    expect(shownCards()).toEqual(['Latte'])
    fireEvent.click(confirmButton())
    await screen.findByText(/2 items in the cart were not shown here/)
    expect(screen.getByRole('textbox', { name: 'Search this purchase…' }).value).toBe('')
    expect(screen.queryByText(/shown — the total counts all/)).toBeNull()
    expect(shownCards()).toHaveLength(10)
  })

  it('offline: nothing is checked or sent; "You\'re offline — this needs a connection."', async () => {
    mode.real = true
    const calls = fakeDatabase({ grocery_items: BOUGHT_SEPARATELY() })
    open(BOUGHT_SEPARATELY())
    act(() => setOnlineForTest(false))
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(getToasts().map((t) => t.message)).toContain("You're offline — this needs a connection."))
    expect(calls).toEqual([])
  })

  it('the check fails: nothing is sent; "Couldn\'t save — check your connection." with Retry, which presses Confirm again', async () => {
    mode.real = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failing = true
    const calls = fakeDatabase({ grocery_items: BOUGHT_SEPARATELY() }, { fail: (c) => failing && c.table === 'grocery_items' })
    open(BOUGHT_SEPARATELY())
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(getToasts().map((t) => t.message)).toContain("Couldn't save — check your connection."))
    expect(rpcs(calls)).toEqual([])
    const toast = getToasts().find((t) => t.message === "Couldn't save — check your connection.")
    expect(toast.action.label).toBe('Retry')
    failing = false
    await act(async () => toast.action.onClick())
    await vi.waitFor(() => expect(rpcs(calls)).toHaveLength(1))
    expect(rpcs(calls)[0].args.payload.items).toHaveLength(8)
    vi.restoreAllMocks()
  })
})
