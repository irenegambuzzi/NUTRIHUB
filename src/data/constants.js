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

export const GROCERY_CATEGORIES = ['Kitchen', 'Beauty Care', 'Cleaning', 'Home']

export const PANTRY_CATEGORIES = ['Home', 'Kitchen', 'Bathroom']

// Where a bought grocery item lands in the pantry by default, and back.
export const GROCERY_TO_PANTRY_CATEGORY = {
  Kitchen: 'Kitchen',
  'Beauty Care': 'Bathroom',
  Cleaning: 'Home',
  Home: 'Home',
}

export const PANTRY_TO_GROCERY_CATEGORY = {
  Kitchen: 'Kitchen',
  Bathroom: 'Beauty Care',
  Home: 'Home',
}

export const UNIT_OPTIONS = ['pcs', 'g', 'kg', 'ml', 'l']

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
