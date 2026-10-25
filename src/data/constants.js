export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const WEEKDAY_SHORT_LABELS = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

export const MEAL_TYPE_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

export const MEAL_TYPE_CALORIE_SHARE = {
  breakfast: 0.25,
  lunch: 0.37,
  dinner: 0.38,
}

// Metric and count units only — no US/Imperial (oz, lb, cup, ...).
export const UNIT_GROUPS = [
  {
    label: 'Count',
    units: [
      { value: 'pcs', label: 'pieces (pcs)' },
      { value: 'pack', label: 'pack' },
      { value: 'box', label: 'box' },
      { value: 'btl', label: 'bottle (btl)' },
      { value: 'can', label: 'can' },
      { value: 'jar', label: 'jar' },
      { value: 'tube', label: 'tube' },
      { value: 'sachet', label: 'sachet' },
      { value: 'roll', label: 'roll' },
      { value: 'sheet', label: 'sheet' },
      { value: 'tablet', label: 'tablet' },
      { value: 'capsule', label: 'capsule' },
      { value: 'set', label: 'set' },
      { value: 'pair', label: 'pair' },
      { value: 'shaker', label: 'shaker' },
    ],
  },
  { label: 'Weight', units: [{ value: 'gr', label: 'gram (gr)' }, { value: 'kg', label: 'kilogram (kg)' }] },
  { label: 'Volume', units: [{ value: 'ml', label: 'milliliter (ml)' }, { value: 'L', label: 'liter (L)' }] },
]

export const UNIT_VALUES = UNIT_GROUPS.flatMap((g) => g.units.map((u) => u.value))

export const DEFAULT_UNIT = 'pcs'

// Older spellings still in the database (or in imported files) and the
// unit they now mean.
export const LEGACY_UNITS = {
  g: 'gr',
  G: 'gr',
  gram: 'gr',
  grams: 'gr',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  ea: 'pcs',
  l: 'L',
  lt: 'L',
  KG: 'kg',
  Kg: 'kg',
  ML: 'ml',
  Ml: 'ml',
  mL: 'ml',
}

// Outer packaging a multipack comes in; stock is always counted in the
// item's base unit, so "2 case × 12 btl" is stored as 24 btl.
export const PACKAGING_UNITS = ['pack', 'box', 'case', 'carton', 'crate', 'bag']

export const PACK_SIZE_PRESETS = [6, 12, 24]

// Units that are usual for each parent category. Anything else still
// saves, it just shows a warning.
export const SUGGESTED_UNITS = {
  beverages: ['btl', 'can', 'ml', 'L'],
  'pantry-staples': ['gr', 'kg', 'pack', 'pcs', 'jar', 'btl', 'shaker'],
  meat: ['gr', 'kg', 'pack', 'pcs'],
  canned: ['can', 'jar', 'pack'],
  snacks: ['pack', 'pcs', 'box'],
  cleaning: ['btl', 'pack', 'pcs'],
  laundry: ['pack', 'btl', 'pcs'],
  toiletries: ['pcs', 'pack', 'btl'],
  'personal-care': ['pcs', 'btl', 'tube'],
  baby: ['pack', 'pcs', 'gr', 'jar', 'btl'],
  health: ['pcs', 'tablet', 'capsule'],
  pet: ['pack', 'can', 'pcs'],
  household: ['pcs', 'pack', 'roll'],
  misc: ['pcs', 'pack'],
  appliances: ['pcs', 'set', 'box', 'pack'],
  produce: ['gr', 'kg', 'pcs', 'pack'],
  dairy: ['pcs', 'pack', 'btl', 'L', 'ml', 'gr', 'kg', 'jar'],
  bakery: ['pcs', 'pack', 'gr', 'kg'],
  deli: ['gr', 'kg', 'pack', 'pcs'],
  frozen: ['pack', 'box', 'pcs', 'gr', 'kg'],
}

// Durables — things bought once and kept (oven, laptop, towel, sandals,
// cat toys…): the HOME main `appliances` ("Durables" since 026) and every
// sub-category under it. They can go on the grocery list, but never into
// HOME stock, don't count towards the grocery budget, and are booked by
// their sub-category's mapping row, else under this expense category (or
// its sub-category of the same name) instead of Groceries. A durable
// budget category locks too (DURABLE_MONEY_CATEGORY_IDS below), and so
// does a service one (SERVICE_MONEY_CATEGORY_IDS).
export const DURABLE_CATEGORY_IDS = ['appliances']
export const DURABLE_EXPENSE_CATEGORY = 'Home & Appliances'

// The MONEY main category for trips (now "Trips & Holidays"). Found by id,
// never by name, so it can be renamed freely; it can't be moved under
// another main or deleted. Round 7 may move this id to household_settings.
export const TRIPS_CATEGORY_ID = 'dc79f604-19fd-4bdd-817e-335816c4afe7'

// MONEY categories the durable lock and the purpose words use, by id
// (any name; plan 9F, supabase/026_durable_lock.sql). A main covers all
// its sub-categories, also ones made later.
export const WORK_CATEGORY_ID = '6faa75ea-ece5-40c9-9e44-75785f59568e' // Work (main, new in 026)
export const FAMILY_SUPPORT_CATEGORY_ID = '54c1355d-5ebb-4237-ae67-1be0ca593443' // Family Support (main, 024)
export const GIFTS_CATEGORY_ID = '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c' // Shopping › Gifts

// Bought with one of these budget categories, a thing is durable: "Add to
// HOME" is off and locked, whatever its HOME category. Not Work (a work
// laptop is locked because a laptop is durable; printer ink for work may
// go into HOME) and not Health › Glasses & Lenses (contact lenses are
// bought again; glasses are locked by HOME Durables › Glasses).
export const DURABLE_MONEY_CATEGORY_IDS = [
  '199ec782-505a-4292-984e-08ae1d76469f', // Home & Appliances (main)
  '654a80a3-2e6f-4ada-b214-0486d91d869c', // Shopping (main)
  'd0c05f29-1418-485f-9433-b4b0e97c2423', // Pets › Pet Accessories & Toys
  'a972798e-d08c-4b09-b8cf-cfe5c1724128', // Trips & Holidays › Souvenirs
  FAMILY_SUPPORT_CATEGORY_ID, // Family Support (main)
]

// Services and subscriptions (decision 14b): never HOME stock either, so
// they lock "Add to HOME" the same way, with their own note. Car / Vehicle
// only by its four subs, never the main: HOME Household Supplies › Car
// Care (car shampoo, windscreen fluid) is mapped to the main and stays a
// consumable.
export const SERVICE_MONEY_CATEGORY_IDS = [
  '688bfedf-8e4c-4b59-860f-3a55c33f50d1', // Subscription (main)
  '88ea2c65-397a-4774-b4de-22886f397cf5', // Housing & Utilities (main)
  '676901e2-4693-47cb-93e4-b071a8eac8f3', // Going out (main)
  'b498cc5d-95ea-4666-89f2-11973222ec2c', // Bank & Fee (main)
  '7d2a77f8-a5ff-4846-9021-143757927bb2', // Savings & Investments (main)
  '744f7d8e-c90d-49d3-ad03-72c6e81aad9d', // Entertainment (main)
  'cd1ec5e6-4c7e-4f38-a86f-e6d1e42b10f5', // Health › Doctor & Tests
  '3bbb8479-42e4-4f40-b9fb-bacc5d586128', // Health › Dentist
  'd3728a31-bd77-487d-ac80-aaffe90fa5f3', // Personal Care › Hairdresser
  'b79bd43a-bfa9-4101-93d7-70468af9dcfd', // Pets › Veterinary
  '9d61caa3-80c5-4104-a734-51deca1f19ed', // Pets › Pet Sitting
  '6aedf34e-9f47-48e9-a5ca-7b8b529fa447', // Car / Vehicle › Fuel
  '1fe3c787-1e67-4e31-86a1-d6114f2ef473', // Car / Vehicle › Maintenance
  '90065703-c0e7-436e-9ba3-2992dc819c7c', // Car / Vehicle › Insurance & Tax
  'e6ce7094-0f5c-49f7-aff4-78e2b9f2e494', // Car / Vehicle › Parking & Tolls
]

// Budget categories chosen for what the money was FOR (family, work, a
// gift): a name with such a word fills them in even when "Add to HOME" is
// on (lib/moneyPurchase.js budgetOf).
export const PURPOSE_BUDGET_IDS = [FAMILY_SUPPORT_CATEGORY_ID, WORK_CATEGORY_ID, GIFTS_CATEGORY_ID]

// Expenses in these were put there on purpose: "Apply the mapping to past
// purchases" never moves them (lib/budgetMap.js).
export const CHOSEN_ON_PURPOSE_IDS = [WORK_CATEGORY_ID, FAMILY_SUPPORT_CATEGORY_ID, TRIPS_CATEGORY_ID]

// Removed categories that must never be offered again, even if a stale
// row is still in the database. "+ New category" never gives a new
// category one of these ids. ("baby" was here until round 6C: the HOME
// main "Baby" now uses that id again, see supabase/024_categories.sql.)
export const HIDDEN_CATEGORY_IDS = ['automotive']

// Display names that differ from what an older database may still have.
// Used only while the stored name is still the original one below: once
// someone renames the category in Manage, their name is shown.
export const CATEGORY_NAME_OVERRIDES = { 'personal-care': 'Beauty Care' }
export const CATEGORY_ORIGINAL_NAMES = { 'personal-care': 'Personal Care & Beauty' }

export const PAID_BY_OPTIONS = [
  { value: 'irene', label: 'Irene' },
  { value: 'akbar', label: 'Akbar' },
  { value: 'shared', label: 'Shared' },
]

export const EXPENSE_PERIODS = ['week', 'month', '3months', '6months', 'year']

export const EXPENSE_PERIOD_LABELS = {
  week: 'Week',
  month: 'Month',
  '3months': '3 Months',
  '6months': '6 Months',
  year: 'Year',
}
