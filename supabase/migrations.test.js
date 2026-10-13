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
  // 015 (the login lock) and 016 to 020 (which rely on it) are tested on their own at the end.
  const all = fs.readdirSync(dir).filter((f) => /^0\d\d_.*\.sql$/.test(f) && !f.startsWith('015') && !f.startsWith('016') && !f.startsWith('017') && !f.startsWith('018') && !f.startsWith('019') && !f.startsWith('020')).sort()
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

describe('a purchase partly deleted by hand', () => {
  let groceries, ids, trip
  const add = async (name, pantry) =>
    (await one(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id) values ($1, 2, 'pcs', 2, 2, 'pcs', $2, true, 'misc') returning id`, [name, pantry])).id

  beforeAll(async () => {
    groceries = (await one(`select id from expense_categories where name = 'Groceries'`)).id
    const tea = (await one(`insert into pantry_items (name, unit, current_stock, category_id) values ('Tea', 'pcs', 1, 'beverages') returning id`)).id
    const soap = (await one(`insert into pantry_items (name, unit, current_stock, category_id) values ('Soap', 'pcs', 5, 'toiletries') returning id`)).id
    ids = { tea, soap, teaEntry: await add('Tea', tea), soapEntry: await add('Soap', soap), newEntry: await add('Brand new thing', null) }
    trip = '55555555-5555-5555-5555-555555555555'
    await one(`select * from confirm_shopping_trip($1)`, [
      {
        id: trip,
        trip_date: '2026-10-06',
        items: [
          { grocery_item_id: ids.teaEntry, line_total: 2, expense_category_id: groceries, pantry_item_id: tea, add: 2 },
          { grocery_item_id: ids.soapEntry, line_total: 4, expense_category_id: groceries, pantry_item_id: soap, add: 2 },
          { grocery_item_id: ids.newEntry, line_total: 1, expense_category_id: groceries, pantry_item_id: null, add: 2 },
        ],
      },
    ])
    // By hand: the Tea pantry item and its history, the Soap expense, and
    // most of the Soap stock (used up).
    await q(`delete from stock_logs where item_id = $1`, [tea])
    await q(`delete from pantry_items where id = $1`, [tea])
    await q(`delete from expenses where trip_id = $1 and description = 'Soap'`, [trip])
    await q(`update pantry_items set current_stock = 1 where id = $1`, [soap])
  })

  it('shows what was deleted: the links are emptied', async () => {
    const rows = await q(`select name, expense_id is null as expense_gone, pantry_item_id is null as pantry_gone from shopping_trip_items where trip_id = $1 order by position`, [trip])
    expect(rows).toEqual([
      { name: 'Tea', expense_gone: false, pantry_gone: true },
      { name: 'Soap', expense_gone: true, pantry_gone: false },
      { name: 'Brand new thing', expense_gone: false, pantry_gone: false },
    ])
  })

  it('reopens without errors, undoing only what is left and never going below 0', async () => {
    expect((await one(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(3)
    // Soap: 1 left − 2 bought → 0, not −1.
    expect(Number((await one(`select current_stock from pantry_items where id = $1`, [ids.soap])).current_stock)).toBe(0)
    // Tea stays deleted (not made again); the new thing's pantry item goes.
    expect(Number((await one(`select count(*) from pantry_items where name in ('Tea', 'Brand new thing')`)).count)).toBe(0)
    expect(Number((await one(`select count(*) from expenses where trip_id = $1`, [trip])).count)).toBe(0)
    const back = await q(`select name, in_cart, completed from grocery_items where id = any($1) order by name`, [[ids.teaEntry, ids.soapEntry, ids.newEntry]])
    expect(back).toEqual([
      { name: 'Brand new thing', in_cart: true, completed: false },
      { name: 'Soap', in_cart: true, completed: false },
      { name: 'Tea', in_cart: true, completed: false },
    ])
  })

  it('"Delete record" removes only the record: stock and expenses stay, entries are unlinked', async () => {
    const record = '66666666-6666-6666-6666-666666666666'
    const entry = await add('Record only', null)
    await one(`select * from confirm_shopping_trip($1)`, [
      { id: record, trip_date: '2026-10-06', items: [{ grocery_item_id: entry, line_total: 3, expense_category_id: groceries, pantry_item_id: null, add: 2 }] },
    ])
    await q(`delete from shopping_trips where id = $1`, [record])
    expect(Number((await one(`select count(*) from shopping_trip_items where trip_id = $1`, [record])).count)).toBe(0)
    expect(await one(`select amount::float, trip_id from expenses where description = 'Record only'`)).toEqual({ amount: 3, trip_id: null })
    expect(Number((await one(`select current_stock from pantry_items where name = 'Record only'`)).current_stock)).toBe(2)
    expect(await one(`select completed, trip_id from grocery_items where id = $1`, [entry])).toEqual({ completed: true, trip_id: null })
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


describe('016: income and category colors, locked like the rest', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const run = (file) => db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  let before

  beforeAll(async () => {
    before = {
      expenses: (await db.query(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`)).rows[0],
      categories: (await db.query(`select count(*)::int as n from expense_categories`)).rows[0].n,
      policies: (await db.query(`select count(*)::int as n from pg_policies where tablename in ('expenses', 'expense_categories')`)).rows[0].n,
    }
    await run('016_income_and_category_colors.sql')
    await run('016_income_and_category_colors.sql') // safe to re-run
  })

  it('changes nothing that exists', async () => {
    const after = {
      expenses: (await db.query(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`)).rows[0],
      categories: (await db.query(`select count(*)::int as n from expense_categories`)).rows[0].n,
      policies: (await db.query(`select count(*)::int as n from pg_policies where tablename in ('expenses', 'expense_categories')`)).rows[0].n,
    }
    expect(after).toEqual(before)
  })

  it('leaves both new tables closed to anon, with the same policy as the others', async () => {
    const check = fs.readFileSync(path.join(dir, '016_income_and_category_colors.sql'), 'utf8').split('-- ── Check')[1].replace(/^[^\n]*\n/, '')
    expect((await db.query(check)).rows[0]).toEqual({ open_to_anon: 'none', locked_to_household: true })
    expect(await as('anon', null, () => fails('select * from income'))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails(`insert into income (amount) values (1)`))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails('select * from expense_category_colors'))).toMatch(/permission denied/)
    const policy = (t) => db.query(`select cmd, roles::text, qual, with_check from pg_policies where tablename = $1 and policyname = 'household_only'`, [t])
    expect((await policy('income')).rows).toEqual((await policy('expenses')).rows)
    expect((await policy('expense_category_colors')).rows).toEqual((await policy('expenses')).rows)
    expect((await db.query(`select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('income', 'expense_category_colors')`)).rows[0].n).toBe(2)
  })

  it('lets the household add, edit, delete and read income', async () => {
    await as('authenticated', MEMBER, async () => {
      const id = (await db.query(`insert into income (amount, income_type, received_by, source) values (1500, 'salary', 'irene', 'October salary') returning id`)).rows[0].id
      await db.query(`update income set amount = 1600, income_type = 'other' where id = $1`, [id])
      expect((await db.query(`select amount::float, income_type, received_by, source from income where id = $1`, [id])).rows).toEqual([
        { amount: 1600, income_type: 'other', received_by: 'irene', source: 'October salary' },
      ])
      await db.query(`delete from income where id = $1`, [id])
      expect((await db.query(`select count(*)::int as n from income`)).rows[0].n).toBe(0)
    })
  })

  it('rejects an amount of zero or an unknown type, and keeps out strangers', async () => {
    await as('authenticated', MEMBER, async () => {
      expect(await fails(`insert into income (amount) values (0)`)).toMatch(/check/)
      expect(await fails(`insert into income (amount, income_type) values (5, 'gift')`)).toMatch(/check/)
    })
    await as('authenticated', STRANGER, async () => {
      expect(await fails(`insert into income (amount) values (5)`)).toMatch(/row-level security/)
      expect(await fails(`insert into expense_category_colors (category_id, color) values (gen_random_uuid(), '#FFFFFF')`)).toMatch(/row-level security/)
    })
  })

  it('stores one color per category and drops it with the category', async () => {
    await as('authenticated', MEMBER, async () => {
      const cat = (await db.query(`insert into expense_categories (name) values ('Color test') returning id`)).rows[0].id
      await db.query(`insert into expense_category_colors (category_id, color) values ($1, '#F97316')`, [cat])
      expect(await fails(`insert into expense_category_colors (category_id, color) values ($1, '#3B82F6')`, [cat])).toMatch(/unique|duplicate/)
      expect(await fails(`insert into expense_category_colors (category_id, color) values ($1, 'orange')`, [cat])).toMatch(/check|unique|duplicate/)
      await db.query(`delete from expense_categories where id = $1`, [cat])
      expect((await db.query(`select count(*)::int as n from expense_category_colors`)).rows[0].n).toBe(0)
    })
  })
})

describe('017: income categories, locked like the rest', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const run = (file) => db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  let before

  beforeAll(async () => {
    // Income as it is today: entered before categories existed.
    await db.exec(`
      insert into income (amount, income_type, source) values (2000, 'salary', 'Old salary'), (150, 'other', 'Old refund'), (1800, 'salary', 'Older salary');
    `)
    before = {
      income: (await rows(`select count(*)::int as n, sum(amount)::float as total, sum(amount) filter (where income_type = 'salary')::float as salary from income`))[0],
      expenses: (await rows(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`))[0],
      policies: (await rows(`select count(*)::int as n from pg_policies where tablename in ('expenses', 'expense_categories', 'income')`))[0].n,
    }
    await run('017_income_categories.sql')
    await run('017_income_categories.sql') // safe to re-run
  })

  it('moves every existing income entry to Salary or Other and changes nothing else', async () => {
    const after = {
      income: (await rows(`select count(*)::int as n, sum(amount)::float as total, sum(amount) filter (where income_type = 'salary')::float as salary from income`))[0],
      expenses: (await rows(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`))[0],
      policies: (await rows(`select count(*)::int as n from pg_policies where tablename in ('expenses', 'expense_categories', 'income')`))[0].n,
    }
    expect(after).toEqual(before)
    expect(await rows(`select c.name, count(*)::int as n, sum(i.amount)::float as total from income i join income_categories c on c.id = i.category_id group by c.name order by c.name`)).toEqual([
      { name: 'Other', n: 1, total: 150 },
      { name: 'Salary', n: 2, total: 3800 },
    ])
    expect((await rows(`select count(*)::int as n from income_categories`))[0].n).toBe(2)
  })

  it('leaves the new tables closed to anon, with the same policy as the others, and the check says so', async () => {
    const check = fs.readFileSync(path.join(dir, '017_income_categories.sql'), 'utf8').split('-- ── Check')[1].replace(/^[^\n]*\n[^\n]*\n/, '')
    expect((await rows(check))[0]).toEqual({ open_to_anon: 'none', locked_to_household: true, starting_categories: true, entries_without_category: 0 })
    expect(await as('anon', null, () => fails('select * from income_categories'))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails('select * from income_category_colors'))).toMatch(/permission denied/)
    const policy = (t) => rows(`select cmd, roles::text, qual, with_check from pg_policies where tablename = $1 and policyname = 'household_only'`, [t])
    expect(await policy('income_categories')).toEqual(await policy('expenses'))
    expect(await policy('income_category_colors')).toEqual(await policy('expenses'))
    expect((await rows(`select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('income_categories', 'income_category_colors')`))[0].n).toBe(2)
  })

  it('lets the household add categories and sub-categories, and keeps out strangers', async () => {
    await as('authenticated', MEMBER, async () => {
      const main = (await rows(`insert into income_categories (name) values ('Freelance') returning id`))[0].id
      const sub = (await rows(`insert into income_categories (name, parent_id, type) values ('Design', $1, 'sub') returning id`, [main]))[0].id
      await db.query(`insert into income_category_colors (category_id, color) values ($1, '#F97316')`, [sub])
      const entry = (await rows(`insert into income (amount, income_type, category_id) values (80, 'other', $1) returning id`, [sub]))[0].id
      expect(await fails(`insert into income_categories (name) values ('Freelance')`)).toMatch(/unique|duplicate/)
      // Deleting a main category removes its sub-category and color; the entry stays, uncategorized.
      await db.query(`delete from income_categories where id = $1`, [main])
      expect((await rows(`select category_id from income where id = $1`, [entry]))[0].category_id).toBeNull()
      expect((await rows(`select count(*)::int as n from income_category_colors`))[0].n).toBe(0)
      await db.query(`delete from income where id = $1`, [entry])
    })
    await as('authenticated', STRANGER, async () => {
      expect(await fails(`insert into income_categories (name) values ('Nope')`)).toMatch(/row-level security/)
    })
  })

  it('renames and moves categories in place: same id, same color, same entries, no new rows (expenses and income)', async () => {
    await as('authenticated', MEMBER, async () => {
      for (const [table, colors, entries, entryTable] of [
        ['expense_categories', 'expense_category_colors', 'expenses', 'expenses'],
        ['income_categories', 'income_category_colors', 'income', 'income'],
      ]) {
        const col = table === 'expense_categories' ? { extra: '', vals: '' } : { extra: ", income_type", vals: ", 'other'" }
        const main = (await rows(`insert into ${table} (name) values ('Going Out X') returning id`))[0].id
        const alone = (await rows(`insert into ${table} (name) values ('Aperitivo X') returning id`))[0].id
        await db.query(`insert into ${colors} (category_id, color) values ($1, '#112233')`, [alone])
        await db.query(`insert into ${entryTable} (amount${col.extra}, category_id) values (12${col.vals}, $1), (8${col.vals}, $1)`, [alone])
        const count = async () => (await rows(`select (select count(*) from ${table})::int as c, (select count(*) from ${entryTable})::int as e`))[0]
        const before = await count()
        // Rename: only the name changes; a taken name is refused and changes nothing.
        await db.query(`update ${table} set name = 'Drinks X' where id = $1`, [alone])
        expect(await fails(`update ${table} set name = 'Going Out X' where id = $1`, [alone])).toMatch(/unique|duplicate/)
        // Move: a main category becomes a sub-category of another.
        await db.query(`update ${table} set parent_id = $2, type = 'sub' where id = $1`, [alone, main])
        const moved = (await rows(`select name, parent_id, type from ${table} where id = $1`, [alone]))[0]
        expect(moved).toEqual({ name: 'Drinks X', parent_id: main, type: 'sub' })
        expect(await count()).toEqual(before)
        expect((await rows(`select color from ${colors} where category_id = $1`, [alone]))[0].color).toBe('#112233')
        expect((await rows(`select count(*)::int as n, sum(amount)::float as t from ${entryTable} where category_id = $1`, [alone]))[0]).toEqual({ n: 2, t: 20 })
        // And back to a main category.
        await db.query(`update ${table} set parent_id = null, type = 'parent' where id = $1`, [alone])
        expect((await rows(`select parent_id, type from ${table} where id = $1`, [alone]))[0]).toEqual({ parent_id: null, type: 'parent' })
        expect((await rows(`select count(*)::int as n from ${entryTable} where category_id = $1`, [alone]))[0].n).toBe(2)
        await db.query(`delete from ${entryTable} where category_id = $1`, [alone])
        await db.query(`delete from ${table} where id in ($1, $2)`, [alone, main])
      }
    })
  })
})

describe('018: item groups', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const run = (file) => db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  let before

  beforeAll(async () => {
    await db.exec(`
      insert into pantry_items (name, unit, current_stock, min_stock, category_id) values
        ('Group test rice', 'gr', 1250.5, 500, 'pantry-staples'), ('Group test lays', 'pcs', 3, 1, 'snacks'), ('Group test empty', 'pcs', 0, 2, 'snacks');
    `)
    before = await rows(`select id, name, unit, current_stock::float as stock, min_stock::float as min, category_id, expiry_date, batch_lot from pantry_items order by id`)
    await run('018_item_groups.sql')
    await run('018_item_groups.sql') // safe to re-run
  })

  it('changes no existing item: same rows, same stock, nobody is a group or a variant', async () => {
    const after = await rows(`select id, name, unit, current_stock::float as stock, min_stock::float as min, category_id, expiry_date, batch_lot from pantry_items order by id`)
    expect(after).toEqual(before)
    expect((await rows(`select count(*)::int as n from pantry_items where is_group or group_id is not null`))[0].n).toBe(0)
  })

  it('ends with a check that says nothing changed and nothing is open to anon', async () => {
    const check = fs.readFileSync(path.join(dir, '018_item_groups.sql'), 'utf8')
    const result = (await db.exec(check)).at(-1).rows[0]
    expect(result).toEqual({ stock_changed: 0, items_lost: 0, groups_now: 0, variants_now: 0, columns: 2, open_to_anon: 'none', locked_to_household: true })
  })

  it('keeps pantry_items closed to anon, and open to the household only', async () => {
    expect(await as('anon', null, () => fails('select * from pantry_items'))).toMatch(/permission denied/)
    await as('authenticated', MEMBER, async () => {
      expect((await rows('select count(*)::int as n from pantry_items')).length).toBe(1)
    })
    expect(await as('authenticated', '99999999-9999-9999-9999-999999999999', async () => (await rows('select count(*)::int as n from pantry_items'))[0].n)).toBe(0)
  })

  it('holds a group and its variants; deleting a group never deletes the variants or their stock', async () => {
    await as('authenticated', MEMBER, async () => {
      const group = (await rows(`insert into pantry_items (name, unit, min_stock, is_group, category_id) values ('Chips & Snacks', 'pcs', 4, true, 'snacks') returning id`))[0].id
      const a = (await rows(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Lays', 'pcs', 3, $1, 'snacks') returning id`, [group]))[0].id
      await db.query(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Pringles', 'pcs', 2, $1, 'snacks')`, [group])
      expect((await rows(`select sum(current_stock)::float as total from pantry_items where group_id = $1`, [group]))[0].total).toBe(5)
      // A group inside a group, or an item as its own group, is refused.
      expect(await fails(`update pantry_items set group_id = $1 where id = $1`, [group])).toMatch(/pantry_items_group_shape/)
      expect(await fails(`insert into pantry_items (name, unit, is_group, group_id) values ('Nested', 'pcs', true, $1)`, [group])).toMatch(/pantry_items_group_shape/)
      // Taking a variant out gives back a normal item with its stock.
      await db.query(`update pantry_items set group_id = null where id = $1`, [a])
      expect((await rows(`select current_stock::float as stock, group_id from pantry_items where id = $1`, [a]))[0]).toEqual({ stock: 3, group_id: null })
      await db.query(`update pantry_items set group_id = $2 where id = $1`, [a, group])
      // Even a group deleted by force leaves its variants, unlinked, with their stock.
      await db.query(`delete from pantry_items where id = $1`, [group])
      expect((await rows(`select name, current_stock::float as stock, group_id from pantry_items where name in ('Lays', 'Pringles') order by name`))).toEqual([
        { name: 'Lays', stock: 3, group_id: null },
        { name: 'Pringles', stock: 2, group_id: null },
      ])
      await db.query(`delete from pantry_items where name in ('Lays', 'Pringles')`)
    })
  })
})

describe('019: stores ("Bought at") and orders', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const file = '019_stores_and_orders.sql'
  const run = () => db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  const snapshot = () => rows(`select id, amount::float as amount, category_id, description, paid_by, expense_date::text as date, created_at::text as created, trip_id from expenses order by id`)
  let before

  beforeAll(async () => {
    const groceries = (await rows(`select id from expense_categories where name = 'Groceries'`))[0].id
    await db.exec(`
      insert into expenses (category_id, amount, description, paid_by, expense_date) values
        ('${groceries}', 42.5, 'Weekly shop', 'shared', '2026-10-01'), ('${groceries}', 18.2, 'Market', 'irene', '2026-10-03'), (null, 9.99, 'No category', 'akbar', '2026-09-20');
    `)
    before = await snapshot()
  })

  it('changes no existing expense: same rows, amounts, categories, dates and total; every store empty', async () => {
    await run()
    await run() // safe to re-run
    expect(await snapshot()).toEqual(before)
    expect((await rows(`select count(*)::int as n, sum(amount)::float as total from expenses`))[0]).toEqual({ n: before.length, total: before.reduce((s, e) => s + e.amount, 0) })
    expect((await rows(`select count(*)::int as n from expenses where shop_id is not null`))[0].n).toBe(0)
  })

  it('ends with a check that says the expenses are untouched and nothing is open to anon', async () => {
    const result = (await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))).at(-1).rows[0]
    expect(result).toMatchObject({
      expenses_before: before.length,
      expenses_now: before.length,
      expenses_changed: 0,
      expenses_lost: 0,
      expenses_with_store: 0,
      open_to_anon: 'none',
      locked_to_household: true,
      realtime_on: true,
      new_columns: true,
    })
    expect(Number(result.total_before)).toBe(Number(result.total_now))
    expect(Number(result.total_now)).toBeCloseTo(before.reduce((s, e) => s + e.amount, 0), 2)
  })

  it('leaves both new tables closed to anon, with the same policy as the others', async () => {
    expect(await as('anon', null, () => fails('select * from shops'))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails('select * from orders'))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails(`insert into shops (name) values ('X')`))).toMatch(/permission denied/)
    const policy = (t) => rows(`select cmd, roles::text, qual, with_check from pg_policies where tablename = $1 and policyname = 'household_only'`, [t])
    expect(await policy('shops')).toEqual(await policy('expenses'))
    expect(await policy('orders')).toEqual(await policy('expenses'))
    expect(await as('authenticated', STRANGER, async () => {
      await fails(`select 1`)
      return rows(`select id from shops`)
    })).toEqual([])
    expect(await as('authenticated', STRANGER, () => fails(`insert into shops (name) values ('Sneaky')`))).toMatch(/row-level security/)
  })

  it('holds stores once per name; deleting a store keeps its expenses, with the store emptied', async () => {
    await as('authenticated', MEMBER, async () => {
      const zalando = (await rows(`insert into shops (name, is_online) values ('Zalando', true) returning id`))[0].id
      expect(await fails(`insert into shops (name) values ('zalando')`)).toMatch(/shops_name_key|duplicate/)
      expect(await fails(`insert into shops (name) values ('   ')`)).toMatch(/check/)
      const ids = (await rows(`select id from expenses order by id limit 2`)).map((r) => r.id)
      await db.query(`update expenses set shop_id = $1 where id = any($2)`, [zalando, ids])
      expect((await rows(`select count(*)::int as n from expenses where shop_id = $1`, [zalando]))[0].n).toBe(2)
      await db.query(`delete from shops where id = $1`, [zalando])
      expect((await rows(`select count(*)::int as n from expenses where shop_id is not null`))[0].n).toBe(0)
      expect(await snapshot()).toEqual(before)
    })
  })

  it('holds an order linked to one expense; the status, price and date range are checked', async () => {
    await as('authenticated', MEMBER, async () => {
      const shop = (await rows(`insert into shops (name, is_online) values ('Vinted', true) returning id`))[0].id
      const expense = (await rows(`insert into expenses (amount, description, paid_by, expense_date, shop_id) values (55, 'Winter jacket', 'irene', '2026-10-01', $1) returning id`, [shop]))[0].id
      const order = (await rows(
        `insert into orders (item_name, shop_id, order_date, price, paid_by, expected_date, expected_until, expense_id) values ('Winter jacket', $1, '2026-10-01', 55, 'irene', '2026-10-10', '2026-10-15', $2) returning id, status`,
        [shop, expense]
      ))[0]
      expect(order.status).toBe('on_the_way')
      expect(await fails(`insert into orders (item_name, price, expense_id) values ('Twin', 1, $1)`, [expense])).toMatch(/orders_expense_id_key|duplicate/)
      expect(await fails(`update orders set status = 'lost' where id = $1`, [order.id])).toMatch(/check/)
      expect(await fails(`update orders set price = -1 where id = $1`, [order.id])).toMatch(/check/)
      expect(await fails(`update orders set expected_until = '2026-10-05' where id = $1`, [order.id])).toMatch(/check/)
      // Deleting the expense keeps the order, with no expense; deleting the store keeps the order too.
      await db.query(`delete from expenses where id = $1`, [expense])
      expect((await rows(`select expense_id from orders where id = $1`, [order.id]))[0].expense_id).toBeNull()
      await db.query(`delete from shops where id = $1`, [shop])
      expect((await rows(`select shop_id, status from orders where id = $1`, [order.id]))[0]).toEqual({ shop_id: null, status: 'on_the_way' })
      await db.query(`delete from orders where id = $1`, [order.id])
      expect(await snapshot()).toEqual(before)
    })
  })
})

describe('020: orders can be returned, and remember what happened to the expense', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const file = '020_order_returned.sql'
  const read = () => fs.readFileSync(path.join(dir, file), 'utf8')
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  const orderSnapshot = () => rows(`select id, item_name, price::float as price, status, order_date::text as date, expected_date::text as expected, expense_id, arrived_date::text as arrived from orders order by id`)
  const expenseSnapshot = () => rows(`select id, amount::float as amount, category_id, description, paid_by, expense_date::text as date from expenses order by id`)
  let ordersBefore
  let expensesBefore
  let incomeCount

  beforeAll(async () => {
    await db.exec(`
      insert into orders (item_name, price, status, order_date, arrived_date) values
        ('Lamp', 25, 'on_the_way', '2026-10-01', null), ('Book', 15, 'arrived', '2026-09-01', '2026-09-10'), ('Shirt', 30, 'cancelled', '2026-08-01', null);
      insert into income (amount, income_date, income_type, received_by) values (1500, '2026-10-01', 'salary', 'irene');
    `)
    ordersBefore = await orderSnapshot()
    expensesBefore = await expenseSnapshot()
    incomeCount = (await rows(`select count(*)::int as n from income`))[0].n
  })

  it('changes no existing order, expense or income, and is safe to re-run', async () => {
    await db.exec(read())
    await db.exec(read())
    expect(await orderSnapshot()).toEqual(ordersBefore)
    expect(await expenseSnapshot()).toEqual(expensesBefore)
    expect((await rows(`select count(*)::int as n from orders where expense_outcome is not null`))[0].n).toBe(0)
  })

  it('ends with a check that says nothing changed, returned is allowed and nothing is open to anon', async () => {
    const result = (await db.exec(read())).at(-1).rows[0]
    expect(result).toMatchObject({
      orders_before: ordersBefore.length,
      orders_now: ordersBefore.length,
      orders_changed: 0,
      orders_lost: 0,
      expenses_before: expensesBefore.length,
      expenses_now: expensesBefore.length,
      expenses_changed: 0,
      expenses_lost: 0,
      income_before: incomeCount,
      income_now: incomeCount,
      income_changed: 0,
      income_lost: 0,
      returned_allowed: true,
      outcome_column: true,
      open_to_anon: 'none',
      locked_to_household: true,
    })
    expect(Number(result.expenses_total_before)).toBe(Number(result.expenses_total_now))
    expect(Number(result.income_total_before)).toBe(Number(result.income_total_now))
  })

  it('accepts returned and the two outcomes, still refuses anything else', async () => {
    const id = (await rows(`select id from orders where item_name = 'Lamp'`))[0].id
    expect(await fails(`update orders set status = 'returned', arrived_date = '2026-10-13', expense_outcome = 'deleted' where id = $1`, [id])).toBeNull()
    expect(await fails(`update orders set expense_outcome = 'kept' where id = $1`, [id])).toBeNull()
    expect(await fails(`update orders set status = 'lost' where id = $1`, [id])).toMatch(/check/)
    expect(await fails(`update orders set expense_outcome = 'maybe' where id = $1`, [id])).toMatch(/check/)
    await db.query(`update orders set status = 'on_the_way', arrived_date = null, expense_outcome = null where id = $1`, [id])
    expect(await orderSnapshot()).toEqual(ordersBefore)
  })

  it('keeps orders locked to the household', async () => {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
    await db.exec('set role anon')
    try {
      expect(await fails('select * from orders')).toMatch(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [MEMBER])
    await db.exec('set role authenticated')
    try {
      expect((await rows('select count(*)::int as n from orders'))[0].n).toBe(ordersBefore.length)
    } finally {
      await db.exec('reset role')
    }
  })
})
