// "Newest first" for money lists: by the entry's own date first, and for
// entries on the same date by the time they were entered (the last one
// entered comes first). Pure, so it can be tested.

// When an entry was created, in milliseconds; null for rows that have no
// (or an unreadable) creation time.
export function enteredAt(entry) {
  const time = Date.parse(entry?.created_at)
  return Number.isNaN(time) ? null : time
}

// Later creation time first. A row with no time comes after rows that
// have one; two rows with none keep the order they already had (sorting
// is stable), so old rows never cause an error.
function laterEnteredFirst(a, b) {
  const [x, y] = [enteredAt(a), enteredAt(b)]
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return y - x
}

// A sort comparator: newest date first, then last entered first.
// `dateOf(entry)` gives 'YYYY-MM-DD'.
export const newestFirst = (dateOf) => (a, b) => String(dateOf(b) ?? '').localeCompare(String(dateOf(a) ?? '')) || laterEnteredFirst(a, b)

// The entries, newest first (the list given is left alone).
export const sortNewestFirst = (entries, dateOf) => [...entries].sort(newestFirst(dateOf))

// Compares two groups by their most recent entry, newest group first.
// `entriesOf(group)` gives the group's entries.
export const newestGroupFirst = (dateOf, entriesOf) => {
  const compare = newestFirst(dateOf)
  const newest = (group) => [...entriesOf(group)].sort(compare)[0]
  return (a, b) => compare(newest(a), newest(b))
}
