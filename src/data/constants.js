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

// Durable one-off purchases (oven, vacuum, laptop…): they can go on the
// grocery list, but never into the pantry, don't count towards the
// grocery budget, and are logged under this expense category (or its
// sub-category of the same name) instead of Groceries.
export const DURABLE_CATEGORY_IDS = ['appliances']
export const DURABLE_EXPENSE_CATEGORY = 'Home & Appliances'

// Removed categories that must never be offered again, even if a stale
// row is still in the database.
export const HIDDEN_CATEGORY_IDS = ['baby', 'automotive']

// Display names that differ from what an older database may still have.
export const CATEGORY_NAME_OVERRIDES = { 'personal-care': 'Beauty Care' }

export const PAID_BY_OPTIONS = [
  { value: 'irene', label: 'Irene' },
  { value: 'akbar', label: 'Akbar' },
  { value: 'shared', label: 'Shared' },
]

export const EXPENSE_PERIODS = ['week', 'month', 'year']

export const EXPENSE_PERIOD_LABELS = {
  week: 'This week',
  month: 'This month',
  year: 'This year',
}
