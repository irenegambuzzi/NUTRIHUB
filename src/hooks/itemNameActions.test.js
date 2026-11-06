import { beforeEach, describe, expect, it, vi } from 'vitest'

// K58 + K85 (plan 9N): a word the safety net linked to an item is saved as
// another name, after the normal action, with a toast and Undo.
const db = vi.hoisted(() => ({ calls: [], answer: null, rows: [], probe: null }))
const toasts = vi.hoisted(() => [])
const errors = vi.hoisted(() => [])

vi.mock('../lib/feedback', async (original) => ({
  ...(await original()),
  showToast: (t) => toasts.push(t),
  toastSaveError: (error, retry, message) => errors.push({ error, retry, message }),
}))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: async (name, args) => {
      db.calls.push([name, args.payload])
      return db.answer(args.payload)
    },
    from: () => ({ select: () => ({ limit: async () => db.probe }) }),
  },
}))
vi.mock('../lib/stores', () => ({
  pantryStore: {
    getSnapshot: () => ({ rows: db.rows }),
    refresh: vi.fn(async () => {}),
    upsertLocal: (rows) => {
      db.rows = db.rows.map((r) => rows.find((row) => row.id === r.id) ?? r)
    },
  },
}))

const { keepFirstWord, keepTypedName, saveItemNames } = await import('./itemNameActions')
const { forgetNamesForTest } = await import('./useItemNamesReady')
const { setOnlineForTest } = await import('../lib/connection')

const item = (id, name, names = [], extra = {}) => ({ id, name, unit: 'pcs', category_id: 'snacks', names: names.map((n) => ({ name: n, origin: null })), ...extra })
// The database stand-in: applies add and remove as save_item_names does.
const applied = (payload) => {
  const row = db.rows.find((r) => r.id === payload.item_id)
  const kept = row.names.filter((n) => !(payload.remove ?? []).includes(n.name))
  return { data: { ...row, names: [...kept, ...(payload.add ?? []).map((a) => ({ ...a, origin: null }))] }, error: null }
}

beforeEach(() => {
  db.calls.length = 0
  toasts.length = 0
  errors.length = 0
  db.answer = applied
  db.probe = { data: [], error: null }
  db.rows = [item('pumpkin', 'Fresh Pumpkin'), item('chips', 'Chips & Snacks', ['Corn Snack', 'Nuvole di drago']), item('milk', 'Milk')]
  forgetNamesForTest()
  setOnlineForTest(true)
})

describe('"Use …": the typed word becomes a real name (K58, K85)', () => {
  it('saved through save_item_names with `was`, then the toast with Undo', async () => {
    await keepTypedName('  Pumpkin ', 'pumpkin')
    expect(db.calls).toEqual([['save_item_names', { item_id: 'pumpkin', add: [{ name: 'Pumpkin', packaging_unit: null, quantity_per_pack: null, price: null, price_qty: null, price_unit: null }], was: { names: [] } }]])
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('"Pumpkin" saved as another name of "Fresh Pumpkin"')
    expect(toasts[0].action.label).toBe('Undo')
    expect(db.rows[0].names.map((n) => n.name)).toEqual(['Pumpkin'])
  })

  it('Undo removes only that name, reading the list as it is now', async () => {
    await keepTypedName('Corn Snak', 'chips')
    expect(db.rows[1].names.map((n) => n.name)).toEqual(['Corn Snack', 'Nuvole di drago', 'Corn Snak'])
    const { error } = await toasts[0].action.onClick()
    expect(error).toBeNull()
    const [, payload] = db.calls[1]
    expect(payload.remove).toEqual(['Corn Snak'])
    expect(payload.was.names.map((n) => n.name)).toEqual(['Corn Snack', 'Nuvole di drago', 'Corn Snak'])
    expect(db.rows[1].names.map((n) => n.name)).toEqual(['Corn Snack', 'Nuvole di drago'])
  })

  it('a failed save: no toast of success, one error toast with Retry; Retry saves it', async () => {
    db.answer = async () => ({ data: null, error: { message: 'Failed to fetch' } })
    await keepTypedName('Pumpkin', 'pumpkin')
    expect(toasts).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('"Pumpkin" was not saved as another name of "Fresh Pumpkin".')
    db.answer = applied
    await errors[0].retry()
    expect(toasts[0].message).toBe('"Pumpkin" saved as another name of "Fresh Pumpkin"')
    expect(db.rows[0].names.map((n) => n.name)).toEqual(['Pumpkin'])
  })

  it('offline: simply not saved, no toast at all', async () => {
    setOnlineForTest(false)
    await keepTypedName('Pumpkin', 'pumpkin')
    expect(db.calls).toEqual([])
    expect(toasts).toEqual([])
    expect(errors).toEqual([])
  })

  it.each([
    ['Chips & Snacks', 'chips'],
    ['chips & snack', 'chips'],
    ['Corn Snack', 'chips'],
    ['corn snacks', 'chips'],
    ['   ', 'chips'],
  ])('never when the word is already a name of the item: %j', async (word, id) => {
    await keepTypedName(word, id)
    expect(db.calls).toEqual([])
    expect(toasts).toEqual([])
  })

  it('never for a group, a variant or a durable, or a word of another item (K59)', async () => {
    db.rows = [...db.rows, item('g', 'Crisps', [], { is_group: true }), item('v', 'Lays', [], { group_id: 'g' }), item('d', 'Lamp', [], { category_id: 'appliances' })]
    for (const id of ['g', 'v', 'd']) await keepTypedName('Pumpkin', id)
    await keepTypedName('Milk', 'pumpkin')
    await keepTypedName('Nuvole di drago', 'pumpkin')
    expect(db.calls).toEqual([])
    expect(toasts).toEqual([])
  })

  it('before 032, or while it can\'t be told: nothing is sent', async () => {
    db.rows = db.rows.map(({ names: _names, ...row }) => row)
    db.probe = { data: null, error: { code: '42703', message: 'column pantry_items.names does not exist' } }
    await keepTypedName('Pumpkin', 'pumpkin')
    db.probe = { data: null, error: { message: 'timeout' } }
    await keepTypedName('Pumpkin', 'pumpkin')
    expect(db.calls).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('"Create new": the first word goes to the item just made (K58)', () => {
  it('found by its name, after a reload', async () => {
    db.rows = [...db.rows, item('new', 'Frozen Pumpkin Cubes')]
    await keepFirstWord('Pumkin', 'Frozen Pumpkin Cubes')
    expect(toasts[0].message).toBe('"Pumkin" saved as another name of "Frozen Pumpkin Cubes"')
    expect(db.calls[0][1].item_id).toBe('new')
  })

  it('not found, or offline: nothing', async () => {
    await keepFirstWord('Pumkin', 'Not there')
    setOnlineForTest(false)
    await keepFirstWord('Pumkin', 'Milk')
    expect(db.calls).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('"Save changes": saveItemNames', () => {
  const payload = { item_id: 'milk', add: [{ name: 'Latte' }], remove: [], edit: [], was: { names: [] } }

  it('a refusal shows as it is, with no Retry', async () => {
    const message = '"Milk" changed meanwhile (on the other phone?) — open it again. Nothing was changed.'
    db.answer = async () => ({ data: null, error: { code: 'P0001', message } })
    const { error } = await saveItemNames(payload)
    expect(error.message).toBe(message)
    expect(errors[0].message).toBe(message)
    expect(errors[0].retry).toBeNull()
  })

  it('offline: refused, nothing sent', async () => {
    setOnlineForTest(false)
    const { error } = await saveItemNames(payload)
    expect(error.offline).toBe(true)
    expect(db.calls).toEqual([])
  })

  it('saved: the store has the new list', async () => {
    const { error } = await saveItemNames(payload)
    expect(error).toBeNull()
    expect(db.rows[2].names.map((n) => n.name)).toEqual(['Latte'])
  })
})
