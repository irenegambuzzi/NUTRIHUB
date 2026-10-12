// "Dismiss for today" on the orders reminder: the day it was dismissed is
// kept on this device (each phone decides for itself).

const KEY = 'nutrihub.orderRemindersDismissed'

export function dismissedToday(today) {
  try {
    return localStorage.getItem(KEY) === today
  } catch {
    return false
  }
}

export function dismissForToday(today) {
  try {
    localStorage.setItem(KEY, today)
  } catch {
    // Not remembered (private window, blocked storage): hidden until reload.
  }
}
