// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const main = (id, name, sort_order = 1) => ({ id, name, parent_id: null, type: 'parent', sort_order })
const sub = (id, name, parent_id, sort_order = 1) => ({ id, name, parent_id, type: 'sub', sort_order })

const state = vi.hoisted(() => ({ categories: [], pantry: [], grocery: [], memory: [] }))
const calls = vi.hoisted(() => ({ rpc: [], from: [], upserted: [], removed: [], inserted: [] }))
const db = vi.hoisted(() => ({ rpcResult: { data: null, error: null }, usedRows: [], updateResult: null }))

vi.mock('../lib/connection', () => ({ isOffline: () => false }))
vi.mock('../lib/feedback', () => ({ showToast: vi.fn(), toastSaveError: vi.fn() }))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(async (name, args) => {
      calls.rpc.push([name, args])
      return db.rpcResult
    }),
    from: vi.fn((table) => {
      calls.from.push(table)
      const chain = {
        select: () => chain,
        or: () => chain,
        eq: () => chain,
        limit: async () => ({ data: db.usedRows, error: null }),
        update: (fields) => ({ eq: () => ({ select: async () => ({ data: [{ ...state.categories[0], ...fields }], error: null }) }) }),
        insert: (rows) => (calls.inserted.push(...rows), { select: () => ({ single: async () => ({ data: { id: 'new' }, error: null }) }) }),
        delete: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'gone' }], error: null }) }) }),
        upsert: async (rows) => (calls.upserted.push(rows), { error: null }),
      }
      return chain
    }),
  },
}))

const store = (key, extra = {}) => ({
  useRows: () => ({ rows: state[key], loaded: true }),
  getSnapshot: () => ({ rows: state[key] }),
  refresh: vi.fn(async () => {}),
  upsertLocal: vi.fn(),
  removeLocal: vi.fn((ids) => calls.removed.push(ids)),
  ...extra,
})
vi.mock('../lib/stores', () => ({
  inventoryCategoryStore: store('categories'),
  pantryStore: store('pantry'),
  groceryStore: store('grocery'),
  categoryMemoryStore: store('memory'),
  budgetMapStore: store('memory'),
}))
vi.mock('../lib/db', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteWithUndo: vi.fn(async ({ remove }) => ({ error: null, snapshot: await remove() })),
}))

const { useInventoryCategories } = await import('./useInventoryCategories')
const { supabase } = await import('../lib/supabaseClient')

beforeEach(() => {
  state.categories = [
    main('produce', 'Fruit & Vegetables'),
    sub('hand-veg', 'Frozen Vegetables', 'produce'),
    sub('produce:fruit', 'Fresh Fruit', 'produce', 2),
    main('frozen', 'Frozen Food', 2),
    sub('frozen:vegetables', 'Frozen Vegetables', 'frozen'),
    sub('frozen:fish', 'Frozen Fish', 'frozen', 2),
    main('laundry', 'Laundry Supplies', 3),
    sub('laundry:parfume', 'Parfume', 'laundry'),
    main('snacks', 'Snacks', 4),
    main('appliances', 'Home & Appliances', 5),
    main('empty', 'Empty one', 6),
    main('personal-care', 'Personal Care & Beauty', 7),
    main('automotive', 'Automotive (old)', 8),
  ]
  state.pantry = [{ id: 'p1', category_id: 'produce', subcategory_id: 'hand-veg' }]
  state.grocery = []
  state.memory = []
  calls.rpc.length = calls.from.length = calls.upserted.length = calls.removed.length = calls.inserted.length = 0
  db.rpcResult = { data: null, error: null }
  db.usedRows = []
  vi.mocked(supabase.from).mockClear()
})

const hook = () => renderHook(() => useInventoryCategories()).result

describe('adding a HOME category: names are unique across every level', () => {
  it('refuses a sub named "frozen fish" before anything is sent', async () => {
    const result = await hook().current.addSubcategory('laundry', 'frozen fish')
    expect(result.error.nameProblem).toBe(true)
    expect(result.error.message).toBe('"Frozen Fish" already exists in Frozen Food.')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('refuses a main category named like a sub-category anywhere', async () => {
    const result = await hook().current.addCategory('  PARFUME ')
    expect(result.error.message).toBe('"Parfume" already exists in Laundry Supplies.')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('saves a new name trimmed', async () => {
    const result = await hook().current.addSubcategory('snacks', ' Crackers ')
    expect(result.error).toBeNull()
    expect(supabase.from).toHaveBeenCalledWith('inventory_categories')
  })

  it('still loads with the duplicate "Frozen Vegetables" and offers both', () => {
    const { subsByParent } = hook().current
    expect(subsByParent.get('produce').map((s) => s.name)).toContain('Frozen Vegetables')
    expect(subsByParent.get('frozen').map((s) => s.name)).toContain('Frozen Vegetables')
  })

  it("doesn't count hidden categories", async () => {
    state.categories.push(sub('automotive:x', 'Toys', 'automotive'))
    const result = await hook().current.addSubcategory('snacks', 'Toys')
    expect(result.error).toBeNull()
  })
})

describe('renaming', () => {
  it('allows a rename that only changes capitals', async () => {
    const result = await hook().current.renameCategory('laundry:parfume', 'parfume')
    expect(result.error).toBeNull()
    expect(supabase.from).toHaveBeenCalledWith('inventory_categories')
  })

  it("refuses another category's name", async () => {
    const result = await hook().current.renameCategory('laundry:parfume', 'Frozen Fish')
    expect(result.error.message).toBe('"Frozen Fish" already exists in Frozen Food.')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('never renames Home & Appliances, and never calls the database for it', async () => {
    const result = await hook().current.renameCategory('appliances', 'House & Appliances')
    expect(result.error.message).toMatch(/is locked: it can't be renamed, moved or deleted/)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('shows the built-in "Beauty Care" only while the stored name is the original, then the renamed one', () => {
    expect(hook().current.byId.get('personal-care').name).toBe('Beauty Care')
    state.categories = state.categories.map((c) => (c.id === 'personal-care' ? { ...c, name: 'Care & Beauty' } : c))
    expect(hook().current.byId.get('personal-care').name).toBe('Care & Beauty')
  })
})

describe('moving', () => {
  it('moves a sub through the database function and reports the items that followed', async () => {
    db.rpcResult = { data: { items: 2, list_entries: 0, memory: 1 }, error: null }
    const result = await hook().current.moveSubcategory('laundry:parfume', 'snacks')
    expect(calls.rpc).toEqual([['move_inventory_subcategory', { sub_id: 'laundry:parfume', parent_id: 'snacks' }]])
    expect(result.message).toBe('"Parfume" moved to Snacks · 2 items followed')
  })

  it('never moves Home & Appliances, and never calls the database for it', async () => {
    const result = await hook().current.moveSubcategory('appliances', 'snacks')
    expect(result.error.message).toMatch(/is locked: it can't be renamed, moved or deleted/)
    expect(calls.rpc).toEqual([])
  })

  it('shows a database refusal in plain English', async () => {
    db.rpcResult = { data: null, error: { message: 'This category no longer exists.' } }
    const result = await hook().current.moveSubcategory('laundry:parfume', 'snacks')
    expect(result.error.message).toBe('This category no longer exists.')
  })
})

describe('deleting', () => {
  it('merges a category in use through the database function, never with a plain delete', async () => {
    db.rpcResult = { data: { items: 1, list_entries: 0, memory: 0, subcategories: 0 }, error: null }
    const result = await hook().current.deleteCategory('hand-veg', 'frozen:vegetables')
    expect(calls.rpc).toEqual([['merge_inventory_category', { from_id: 'hand-veg', to_id: 'frozen:vegetables' }]])
    expect(supabase.from).not.toHaveBeenCalled()
    expect(result.message).toBe('1 item moved to Frozen Food › Frozen Vegetables. "Frozen Vegetables" deleted.')
  })

  it('refuses a plain delete of a category that is in use', async () => {
    const result = await hook().current.deleteCategory('hand-veg')
    expect(result.error.message).toMatch(/still in use/)
    expect(calls.rpc).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('refuses a plain delete when the database says something uses it (another phone)', async () => {
    db.usedRows = [{ id: 'x' }]
    const result = await hook().current.deleteCategory('empty')
    expect(result.error.message).toMatch(/still in use/)
    expect(calls.removed).toEqual([])
  })

  it('deletes an empty category right away', async () => {
    const result = await hook().current.deleteCategory('empty')
    expect(result.error).toBeNull()
    expect(calls.removed).toEqual([['empty']])
    expect(calls.rpc).toEqual([])
  })

  it('uses the function for a category that only a remembered name or a SHOP entry points to', async () => {
    state.memory = [{ id: 'gel', category_id: 'snacks', subcategory_id: null }]
    expect((await hook().current.deleteCategory('snacks')).error.message).toMatch(/still in use/)
  })

  it('blocks merging a main into a main when a moved sub has the same name, before the database', async () => {
    const result = await hook().current.deleteCategory('produce', 'frozen')
    expect(result.error.message).toBe('"Frozen Vegetables" already exists in Frozen Food — merge or rename that sub first.')
    expect(calls.rpc).toEqual([])
  })

  it('never deletes Home & Appliances', async () => {
    const result = await hook().current.deleteCategory('appliances', 'snacks')
    expect(result.error.message).toMatch(/is locked: it can't be renamed, moved or deleted/)
    expect(calls.rpc).toEqual([])
  })

  it('refuses moving Home & Appliances items out of its tree', async () => {
    state.categories.push(sub('appliances:air', 'Air & Climate', 'appliances'))
    const result = await hook().current.deleteCategory('appliances:air', 'snacks')
    expect(result.error.message).toMatch(/nothing moves into or out of it/)
  })
})

describe('round 6C: A–Z lists, the shop route kept apart, Baby visible', () => {
  it('gives parents and sub-categories A–Z, and shopOrder in sort_order', () => {
    state.categories = [
      main('produce', 'Fruit & Vegetables', 1),
      sub('produce:salad', 'Salad & Leafy Greens', 'produce', 1),
      sub('produce:fruit', 'Fresh Fruit', 'produce', 2),
      main('toiletries', 'Toiletries', 13),
      main('baby', 'Baby', 14),
      main('misc', 'Miscellaneous / Seasonal', 19),
      main('appliances', 'Home & Appliances', 18),
    ]
    const { parents, pantryParents, subsByParent, shopOrder } = hook().current
    // A category with a low sort_order and a late letter: first in the
    // shop, later in the lists. "Miscellaneous / Seasonal" is last.
    expect(parents.map((p) => p.name)).toEqual(['Baby', 'Fruit & Vegetables', 'Home & Appliances', 'Toiletries', 'Miscellaneous / Seasonal'])
    expect(pantryParents.map((p) => p.id)).toEqual(['baby', 'produce', 'toiletries', 'misc'])
    expect(subsByParent.get('produce').map((s) => s.name)).toEqual(['Fresh Fruit', 'Salad & Leafy Greens'])
    expect(shopOrder).toEqual(['produce', 'toiletries', 'baby', 'appliances', 'misc'])
  })

  it('shows "Baby" (id baby) with its subs: it is no longer hidden', () => {
    state.categories.push(main('baby', 'Baby', 14), sub('baby:diapers', 'Diapers', 'baby'))
    const { parents, subsByParent } = hook().current
    expect(parents.map((p) => p.id)).toContain('baby')
    expect(subsByParent.get('baby').map((s) => s.id)).toEqual(['baby:diapers'])
  })

  it('"+ New category" never picks a hidden id: "Automotive" becomes automotive-2, and is shown', async () => {
    state.categories = state.categories.filter((c) => c.id !== 'automotive')
    const result = await hook().current.addCategory('Automotive')
    expect(result.error).toBeNull()
    expect(calls.inserted).toEqual([expect.objectContaining({ id: 'automotive-2', name: 'Automotive', type: 'parent' })])
    state.categories.push(main('automotive-2', 'Automotive', 20))
    expect(hook().current.parents.map((p) => p.id)).toContain('automotive-2')
  })

  it('"Baby" made with "+ New category" gets the id baby and is shown', async () => {
    await hook().current.addCategory('Baby')
    expect(calls.inserted).toEqual([expect.objectContaining({ id: 'baby', name: 'Baby' })])
  })
})
