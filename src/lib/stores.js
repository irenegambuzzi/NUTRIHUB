import { NEW_ITEM_SINCE, RESTOCK_REASONS } from './newItems'
import { createTableStore, newestFirst, storeFamily } from './tableStore'
import { normalizeItem } from './inventory'
import { getPeriodRange } from './expensePeriods'
import { localDateString } from './week'

// The app's shared, live tables (see tableStore.js). The lists used
// around the house are also kept on the phone (`persist`), so they open
// without signal.

export const groceryStore = createTableStore({
  name: 'grocery_items',
  table: 'grocery_items',
  persist: 'grocery_items',
  query: (q) => q.order('created_at', { ascending: false }),
  normalize: normalizeItem,
  compare: newestFirst(),
})

export const pantryStore = createTableStore({
  name: 'pantry_items',
  table: 'pantry_items',
  persist: 'pantry_items',
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

// When items were bought or restocked since NEW_ITEM_SINCE: what ends an
// item's "New Item" label in HOME (see newItems.js).
export const restockLogStore = createTableStore({
  name: 'restock_logs',
  table: 'stock_logs',
  columns: 'id, item_id, reason, created_at',
  query: (q) => q.in('reason', RESTOCK_REASONS).gte('created_at', NEW_ITEM_SINCE).order('created_at').order('id'),
  paginate: true,
  accept: (row) => RESTOCK_REASONS.includes(row.reason) && row.created_at >= NEW_ITEM_SINCE,
})

export const inventoryCategoryStore = createTableStore({
  name: 'inventory_categories',
  table: 'inventory_categories',
  persist: 'inventory_categories',
  query: (q) => q.order('sort_order').order('name'),
  compare: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
})

// Categories chosen by hand for item names (supabase/011), shared by both
// phones and tried before the keyword list.
export const categoryMemoryStore = createTableStore({
  name: 'category_memory',
  table: 'category_memory',
  persist: 'category_memory',
  compare: (a, b) => a.id.localeCompare(b.id),
})

// The order of the shop for shopping mode (supabase/012).
export const shopOrderStore = createTableStore({
  name: 'shop_order',
  table: 'shop_order',
  persist: 'shop_order',
})

// Receipt photos (supabase/013), newest day first; loaded with Receipts.
export const receiptPhotoStore = createTableStore({
  name: 'receipt_photos',
  table: 'receipt_photos',
  query: (q) => q.order('receipt_date', { ascending: false }),
  compare: newestFirst('receipt_date'),
})

// Confirmed purchases (supabase/014), newest first, with what each did
// per item and their expenses; loaded with Receipts.
export const tripStore = createTableStore({
  name: 'shopping_trips',
  table: 'shopping_trips',
  query: (q) => q.order('trip_date', { ascending: false }),
  compare: newestFirst('trip_date'),
})

export const tripItemStore = createTableStore({
  name: 'shopping_trip_items',
  table: 'shopping_trip_items',
  query: (q) => q.order('position'),
  compare: (a, b) => (a.position ?? 0) - (b.position ?? 0),
})

export const tripExpenseStore = createTableStore({
  name: 'trip_expenses',
  table: 'expenses',
  query: (q) => q.not('trip_id', 'is', null),
  accept: (row) => row.trip_id != null,
})

export const expenseCategoryStore = createTableStore({
  name: 'expense_categories',
  table: 'expense_categories',
  persist: 'expense_categories',
  query: (q) => q.order('name'),
  compare: (a, b) => a.name.localeCompare(b.name),
})

// The Expenses page opens on this week, month or year, so it loads the
// expenses from the earliest of those (a week can start in December);
// looking further back loads from there (see `since` in useExpenses).
export function currentExpensesSince(now = new Date()) {
  const starts = ['week', 'month', 'year'].map((p) => getPeriodRange(p, now).start)
  return localDateString(new Date(Math.min(...starts)))
}

export const expensesSince = storeFamily((since) =>
  createTableStore({
    name: 'expenses',
    table: 'expenses',
    query: (q) => q.gte('expense_date', since).order('expense_date', { ascending: false }).order('id'),
    paginate: true,
    accept: (row) => row.expense_date >= since,
    compare: newestFirst('expense_date'),
  })
)

// Income (supabase/016), loaded from the same day as the expenses shown.
export const incomeSince = storeFamily((since) =>
  createTableStore({
    name: 'income',
    table: 'income',
    query: (q) => q.gte('income_date', since).order('income_date', { ascending: false }).order('id'),
    paginate: true,
    optional: true,
    accept: (row) => row.income_date >= since,
    compare: newestFirst('income_date'),
  })
)

export const allIncomeStores = () => [...incomeSince.all(), incomeUsageStore].filter((s) => s.isStarted())

// The saved color of each expense category (supabase/016).
export const categoryColorStore = createTableStore({
  name: 'expense_category_colors',
  table: 'expense_category_colors',
  persist: 'expense_category_colors',
  optional: true,
  compare: (a, b) => a.category_id.localeCompare(b.category_id),
})

// Income categories and their colors (supabase/017); until it has been
// run these are missing and income keeps its old Salary / Other type.
export const incomeCategoryStore = createTableStore({
  name: 'income_categories',
  table: 'income_categories',
  persist: 'income_categories',
  optional: true,
  query: (q) => q.order('name'),
  compare: (a, b) => a.name.localeCompare(b.name),
})

export const incomeCategoryColorStore = createTableStore({
  name: 'income_category_colors',
  table: 'income_category_colors',
  persist: 'income_category_colors',
  optional: true,
  compare: (a, b) => a.category_id.localeCompare(b.category_id),
})

// Which category each income entry is in, for the category manager's
// usage counts (all years); loaded when the manager opens.
export const incomeUsageStore = createTableStore({
  name: 'income',
  table: 'income',
  columns: 'id, category_id',
  optional: true,
})

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
  [...expensesSince.all(), ...expensesInCategory.all(), expenseUsageStore, tripExpenseStore].filter((s) => s.isStarted())

export const recipeStore = createTableStore({
  name: 'recipes',
  table: 'recipes',
  persist: 'recipes',
  query: (q) => q.order('created_at', { ascending: false }),
  compare: newestFirst(),
})

export const profileStore = createTableStore({
  name: 'profiles',
  table: 'profiles',
  persist: 'profiles',
  query: (q) => q.order('id'),
  compare: (a, b) => a.id.localeCompare(b.id),
})

// The first row is the household budget.
export const budgetStore = createTableStore({
  name: 'budget_settings',
  table: 'budget_settings',
  persist: 'budget_settings',
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
    persist: `meal_plan_entries:${keys}`,
    query: (q) => q.in('week_start', weekKeys),
    accept: (row) => weekKeys.includes(row.week_start),
  })
})
