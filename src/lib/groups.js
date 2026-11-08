// Item groups are gone (plan 9N, round 6D stage 5): every item is a normal
// item with its own names. The columns pantry_items.is_group and group_id
// stay in the database (supabase/018), so an older version of the app still
// open on another phone keeps working and old backups still restore (K134).
// Such a version can still make a group ("Add group") until it is reloaded.
// This app then shows that row as an item tile with its own stored stock,
// never puts it on the SHOP list and never sends stock to it (K138); its
// variants (rows with its id as group_id) are normal items. "Merge other
// items into this one…" on the group row takes all its variants at once
// (K112, lib/itemNames.js mergeRows).

export const isGroup = (item) => Boolean(item?.is_group)

export function variantsOf(rows, groupId) {
  return rows.filter((r) => r.group_id === groupId)
}

// The grey note on a group row's tile (K138).
export const OLD_GROUP_NOTE = 'Item group from an older app version — merge its variants into it: Edit item → Merge other items into this one…'

// A group row still holding variants is never deleted: its variants would
// lose their group without being merged (K138 c).
export const groupDeleteText = (group) => `"${group.name}" still has variants — merge them into it first (Edit item → Merge other items into this one…), then delete it if you want.`

// A SHOP card linked to a group row (made by an older version of the app)
// can't be confirmed: the stock would go to the group row (K138 b).
export const oldGroupLineText = (group) => `"${group.name}" is an item group from an older app version and can't get stock — merge its variants into it first (Home → Edit item → Merge other items into this one…), or take this card out of the cart.`
