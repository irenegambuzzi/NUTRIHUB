import { describe, expect, it } from 'vitest'
import {
  deleteProblem,
  homeNameKey,
  homeNameTaken,
  isUnused,
  mergeProblem,
  mergeSummary,
  mergeTargets,
  moveProblem,
  moveSummary,
  moveTargets,
  nameProblem,
  pathOf,
  plainError,
  renameProblem,
  subNameClashes,
  usageOf,
  visibleInventoryCategories,
} from './inventoryCategoryEdit'

const main = (id, name) => ({ id, name, parent_id: null, type: 'parent' })
const sub = (id, name, parent_id) => ({ id, name, parent_id, type: 'sub' })

// Like the live data: the duplicate "Frozen Vegetables" included.
const categories = [
  main('produce', 'Fruit & Vegetables'),
  sub('produce:fruit', 'Fresh Fruit', 'produce'),
  sub('hand-frozen-veg', 'Frozen Vegetables', 'produce'),
  main('frozen', 'Frozen Food'),
  sub('frozen:vegetables', 'Frozen Vegetables', 'frozen'),
  sub('frozen:fish', 'Frozen Fish', 'frozen'),
  main('laundry', 'Laundry Supplies'),
  sub('laundry:parfume', 'Parfume', 'laundry'),
  main('misc', 'Miscellaneous / Seasonal'),
  sub('misc:gifts', 'Gifts', 'misc'),
  main('snacks', 'Snacks'),
  main('appliances', 'Home & Appliances'),
  sub('appliances:kitchen', 'Kitchen Appliances', 'appliances'),
  sub('appliances:air', 'Air & Climate', 'appliances'),
]

describe('HOME names are unique across every level', () => {
  it('compares ignoring capitals, accents, outer and repeated spaces', () => {
    expect(homeNameKey('  Frozen   FISH ')).toBe('frozen fish')
    expect(homeNameKey('Cafè')).toBe('cafe')
    expect(homeNameKey(null)).toBe('')
  })

  it('refuses a sub named like another sub, and says where it is', () => {
    expect(nameProblem(categories, 'frozen fish')).toBe('"Frozen Fish" already exists in Frozen Food.')
    expect(nameProblem(categories, 'Gifts')).toBe('"Gifts" already exists in Miscellaneous / Seasonal.')
  })

  it('refuses a name that is used by a main category, whatever is being added', () => {
    expect(nameProblem(categories, 'snacks ')).toBe('"Snacks" already exists as a main category.')
    expect(homeNameTaken(categories, 'Kitchen Appliances')?.id).toBe('appliances:kitchen')
  })

  it('refuses a main named like a sub, under any main', () => {
    expect(nameProblem(categories, 'Fresh   fruit')).toBe('"Fresh Fruit" already exists in Fruit & Vegetables.')
  })

  it('accepts a new name, and refuses an empty one', () => {
    expect(nameProblem(categories, 'Gluten free')).toBeNull()
    expect(nameProblem(categories, '   ')).toBe('Type a name.')
  })

  it('allows renaming to the same name with other capitals', () => {
    expect(renameProblem(categories, 'laundry:parfume', 'parfume')).toBeNull()
    expect(renameProblem(categories, 'snacks', 'snacks ')).toBeNull()
    expect(renameProblem(categories, 'laundry:parfume', 'Perfume')).toBeNull()
  })

  it("refuses renaming to another category's name", () => {
    expect(renameProblem(categories, 'laundry:parfume', 'Frozen Fish')).toBe('"Frozen Fish" already exists in Frozen Food.')
    expect(renameProblem(categories, 'misc:gifts', 'Snacks')).toBe('"Snacks" already exists as a main category.')
    expect(renameProblem(categories, 'gone', 'Whatever')).toBe('This category no longer exists.')
  })

  it('works with the existing duplicate: only the typed name is checked', () => {
    expect(renameProblem(categories, 'frozen:vegetables', 'Frozen Fruit & Vegetables')).toBeNull()
    expect(renameProblem(categories, 'hand-frozen-veg', 'Frozen Fruit & Vegetables')).toBeNull()
    expect(nameProblem(categories, 'Frozen Vegetables')).toMatch(/already exists/)
    expect(nameProblem(categories, 'Cheese')).toBeNull()
  })

  it('lets Home & Appliances be renamed', () => {
    expect(renameProblem(categories, 'appliances', 'House & Appliances')).toBeNull()
  })
})

describe('moving a category', () => {
  it('moves a sub under another main, or makes it a main', () => {
    expect(moveProblem(categories, 'laundry:parfume', 'misc')).toBeNull()
    expect(moveProblem(categories, 'laundry:parfume', null)).toBeNull()
    expect(moveTargets(categories, 'laundry:parfume').map((c) => c.id)).toEqual(['produce', 'frozen', 'misc', 'snacks'])
  })

  it('says it is already there', () => {
    expect(moveProblem(categories, 'laundry:parfume', 'laundry')).toBe('It is already there.')
  })

  it('lets a main without sub-categories become a sub-category', () => {
    expect(moveProblem(categories, 'snacks', 'misc')).toBeNull()
  })

  it('does not let a main with sub-categories become a sub-category', () => {
    expect(moveProblem(categories, 'frozen', 'misc')).toMatch(/has sub-categories, so it can't become a sub-category/)
    expect(moveTargets(categories, 'frozen')).toEqual([])
  })

  it('never moves Home & Appliances, or anything into or out of it', () => {
    expect(moveProblem(categories, 'appliances', 'misc')).toMatch(/can't be moved \(it can be renamed\)/)
    expect(moveProblem(categories, 'appliances', null)).toMatch(/can't be moved/)
    expect(moveProblem(categories, 'laundry:parfume', 'appliances')).toMatch(/nothing moves into or out of it/)
    expect(moveProblem(categories, 'appliances:air', 'misc')).toMatch(/nothing moves into or out of it/)
    expect(moveProblem(categories, 'appliances:air', null)).toMatch(/nothing moves into or out of it/)
    expect(moveProblem(categories, 'snacks', 'appliances')).toMatch(/nothing moves into or out of it/)
    expect(moveTargets(categories, 'appliances:air')).toEqual([])
  })

  it('rejects a sub as the target', () => {
    expect(moveProblem(categories, 'snacks', 'misc:gifts')).toBe('Choose a main category.')
  })
})

describe('deleting a category', () => {
  it('never deletes Home & Appliances (it can be renamed)', () => {
    expect(deleteProblem(categories, 'appliances')).toMatch(/can't be deleted \(it can be renamed\)/)
    expect(deleteProblem(categories, 'appliances:air')).toBeNull()
    expect(deleteProblem(categories, 'snacks')).toBeNull()
  })

  it('counts what uses a category: a main counts its subs\' items too', () => {
    const items = [
      { id: 1, category_id: 'frozen', subcategory_id: 'frozen:vegetables' },
      { id: 2, category_id: 'frozen', subcategory_id: 'frozen:fish' },
      { id: 3, category_id: 'frozen', subcategory_id: null },
      { id: 4, category_id: 'snacks', subcategory_id: null },
    ]
    const entries = [{ id: 'g1', category_id: 'frozen', subcategory_id: 'frozen:fish' }]
    const memory = [{ id: 'pizza', category_id: 'frozen', subcategory_id: 'frozen:vegetables' }]
    const frozen = categories.find((c) => c.id === 'frozen')
    const veg = categories.find((c) => c.id === 'frozen:vegetables')
    expect(usageOf(categories, frozen, items, entries, memory)).toEqual({ items: 3, entries: 1, memory: 1, subs: 2 })
    expect(usageOf(categories, veg, items, entries, memory)).toEqual({ items: 1, entries: 0, memory: 1, subs: 0 })
    expect(isUnused(usageOf(categories, categories.find((c) => c.id === 'misc:gifts'), items, entries, memory))).toBe(true)
    // A main with an empty sub is not "empty": the sub must go somewhere.
    expect(isUnused(usageOf(categories, categories.find((c) => c.id === 'misc'), items, entries, memory))).toBe(false)
  })

  it('counts SHOP entries and remembered names alone as use', () => {
    const veg = categories.find((c) => c.id === 'frozen:vegetables')
    expect(isUnused(usageOf(categories, veg, [], [{ subcategory_id: 'frozen:vegetables' }], []))).toBe(false)
    expect(isUnused(usageOf(categories, veg, [], [], [{ subcategory_id: 'frozen:vegetables' }]))).toBe(false)
  })
})

describe('moving the items of a deleted category (merge)', () => {
  it('offers only mains for a main with sub-categories, never the appliances tree', () => {
    expect(mergeTargets(categories, 'frozen').map((t) => t.id)).toEqual(['produce', 'laundry', 'misc', 'snacks'])
  })

  it('offers mains and subs (indented by the screen) for a sub or an empty main', () => {
    const ids = mergeTargets(categories, 'hand-frozen-veg').map((t) => t.id)
    expect(ids).toContain('frozen:vegetables')
    expect(ids).toContain('snacks')
    expect(ids).not.toContain('hand-frozen-veg')
    expect(ids).not.toContain('appliances')
    expect(ids).not.toContain('appliances:air')
    expect(mergeTargets(categories, 'snacks').map((t) => t.label)).toContain('Frozen Food › Frozen Fish')
  })

  it('keeps Home & Appliances items inside Home & Appliances', () => {
    expect(mergeTargets(categories, 'appliances:air').map((t) => t.id)).toEqual(['appliances', 'appliances:kitchen'])
    expect(mergeProblem(categories, 'appliances:air', 'snacks')).toMatch(/nothing moves into or out of it/)
    expect(mergeProblem(categories, 'snacks', 'appliances:kitchen')).toMatch(/nothing moves into or out of it/)
  })

  it('never deletes Home & Appliances itself', () => {
    expect(mergeProblem(categories, 'appliances', 'snacks')).toMatch(/can't be deleted/)
  })

  it('merges the hand-made Frozen Vegetables into the seeded one', () => {
    expect(mergeProblem(categories, 'hand-frozen-veg', 'frozen:vegetables')).toBeNull()
    expect(pathOf(categories, categories.find((c) => c.id === 'frozen:vegetables'))).toBe('Frozen Food › Frozen Vegetables')
  })

  it('blocks merging a main into another main when a moved sub has the same name as one there', () => {
    // The live case: "Frozen Vegetables" under both Fruit & Vegetables and Frozen Food.
    expect(subNameClashes(categories, 'produce', 'frozen')).toEqual([{ name: 'Frozen Vegetables', intoName: 'Frozen Food' }])
    expect(mergeProblem(categories, 'produce', 'frozen')).toBe('"Frozen Vegetables" already exists in Frozen Food — merge or rename that sub first.')
  })

  it('says each clashing name once', () => {
    const twice = [...categories, sub('produce:veg2', 'frozen vegetables', 'produce')]
    expect(subNameClashes(twice, 'produce', 'frozen')).toHaveLength(1)
  })

  it('lists every clashing name, ignoring capitals', () => {
    const cats = [...categories, sub('produce:x', 'frozen FISH ', 'produce')]
    const problem = mergeProblem(cats, 'produce', 'frozen')
    expect(problem).toContain('"Frozen Vegetables" already exists in Frozen Food')
    expect(problem).toContain('"Frozen Fish" already exists in Frozen Food')
    expect(problem.endsWith('merge or rename that sub first.')).toBe(true)
  })

  it('lets a main merge into a main when no sub names clash', () => {
    const cats = [main('a', 'A'), sub('a:1', 'One', 'a'), main('b', 'B'), sub('b:2', 'Two', 'b')]
    expect(mergeProblem(cats, 'a', 'b')).toBeNull()
  })

  it('does not look at clashes when a sub is merged (only a main brings its subs along)', () => {
    expect(subNameClashes(categories, 'hand-frozen-veg', 'frozen')).toEqual([])
  })

  it('refuses the same category, a main with subs into a sub, and a main into its own sub', () => {
    expect(mergeProblem(categories, 'snacks', 'snacks')).toBe('Pick another category to move everything to.')
    expect(mergeProblem(categories, 'frozen', 'misc:gifts')).toMatch(/has sub-categories/)
    expect(mergeProblem(categories, 'frozen', 'frozen:fish')).toMatch(/is inside/)
    expect(mergeProblem(categories, 'snacks', '')).toBe('Choose where to move the items.')
  })

  it('writes what moved from the database counts', () => {
    expect(mergeSummary({ items: 4, list_entries: 0, memory: 2, subcategories: 0 }, 'Frozen Food › Frozen Vegetables')).toBe('4 items moved to Frozen Food › Frozen Vegetables')
    expect(mergeSummary({ items: 1, list_entries: 2, subcategories: 3 }, 'Snacks')).toBe('1 item, 2 SHOP entries, 3 sub-categories moved to Snacks')
    expect(mergeSummary({ items: 0, list_entries: 0, memory: 0, subcategories: 0 }, 'Snacks')).toBe('Moved to Snacks')
    expect(moveSummary({ items: 2 }, 'Parfume', 'Snacks')).toBe('"Parfume" moved to Snacks · 2 items followed')
  })
})

describe('plain errors', () => {
  it('keeps the database sentences, and explains the technical ones', () => {
    expect(plainError({ message: 'This category no longer exists.' })).toBe('This category no longer exists.')
    expect(plainError({ code: '42501', message: 'x' })).toBe('Not allowed: log in with the household account.')
    expect(plainError({ message: 'Could not find the function public.merge_inventory_category' })).toMatch(/023_oct_2026_features/)
    expect(plainError({ message: 'TypeError: Failed to fetch' })).toMatch(/check your connection/)
  })
})

describe('the names HOME shows', () => {
  const rows = [
    { id: 'personal-care', name: 'Personal Care & Beauty', parent_id: null },
    { id: 'baby', name: 'Baby', parent_id: null },
    { id: 'baby:x', name: 'Toys', parent_id: 'baby' },
    { id: 'snacks', name: 'Snacks', parent_id: null },
  ]
  const options = { hiddenIds: ['baby', 'automotive'], displayNames: { 'personal-care': 'Beauty Care' }, originalNames: { 'personal-care': 'Personal Care & Beauty' } }

  it('uses the built-in name only while the stored name is the original one', () => {
    expect(visibleInventoryCategories(rows, options).map((c) => c.name)).toEqual(['Beauty Care', 'Snacks'])
  })

  it('shows the name someone gave it in Manage', () => {
    const renamed = rows.map((c) => (c.id === 'personal-care' ? { ...c, name: 'Care & Beauty' } : c))
    expect(visibleInventoryCategories(renamed, options)[0].name).toBe('Care & Beauty')
  })
})
