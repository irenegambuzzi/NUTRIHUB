import { describe, expect, it } from 'vitest'
import { budgetCategoryFor, defaultBudgetCategory, effectiveBudget, pastPurchaseChanges, purchasedItemsByExpense } from './budgetMap'
import { pickDurableCategory } from './inventory'
import { FAMILY_SUPPORT_CATEGORY_ID, TRIPS_CATEGORY_ID, WORK_CATEGORY_ID } from '../data/constants'

const expenseCategories = [
  { id: 'groc', name: 'Groceries', parent_id: null },
  { id: 'home', name: 'Home & Appliances', parent_id: null },
  { id: 'kitchen', name: 'Kitchen Appliances', parent_id: 'home' },
  { id: 'pets', name: 'Pets', parent_id: null },
  { id: 'pets-food', name: 'Pet food', parent_id: 'pets' },
  { id: 'house', name: 'Home', parent_id: null },
]
const inventoryCategories = [
  { id: 'pet', name: 'Pet Supplies', parent_id: null },
  { id: 'pet:food', name: 'Pet Food', parent_id: 'pet' },
  { id: 'dairy', name: 'Dairy', parent_id: null },
  { id: 'appliances', name: 'Home & Appliances', parent_id: null },
  { id: 'appliances:kitchen', name: 'Kitchen Appliances', parent_id: 'appliances' },
  { id: 'appliances:other', name: 'Other appliances', parent_id: 'appliances' },
  { id: 'cleaning', name: 'Cleaning Supplies', parent_id: null },
]
const ctx = { expenseCategories, inventoryCategories, mapRows: [] }

describe('the default: exactly what the app did before any mapping', () => {
  it('books everything that is not an appliance under Groceries', () => {
    for (const item of [{ category_id: 'pet', subcategory_id: 'pet:food' }, { category_id: 'dairy' }, { category_id: 'cleaning' }, { category_id: null }]) {
      expect(budgetCategoryFor(item, ctx)).toBe('groc')
    }
  })
  it('books an appliance under its Home & Appliances sub-category, else Home & Appliances', () => {
    expect(budgetCategoryFor({ category_id: 'appliances', subcategory_id: 'appliances:kitchen' }, ctx)).toBe('kitchen')
    expect(budgetCategoryFor({ category_id: 'appliances', subcategory_id: 'appliances:other' }, ctx)).toBe('home')
    expect(budgetCategoryFor({ category_id: 'appliances', subcategory_id: null }, ctx)).toBe('home')
  })
  it('picks the appliance category from the same rows the old database lookup used', () => {
    const rows = expenseCategories.filter((c) => ['Home & Appliances', 'Kitchen Appliances'].includes(c.name))
    expect(pickDurableCategory(rows, 'Kitchen Appliances')).toBe(defaultBudgetCategory({ category_id: 'appliances', subcategory_id: 'appliances:kitchen' }, ctx))
  })
  it('without Groceries, books without a category (as before); without Home & Appliances, refuses an appliance (as before)', () => {
    const none = { ...ctx, expenseCategories: expenseCategories.filter((c) => c.name !== 'Groceries' && c.parent_id !== 'home' && c.id !== 'home') }
    expect(budgetCategoryFor({ category_id: 'dairy' }, none)).toBeNull()
    expect(() => budgetCategoryFor({ category_id: 'appliances' }, none)).toThrow(/Home & Appliances/)
  })
})

describe('a mapping chosen by hand', () => {
  const mapRows = [
    { id: 'pet', expense_category_id: 'pets' },
    { id: 'cleaning', expense_category_id: 'house' },
  ]
  it('books the item category, and its sub-categories, under the chosen budget category', () => {
    expect(budgetCategoryFor({ category_id: 'pet', subcategory_id: 'pet:food' }, { ...ctx, mapRows })).toBe('pets')
    expect(budgetCategoryFor({ category_id: 'cleaning' }, { ...ctx, mapRows })).toBe('house')
    expect(budgetCategoryFor({ category_id: 'dairy' }, { ...ctx, mapRows })).toBe('groc')
  })
  it('a sub-category choice wins over its main category', () => {
    const rows = [...mapRows, { id: 'pet:food', expense_category_id: 'pets-food' }]
    expect(budgetCategoryFor({ category_id: 'pet', subcategory_id: 'pet:food' }, { ...ctx, mapRows: rows })).toBe('pets-food')
  })
  it('a choice whose budget category was deleted falls back to the default', () => {
    expect(budgetCategoryFor({ category_id: 'pet' }, { ...ctx, mapRows: [{ id: 'pet', expense_category_id: 'gone' }] })).toBe('groc')
  })
  it('says where each category is booked, and why', () => {
    const rows = [...mapRows]
    expect(effectiveBudget(inventoryCategories[0], { ...ctx, mapRows: rows })).toEqual({ target: 'pets', source: 'own' })
    expect(effectiveBudget(inventoryCategories[1], { ...ctx, mapRows: rows })).toEqual({ target: 'pets', source: 'main' })
    expect(effectiveBudget(inventoryCategories[2], { ...ctx, mapRows: rows })).toEqual({ target: 'groc', source: 'default' })
    expect(effectiveBudget(inventoryCategories[4], { ...ctx, mapRows: rows })).toEqual({ target: 'kitchen', source: 'default' })
  })
})

describe('applying the mapping to past purchases', () => {
  const expenses = [
    { id: 'e1', category_id: 'groc', amount: 30 },
    { id: 'e2', category_id: 'groc', amount: 12.5 },
    { id: 'e3', category_id: 'groc', amount: 4 },
    { id: 'e4', category_id: 'groc', amount: 99 }, // typed by hand, not from a purchase
    { id: 'e5', category_id: 'pets', amount: 8 }, // already right
  ]
  const items = { e1: { category_id: 'pet' }, e2: { category_id: 'pet', subcategory_id: 'pet:food' }, e3: { category_id: 'dairy' }, e5: { category_id: 'pet' } }
  it('lists only purchases whose category would change, grouped from → to', () => {
    const { changes, summary } = pastPurchaseChanges(expenses, (id) => items[id] ?? null, { ...ctx, mapRows: [{ id: 'pet', expense_category_id: 'pets' }] })
    expect(changes.map((c) => c.expense.id)).toEqual(['e1', 'e2'])
    expect(summary).toEqual([{ from: 'groc', to: 'pets', count: 2, total: 42.5 }])
  })
  it('with the default mapping changes nothing that was booked as before', () => {
    expect(pastPurchaseChanges(expenses.slice(0, 4), (id) => items[id] ?? null, ctx).changes).toEqual([])
  })
})

describe('Apply the mapping to past purchases: what was bought', () => {
  it('reads only SHOP lines: a MONEY line (budget chosen in the form) is never moved, not even through the SHOP entry it closed', () => {
    const byExpense = purchasedItemsByExpense({
      orderItems: [['e-order', { category_id: 'pet', subcategory_id: null }]],
      groceries: [
        { expense_id: 'e-shop', category_id: 'dairy', subcategory_id: null },
        { expense_id: 'e-money', category_id: 'dairy', subcategory_id: null },
      ],
      tripLines: [
        { expense_id: 'e-shop', line_kind: 'shop', grocery_snapshot: { category_id: 'dairy', subcategory_id: 'dairy:milk' } },
        { expense_id: 'e-old', grocery_snapshot: { category_id: 'bakery' } },
        { expense_id: 'e-money', line_kind: 'money', grocery_snapshot: { category_id: 'dairy' } },
        { expense_id: 'e-dinner', line_kind: 'money', grocery_snapshot: { category_id: null } },
      ],
    })
    expect([...byExpense.keys()].sort()).toEqual(['e-old', 'e-order', 'e-shop'])
    expect(byExpense.get('e-shop')).toEqual({ category_id: 'dairy', subcategory_id: 'dairy:milk' })
    expect(byExpense.get('e-old')).toEqual({ category_id: 'bakery', subcategory_id: null })
  })
})

describe('round 9F: what "Apply the mapping to past purchases" leaves alone', () => {
  const money = [
    ...expenseCategories,
    { id: WORK_CATEGORY_ID, name: 'Work', parent_id: null },
    { id: FAMILY_SUPPORT_CATEGORY_ID, name: 'Family Support', parent_id: null },
    { id: TRIPS_CATEGORY_ID, name: 'Trips & Holidays', parent_id: null },
    { id: 'flights', name: 'Flights', parent_id: TRIPS_CATEGORY_ID },
  ]
  const c = { ...ctx, expenseCategories: money }

  it('a SHOP line without a HOME category is never moved (it says nothing about where it belongs)', () => {
    const expenses = [{ id: 'bra', category_id: 'house', amount: 1.74 }, { id: 'milk', category_id: 'house', amount: 1 }]
    const items = { bra: { category_id: null, subcategory_id: null }, milk: { category_id: 'dairy', subcategory_id: null } }
    expect(pastPurchaseChanges(expenses, (id) => items[id], c).changes.map((x) => x.expense.id)).toEqual(['milk'])
  })

  it('an expense in Work, Family Support or Trips & Holidays (or one of its subs) was put there on purpose: never moved', () => {
    const expenses = [WORK_CATEGORY_ID, FAMILY_SUPPORT_CATEGORY_ID, TRIPS_CATEGORY_ID, 'flights', 'house'].map((category_id) => ({ id: category_id, category_id, amount: 1 }))
    expect(pastPurchaseChanges(expenses, () => ({ category_id: 'dairy' }), c).changes.map((x) => x.expense.id)).toEqual(['house'])
  })

  it('a mapping row by id survives a MONEY rename; without one, an appliance follows the name (the old fallback)', () => {
    const renamed = money.map((x) => (x.id === 'kitchen' ? { ...x, name: 'Cucina' } : x))
    const kettle = { category_id: 'appliances', subcategory_id: 'appliances:kitchen' }
    expect(budgetCategoryFor(kettle, { ...c, expenseCategories: renamed, mapRows: [{ id: 'appliances:kitchen', expense_category_id: 'kitchen' }] })).toBe('kitchen')
    expect(budgetCategoryFor(kettle, { ...c, expenseCategories: renamed })).toBe('home')
    expect(budgetCategoryFor(kettle, c)).toBe('kitchen')
  })
})
