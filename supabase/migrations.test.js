// Runs every migration in a real Postgres (PGlite) and checks the shopping
// trip functions from 014: confirming a cart all at once, sending the same
// confirmation twice, a confirmation that fails half way, and reopening.
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(import.meta.dirname)
let db
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]

beforeAll(async () => {
  db = new PGlite()
  // What Supabase provides that plain Postgres doesn't.
  await db.exec(`
    create role anon; create role authenticated;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('2d8a40ba-d751-4c22-9662-df3b758a4749'), ('99999999-9999-9999-9999-999999999999');
    grant usage on schema public, auth, storage to anon, authenticated;
  `)
  // 006 uses columns that 007 formally adds (they existed before 006 ran).
  // 015 (the login lock) is tested on its own at the end.
  const all = fs.readdirSync(dir).filter((f) => /^0\d\d_.*\.sql$/.test(f) && !f.startsWith('015')).sort()
  const order = ['schema.sql', ...all.filter((f) => f < '006'), ...all.filter((f) => f.startsWith('007')), ...all.filter((f) => f >= '006' && !f.startsWith('007'))]
  for (const f of order) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
}, 60000)

describe('migrations', () => {
  it('run in order, and again (safe to re-run)', async () => {
    for (const f of ['010_fresh_and_frozen_categories.sql', '011_category_memory.sql', '012_shop_order.sql', '013_receipt_photos.sql', '014_shopping_trips.sql']) {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    expect(Number((await one(`select count(*) from inventory_categories where id = 'frozen'`)).count)).toBe(1)
  })
})

describe('shopping trips', () => {
  let groceries, wine, milk, ids
  const add = async (name, qty, unit, price, pantry) =>
    (await one(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id) values ($1,$2,$3,$4,$2,$3,$5,true,'misc') returning id`, [name, qty, unit, price, pantry])).id
  const state = async () => ({
    wine: Number((await one(`select current_stock from pantry_items where id = $1`, [wine])).current_stock),
    milk: await one(`select current_stock::float as stock, expiry_date::text as expiry, payer from pantry_items where id = $1`, [milk]),
    avocados: (await q(`select current_stock::float as stock from pantry_items where name = 'Avocado'`)).map((r) => r.stock),
    logs: Number((await one(`select count(*) from stock_logs`)).count),
    expenses: await one(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total, min(expense_date)::text as date from expenses`),
    bought: Number((await one(`select count(*) from grocery_items where completed`)).count),
    inCart: Number((await one(`select count(*) from grocery_items where in_cart`)).count),
  })
  const payload = (id) => ({
    id,
    trip_date: '2026-10-03',
    photo_ids: [],
    items: [
      { grocery_item_id: ids.falanghina, line_total: 2.27, expense_category_id: groceries, pantry_item_id: wine, add: 1 },
      { grocery_item_id: ids.vermentino, line_total: 3.32, expense_category_id: groceries, pantry_item_id: wine, add: 1 },
      { grocery_item_id: ids.milk, line_total: 3.6, payer: 'irene', expense_category_id: groceries, pantry_item_id: milk, add: 3, discard_expired: true, expiry_date: '2026-10-20' },
      { grocery_item_id: ids.avocado1, line_total: 2.84, expense_category_id: groceries, pantry_item_id: null, add: 2 },
      { grocery_item_id: ids.avocado2, line_total: 1, expense_category_id: groceries, pantry_item_id: null, add: 1 },
    ],
  })
  let before

  beforeAll(async () => {
    groceries = (await one(`select id from expense_categories where name = 'Groceries'`)).id
    wine = (await one(`insert into pantry_items (name, unit, current_stock, category_id) values ('wine', 'pcs', 1, 'beverages') returning id`)).id
    milk = (await one(`insert into pantry_items (name, unit, current_stock, expiry_date, category_id) values ('Milk', 'btl', 2, '2020-01-01', 'dairy') returning id`)).id
    ids = {
      falanghina: await add('Falanghina', 1, 'pcs', 2.27, wine),
      vermentino: await add('Vermentino', 1, 'pcs', 3.32, wine),
      milk: await add('Milk', 3, 'btl', 3.6, milk),
      avocado1: await add('Avocado', 2, 'pcs', 2.84, null),
      avocado2: await add('Avocado', 1, 'pcs', 1, null),
    }
    before = await state()
  })

  const trip = '11111111-1111-1111-1111-111111111111'

  it('putting items in the cart changes nothing else', () => {
    expect(before).toMatchObject({ wine: 1, logs: 0, expenses: { n: 0 }, bought: 0, inCart: 5 })
  })

  it('confirms the whole cart at once', async () => {
    const t = await one(`select * from confirm_shopping_trip($1)`, [payload(trip)])
    expect(Number(t.total)).toBe(13.03)
    expect(await state()).toEqual({
      wine: 3,
      milk: { stock: 3, expiry: '2026-10-20', payer: 'irene' },
      avocados: [3], // one pantry item for both avocado lines
      logs: 6,
      expenses: { n: 5, total: 13.03, date: '2026-10-03' },
      bought: 5,
      inCart: 0,
    })
  })

  it('saves the same confirmation only once', async () => {
    const after = await state()
    await one(`select * from confirm_shopping_trip($1)`, [payload(trip)])
    expect(await state()).toEqual(after)
  })

  it('changes nothing when a confirmation fails half way', async () => {
    const after = await state()
    const bread = await add('Bread', 1, 'pcs', 1, null)
    await expect(
      one(`select * from confirm_shopping_trip($1)`, [
        {
          id: '22222222-2222-2222-2222-222222222222',
          trip_date: '2026-10-04',
          items: [
            { grocery_item_id: bread, line_total: 1, expense_category_id: groceries, add: 1 },
            { grocery_item_id: ids.falanghina, line_total: 2.27, expense_category_id: groceries, pantry_item_id: wine, add: 1 },
          ],
        },
      ])
    ).rejects.toThrow(/already bought/)
    expect(await state()).toEqual({ ...after, inCart: 1 })
    await q(`delete from grocery_items where id = $1`, [bread])
  })

  it('reopens a purchase exactly, and the items go back to the cart', async () => {
    expect((await one(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(5)
    expect(await state()).toEqual(before)
    expect((await one(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(0)
  })

  it('puts back an entry that was deleted after confirming', async () => {
    const again = '33333333-3333-3333-3333-333333333333'
    await one(`select * from confirm_shopping_trip($1)`, [payload(again)])
    await q(`delete from grocery_items where id = $1`, [ids.avocado1])
    await one(`select reopen_shopping_trip($1)`, [again])
    expect(await one(`select name, in_cart, completed, quantity::float as quantity from grocery_items where id = $1`, [ids.avocado1])).toEqual({
      name: 'Avocado',
      in_cart: true,
      completed: false,
      quantity: 2,
    })
    expect(await state()).toEqual(before)
  })
})

describe('a purchase edited on the confirm screen', () => {
  it('uses the edited price, quantity, payer and day for everything, and Reopen undoes it exactly', async () => {
    const groceries = (await one(`select id from expense_categories where name = 'Groceries'`)).id
    const juice = (await one(`insert into pantry_items (name, unit, current_stock, price, price_qty, price_unit, payer, category_id) values ('Juice', 'btl', 1, 1, 1, 'btl', 'shared', 'beverages') returning id`)).id
    // On the list: 1 btl at €1.
    const entry = (await one(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, payer, pantry_item_id, in_cart, category_id) values ('Juice', 1, 'btl', 1, 1, 'btl', 'shared', $1, true, 'beverages') returning id`, [juice])).id
    // Edited on the confirm screen: 2 btl for €2 in total, paid by Akbar —
    // saved to the entry, then confirmed with the same values.
    await q(`update grocery_items set quantity = 2, price = 2, price_qty = 2, price_unit = 'btl', payer = 'akbar' where id = $1`, [entry])
    const id = '44444444-4444-4444-4444-444444444444'
    await one(`select * from confirm_shopping_trip($1)`, [
      { id, trip_date: '2026-10-05', items: [{ grocery_item_id: entry, line_total: 2, payer: 'akbar', expense_category_id: groceries, pantry_item_id: juice, add: 2 }] },
    ])

    expect(await one(`select amount::float, paid_by, expense_date::text from expenses where trip_id = $1`, [id])).toEqual({ amount: 2, paid_by: 'akbar', expense_date: '2026-10-05' })
    expect(await one(`select current_stock::float, price::float, price_qty::float, payer from pantry_items where id = $1`, [juice])).toEqual({ current_stock: 3, price: 2, price_qty: 2, payer: 'akbar' })
    expect(await one(`select change::float, new_stock::float, reason from stock_logs where item_id = $1`, [juice])).toEqual({ change: 2, new_stock: 3, reason: 'purchased' })
    expect(await one(`select quantity::float, price::float, payer, completed from grocery_items where id = $1`, [entry])).toEqual({ quantity: 2, price: 2, payer: 'akbar', completed: true })
    expect(Number((await one(`select total from shopping_trips where id = $1`, [id])).total)).toBe(2)

    await one(`select reopen_shopping_trip($1)`, [id])
    expect(Number((await one(`select count(*) from expenses where trip_id = $1`, [id])).count)).toBe(0)
    expect(Number((await one(`select count(*) from stock_logs where item_id = $1`, [juice])).count)).toBe(0)
    expect(await one(`select current_stock::float, price::float, price_qty::float, payer from pantry_items where id = $1`, [juice])).toEqual({ current_stock: 1, price: 1, price_qty: 1, payer: 'shared' })
    // Back in the cart as edited, ready to confirm again.
    expect(await one(`select quantity::float, price::float, payer, completed, in_cart from grocery_items where id = $1`, [entry])).toEqual({ quantity: 2, price: 2, payer: 'akbar', completed: false, in_cart: true })
  })
})

describe('015: only the logged-in household can use the data', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const run = (file) => db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  // Runs fn as the app's anon key, or logged in as a user.
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const tryQuery = async (sql, params) => {
    try {
      return { rows: (await db.query(sql, params)).rows }
    } catch (error) {
      return { error: error.message }
    }
  }

  beforeAll(async () => {
    await run('015_lock_to_household.sql')
    await run('015_lock_to_household.sql') // safe to re-run
  })

  it('leaves nothing open to anon (the check at the end of the file)', async () => {
    const result = await db.query(fs.readFileSync(path.join(dir, '015_lock_to_household.sql'), 'utf8').split('-- ── 5. Check')[1].replace(/^[^\n]*\n/, ''))
    expect(result.rows[0]).toEqual({ tables_open_to_anon: 'none', functions_open_to_anon: 'none', policies_for_anon: 'none', tables_without_rls: 'none', members: 1 })
  })

  it('refuses the anon key: no reading, writing or functions', async () => {
    expect((await as('anon', null, () => tryQuery('select * from grocery_items'))).error).toMatch(/permission denied/)
    expect((await as('anon', null, () => tryQuery(`insert into pantry_items (name) values ('x')`))).error).toMatch(/permission denied/)
    expect((await as('anon', null, () => tryQuery(`select reopen_shopping_trip(gen_random_uuid())`))).error).toMatch(/permission denied/)
    expect((await as('anon', null, () => tryQuery(`select * from increment_stock(gen_random_uuid(), 1)`))).error).toMatch(/permission denied/)
  })

  it('lets the household account do everything', async () => {
    await as('authenticated', MEMBER, async () => {
      const item = (await db.query(`insert into pantry_items (name, unit, current_stock) values ('Lock test', 'pcs', 1) returning id`)).rows[0].id
      expect((await db.query(`select name from pantry_items where id = $1`, [item])).rows).toEqual([{ name: 'Lock test' }])
      expect(Number((await db.query(`select current_stock from increment_stock($1, 2)`, [item])).rows[0].current_stock)).toBe(3)
      await db.query(`update pantry_items set notes = 'ok' where id = $1`, [item])
      await db.query(`delete from pantry_items where id = $1`, [item])
      expect((await db.query(`select count(*)::int as n from pantry_items where id = $1`, [item])).rows[0].n).toBe(0)
    })
  })

  it('keeps out a logged-in user who is not in the household', async () => {
    await as('authenticated', STRANGER, async () => {
      expect((await db.query(`select count(*)::int as n from expense_categories`)).rows[0].n).toBe(0)
      expect((await tryQuery(`insert into pantry_items (name) values ('x')`)).error).toMatch(/row-level security/)
      expect((await tryQuery(`select reopen_shopping_trip(gen_random_uuid())`)).error).toMatch(/Not allowed/)
      expect((await tryQuery(`select * from apply_stock_change(gen_random_uuid(), gen_random_uuid(), 1, 'x')`)).error).toMatch(/Not allowed/)
    })
  })

  it('the rollback opens everything to anon again, as before 015', async () => {
    await run('015_ROLLBACK.sql')
    await run('015_ROLLBACK.sql') // safe to re-run
    const rows = (await as('anon', null, () => tryQuery('select count(*)::int as n from expense_categories'))).rows
    expect(rows[0].n).toBeGreaterThan(0)
    const item = (await as('anon', null, () => tryQuery(`insert into pantry_items (name, unit, current_stock) values ('After rollback', 'pcs', 1) returning id`))).rows[0].id
    expect(Number((await as('anon', null, () => tryQuery(`select current_stock from increment_stock($1, 1)`, [item]))).rows[0].current_stock)).toBe(2)
    // And 015 can be run again afterwards.
    await run('015_lock_to_household.sql')
    expect((await as('anon', null, () => tryQuery('select * from pantry_items'))).error).toMatch(/permission denied/)
  })
})

