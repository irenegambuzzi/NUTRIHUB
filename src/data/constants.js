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
      { value: 'ea', label: 'each (ea)' },
      { value: 'pc', label: 'piece (pc)' },
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
    ],
  },
  { label: 'Weight', units: [{ value: 'g', label: 'gram (g)' }, { value: 'kg', label: 'kilogram (kg)' }] },
  { label: 'Volume', units: [{ value: 'ml', label: 'milliliter (ml)' }, { value: 'L', label: 'liter (L)' }] },
  { label: 'Length', units: [{ value: 'cm', label: 'centimeter (cm)' }, { value: 'm', label: 'meter (m)' }] },
]

export const UNIT_VALUES = UNIT_GROUPS.flatMap((g) => g.units.map((u) => u.value))

export const DEFAULT_UNIT = 'pc'

// Outer packaging a multipack comes in; stock is always counted in the
// item's base unit, so "2 case × 12 btl" is stored as 24 btl.
export const PACKAGING_UNITS = ['pack', 'box', 'case', 'carton', 'crate', 'bag']

export const PACK_SIZE_PRESETS = [6, 12, 24]

// Days before expiry that trigger a reminder.
export const EXPIRY_WARNING_DAYS = [30, 7]

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
