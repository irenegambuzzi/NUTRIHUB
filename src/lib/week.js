// Returns the ISO Monday of the week containing `date` as a YYYY-MM-DD string.
export function getWeekStart(date = new Date()) {
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().slice(0, 10)
}

export function getCurrentWeekStart() {
  return getWeekStart(new Date())
}
