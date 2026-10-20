import { supabase } from './supabaseClient'
import { LEGACY_UNITS } from '../data/constants'
import { normName } from './grocery'

// The last NORMAL price paid for a name, and the unit it was bought in, so
// a form can fill them in (editable). "Normal" = before any discount:
// `list_total` of a purchase line when it has one (round 6 stores it), else
// `line_total`; `list_price` of an order, else `price`. The store is never
// filled.
//
// Sources, the most recent wins:
//   trip         a purchase line with that name (SHOP or MONEY): the price of
//                its `quantity` + `unit` (older SHOP lines keep them in
//                grocery_snapshot)
//   order        an online order for the name
//   pantry       the HOME item with the name: price per price_qty price_unit
// → { price, quantity, unit, source, at } | null — `price` is for
// `quantity` × `unit`.

const when = (value) => {
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

const cleanUnit = (unit) => LEGACY_UNITS[unit] ?? unit
const positive = (n) => (Number(n) > 0 ? Number(n) : null)

function fromTripLine(line) {
  const price = positive(line.list_total) ?? positive(line.line_total)
  const quantity = positive(line.quantity) ?? positive(line.grocery_snapshot?.quantity) ?? 1
  const unit = line.unit || line.grocery_snapshot?.unit
  return price && unit ? { price, quantity, unit: cleanUnit(unit), source: 'trip', at: when(line.created_at) } : null
}

function fromOrder(order) {
  const price = positive(order.list_price) ?? positive(order.price)
  const quantity = positive(order.quantity)
  return price && quantity && order.unit && order.status !== 'cancelled' ? { price, quantity, unit: cleanUnit(order.unit), source: 'order', at: when(order.created_at ?? order.order_date) } : null
}

function fromPantry(item) {
  const price = positive(item.price)
  if (!price) return null
  return { price, quantity: positive(item.price_qty) ?? 1, unit: cleanUnit(item.price_unit || item.unit), source: 'pantry', at: when(item.updated_at ?? item.created_at) }
}

export function lastPriceFor(name, { tripLines = [], orders = [], pantryItems = [] } = {}) {
  const key = normName(name)
  if (!key) return null
  const found = [
    ...tripLines.filter((l) => normName(l.name) === key).map(fromTripLine),
    ...orders.filter((o) => normName(o.item_name) === key).map(fromOrder),
    ...pantryItems.filter((p) => !p.is_group && normName(p.name) === key).map(fromPantry),
  ].filter(Boolean)
  if (!found.length) return null
  return found.reduce((a, b) => (b.at > a.at ? b : a))
}

// "Nutella" matched case-insensitively and exactly; % and _ are plain
// letters here.
const likeExact = (name) => name.trim().replace(/[\\%_]/g, (c) => `\\${c}`)

// The newest purchase lines with this name, from the database (the phone
// keeps no copy of every purchase). [] when offline or on any error:
// the other sources still fill in.
export async function fetchTripLines(name) {
  if (!normName(name)) return []
  try {
    const { data, error } = await supabase
      .from('shopping_trip_items')
      .select('name, line_total, list_total, quantity, unit, grocery_snapshot, created_at')
      .ilike('name', likeExact(name))
      .order('created_at', { ascending: false })
      .limit(3)
    return error ? [] : data ?? []
  } catch {
    return []
  }
}
