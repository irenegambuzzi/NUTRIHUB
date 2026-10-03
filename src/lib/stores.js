import { createTableStore, newestFirst, storeFamily } from './tableStore'
import { normalizeItem } from './inventory'
import { getPeriodRange } from './expensePeriods'
import { localDateString } from './week'

// The app's shared, live tables (see tableStore.js).

export const groceryStore = createTableStore({
  name: 'grocery_items',
  table: 'grocery_items',
  query: (q) => q.order('created_at', { ascending: false }),
  normalize: normalizeItem,
  compare: newestFirst(),
})

export const pantryStore = createTableStore({
  name: 'pantry_items',
  table: 'pantry_items',
  query: (q) => q.order('created_at', { ascending: false }),
  normalize: normalizeItem,
  compare: newestFirst(),
})

// The history view shows the latest 1000 changes.
const STOCK_LOG_LIMIT = 1000
export const stockLogStore = createTableStore({
  name: 'stock_logs',
  table: 'stock_logs',
  query: (q) => q.order('created_at', { ascending: false }).limit(STOCK_LOG_LIMIT),
  compare: newestFirst(),
  limit: STOCK_LOG_LIMIT,
})

export const inventoryCategoryStore = createTableStore({
  name: 'inventory_categories',
  table: 'inventory_categories',
  query: (q) => q.order('sort_order').order('name'),
  compare: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
})

export const expenseCategoryStore = createTableStore({
  name: 'expense_categories',
  table: 'expense_categories',
  query: (q) => q.order('name'),
  compare: (a, b) => a.name.localeCompare(b.name),
})

// The Expenses page only shows this week, month or year, so it loads the
// expenses from the earliest of those (a week can start in December).
export function currentExpensesSince(now = new Date()) {
  const starts = ['week', 'month', 'year'].map((p) => getPeriodRange(p, now).start)
  return localDateString(new Date(Math.min(...starts)))
}

export const expensesSince = storeFamily((since) =>
  createTableStore({
    name: 'expenses',
    table: 'expenses',
    query: (q) => q.gte('expense_date', since).order('expense_date', { ascending: false }),
    accept: (row) => row.expense_date >= since,
    compare: newestFirst('expense_date'),
  })
)

// Receipts: every expense in one category (Groceries), loaded only when
// the Receipts view is opened.
export const expensesInCategory = storeFamily((categoryId) =>
  createTableStore({
    name: 'receipts',
    table: 'expenses',
    query: (q) => q.eq('category_id', categoryId).order('expense_date', { ascending: false }),
    accept: (row) => row.category_id === categoryId,
    compare: newestFirst('expense_date'),
  })
)

// Just which category each expense is in, for the category manager's
// usage counts (all years); loaded when the manager opens.
export const expenseUsageStore = createTableStore({
  name: 'expenses',
  table: 'expenses',
  columns: 'id, category_id',
})

// Every expense store in use, so a write can update all of them.
export const allExpenseStores = () =>
  [...expensesSince.all(), ...expensesInCategory.all(), expenseUsageStore].filter((s) => s.isStarted())

export const recipeStore = createTableStore({
  name: 'recipes',
  table: 'recipes',
  query: (q) => q.order('created_at', { ascending: false }),
  compare: newestFirst(),
})

export const profileStore = createTableStore({
  name: 'profiles',
  table: 'profiles',
  query: (q) => q.order('id'),
  compare: (a, b) => a.id.localeCompare(b.id),
})

// The first row is the household budget.
export const budgetStore = createTableStore({
  name: 'budget_settings',
  table: 'budget_settings',
  query: (q) => q.order('created_at'),
  compare: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
})

// One week of meal plans (both people), keyed by its week_start values
// joined with ",".
export const mealPlanWeek = storeFamily((keys) => {
  const weekKeys = keys.split(',')
  return createTableStore({
    name: 'meal_plan_entries',
    table: 'meal_plan_entries',
    query: (q) => q.in('week_start', weekKeys),
    accept: (row) => weekKeys.includes(row.week_start),
  })
})
