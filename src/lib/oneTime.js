// One-time purchases ("1×"): something bought once and not kept in stock
// (a gift, sun cream for one holiday). It never goes on the SHOP list by
// itself, never turns yellow or red, and when it is used up it is
// "finished": hidden from the HOME grid and listed apart, never deleted, so
// buying it again by the same name brings the same item back. Finished is
// worked out, not stored. A group can never be 1× (supabase/023 refuses it);
// a variant inside a group can.

export const isOneTime = (item) => Boolean(item?.one_time) && !item?.is_group

export const isFinished = (item) => isOneTime(item) && (Number(item.current_stock) || 0) <= 0

// { active, finished }: the items HOME shows as usual, and the finished
// one-time items (A–Z) for the "Finished one-time items" section.
export function splitFinished(items) {
  const active = []
  const finished = []
  for (const item of items) (isFinished(item) ? finished : active).push(item)
  finished.sort((a, b) => a.name.localeCompare(b.name))
  return { active, finished }
}

// Whether a SHOP entry is for a one-time purchase: the HOME item's flag
// when it has one, else the entry's own (a new item not in HOME yet).
export const entryIsOneTime = (entry, pantry = null) => (pantry ? isOneTime(pantry) : Boolean(entry?.one_time))

// Whether a stock change just made an item finished.
export const becameFinished = (before, after) => !isFinished(before) && isFinished(after)
