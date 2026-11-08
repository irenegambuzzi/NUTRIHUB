// A small database kept in memory for the arrival tests (plan 9J): the
// tables the arrival touches, the query builder the app uses (select,
// insert, upsert, update, delete with eq / neq / is / in …) and the
// database functions arrive_order, unarrive_order (as supabase/021 writes
// them) and increment_stock. Deleting a HOME item unlinks what pointed to
// it, as the foreign keys do. Every call is kept in `calls`; `failWhen(call)`
// makes a call fail once it returns true (a dropped connection).
// `{ units: true }`: unarrive_order as supabase/031 replaces it — the
// arrival's stock converted from the unit of its own history row to the
// item's unit now, or not taken out at all when it can't be (plan 9M).
// save_item_names as supabase/032 writes a name's pack size (plan 9N).

const DEFAULTS = {
  orders: { status: 'on_the_way', stock_added: 0, arrived_item_id: null, arrived_log_id: null, arrived_date: null, pantry_item_id: null, grocery_item_id: null, pack_size: null, arrival_pack_before: null, group_id: null, group_share: 0 },
  pantry_items: { current_stock: 0, min_stock: 0, is_group: false, group_id: null, packaging_unit: null, quantity_per_pack: null, one_time: null, category_id: null },
  stock_logs: {},
  grocery_items: { completed: false, in_cart: false, auto_generated: false, pantry_item_id: null, trip_id: null, quantity: 1, unit: 'pcs' },
}

// supabase/031: the same unit → 1; kg ↔ gr, L ↔ ml; the item's usual pack.
function unitFactor031(from, pi) {
  if (!pi) return null
  if ((from ?? null) === (pi.unit ?? null)) return 1
  const metric = { 'kg>gr': 1000, 'L>ml': 1000, 'gr>kg': 0.001, 'ml>L': 0.001 }[`${from}>${pi.unit}`]
  if (metric) return metric
  return pi.packaging_unit === from && Number(pi.quantity_per_pack) > 0 ? Number(pi.quantity_per_pack) : null
}

const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b))
const round = (n) => Math.round(n * 100) / 100

export function arrivalDb({ units = false } = {}) {
  const tables = { orders: [], pantry_items: [], stock_logs: [], grocery_items: [], expenses: [], order_groups: [] }
  const calls = []
  let clock = Date.parse('2026-10-30T09:00:00Z')
  let seq = 0
  const db = {
    tables,
    calls,
    failWhen: () => false,
    // The next moment (one second later each time), as created_at.
    now: () => new Date((clock += 1000)).toISOString(),
    later: (ms) => (clock += ms),
    id: (prefix) => `${prefix}-${++seq}`,
    add(table, row) {
      const full = { id: db.id(table), created_at: db.now(), ...DEFAULTS[table], ...row }
      tables[table] = [...(tables[table] ?? []), full]
      return full
    },
    row: (table, id) => tables[table].find((r) => r.id === id) ?? null,
  }

  const removeItem = (id) => {
    for (const log of tables.stock_logs) if (log.item_id === id) log.item_id = null
    for (const g of tables.grocery_items) if (g.pantry_item_id === id) g.pantry_item_id = null
    for (const o of tables.orders) {
      if (o.pantry_item_id === id) o.pantry_item_id = null
      if (o.arrived_item_id === id) o.arrived_item_id = null
    }
  }

  const copy = (rows) => rows.map((r) => ({ ...r }))

  function run(call) {
    const list = tables[call.table] ?? []
    const matching = list.filter((r) => call.filters.every((f) => f(r)))
    if (call.op === 'select') return call.single ? { ...(matching[0] ?? {}), _none: !matching[0] } : copy(matching)
    if (call.op === 'insert') return call.rows.map((r) => db.add(call.table, r))
    if (call.op === 'upsert') {
      const out = []
      for (const r of call.rows) {
        const there = r.id && list.find((x) => x.id === r.id)
        if (there && call.options.ignoreDuplicates) continue
        if (there) out.push(Object.assign(there, r))
        else out.push(db.add(call.table, r))
      }
      return copy(out)
    }
    if (call.op === 'update') return copy(matching.map((r) => Object.assign(r, call.patch)))
    if (call.op === 'delete') {
      tables[call.table] = list.filter((r) => !matching.includes(r))
      if (call.table === 'pantry_items') matching.forEach((r) => removeItem(r.id))
      return copy(matching)
    }
    return []
  }

  function from(table) {
    const call = { table, op: 'select', filters: [], options: {} }
    const q = {
      select: () => q,
      insert: (rows) => ((call.op = 'insert'), (call.rows = rows), q),
      upsert: (rows, options = {}) => ((call.op = 'upsert'), (call.rows = [rows].flat()), (call.options = options), q),
      update: (patch) => ((call.op = 'update'), (call.patch = patch), q),
      delete: () => ((call.op = 'delete'), q),
      eq: (col, val) => (call.filters.push((r) => same(r[col], val)), q),
      neq: (col, val) => (call.filters.push((r) => !same(r[col], val)), q),
      is: (col, val) => (call.filters.push((r) => (r[col] ?? null) === val), q),
      in: (col, vals) => (call.filters.push((r) => vals.some((v) => same(r[col], v))), q),
      gte: (col, val) => (call.filters.push((r) => r[col] >= val), q),
      lte: (col, val) => (call.filters.push((r) => r[col] <= val), q),
      not: () => q,
      order: () => q,
      range: () => q,
      limit: () => q,
      maybeSingle: () => ((call.single = true), q),
      then: (resolve, reject) => {
        calls.push(call)
        if (db.failWhen(call)) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(resolve, reject)
        const data = run(call)
        if (call.single) {
          const { _none, ...row } = data
          return Promise.resolve({ data: _none ? null : row, error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return q
  }

  // supabase/021 arrive_order: only an order on the way; the stock and its
  // "purchased" history row in the same step.
  function arriveOrder({ order_id, item_id, add_qty, arrived_on }) {
    const o = db.row('orders', order_id)
    if (!o) throw new Error('This order was deleted meanwhile.')
    if (o.status !== 'on_the_way') return { order: { ...o }, added: false }
    let add = Number(add_qty) || 0
    let log = null
    if (item_id && add > 0) {
      const pi = db.row('pantry_items', item_id)
      if (!pi) throw new Error('The item for this order was deleted meanwhile.')
      if (pi.is_group) throw new Error(`Pick which variant of "${pi.name}" arrived.`)
      pi.current_stock = round((Number(pi.current_stock) || 0) + add)
      pi.last_purchased_at = db.now()
      log = db.add('stock_logs', { item_id: pi.id, item_name: pi.name, change: add, new_stock: pi.current_stock, unit: pi.unit, reason: 'purchased' }).id
    } else add = 0
    Object.assign(o, { status: 'arrived', arrived_date: arrived_on, stock_added: add, arrived_item_id: add > 0 ? item_id : null, arrived_log_id: log })
    const entry = o.grocery_item_id && db.row('grocery_items', o.grocery_item_id)
    if (entry) Object.assign(entry, { completed: true, in_cart: false })
    return { order: { ...o }, added: true }
  }

  function unarriveOrder({ order_id }) {
    const o = db.row('orders', order_id)
    if (!o) throw new Error('This order was deleted meanwhile.')
    if (o.status !== 'arrived') return { ...o }
    if (o.arrived_item_id && o.stock_added > 0) {
      const pi = db.row('pantry_items', o.arrived_item_id)
      const factor = units ? unitFactor031(db.row('stock_logs', o.arrived_log_id)?.unit ?? pi?.unit, pi) : 1
      if (pi && factor != null) pi.current_stock = round(Math.max(0, (Number(pi.current_stock) || 0) - o.stock_added * factor))
    }
    if (o.arrived_log_id) tables.stock_logs = tables.stock_logs.filter((l) => l.id !== o.arrived_log_id)
    Object.assign(o, { status: 'on_the_way', arrived_date: null, stock_added: 0, arrived_item_id: null, arrived_log_id: null })
    const entry = o.grocery_item_id && db.row('grocery_items', o.grocery_item_id)
    if (entry && !entry.trip_id) entry.completed = false
    return { ...o }
  }

  function incrementStock({ item_id, delta }) {
    const pi = db.row('pantry_items', item_id)
    if (!pi) return null
    pi.current_stock = round(Math.max(0, (Number(pi.current_stock) || 0) + Number(delta)))
    return { ...pi }
  }

  // supabase/032 save_item_names, the parts the app sends from an arrival
  // (plan 9N, K90 + K95): `edit` of a name's pack size, guarded by `was`;
  // already as asked → nothing written; a size changed by hand clears
  // pack_by_trip. Names compared with capitals and outer spaces ignored.
  function saveItemNames({ payload }) {
    const pi = db.row('pantry_items', payload.item_id)
    if (!pi) throw new Error('This item was deleted meanwhile — open it again. Nothing was changed.')
    const key = (name) => String(name ?? '').trim().toLowerCase()
    const names = pi.names ?? []
    const asked = [...(payload.add ?? []), ...(payload.edit ?? [])]
    const holds = (n, a) => Object.entries(a).every(([k, v]) => same(n[k], v))
    if (!asked.some((a) => !names.some((n) => holds(n, a))) && !(payload.remove ?? []).some((r) => names.some((n) => key(n.name) === key(r)))) return { ...pi }
    if (JSON.stringify(names) !== JSON.stringify(payload.was?.names ?? null)) throw new Error(`"${pi.name}" changed meanwhile (on the other phone?) — open it again. Nothing was changed.`)
    let next = names.filter((n) => !(payload.remove ?? []).some((r) => key(r) === key(n.name)))
    for (const e of payload.edit ?? []) {
      const fields = Object.fromEntries(Object.entries(e).filter(([k]) => ['packaging_unit', 'quantity_per_pack', 'price', 'price_qty', 'price_unit'].includes(k)))
      if ('packaging_unit' in fields || 'quantity_per_pack' in fields) fields.pack_by_trip = null
      next = next.map((n) => (key(n.name) === key(e.name) ? { ...n, ...fields } : n))
    }
    for (const a of payload.add ?? []) next = [...next, { ...a, from_item_id: null, origin: null, added_at: db.now(), added_by_trip: null, pack_by_trip: null }]
    pi.names = next
    return { ...pi }
  }

  const functions = { arrive_order: arriveOrder, unarrive_order: unarriveOrder, increment_stock: incrementStock, save_item_names: saveItemNames }
  // A test may add a function of its own (e.g. a merge with fixed results).
  db.functions = functions

  db.supabase = {
    from,
    rpc: (name, args) => {
      const call = { op: 'rpc', name, args, filters: [] }
      calls.push(call)
      if (db.failWhen(call)) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
      try {
        return Promise.resolve({ data: functions[name]?.(args) ?? null, error: null })
      } catch (error) {
        return Promise.resolve({ data: null, error: { message: error.message, ...(error.code ? { code: error.code } : {}) } })
      }
    },
    channel: () => ({
      on() {
        return this
      },
      subscribe() {
        return this
      },
    }),
  }
  return db
}
