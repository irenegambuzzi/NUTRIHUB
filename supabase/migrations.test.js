// Runs every migration in a real Postgres (PGlite) and checks the shopping
// trip functions from 014: confirming a cart all at once, sending the same
// confirmation twice, a confirmation that fails half way, and reopening.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

// The app's own payload for a purchase typed in MONEY (round 4), sent to
// the real function below.
vi.mock('../src/lib/supabaseClient', () => ({ supabase: {} }))
const { emptyRow, listEntryFor, moneyPurchasePayload, pricedLines, rowLine } = await import('../src/lib/moneyPurchase.js')
// For 025: the remembered-name keys and "Apply the mapping to past purchases", as the app works them out.
const { normalizeName } = await import('../src/lib/categoryGuess.js')
const { pastPurchaseChanges, purchasedItemsByExpense } = await import('../src/lib/budgetMap.js')
const { LIVE_MONEY_CATEGORIES } = await import('../src/data/moneyCategories.fixture.js')

const dir = path.join(import.meta.dirname)
let db
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]

// A new database with what Supabase provides and the migrations before
// 015 (015 to 025 rely on the login lock and are run by their own blocks).
async function newDatabase() {
  const db = new PGlite()
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
  // 015 (the login lock) and 016 to 025 (which rely on it) are tested on their own at the end.
  const all = fs.readdirSync(dir).filter((f) => /^0\d\d_.*\.sql$/.test(f) && f < '015').sort()
  const order = ['schema.sql', ...all.filter((f) => f < '006'), ...all.filter((f) => f.startsWith('007')), ...all.filter((f) => f >= '006' && !f.startsWith('007'))]
  for (const f of order) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
  return db
}

beforeAll(async () => {
  db = await newDatabase()
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

describe('021: one flow for HOME, SHOP, Orders and MONEY', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const file = '021_connected_flow.sql'
  const read = () => fs.readFileSync(path.join(dir, file), 'utf8')
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  const row = async (sql, params) => (await rows(sql, params))[0]
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  async function asMember(fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [MEMBER])
    await db.exec('set role authenticated')
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const snapshot = async () => ({
    expenses: await rows(`select id, amount::float as amount, category_id, description, paid_by, expense_date::text as date, shop_id, trip_id from expenses order by id`),
    orders: await rows(`select id, item_name, price::float as price, status, expense_id from orders order by id`),
    stock: await rows(`select id, current_stock::float as stock from pantry_items order by id`),
    income: await rows(`select id, amount::float as amount from income order by id`),
  })
  let before

  beforeAll(async () => {
    before = await snapshot()
  })

  it('changes no existing expense, income, order or stock, and is safe to re-run', async () => {
    await db.exec(read())
    await db.exec(read())
    expect(await snapshot()).toEqual(before)
    expect((await row(`select count(*)::int as n from category_budget_map`)).n).toBe(0)
    expect((await row(`select count(*)::int as n from pantry_items where usual_shop_id is not null`)).n).toBe(0)
    expect((await row(`select count(*)::int as n from shopping_trips where shop_id is not null or paid_by is not null`)).n).toBe(0)
  })

  it('ends with a check that says nothing changed and nothing is open to anon', async () => {
    const result = (await db.exec(read())).at(-1).rows[0]
    expect(result).toMatchObject({
      expenses_before: before.expenses.length,
      expenses_now: before.expenses.length,
      expenses_changed: 0,
      expenses_lost: 0,
      income_before: before.income.length,
      income_now: before.income.length,
      income_changed: 0,
      orders_before: before.orders.length,
      orders_now: before.orders.length,
      orders_changed: 0,
      items_before: before.stock.length,
      items_now: before.stock.length,
      stock_changed: 0,
      new_columns: true,
      open_to_anon: 'none',
      locked_to_household: true,
      realtime_on: true,
    })
    expect(Number(result.expenses_total_before)).toBe(Number(result.expenses_total_now))
    expect(Number(result.income_total_before)).toBe(Number(result.income_total_now))
    expect(Number(result.orders_total_before)).toBe(Number(result.orders_total_now))
    // 015's own check still finds nothing open, the new functions included.
    const lock = await db.query(fs.readFileSync(path.join(dir, '015_lock_to_household.sql'), 'utf8').split('-- ── 5. Check')[1].replace(/^[^\n]*\n/, ''))
    expect(lock.rows[0]).toMatchObject({ tables_open_to_anon: 'none', functions_open_to_anon: 'none', tables_without_rls: 'none' })
  })

  it('keeps the new table and functions away from anon', async () => {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
    await db.exec('set role anon')
    try {
      expect(await fails('select * from category_budget_map')).toMatch(/permission denied/)
      expect(await fails(`select arrive_order(gen_random_uuid(), null, 1, current_date)`)).toMatch(/permission denied/)
      expect(await fails(`select unarrive_order(gen_random_uuid())`)).toMatch(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  describe('as the household', () => {
    let shop, online, groceries, catFood, cheese, cheeseEntry, foodEntry

    beforeAll(async () => {
      await asMember(async () => {
        shop = (await row(`insert into shops (name, is_online) values ('Conad', false) returning id`)).id
        online = (await row(`insert into shops (name, is_online) values ('Amazon', true) returning id`)).id
        groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
        catFood = (await row(`insert into pantry_items (name, unit, current_stock, min_stock, category_id, usual_shop_id, packaging_unit, quantity_per_pack) values ('Cat Dry Food', 'kg', 1, 2, 'pet', $1, 'bag', 2) returning id`, [online])).id
        cheese = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Cheese', 'pcs', 1, 'dairy') returning id`)).id
        cheeseEntry = (await row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id) values ('Cheese', 2, 'pcs', 3, 1, 'pcs', $1, true, 'dairy') returning id`, [cheese])).id
        foodEntry = (await row(`insert into grocery_items (name, quantity, unit, price, pantry_item_id, in_cart, category_id) values ('Cat Dry Food', 1, 'bag', 0, $1, true, 'pet') returning id`, [catFood])).id
      })
    })

    it('saves the store and payer on the trip and on every expense it makes', async () => {
      await asMember(async () => {
        const trip = '22222222-2222-2222-2222-222222222222'
        const payload = { id: trip, trip_date: '2026-10-16', shop_id: shop, paid_by: 'irene', items: [{ grocery_item_id: cheeseEntry, line_total: 6, payer: 'irene', expense_category_id: groceries, pantry_item_id: cheese, add: 2 }] }
        const t = await row(`select * from confirm_shopping_trip($1)`, [payload])
        expect({ shop: t.shop_id, paid: t.paid_by, total: Number(t.total) }).toEqual({ shop, paid: 'irene', total: 6 })
        expect(await rows(`select shop_id, amount::float as amount from expenses where trip_id = $1`, [trip])).toEqual([{ shop_id: shop, amount: 6 }])
        // Sent again: nothing new.
        await db.query(`select * from confirm_shopping_trip($1)`, [payload])
        expect((await row(`select count(*)::int as n from expenses where trip_id = $1`, [trip])).n).toBe(1)
        expect(Number((await row(`select current_stock from pantry_items where id = $1`, [cheese])).current_stock)).toBe(3)
      })
    })

    it('allows one open order per SHOP list entry, and refuses to buy an ordered item in a trip', async () => {
      await asMember(async () => {
        const expense = (await row(`insert into expenses (amount, description, paid_by, expense_date, shop_id, category_id) values (30, 'Cat Dry Food', 'shared', '2026-10-16', $1, $2) returning id`, [online, groceries])).id
        const order = (await row(
          `insert into orders (item_name, shop_id, order_date, price, paid_by, expense_id, pantry_item_id, grocery_item_id, quantity, unit, expected_date) values ('Cat Dry Food', $1, '2026-10-16', 30, 'shared', $2, $3, $4, 2, 'bag', '2026-10-20') returning id`,
          [online, expense, catFood, foodEntry]
        )).id
        expect(await fails(`insert into orders (item_name, price, grocery_item_id) values ('Twice', 1, $1)`, [foodEntry])).toMatch(/orders_open_grocery_key|duplicate/)
        const before = await row(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`)
        const trip = { id: '33333333-3333-3333-3333-333333333333', trip_date: '2026-10-16', shop_id: shop, items: [{ grocery_item_id: foodEntry, line_total: 28, expense_category_id: groceries, pantry_item_id: catFood, add: 2 }] }
        expect(await fails(`select * from confirm_shopping_trip($1)`, [trip])).toMatch(/already ordered online/)
        // Nothing of the refused trip is left behind.
        expect(await row(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`)).toEqual(before)
        expect((await row(`select count(*)::int as n from shopping_trips where id = $1`, [trip.id])).n).toBe(0)
        expect(Number((await row(`select current_stock from pantry_items where id = $1`, [catFood])).current_stock)).toBe(1)

        // Arrived: 2 bags = 4 kg added once, the entry leaves the list, no expense made.
        const first = (await row(`select arrive_order($1, $2, 4, '2026-10-19') as r`, [order, catFood])).r
        expect(first.added).toBe(true)
        const second = (await row(`select arrive_order($1, $2, 4, '2026-10-19') as r`, [order, catFood])).r
        expect(second.added).toBe(false)
        expect(Number((await row(`select current_stock from pantry_items where id = $1`, [catFood])).current_stock)).toBe(5)
        expect(await row(`select status, arrived_date::text as day, stock_added::float as added from orders where id = $1`, [order])).toEqual({ status: 'arrived', day: '2026-10-19', added: 4 })
        expect((await row(`select completed from grocery_items where id = $1`, [foodEntry])).completed).toBe(true)
        expect(await row(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses`)).toEqual(before)
        expect((await row(`select count(*)::int as n from stock_logs where item_id = $1 and reason = 'purchased'`, [catFood])).n).toBe(1)

        // Back on the way: exactly that stock comes out again, and its history entry.
        await db.query(`select unarrive_order($1)`, [order])
        await db.query(`select unarrive_order($1)`, [order])
        expect(Number((await row(`select current_stock from pantry_items where id = $1`, [catFood])).current_stock)).toBe(1)
        expect((await row(`select count(*)::int as n from stock_logs where item_id = $1 and reason = 'purchased'`, [catFood])).n).toBe(0)
        expect(await row(`select status, stock_added::float as added from orders where id = $1`, [order])).toEqual({ status: 'on_the_way', added: 0 })
        expect((await row(`select completed from grocery_items where id = $1`, [foodEntry])).completed).toBe(false)

        // A group needs a variant; an arrival without an item adds nothing.
        const group = (await row(`insert into pantry_items (name, unit, is_group, category_id) values ('Cat food', 'kg', true, 'pet') returning id`)).id
        expect(await fails(`select arrive_order($1, $2, 1, current_date)`, [order, group])).toMatch(/variant/)
        expect((await row(`select arrive_order($1, null, 0, current_date) as r`, [order])).r.added).toBe(true)
        expect(Number((await row(`select current_stock from pantry_items where id = $1`, [catFood])).current_stock)).toBe(1)
        await db.query(`delete from orders where id = $1`, [order])
        await db.query(`delete from expenses where id = $1`, [expense])
        await db.query(`delete from pantry_items where id = $1`, [group])
      })
    })

    it('maps an item category to a budget category, and forgets it when either is deleted', async () => {
      await asMember(async () => {
        const pets = (await row(`insert into expense_categories (name) values ('Pets') returning id`)).id
        await db.query(`insert into category_budget_map (id, expense_category_id) values ('pet', $1)`, [pets])
        expect(await fails(`insert into category_budget_map (id, expense_category_id) values ('no-such-category', $1)`, [pets])).toMatch(/foreign key/)
        await db.query(`delete from expense_categories where id = $1`, [pets])
        expect((await row(`select count(*)::int as n from category_budget_map`)).n).toBe(0)
      })
    })
  })
})

describe('022: a group never receives stock directly', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8')
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  const row = async (sql, params) => (await rows(sql, params))[0]
  async function asMember(fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [MEMBER])
    await db.exec('set role authenticated')
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const stockOf = async (id) => Number((await row(`select current_stock from pantry_items where id = $1`, [id])).current_stock)
  let groceries

  // A group with one variant, and an unlinked SHOP entry with the group's name, bought on a trip.
  async function buyUnlinked(name, tripId) {
    return asMember(async () => {
      groceries ??= (await row(`select id from expense_categories where name = 'Groceries'`)).id
      const group = (await row(`insert into pantry_items (name, unit, is_group, category_id) values ($1, 'pcs', true, 'misc') returning id`, [name])).id
      const variant = (await row(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ($1, 'pcs', 2, $2, 'misc') returning id`, [`${name} paprika`, group])).id
      const entry = (await row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, in_cart, category_id) values ($1, 3, 'pcs', 4, 1, 'pcs', true, 'misc') returning id`, [name])).id
      await db.query(`select * from confirm_shopping_trip($1)`, [{ id: tripId, trip_date: '2026-10-16', items: [{ grocery_item_id: entry, line_total: 12, expense_category_id: groceries, add: 3 }] }])
      return { group, variant, entry }
    })
  }

  it('shows the old behaviour first: 021 added the stock to the group itself', async () => {
    const { group } = await buyUnlinked('Chips', '44444444-4444-4444-4444-444444444444')
    expect(await stockOf(group)).toBe(3)
  })

  let before
  const snapshot = async () => ({
    expenses: await rows(`select id, amount::float as amount, category_id, description, paid_by, expense_date::text as date, shop_id, trip_id from expenses order by id`),
    orders: await rows(`select id, item_name, price::float as price, status, expense_id from orders order by id`),
    stock: await rows(`select id, current_stock::float as stock from pantry_items order by id`),
  })

  it('changes no existing expense, order or stock, and is safe to re-run', async () => {
    before = await snapshot()
    await db.exec(read('022_groups_never_get_stock.sql'))
    await db.exec(read('022_groups_never_get_stock.sql'))
    expect(await snapshot()).toEqual(before)
  })

  it('ends with a check that says nothing changed, and the function is still closed to anon', async () => {
    const result = (await db.exec(read('022_groups_never_get_stock.sql'))).at(-1).rows[0]
    expect(result).toMatchObject({
      expenses_before: before.expenses.length,
      expenses_now: before.expenses.length,
      expenses_changed: 0,
      expenses_lost: 0,
      orders_before: before.orders.length,
      orders_now: before.orders.length,
      orders_changed: 0,
      items_before: before.stock.length,
      items_now: before.stock.length,
      stock_changed: 0,
      open_to_anon: 'none',
      skips_groups: true,
    })
    expect(Number(result.expenses_total_before)).toBe(Number(result.expenses_total_now))
    expect(Number(result.orders_total_before)).toBe(Number(result.orders_total_now))
    const lock = await db.query(read('015_lock_to_household.sql').split('-- ── 5. Check')[1].replace(/^[^\n]*\n/, ''))
    expect(lock.rows[0]).toMatchObject({ tables_open_to_anon: 'none', functions_open_to_anon: 'none', tables_without_rls: 'none' })
  })

  it('buys an item named like a group into a normal item, never the group or its variants', async () => {
    const { group, variant } = await buyUnlinked('Pasta', '55555555-5555-5555-5555-555555555555')
    expect(await stockOf(group)).toBe(0)
    expect(await stockOf(variant)).toBe(2)
    const made = await rows(`select id, current_stock::float as stock, is_group, group_id from pantry_items where lower(name) = 'pasta'`)
    expect(made.filter((p) => !p.is_group)).toEqual([{ id: expect.any(String), stock: 3, is_group: false, group_id: null }])
    // Bought again: the normal item is restocked, no second one is made.
    await asMember(async () => {
      const entry = (await row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, in_cart, category_id) values ('Pasta', 1, 'pcs', 2, 1, 'pcs', true, 'misc') returning id`)).id
      await db.query(`select * from confirm_shopping_trip($1)`, [{ id: '66666666-6666-6666-6666-666666666666', trip_date: '2026-10-17', items: [{ grocery_item_id: entry, line_total: 2, expense_category_id: groceries, add: 1 }] }])
    })
    expect((await rows(`select current_stock::float as stock from pantry_items where lower(name) = 'pasta' and not is_group`)).map((r) => r.stock)).toEqual([4])
    expect(await stockOf(group)).toBe(0)
  })

  it('still adds to an item linked to a normal pantry item, as before', async () => {
    await asMember(async () => {
      const item = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Rice', 'pcs', 1, 'misc') returning id`)).id
      const entry = (await row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id) values ('Rice', 2, 'pcs', 2, 1, 'pcs', $1, true, 'misc') returning id`, [item])).id
      await db.query(`select * from confirm_shopping_trip($1)`, [{ id: '77777777-7777-7777-7777-777777777777', trip_date: '2026-10-17', items: [{ grocery_item_id: entry, line_total: 4, expense_category_id: groceries, pantry_item_id: item, add: 2 }] }])
      expect(await stockOf(item)).toBe(3)
    })
  })
})

describe('023: cart order, 1×, purchases typed in MONEY, merging, trips away, category tools, AI data', () => {
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const file = '023_oct_2026_features.sql'
  const read = (f = file) => fs.readFileSync(path.join(dir, f), 'utf8')
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  const row = async (sql, params) => (await rows(sql, params))[0]
  const fails = async (sql, params) => {
    try {
      await db.query(sql, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  async function as(role, userId, fn) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }
  const asMember = (fn) => as('authenticated', MEMBER, fn)
  const stockOf = async (id) => Number((await row(`select current_stock from pantry_items where id = $1`, [id])).current_stock)
  // Everything that existed before 023, without the columns 023 adds.
  const snapshot = async () => ({
    expenses: await rows(`select id, amount::float as amount, category_id, description, paid_by, expense_date::text as date, shop_id, trip_id from expenses order by id`),
    orders: await rows(`select id, item_name, price::float as price, status, expense_id, quantity::float as quantity from orders order by id`),
    stock: await rows(`select id, name, current_stock::float as stock, min_stock::float as min, category_id, subcategory_id, is_group, group_id from pantry_items order by id`),
    grocery: await rows(`select id, name, quantity::float as quantity, price::float as price, completed, in_cart, expense_id, trip_id, pantry_item_id, category_id from grocery_items order by id`),
    trips: await rows(`select id, trip_date::text as date, total::float as total, shop_id, paid_by from shopping_trips order by id`),
    tripItems: await rows(`select id, trip_id, expense_id, line_total::float as total, stock_added::float as added from shopping_trip_items order by id`),
    categories: await rows(`select id, name, parent_id, type from inventory_categories order by id`),
    memory: await rows(`select id, category_id, subcategory_id from category_memory order by id`),
    budgetMap: await rows(`select id, expense_category_id from category_budget_map order by id`),
    logs: (await row(`select count(*)::int as n from stock_logs`)).n,
  })
  let before

  beforeAll(async () => {
    // In the cart before 023: it gets its created_at as the time it went in.
    await db.query(`insert into grocery_items (name, quantity, unit, in_cart, category_id, created_at) values ('In the cart before 023', 1, 'pcs', true, 'misc', '2026-10-01T10:00:00Z')`)
    before = await snapshot()
  })

  it('changes nothing that exists (only the cart time of what is in the cart), and is safe to re-run', async () => {
    await db.exec(read())
    await db.exec(read())
    expect(await snapshot()).toEqual(before)
    const cart = await rows(`select (cart_added_at = created_at) as same from grocery_items where in_cart`)
    expect(cart.length).toBeGreaterThan(0)
    expect(cart.every((r) => r.same)).toBe(true)
    expect(await row(`select (select count(*)::int from grocery_items where not in_cart and cart_added_at is not null) as stray_times,
      (select count(*)::int from pantry_items where one_time) as one_time_items,
      (select count(*)::int from grocery_items where one_time) as one_time_entries,
      (select count(*)::int from pantry_items where shop_dismissed_at is not null) as dismissed,
      (select count(*)::int from shopping_trips where source <> 'shop') as not_shop,
      (select count(*)::int from shopping_trip_items where line_kind <> 'shop') as not_shop_lines,
      (select count(*)::int from expenses where merged_at is not null or travel_id is not null or shop_before_merge is not null) as touched_expenses`)).toEqual({
      stray_times: 0,
      one_time_items: 0,
      one_time_entries: 0,
      dismissed: 0,
      not_shop: 0,
      not_shop_lines: 0,
      touched_expenses: 0,
    })
  })

  it('ends with a check where every row says ok, listing the tables, columns, functions and AI model chain', async () => {
    const result = (await db.exec(read())).at(-1).rows
    expect(result.filter((r) => !r.ok)).toEqual([])
    const count = (section) => result.filter((r) => r.section === section).length
    expect([count('1 new table'), count('2 new column'), count('3 function'), count('4 AI model chain'), count('5 data')]).toEqual([4, 23, 8, 7, 5])
    expect(result.filter((r) => r.section === '4 AI model chain').map((r) => `${r.name}: ${r.detail.split(' · ').slice(0, 2).join(' · ')}`)).toEqual([
      'heavy #1: claude-opus-5-5 · Review all categories: cross-check every item',
      'light #1: claude-haiku-5-5 · One new item name → its category',
      'light #2: claude-sonnet-5-5 · One new item name → its category',
      'light #3: claude-opus-5-5 · One new item name → its category',
      'medium #1: claude-sonnet-5-5 · web search',
      'medium #2: claude-opus-5-5 · web search',
      'photo #1: claude-sonnet-5-5 · Receipt photos (later)',
    ])
    // 015's own check still finds nothing open.
    const lock = await db.query(read('015_lock_to_household.sql').split('-- ── 5. Check')[1].replace(/^[^\n]*\n/, ''))
    expect(lock.rows[0]).toMatchObject({ tables_open_to_anon: 'none', functions_open_to_anon: 'none', tables_without_rls: 'none' })
  })

  it('keeps the new tables and functions away from anon and strangers; the model chain is read-only for the app', async () => {
    for (const t of ['travels', 'household_settings', 'ai_model_chain', 'ai_category_proposals']) {
      expect(await as('anon', null, () => fails(`select * from ${t}`))).toMatch(/permission denied/)
      const policy = (table) => rows(`select cmd, roles::text, qual, with_check from pg_policies where tablename = $1`, [table])
      expect(await policy(t)).toEqual(await policy('expenses'))
    }
    for (const call of [
      `select merge_expenses_into_purchase('{}'::jsonb)`,
      `select split_merged_purchase(gen_random_uuid())`,
      `select merge_inventory_category('a', 'b')`,
      `select move_inventory_subcategory('a', null)`,
    ]) {
      expect(await as('anon', null, () => fails(call))).toMatch(/permission denied/)
      expect(await as('authenticated', STRANGER, () => fails(call))).toMatch(/Not allowed/)
    }
    expect(await as('authenticated', STRANGER, () => rows(`select * from household_settings`))).toEqual([])
    expect(await as('authenticated', STRANGER, () => fails(`insert into travels (name, start_date, end_date) values ('Nope', '2026-10-01', '2026-10-02')`))).toMatch(/row-level security/)
    await asMember(async () => {
      expect((await rows(`select model from ai_model_chain where level = 'light' and active order by position`)).map((r) => r.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
      expect(await fails(`insert into ai_model_chain (level, position, model) values ('light', 4, 'x')`)).toMatch(/permission denied/)
      expect(await fails(`update ai_model_chain set active = false`)).toMatch(/permission denied/)
      expect((await row(`select value from household_settings where key = 'ai_suggestions'`)).value).toBe(false)
      await db.query(`update household_settings set value = 'true'::jsonb where key = 'ai_suggestions'`)
      await db.query(`update household_settings set value = 'false'::jsonb where key = 'ai_suggestions'`)
    })
  })

  it('keeps the time an entry went into the cart, and forgets it when it leaves', async () => {
    await asMember(async () => {
      const a = (await row(`insert into grocery_items (name, quantity, unit, category_id) values ('Cart A 023', 1, 'pcs', 'misc') returning id, cart_added_at`))
      expect(a.cart_added_at).toBeNull()
      await db.query(`update grocery_items set in_cart = true where id = $1`, [a.id])
      const inCart = (await row(`select cart_added_at::text as t from grocery_items where id = $1`, [a.id])).t
      expect(inCart).not.toBeNull()
      // Still in the cart (e.g. its quantity changes): the same time.
      await db.query(`update grocery_items set quantity = 3 where id = $1`, [a.id])
      expect((await row(`select cart_added_at::text as t from grocery_items where id = $1`, [a.id])).t).toBe(inCart)
      // A tap sent later (no signal at the time) keeps the time of the tap.
      const b = (await row(`insert into grocery_items (name, quantity, unit, category_id) values ('Cart B 023', 1, 'pcs', 'misc') returning id`)).id
      await db.query(`update grocery_items set in_cart = true, cart_added_at = '2026-10-18T09:00:00Z' where id = $1`, [b])
      expect((await row(`select extract(epoch from cart_added_at)::int as t from grocery_items where id = $1`, [b])).t).toBe(Date.parse('2026-10-18T09:00:00Z') / 1000)
      // Out of the cart: no time.
      await db.query(`update grocery_items set in_cart = false where id = any($1)`, [[a.id, b]])
      expect((await rows(`select cart_added_at from grocery_items where id = any($1)`, [[a.id, b]])).every((r) => r.cart_added_at === null)).toBe(true)
      await db.query(`delete from grocery_items where id = any($1)`, [[a.id, b]])
    })
  })

  describe('a SHOP purchase works exactly as before', () => {
    let groceries, wine, milk, ids, start
    const trip = '23000000-0000-0000-0000-000000000001'
    const add = (name, qty, unit, price, pantry) =>
      row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id) values ($1,$2,$3,$4,$2,$3,$5,true,'misc') returning id`, [name, qty, unit, price, pantry]).then((r) => r.id)
    const state = async () => ({
      wine: await stockOf(wine),
      milk: await row(`select current_stock::float as stock, expiry_date::text as expiry, payer from pantry_items where id = $1`, [milk]),
      avocados: (await rows(`select current_stock::float as stock from pantry_items where name = 'Avocado 023'`)).map((r) => r.stock),
      logs: (await row(`select count(*)::int as n from stock_logs where item_id = any($1) or item_name = 'Avocado 023'`, [[wine, milk]])).n,
      expenses: await row(`select count(*)::int as n, coalesce(sum(amount), 0)::float as total from expenses where description like '% 023'`),
      bought: (await row(`select count(*)::int as n from grocery_items where id = any($1) and completed`, [Object.values(ids)])).n,
      inCart: (await row(`select count(*)::int as n from grocery_items where id = any($1) and in_cart and cart_added_at is not null`, [Object.values(ids)])).n,
    })
    const payload = (id) => ({
      id,
      trip_date: '2026-10-18',
      photo_ids: [],
      items: [
        { grocery_item_id: ids.falanghina, line_total: 2.27, expense_category_id: groceries, pantry_item_id: wine, add: 1 },
        { grocery_item_id: ids.vermentino, line_total: 3.32, expense_category_id: groceries, pantry_item_id: wine, add: 1 },
        { grocery_item_id: ids.milk, line_total: 3.6, payer: 'irene', expense_category_id: groceries, pantry_item_id: milk, add: 3, discard_expired: true, expiry_date: '2026-10-30' },
        { grocery_item_id: ids.avocado1, line_total: 2.84, expense_category_id: groceries, pantry_item_id: null, add: 2 },
        { grocery_item_id: ids.avocado2, line_total: 1, expense_category_id: groceries, pantry_item_id: null, add: 1 },
      ],
    })

    beforeAll(async () => {
      await asMember(async () => {
        groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
        wine = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Wine 023', 'pcs', 1, 'beverages') returning id`)).id
        milk = (await row(`insert into pantry_items (name, unit, current_stock, expiry_date, category_id) values ('Milk 023', 'btl', 2, '2020-01-01', 'dairy') returning id`)).id
        ids = {
          falanghina: await add('Falanghina 023', 1, 'pcs', 2.27, wine),
          vermentino: await add('Vermentino 023', 1, 'pcs', 3.32, wine),
          milk: await add('Milk 023', 3, 'btl', 3.6, milk),
          avocado1: await add('Avocado 023', 2, 'pcs', 2.84, null),
          avocado2: await add('Avocado 023', 1, 'pcs', 1, null),
        }
      })
      start = await state()
    })

    it('confirms the whole cart at once, with the same stock, history and expenses as before', async () => {
      expect(start).toMatchObject({ wine: 1, logs: 0, expenses: { n: 0 }, bought: 0, inCart: 5 })
      await asMember(async () => {
        const t = await row(`select * from confirm_shopping_trip($1)`, [payload(trip)])
        expect({ total: Number(t.total), source: t.source, coupon: Number(t.coupon_total) }).toEqual({ total: 13.03, source: 'shop', coupon: 0 })
        expect(await state()).toEqual({
          wine: 3,
          milk: { stock: 3, expiry: '2026-10-30', payer: 'irene' },
          avocados: [3],
          logs: 6,
          expenses: { n: 5, total: 13.03 },
          bought: 5,
          inCart: 0,
        })
        // Out of the cart: no cart time. No trip away, nothing 1×.
        expect((await rows(`select cart_added_at from grocery_items where id = any($1)`, [Object.values(ids)])).every((r) => r.cart_added_at === null)).toBe(true)
        expect((await row(`select count(*)::int as n from expenses where trip_id = $1 and travel_id is null and merged_at is null`, [trip])).n).toBe(5)
        expect((await row(`select one_time, min_stock::float as min from pantry_items where name = 'Avocado 023'`))).toEqual({ one_time: false, min: 0 })
        // The lines now also say what was bought.
        expect(await rows(`select line_kind, quantity::float as quantity, unit, list_total, coupon_share::float as coupon from shopping_trip_items where trip_id = $1 order by position`, [trip])).toEqual([
          { line_kind: 'shop', quantity: 1, unit: 'pcs', list_total: null, coupon: 0 },
          { line_kind: 'shop', quantity: 1, unit: 'pcs', list_total: null, coupon: 0 },
          { line_kind: 'shop', quantity: 3, unit: 'btl', list_total: null, coupon: 0 },
          { line_kind: 'shop', quantity: 2, unit: 'pcs', list_total: null, coupon: 0 },
          { line_kind: 'shop', quantity: 1, unit: 'pcs', list_total: null, coupon: 0 },
        ])
        // Sent again: nothing new.
        const after = await state()
        await db.query(`select * from confirm_shopping_trip($1)`, [payload(trip)])
        expect(await state()).toEqual(after)
      })
    })

    it('reopens it exactly: the items are back in the cart, with a cart time', async () => {
      await asMember(async () => {
        expect((await row(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(5)
        expect(await state()).toEqual(start)
        expect((await row(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(0)
      })
    })

    it('puts back an entry deleted after confirming (also one saved before 023 had its 1× and cart time)', async () => {
      await asMember(async () => {
        const again = '23000000-0000-0000-0000-000000000002'
        await db.query(`select * from confirm_shopping_trip($1)`, [payload(again)])
        await db.query(`delete from grocery_items where id = $1`, [ids.avocado1])
        // A snapshot from before 023 has neither column.
        await db.query(`update shopping_trip_items set grocery_snapshot = grocery_snapshot - 'one_time' - 'cart_added_at' where trip_id = $1`, [again])
        await db.query(`select reopen_shopping_trip($1)`, [again])
        expect(await row(`select name, in_cart, completed, cart_added_at is not null as timed from grocery_items where id = $1`, [ids.avocado1])).toEqual({ name: 'Avocado 023', in_cart: true, completed: false, timed: true })
        expect(await state()).toEqual(start)
      })
    })

    it('still refuses an item ordered online, and never gives stock to a group by name', async () => {
      await asMember(async () => {
        const entry = await add('Ordered 023', 1, 'pcs', 4, null)
        const order = (await row(`insert into orders (item_name, price, grocery_item_id) values ('Ordered 023', 4, $1) returning id`, [entry])).id
        expect(await fails(`select * from confirm_shopping_trip($1)`, [{ id: '23000000-0000-0000-0000-000000000003', trip_date: '2026-10-18', items: [{ grocery_item_id: entry, line_total: 4, expense_category_id: groceries, add: 1 }] }])).toMatch(/already ordered online/)
        expect((await row(`select count(*)::int as n from shopping_trips where id = '23000000-0000-0000-0000-000000000003'`)).n).toBe(0)
        await db.query(`delete from orders where id = $1`, [order])
        await db.query(`delete from grocery_items where id = $1`, [entry])

        const group = (await row(`insert into pantry_items (name, unit, is_group, category_id) values ('Crackers 023', 'pcs', true, 'snacks') returning id`)).id
        const named = await add('Crackers 023', 2, 'pcs', 3, null)
        await db.query(`select * from confirm_shopping_trip($1)`, [{ id: '23000000-0000-0000-0000-000000000004', trip_date: '2026-10-18', items: [{ grocery_item_id: named, line_total: 6, expense_category_id: groceries, add: 2 }] }])
        expect(await stockOf(group)).toBe(0)
        expect((await rows(`select current_stock::float as stock from pantry_items where name = 'Crackers 023' and not is_group`)).map((r) => r.stock)).toEqual([2])
      })
    })
  })

  describe('1×: one-time purchases', () => {
    let groceries
    beforeAll(async () => {
      groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
    })

    it('a new item bought from a 1× SHOP entry is 1× too; an existing item never becomes 1× by itself', async () => {
      await asMember(async () => {
        const kept = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Candles 023', 'pcs', 1, 'household') returning id`)).id
        const fresh = (await row(`insert into grocery_items (name, quantity, unit, price, in_cart, category_id, one_time) values ('Balloons 023', 1, 'pack', 3, true, 'misc', true) returning id`)).id
        const known = (await row(`insert into grocery_items (name, quantity, unit, price, in_cart, category_id, one_time) values ('Candles 023', 2, 'pcs', 2, true, 'household', true) returning id`)).id
        await db.query(`select * from confirm_shopping_trip($1)`, [
          { id: '23000000-0000-0000-0000-000000000011', trip_date: '2026-10-18', items: [
            { grocery_item_id: fresh, line_total: 3, expense_category_id: groceries, add: 1 },
            { grocery_item_id: known, line_total: 2, expense_category_id: groceries, pantry_item_id: kept, add: 2 },
          ] },
        ])
        expect(await row(`select one_time, current_stock::float as stock from pantry_items where name = 'Balloons 023'`)).toEqual({ one_time: true, stock: 1 })
        expect(await row(`select one_time, current_stock::float as stock from pantry_items where id = $1`, [kept])).toEqual({ one_time: false, stock: 3 })
      })
    })

    it('bought again by name, a finished 1× item comes back instead of a second one', async () => {
      await asMember(async () => {
        const hats = (await row(`insert into pantry_items (name, unit, current_stock, category_id, one_time) values ('Party hats 023', 'pcs', 0, 'misc', true) returning id`)).id
        const entry = (await row(`insert into grocery_items (name, quantity, unit, price, in_cart, category_id) values ('party hats 023', 2, 'pcs', 1, true, 'misc') returning id`)).id
        await db.query(`select * from confirm_shopping_trip($1)`, [{ id: '23000000-0000-0000-0000-000000000012', trip_date: '2026-10-18', items: [{ grocery_item_id: entry, line_total: 2, expense_category_id: groceries, add: 2 }] }])
        expect(await rows(`select id, current_stock::float as stock, one_time from pantry_items where lower(name) = 'party hats 023'`)).toEqual([{ id: hats, stock: 2, one_time: true }])
      })
    })

    it('a group can never be 1×, its variants can', async () => {
      await asMember(async () => {
        const group = (await row(`insert into pantry_items (name, unit, is_group, category_id) values ('Chips 023', 'pcs', true, 'snacks') returning id`)).id
        const variant = (await row(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Chips 023 paprika', 'pcs', 1, $1, 'snacks') returning id`, [group])).id
        expect(await fails(`update pantry_items set one_time = true where id = $1`, [group])).toMatch(/pantry_items_one_time_not_group/)
        expect(await fails(`update pantry_items set one_time = true where id = $1`, [variant])).toBeNull()
      })
    })
  })

  it('a variant taken off the SHOP list by hand stays off until it is restocked', async () => {
    await asMember(async () => {
      const group = (await row(`insert into pantry_items (name, unit, is_group, min_stock, category_id) values ('Snack mix 023', 'pcs', true, 2, 'snacks') returning id`)).id
      const tuc = (await row(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Tuc 023', 'pcs', 0, $1, 'snacks') returning id`, [group])).id
      await db.query(`update pantry_items set shop_dismissed_at = now() where id = $1`, [tuc])
      await db.query(`update pantry_items set notes = 'still out' where id = $1`, [tuc])
      expect((await row(`select shop_dismissed_at is not null as off from pantry_items where id = $1`, [tuc])).off).toBe(true)
      await db.query(`select * from increment_stock($1, 2)`, [tuc])
      expect((await row(`select shop_dismissed_at is null as back from pantry_items where id = $1`, [tuc])).back).toBe(true)
      // Used up again: it can go on the list again (nothing remembers the old dismissal).
      await db.query(`select * from increment_stock($1, -2)`, [tuc])
      expect(await row(`select current_stock::float as stock, shop_dismissed_at from pantry_items where id = $1`, [tuc])).toEqual({ stock: 0, shop_dismissed_at: null })
    })
  })

  describe('a purchase typed in MONEY (several items, discounts, a coupon, a trip away)', () => {
    const trip = '23000000-0000-0000-0000-000000000021'
    let shop, pets, goingOut, litter, entry, cartEntry, bali, payload, start

    beforeAll(async () => {
      await asMember(async () => {
        shop = (await row(`insert into shops (name) values ('Lidl 023') returning id`)).id
        pets = (await row(`insert into expense_categories (name) values ('Pets 023') returning id`)).id
        goingOut = (await row(`insert into expense_categories (name) values ('Going out 023') returning id`)).id
        litter = (await row(`insert into pantry_items (name, unit, current_stock, min_stock, price, price_qty, price_unit, category_id) values ('Cat litter 023', 'pack', 1, 2, 5, 1, 'pack', 'pet') returning id`)).id
        // On the SHOP list, still to buy: it leaves the list once the stock is in HOME.
        entry = (await row(`insert into grocery_items (name, quantity, unit, pantry_item_id, auto_generated, category_id) values ('Cat litter 023', 2, 'pack', $1, true, 'pet') returning id`, [litter])).id
        bali = (await row(`insert into travels (name, kind, start_date, end_date) values ('Bali 023', 'holiday', '2026-10-10', '2026-10-20') returning id`)).id
      })
      // €38.40 as on the receipt (10 + 12 −30% + 20), coupon −€5 spread by price,
      // the cents on the last line: paid 8.70 + 7.31 + 17.39 = 33.40.
      payload = {
        id: trip,
        source: 'money',
        trip_date: '2026-10-12',
        shop_id: shop,
        paid_by: 'irene',
        coupon_kind: 'amount',
        coupon_value: 5,
        coupon_total: 5,
        items: [
          { name: 'Cat litter 023', category_id: 'pet', quantity: 2, unit: 'pack', price: 10, price_qty: 2, price_unit: 'pack', pantry_item_id: litter, add: 2, line_total: 8.7, list_total: 10, coupon_share: 1.3, expense_category_id: pets, travel_id: bali, list_entry_id: entry },
          { name: 'Sun cream 023', category_id: 'personal-care', quantity: 1, unit: 'pcs', price: 12, price_qty: 1, price_unit: 'pcs', pantry_item_id: null, add: 1, one_time: true, min_stock: 0, line_total: 7.31, list_total: 12, item_discount_kind: 'percent', item_discount_value: 30, coupon_share: 1.09, expense_category_id: goingOut, travel_id: bali },
          { name: 'Dinner 023', durable: true, add: 0, line_total: 17.39, list_total: 20, coupon_share: 2.61, expense_category_id: goingOut, travel_id: bali },
        ],
      }
      start = await snapshot()
    })

    it('saves one purchase: an expense per item, stock for what goes to HOME, the normal price kept', async () => {
      await asMember(async () => {
        const t = await row(`select * from confirm_shopping_trip($1)`, [payload])
        expect({ source: t.source, total: Number(t.total), coupon: Number(t.coupon_total), kind: t.coupon_kind, shop: t.shop_id, paid: t.paid_by }).toEqual({ source: 'money', total: 33.4, coupon: 5, kind: 'amount', shop, paid: 'irene' })
        expect(await rows(`select description, amount::float as amount, paid_by, shop_id, travel_id, expense_date::text as date from expenses where trip_id = $1 order by amount`, [trip])).toEqual([
          { description: 'Sun cream 023', amount: 7.31, paid_by: 'irene', shop_id: shop, travel_id: bali, date: '2026-10-12' },
          { description: 'Cat litter 023', amount: 8.7, paid_by: 'irene', shop_id: shop, travel_id: bali, date: '2026-10-12' },
          { description: 'Dinner 023', amount: 17.39, paid_by: 'irene', shop_id: shop, travel_id: bali, date: '2026-10-12' },
        ])
        // Existing item: stock up, and the price is the normal one (before discounts).
        expect(await row(`select current_stock::float as stock, price::float as price, price_qty::float as qty, price_unit as unit from pantry_items where id = $1`, [litter])).toEqual({ stock: 3, price: 10, qty: 2, unit: 'pack' })
        // New item: made in HOME, 1× as asked, minimum 0, normal price.
        expect(await row(`select current_stock::float as stock, one_time, min_stock::float as min, price::float as price, category_id from pantry_items where name = 'Sun cream 023'`)).toEqual({ stock: 1, one_time: true, min: 0, price: 12, category_id: 'personal-care' })
        // "Add to HOME" off: an expense only.
        expect((await row(`select count(*)::int as n from pantry_items where name = 'Dinner 023'`)).n).toBe(0)
        // The SHOP entry left the list; no SHOP entry was made for the others.
        expect(await row(`select completed, in_cart, trip_id from grocery_items where id = $1`, [entry])).toEqual({ completed: true, in_cart: false, trip_id: trip })
        expect((await row(`select count(*)::int as n from grocery_items where name in ('Sun cream 023', 'Dinner 023')`)).n).toBe(0)
        // Each line keeps its details and discounts.
        expect(await rows(`select line_kind, name, quantity::float as quantity, unit, list_total::float as list, item_discount_kind as kind, item_discount_value::float as value, coupon_share::float as coupon, grocery_item_id, grocery_snapshot->>'category_id' as category from shopping_trip_items where trip_id = $1 order by position`, [trip])).toEqual([
          { line_kind: 'money', name: 'Cat litter 023', quantity: 2, unit: 'pack', list: 10, kind: null, value: null, coupon: 1.3, grocery_item_id: entry, category: 'pet' },
          { line_kind: 'money', name: 'Sun cream 023', quantity: 1, unit: 'pcs', list: 12, kind: 'percent', value: 30, coupon: 1.09, grocery_item_id: null, category: 'personal-care' },
          { line_kind: 'money', name: 'Dinner 023', quantity: 1, unit: 'pcs', list: 20, kind: null, value: null, coupon: 2.61, grocery_item_id: null, category: null },
        ])
        // Sent again: nothing new.
        await db.query(`select * from confirm_shopping_trip($1)`, [payload])
        expect((await row(`select count(*)::int as n from expenses where trip_id = $1`, [trip])).n).toBe(3)
        expect(await stockOf(litter)).toBe(3)
      })
    })

    it('Undo (reopen) takes it all back; the SHOP entry is "to buy" again, nothing goes into the cart', async () => {
      await asMember(async () => {
        expect((await row(`select reopen_shopping_trip($1) as n`, [trip])).n).toBe(3)
      })
      expect(await snapshot()).toEqual(start)
      expect(await row(`select completed, in_cart, trip_id, cart_added_at from grocery_items where id = $1`, [entry])).toEqual({ completed: false, in_cart: false, trip_id: null, cart_added_at: null })
    })

    it('never closes a SHOP entry that is in the cart, and refuses a line without a name', async () => {
      await asMember(async () => {
        cartEntry = (await row(`insert into grocery_items (name, quantity, unit, pantry_item_id, in_cart, category_id) values ('Cat litter 023', 1, 'pack', $1, true, 'pet') returning id`, [litter])).id
        const id = '23000000-0000-0000-0000-000000000022'
        await db.query(`select * from confirm_shopping_trip($1)`, [{ id, source: 'money', trip_date: '2026-10-12', items: [{ name: 'Cat litter 023', pantry_item_id: litter, add: 1, line_total: 5, expense_category_id: pets, list_entry_id: cartEntry }] }])
        expect(await row(`select completed, in_cart from grocery_items where id = $1`, [cartEntry])).toEqual({ completed: false, in_cart: true })
        expect((await row(`select grocery_item_id from shopping_trip_items where trip_id = $1`, [id])).grocery_item_id).toBeNull()
        await db.query(`select reopen_shopping_trip($1)`, [id])
        expect(await fails(`select * from confirm_shopping_trip($1)`, [{ id: '23000000-0000-0000-0000-000000000023', source: 'money', trip_date: '2026-10-12', items: [{ name: '  ', line_total: 1 }] }])).toMatch(/needs a name/)
        await db.query(`delete from grocery_items where id = $1`, [cartEntry])
      })
    })

    it('a trip away keeps its expenses when it is deleted; its dates are checked', async () => {
      await asMember(async () => {
        expect(await fails(`insert into travels (name, start_date, end_date) values ('Backwards 023', '2026-10-10', '2026-10-01')`)).toMatch(/check/)
        expect(await fails(`insert into travels (name, kind, start_date, end_date) values ('Cruise 023', 'cruise', '2026-10-10', '2026-10-11')`)).toMatch(/check/)
        const expense = (await row(`insert into expenses (amount, description, paid_by, expense_date, travel_id) values (40, 'Hotel 023', 'shared', '2026-10-11', $1) returning id`, [bali])).id
        await db.query(`delete from travels where id = $1`, [bali])
        expect(await row(`select amount::float as amount, travel_id from expenses where id = $1`, [expense])).toEqual({ amount: 40, travel_id: null })
        await db.query(`delete from expenses where id = $1`, [expense])
      })
    })

    it('checks discounts: a percent goes up to 100, an amount is never negative', async () => {
      await asMember(async () => {
        const order = (await row(`insert into orders (item_name, price, list_price, discount_kind, discount_value) values ('Sneakers 023', 56, 80, 'percent', 30) returning id`)).id
        expect(await fails(`update orders set discount_value = 120 where id = $1`, [order])).toMatch(/orders_discount_ok/)
        expect(await fails(`update orders set discount_kind = 'amount', discount_value = 120 where id = $1`, [order])).toBeNull()
        expect(await fails(`update orders set discount_value = -1 where id = $1`, [order])).toMatch(/orders_discount_ok/)
        expect(await fails(`update orders set discount_kind = 'coupon' where id = $1`, [order])).toMatch(/orders_discount_ok/)
        await db.query(`delete from orders where id = $1`, [order])
      })
    })
  })

  describe('merging old expenses into one purchase', () => {
    let conad, lidl, groceries, pets, e, order
    const merged = '23000000-0000-0000-0000-000000000031'
    const expense = (amount, category, payer, date, shopId, description) =>
      row(`insert into expenses (amount, category_id, paid_by, expense_date, shop_id, description) values ($1, $2, $3, $4, $5, $6) returning id`, [amount, category, payer, date, shopId, description]).then((r) => r.id)
    const money = () => rows(`select id, amount::float as amount, category_id, paid_by, expense_date::text as date, description from expenses where description like 'M023%' order by id`)
    const byCategory = () => rows(`select category_id, sum(amount)::float as total from expenses where description like 'M023%' group by category_id order by category_id`)

    beforeAll(async () => {
      await asMember(async () => {
        conad = (await row(`insert into shops (name) values ('Conad 023') returning id`)).id
        lidl = (await row(`select id from shops where name = 'Lidl 023'`)).id
        groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
        pets = (await row(`select id from expense_categories where name = 'Pets 023'`)).id
        e = {
          bread: await expense(12, groceries, 'irene', '2026-10-14', conad, 'M023 bread'),
          food: await expense(20, pets, 'irene', '2026-10-14', null, 'M023 cat food'),
          fruit: await expense(5.5, groceries, 'irene', '2026-10-14', lidl, 'M023 fruit'),
          akbar: await expense(7, groceries, 'akbar', '2026-10-14', null, 'M023 akbar'),
          yesterday: await expense(3, groceries, 'irene', '2026-10-13', null, 'M023 yesterday'),
          ordered: await expense(30, pets, 'irene', '2026-10-14', null, 'M023 ordered'),
        }
        order = (await row(`insert into orders (item_name, price, expense_id) values ('M023 ordered', 30, $1) returning id`, [e.ordered])).id
      })
    })

    it('refuses what can\'t be merged, and changes nothing then', async () => {
      const startMoney = await money()
      await asMember(async () => {
        const merge = (ids, extra = {}) => fails(`select * from merge_expenses_into_purchase($1)`, [{ id: '23000000-0000-0000-0000-0000000000ff', expense_ids: ids, ...extra }])
        expect(await merge([e.bread])).toMatch(/at least two/)
        expect(await merge([e.bread, e.akbar])).toMatch(/same person/)
        expect(await merge([e.bread, e.yesterday])).toMatch(/same day/)
        expect(await merge([e.bread, e.ordered])).toMatch(/orders can't be merged/)
        expect(await merge([e.bread, '23000000-0000-0000-0000-0000000000aa'])).toMatch(/deleted meanwhile/)
      })
      expect(await money()).toEqual(startMoney)
      expect((await row(`select count(*)::int as n from shopping_trips where source = 'merged'`)).n).toBe(0)
    })

    it('merges them into one purchase: amounts, categories, dates and payers never change; one store', async () => {
      const startMoney = await money()
      const startTotals = await byCategory()
      await asMember(async () => {
        const t = await row(`select * from merge_expenses_into_purchase($1)`, [{ id: merged, expense_ids: [e.bread, e.food, e.fruit], shop_id: conad }])
        expect({ source: t.source, total: Number(t.total), shop: t.shop_id, paid: t.paid_by }).toEqual({ source: 'merged', total: 37.5, shop: conad, paid: 'irene' })
        expect((await row(`select trip_date::text as d from shopping_trips where id = $1`, [merged])).d).toBe('2026-10-14')
        expect(await rows(`select id, trip_id, shop_id, shop_before_merge, merged_at is not null as merged from expenses where id = any($1) order by amount`, [[e.bread, e.food, e.fruit]])).toEqual([
          { id: e.fruit, trip_id: merged, shop_id: conad, shop_before_merge: lidl, merged: true },
          { id: e.bread, trip_id: merged, shop_id: conad, shop_before_merge: conad, merged: true },
          { id: e.food, trip_id: merged, shop_id: conad, shop_before_merge: null, merged: true },
        ])
        // No purchase lines: nothing that undoes a purchase can reach them.
        expect((await row(`select count(*)::int as n from shopping_trip_items where trip_id = $1`, [merged])).n).toBe(0)
        // Sent again: the same purchase, nothing new.
        await db.query(`select * from merge_expenses_into_purchase($1)`, [{ id: merged, expense_ids: [e.bread, e.food, e.fruit], shop_id: conad }])
        expect(Number((await row(`select total from shopping_trips where id = $1`, [merged])).total)).toBe(37.5)
      })
      expect(await money()).toEqual(startMoney)
      expect(await byCategory()).toEqual(startTotals)
    })

    it('can never lose its expenses: Reopen is refused, and a merged expense can\'t join another purchase', async () => {
      const startMoney = await money()
      await asMember(async () => {
        expect(await fails(`select reopen_shopping_trip($1)`, [merged])).toMatch(/use Split/)
        expect(await fails(`select * from merge_expenses_into_purchase($1)`, [{ id: '23000000-0000-0000-0000-000000000032', expense_ids: [e.bread, e.yesterday] }])).toMatch(/already part of a purchase/)
      })
      expect(await money()).toEqual(startMoney)
      expect((await row(`select count(*)::int as n from expenses where trip_id = $1`, [merged])).n).toBe(3)
    })

    it('Split puts one, or all, back as single expenses with the store each had', async () => {
      await asMember(async () => {
        expect((await row(`select split_merged_purchase($1, $2) as n`, [merged, [e.food]])).n).toBe(1)
        expect(await row(`select trip_id, shop_id, merged_at from expenses where id = $1`, [e.food])).toEqual({ trip_id: null, shop_id: null, merged_at: null })
        expect(Number((await row(`select total from shopping_trips where id = $1`, [merged])).total)).toBe(17.5)
        expect((await row(`select split_merged_purchase($1) as n`, [merged])).n).toBe(2)
        expect(await rows(`select id, trip_id, shop_id, shop_before_merge from expenses where id = any($1) order by amount`, [[e.bread, e.fruit]])).toEqual([
          { id: e.fruit, trip_id: null, shop_id: lidl, shop_before_merge: null },
          { id: e.bread, trip_id: null, shop_id: conad, shop_before_merge: null },
        ])
        // Nothing left in it: the purchase is gone.
        expect((await row(`select count(*)::int as n from shopping_trips where id = $1`, [merged])).n).toBe(0)
        expect((await row(`select split_merged_purchase($1) as n`, [merged])).n).toBe(0)
      })
    })

    it('can be added to a SHOP purchase of the same day and payer; reopening that purchase keeps it', async () => {
      await asMember(async () => {
        const bread = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Bread 023', 'pcs', 1, 'bakery') returning id`)).id
        const entry = (await row(`insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id, payer) values ('Bread 023', 1, 'pcs', 2.5, 1, 'pcs', $1, true, 'bakery', 'irene') returning id`, [bread])).id
        const shopTrip = '23000000-0000-0000-0000-000000000033'
        await db.query(`select * from confirm_shopping_trip($1)`, [{ id: shopTrip, trip_date: '2026-10-14', shop_id: conad, paid_by: 'irene', items: [{ grocery_item_id: entry, line_total: 2.5, payer: 'irene', expense_category_id: groceries, pantry_item_id: bread, add: 1 }] }])
        expect(await fails(`select * from merge_expenses_into_purchase($1)`, [{ trip_id: shopTrip, expense_ids: [e.akbar] }])).toMatch(/paid by someone else/)
        expect(await fails(`select * from merge_expenses_into_purchase($1)`, [{ trip_id: shopTrip, expense_ids: [e.yesterday] }])).toMatch(/only the same day/)
        const t = await row(`select * from merge_expenses_into_purchase($1)`, [{ trip_id: shopTrip, expense_ids: [e.food] }])
        expect({ source: t.source, total: Number(t.total) }).toEqual({ source: 'shop', total: 22.5 })
        // Sent again: nothing new.
        await db.query(`select * from merge_expenses_into_purchase($1)`, [{ trip_id: shopTrip, expense_ids: [e.food] }])
        expect(Number((await row(`select total from shopping_trips where id = $1`, [shopTrip])).total)).toBe(22.5)
        expect(await row(`select trip_id, shop_id from expenses where id = $1`, [e.food])).toEqual({ trip_id: shopTrip, shop_id: conad })

        expect((await row(`select reopen_shopping_trip($1) as n`, [shopTrip])).n).toBe(1)
        // The purchase's own expense is undone; the merged one stays, single again.
        expect((await row(`select count(*)::int as n from expenses where description = 'Bread 023'`)).n).toBe(0)
        expect(await row(`select amount::float as amount, category_id, trip_id, shop_id, merged_at from expenses where id = $1`, [e.food])).toEqual({ amount: 20, category_id: pets, trip_id: null, shop_id: null, merged_at: null })
        expect(await stockOf(bread)).toBe(1)
        expect(await row(`select in_cart, completed from grocery_items where id = $1`, [entry])).toEqual({ in_cart: true, completed: false })
        await db.query(`delete from grocery_items where id = $1`, [entry])
        await db.query(`delete from orders where id = $1`, [order])
      })
    })
  })

  describe('HOME Manage: deleting a category in use, moving a sub-category', () => {
    let pets
    const item = (name, category, sub) => row(`insert into pantry_items (name, unit, current_stock, category_id, subcategory_id) values ($1, 'pcs', 1, $2, $3) returning id`, [name, category, sub]).then((r) => r.id)
    const where = (id) => row(`select category_id, subcategory_id from pantry_items where id = $1`, [id])

    beforeAll(async () => {
      pets = (await row(`select id from expense_categories where name = 'Pets 023'`)).id
      await asMember(async () => {
        await db.exec(`
          insert into inventory_categories (id, name, parent_id, type, sort_order) values
            ('garden-023', 'Garden 023', null, 'parent', 90), ('outdoor-023', 'Outdoor 023', null, 'parent', 91), ('patio-023', 'Patio 023', null, 'parent', 92),
            ('garden-023:seeds', 'Seeds 023', 'garden-023', 'sub', 1), ('garden-023:tools', 'Tools 023', 'garden-023', 'sub', 2);
        `)
      })
    })

    it('moves everything of a main category (its sub-categories too) to another one, then deletes it', async () => {
      await asMember(async () => {
        const basil = await item('Basil seeds 023', 'garden-023', 'garden-023:seeds')
        const rake = await item('Rake 023', 'garden-023', 'garden-023:tools')
        const hose = await item('Hose 023', 'garden-023', null)
        await db.query(`insert into grocery_items (name, quantity, unit, category_id, subcategory_id) values ('Hose 023', 1, 'pcs', 'garden-023', null)`)
        await db.query(`insert into category_memory (id, name, category_id, subcategory_id) values ('basil seeds 023', 'Basil seeds 023', 'garden-023', 'garden-023:seeds')`)
        await db.query(`insert into category_budget_map (id, expense_category_id) values ('garden-023', $1)`, [pets])
        const stockBefore = await rows(`select id, current_stock::float as s from pantry_items order by id`)
        const result = (await row(`select merge_inventory_category('garden-023', 'outdoor-023') as r`)).r
        expect(result).toEqual({ items: 3, list_entries: 1, memory: 1, subcategories: 2 })
        expect(await where(basil)).toEqual({ category_id: 'outdoor-023', subcategory_id: 'garden-023:seeds' })
        expect(await where(rake)).toEqual({ category_id: 'outdoor-023', subcategory_id: 'garden-023:tools' })
        expect(await where(hose)).toEqual({ category_id: 'outdoor-023', subcategory_id: null })
        expect((await row(`select category_id from grocery_items where name = 'Hose 023'`)).category_id).toBe('outdoor-023')
        expect(await row(`select category_id, subcategory_id from category_memory where id = 'basil seeds 023'`)).toEqual({ category_id: 'outdoor-023', subcategory_id: 'garden-023:seeds' })
        expect(await rows(`select id, parent_id from inventory_categories where id like 'garden-023%' order by id`)).toEqual([
          { id: 'garden-023:seeds', parent_id: 'outdoor-023' },
          { id: 'garden-023:tools', parent_id: 'outdoor-023' },
        ])
        // Its own budget mapping is gone; stock never changes.
        expect((await row(`select count(*)::int as n from category_budget_map where id = 'garden-023'`)).n).toBe(0)
        expect(await rows(`select id, current_stock::float as s from pantry_items order by id`)).toEqual(stockBefore)

        // A sub-category into another sub-category.
        expect((await row(`select merge_inventory_category('garden-023:tools', 'garden-023:seeds') as r`)).r).toMatchObject({ items: 1 })
        expect(await where(rake)).toEqual({ category_id: 'outdoor-023', subcategory_id: 'garden-023:seeds' })
        expect((await row(`select count(*)::int as n from inventory_categories where id = 'garden-023:tools'`)).n).toBe(0)
      })
    })

    it('refuses what would lose items or break Home & Appliances', async () => {
      await asMember(async () => {
        expect(await fails(`select merge_inventory_category('appliances', 'outdoor-023')`)).toMatch(/can't be deleted/)
        expect(await fails(`select merge_inventory_category('appliances:kitchen', 'outdoor-023')`)).toMatch(/Home & Appliances/)
        expect(await fails(`select merge_inventory_category('outdoor-023', 'appliances:kitchen')`)).toMatch(/Home & Appliances/)
        expect(await fails(`select merge_inventory_category('outdoor-023', 'garden-023:seeds')`)).toMatch(/pick a category outside it/)
        expect(await fails(`select merge_inventory_category('outdoor-023', 'snacks:sweet')`)).toMatch(/has sub-categories/)
        expect(await fails(`select merge_inventory_category('outdoor-023', 'outdoor-023')`)).toMatch(/another category/)
        expect(await fails(`select merge_inventory_category('no-such-023', 'outdoor-023')`)).toMatch(/no longer exists/)
        expect((await row(`select count(*)::int as n from inventory_categories where id in ('outdoor-023', 'appliances', 'appliances:kitchen')`)).n).toBe(3)
      })
    })

    it('moves a sub-category with its items; a main category without sub-categories can become one', async () => {
      await asMember(async () => {
        const basil = (await row(`select id from pantry_items where name = 'Basil seeds 023'`)).id
        const chair = await item('Chair 023', 'patio-023', null)
        // Sub-category → under another main category: its items follow.
        expect((await row(`select move_inventory_subcategory('garden-023:seeds', 'patio-023') as r`)).r).toMatchObject({ items: 2, memory: 1 })
        expect(await where(basil)).toEqual({ category_id: 'patio-023', subcategory_id: 'garden-023:seeds' })
        expect((await row(`select category_id from category_memory where id = 'basil seeds 023'`)).category_id).toBe('patio-023')
        // A main category with sub-categories can't become a sub-category.
        expect(await fails(`select move_inventory_subcategory('patio-023', 'outdoor-023')`)).toMatch(/can't become a sub-category/)
        // Sub-category → main category.
        await db.query(`select move_inventory_subcategory('garden-023:seeds', null)`)
        expect(await row(`select parent_id, type from inventory_categories where id = 'garden-023:seeds'`)).toEqual({ parent_id: null, type: 'parent' })
        expect(await where(basil)).toEqual({ category_id: 'garden-023:seeds', subcategory_id: null })
        // Main category (now without sub-categories) → a sub-category.
        await db.query(`select move_inventory_subcategory('patio-023', 'outdoor-023')`)
        expect(await row(`select parent_id, type from inventory_categories where id = 'patio-023'`)).toEqual({ parent_id: 'outdoor-023', type: 'sub' })
        expect(await where(chair)).toEqual({ category_id: 'outdoor-023', subcategory_id: 'patio-023' })
        // Home & Appliances stays where it is, and nothing moves into it.
        expect(await fails(`select move_inventory_subcategory('appliances', 'outdoor-023')`)).toMatch(/can't be moved/)
        expect(await fails(`select move_inventory_subcategory('patio-023', 'appliances')`)).toMatch(/Home & Appliances/)
        expect(await fails(`select move_inventory_subcategory('appliances:kitchen', 'outdoor-023')`)).toMatch(/Home & Appliances/)
        expect(await fails(`select move_inventory_subcategory('patio-023', 'patio-023')`)).toMatch(/main category|inside itself/)
      })
    })
  })

  it('remembers who chose a name\'s category, and its budget category', async () => {
    await asMember(async () => {
      const pets = (await row(`select id from expense_categories where name = 'Pets 023'`)).id
      await db.query(`insert into category_memory (id, name, category_id, expense_category_id, source) values ('vet visit 023', 'Vet visit 023', null, $1, 'ai')`, [pets])
      expect(await row(`select source, expense_category_id from category_memory where id = 'vet visit 023'`)).toEqual({ source: 'ai', expense_category_id: pets })
      expect((await row(`select source from category_memory where id = 'basil seeds 023'`)).source).toBe('user')
      expect(await fails(`update category_memory set source = 'robot' where id = 'vet visit 023'`)).toMatch(/check/)
    })
  })

  describe('round 4: the MONEY purchase form, as the app builds it', () => {
    let groceries, toiletries, milk, entry, cartEntry, chips, lays, tuc
    const form = (rows) => rows.map((r, i) => ({ ...emptyRow(i + 1), ...r }))
    const pantry = async () => rows(`select id, name, unit, current_stock::float as current_stock, min_stock::float as min_stock, is_group, group_id, one_time, quantity_per_pack, packaging_unit from pantry_items`)
    const linesFor = async (formRows) => {
      const items = await pantry()
      const withVariants = items.map((p) => (p.is_group ? { ...p, variants: items.filter((v) => v.group_id === p.id) } : p))
      return form(formRows).map((r) => rowLine(r, withVariants))
    }
    const save = async (id, lines, extra = {}) => {
      const grocery = await rows(`select id, name, pantry_item_id, completed, in_cart from grocery_items`)
      const payload = moneyPurchasePayload({
        id,
        date: '2026-10-20',
        at: '2026-10-20T10:00:00Z',
        paidBy: 'shared',
        lines,
        budgetFor: (line) => (line.row.categoryId === 'toiletries' ? toiletries : groceries),
        entryOf: (line) => listEntryFor(line.row.name, line.target, grocery),
        ...extra,
      })
      return asMember(() => row(`select * from confirm_shopping_trip($1)`, [payload]))
    }
    const reopen = (id) => asMember(async () => (await row(`select reopen_shopping_trip($1) as n`, [id])).n)

    beforeAll(async () => {
      await asMember(async () => {
        groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
        toiletries = (await row(`insert into expense_categories (name) values ('Toiletries R4') returning id`)).id
        milk = (await row(`insert into pantry_items (name, unit, current_stock, min_stock, category_id) values ('Milk R4', 'btl', 3, 2, 'dairy') returning id`)).id
        entry = (await row(`insert into grocery_items (name, quantity, unit, pantry_item_id, auto_generated, category_id) values ('Milk R4', 1, 'btl', $1, true, 'dairy') returning id`, [milk])).id
        chips = (await row(`insert into pantry_items (name, unit, current_stock, min_stock, is_group, category_id) values ('Chips R4', 'pack', 0, 2, true, 'snacks') returning id`)).id
        lays = (await row(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Lays R4', 'pack', 2, $1, 'snacks') returning id`, [chips])).id
        tuc = (await row(`insert into pantry_items (name, unit, current_stock, group_id, category_id) values ('Tuc R4', 'pack', 0, $1, 'snacks') returning id`, [chips])).id
      })
    })

    it('two rows with Add to HOME off: one purchase, two expenses, nothing in HOME; Undo leaves nothing', async () => {
      const id = '24000000-0000-0000-0000-000000000001'
      const start = await snapshot()
      const lines = await linesFor([
        { name: 'Test bread R4', priceText: '2', categoryId: 'bakery', addToHome: false },
        { name: 'Test shampoo R4', priceText: '4', categoryId: 'toiletries', addToHome: false },
      ])
      const t = await save(id, lines)
      expect({ source: t.source, total: Number(t.total) }).toEqual({ source: 'money', total: 6 })
      expect(await rows(`select description, amount::float as amount, category_id, paid_by from expenses where trip_id = $1 order by amount`, [id])).toEqual([
        { description: 'Test bread R4', amount: 2, category_id: groceries, paid_by: 'shared' },
        { description: 'Test shampoo R4', amount: 4, category_id: toiletries, paid_by: 'shared' },
      ])
      expect((await row(`select count(*)::int as n from pantry_items where name like 'Test % R4'`)).n).toBe(0)
      expect(await reopen(id)).toBe(2)
      expect(await snapshot()).toEqual(start)
    })

    it('an existing HOME item: its stock goes up, its SHOP entry "to buy" leaves the list; Undo puts the stock back exactly, no History left', async () => {
      const id = '24000000-0000-0000-0000-000000000002'
      const start = await snapshot()
      const lines = await linesFor([{ name: 'milk r4', priceText: '2,40', quantityText: '2', unit: 'btl', categoryId: 'dairy' }])
      expect(lines[0]).toMatchObject({ home: true, add: 2, isNew: false })
      await save(id, lines)
      expect(await stockOf(milk)).toBe(5)
      expect(await row(`select completed, trip_id from grocery_items where id = $1`, [entry])).toEqual({ completed: true, trip_id: id })
      expect((await row(`select count(*)::int as n from stock_logs where item_id = $1`, [milk])).n).toBe(1)
      // Pressed again (same id): saved once.
      await save(id, lines)
      expect(await stockOf(milk)).toBe(5)
      expect((await row(`select count(*)::int as n from expenses where trip_id = $1`, [id])).n).toBe(1)

      expect(await reopen(id)).toBe(1)
      expect(await stockOf(milk)).toBe(3)
      expect((await row(`select count(*)::int as n from stock_logs where item_id = $1`, [milk])).n).toBe(0)
      expect(await row(`select completed, in_cart from grocery_items where id = $1`, [entry])).toEqual({ completed: false, in_cart: false })
      expect(await snapshot()).toEqual(start)
    })

    it('round 6: item discounts and a purchase discount, as the form builds them — the expense is what was paid, the HOME price stays the normal one, Undo leaves nothing', async () => {
      const id = '24000000-0000-0000-0000-000000000006'
      const start = await snapshot()
      const built = await linesFor([
        { name: 'Test sneakers R6', priceText: '80', discountKind: 'percent', discountText: '30', categoryId: 'toiletries', addToHome: false },
        { name: 'milk r4', priceText: '6', unit: 'btl', categoryId: 'dairy', discountKind: 'percent', discountText: '50' },
        { name: 'Test cat food R6', priceText: '20', categoryId: 'toiletries', addToHome: false },
      ])
      // 80 −30% = 56, 6 −50% = 3, 20 → 79 after item discounts; coupon −€7.90 over them
      const { lines, priced } = pricedLines(built, { kind: 'amount', text: '7,90' })
      expect(lines.map((l) => l.paid)).toEqual([50.4, 2.7, 18.0])
      const t = await save(id, lines, { priced })
      expect({ total: Number(t.total), kind: t.coupon_kind, value: Number(t.coupon_value), coupon: Number(t.coupon_total) }).toEqual({ total: 71.1, kind: 'amount', value: 7.9, coupon: 7.9 })
      expect(await rows(`select amount::float as amount from expenses where trip_id = $1 order by amount`, [id])).toEqual([{ amount: 2.7 }, { amount: 18 }, { amount: 50.4 }])
      expect(await rows(`select name, line_total::float as paid, list_total::float as list, item_discount_kind as kind, item_discount_value::float as value, coupon_share::float as share from shopping_trip_items where trip_id = $1 order by position`, [id])).toEqual([
        { name: 'Test sneakers R6', paid: 50.4, list: 80, kind: 'percent', value: 30, share: 5.6 },
        { name: 'milk r4', paid: 2.7, list: 6, kind: 'percent', value: 50, share: 0.3 },
        { name: 'Test cat food R6', paid: 18, list: 20, kind: null, value: null, share: 2 },
      ])
      // The HOME item keeps the normal price (€6 for 1 btl), not the €2.70 paid.
      expect(await row(`select price::float as price, price_qty::float as price_qty from pantry_items where id = $1`, [milk])).toEqual({ price: 6, price_qty: 1 })
      expect(await reopen(id)).toBe(3)
      expect(await snapshot()).toEqual(start)
    })

    it('an entry in the cart is never closed; a group gives its stock to the chosen variant, never to the group', async () => {
      const id = '24000000-0000-0000-0000-000000000003'
      await db.query(`update grocery_items set in_cart = true where id = $1`, [entry])
      cartEntry = entry
      const lines = await linesFor([
        { name: 'Milk R4', priceText: '1.20', unit: 'btl', categoryId: 'dairy' },
        { name: 'Chips R4', priceText: '1.99', unit: 'pack', categoryId: 'snacks' },
      ])
      // The group's first variant at 0 is taken until the user picks.
      expect(lines[1].target.id).toBe(tuc)
      await save(id, lines)
      expect(await row(`select completed, in_cart from grocery_items where id = $1`, [cartEntry])).toEqual({ completed: false, in_cart: true })
      expect(await stockOf(tuc)).toBe(1)
      expect(await stockOf(lays)).toBe(2)
      expect(await stockOf(chips)).toBe(0)
      expect(await reopen(id)).toBe(2)
      expect(await stockOf(tuc)).toBe(0)
      await db.query(`update grocery_items set in_cart = false where id = $1`, [entry])
    })

    it('a new item is made in HOME with 1× and its minimum; Undo deletes it again', async () => {
      const id = '24000000-0000-0000-0000-000000000004'
      const lines = await linesFor([
        { name: 'Sun cream R4', priceText: '9', categoryId: 'personal-care', oneTime: true },
        { name: 'Soap R4', priceText: '1', categoryId: 'toiletries', minText: '2' },
      ])
      await save(id, lines)
      expect(await rows(`select name, current_stock::float as stock, one_time, min_stock::float as min from pantry_items where name in ('Sun cream R4', 'Soap R4') order by name`)).toEqual([
        { name: 'Soap R4', stock: 1, one_time: false, min: 2 },
        { name: 'Sun cream R4', stock: 1, one_time: true, min: 0 },
      ])
      await reopen(id)
      expect((await row(`select count(*)::int as n from pantry_items where name in ('Sun cream R4', 'Soap R4')`)).n).toBe(0)
      await db.query(`delete from grocery_items where id = $1`, [entry])
      await db.query(`delete from pantry_items where id = any($1)`, [[milk, lays, tuc, chips]])
    })
  })
})

describe('024: new HOME and MONEY categories, found by id so renames never break it', () => {
  const file = '024_categories.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const rows = async (text, params) => (await db.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  // Runs the whole file; the result of its last SELECT (the check).
  const run = async () => (await db.exec(sql)).at(-1).rows
  // A scenario that is undone afterwards, so each one starts from the
  // same live-like data.
  async function undone(fn) {
    await db.exec('begin')
    try {
      return await fn()
    } finally {
      await db.exec('rollback')
    }
  }
  const TRIPS = 'dc79f604-19fd-4bdd-817e-335816c4afe7'
  const HEALTH = '06729df9-06b2-4465-955b-17d03f3fe125'
  const PETS = 'ecd9a924-7f46-4991-83ce-02825c73ce42'
  const PHARMACY = '8fbe343f-6fd9-4c58-874b-d9bd809be461'
  const PERSONAL_CARE = 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb'
  const FLIGHTS = '38455d3e-ab33-4eae-8088-e6c9e4e55b3e'
  const snapshot = async () => ({
    home: await rows(`select id, name, parent_id, type, sort_order from inventory_categories order by id`),
    money: await rows(`select id::text, name, parent_id::text, type from expense_categories order by id`),
    map: await rows(`select id, expense_category_id::text from category_budget_map order by id`),
    incomeCategories: await rows(`select id::text, name, parent_id::text, type from income_categories order by id`),
    income: await rows(`select id::text, amount::float, category_id::text from income order by id`),
  })
  const statuses = (check) => Object.fromEntries(check.map((r) => [`${r.section} · ${r.planned}`, r.status]))
  let live

  beforeAll(async () => {
    // The live data of 21/10/2026, as far as 024 needs it: the MONEY mains
    // it adds subs to (by their live ids), the Trips subs that exist, HOME
    // Laundry Fragrance (renamed by hand from "Perfume") and the two
    // mapping rows.
    await db.exec(`
      insert into expense_categories (id, name, type, parent_id) values
        ('${TRIPS}', 'Trips & Holidays', 'parent', null),
        ('688bfedf-8e4c-4b59-860f-3a55c33f50d1', 'Subscription', 'parent', null),
        ('744f7d8e-c90d-49d3-ad03-72c6e81aad9d', 'Entertainment', 'parent', null),
        ('8b2d4f49-af1d-41af-bd19-9050a7689164', 'Car / Vehicle', 'parent', null),
        ('${HEALTH}', 'Health', 'parent', null),
        ('${PETS}', 'Pets', 'parent', null),
        ('b498cc5d-95ea-4666-89f2-11973222ec2c', 'Bank & Fee', 'parent', null);
      insert into expense_categories (id, name, type, parent_id) values
        ('5d4cc03f-a148-43b1-b2eb-2186012a20c9', 'Transport', 'sub', '${TRIPS}'),
        ('72cb10f3-3fbd-4bb1-b0f8-81c5cc357077', 'Accommodation', 'sub', '${TRIPS}'),
        ('2b571b2a-1676-4c23-ae1c-46ec11613359', 'Food & Drinks', 'sub', '${TRIPS}'),
        ('df3c1786-b4e8-40b8-b55a-b74f8816e7c2', 'Activities', 'sub', '${TRIPS}');
      insert into inventory_categories (id, name, parent_id, type, sort_order) values
        ('e8e447c7-3b68-4eee-81e8-86915839565f', 'Laundry Fragrance', 'laundry', 'sub', 4);
      insert into category_budget_map (id, expense_category_id) values ('pet', '${PETS}'), ('health', '${HEALTH}');
    `)
    live = await snapshot()
  })

  it('only adds rows: no delete, no rename, no table, policy or grant; the one UPDATE is the guarded health mapping', () => {
    const code = sql.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/\b(delete|drop|truncate|alter|create|grant|revoke|policy)\b/i)
    expect(code.match(/\bupdate\s+\w+/gi)).toEqual(['update category_budget_map'])
    expect(code).toMatch(/where id = 'health'\s+and expense_category_id = '06729df9-06b2-4465-955b-17d03f3fe125'/)
    expect(code).not.toMatch(/income/i)
  })

  it('with the Trips main renamed "Travel" before 024, Flights, Souvenirs and Insurance & Visas still go under it', async () => {
    await undone(async () => {
      await db.query(`update expense_categories set name = 'Travel' where id = $1`, [TRIPS])
      const check = await run()
      expect(await rows(`select name from expense_categories where parent_id = $1 order by name`, [TRIPS])).toEqual(
        ['Accommodation', 'Activities', 'Flights', 'Food & Drinks', 'Insurance & Visas', 'Souvenirs', 'Transport'].map((name) => ({ name }))
      )
      expect(check.find((r) => r.planned === 'Flights')).toMatchObject({ current_name: 'Flights', current_main: 'Travel', status: 'ok' })
    })
  })

  it('run, rename "Personal Care" and "Flights", run again: nothing is duplicated and the new names stay', async () => {
    await undone(async () => {
      await run()
      const counts = await row(`select (select count(*)::int from expense_categories) as money, (select count(*)::int from inventory_categories) as home, (select count(*)::int from category_budget_map) as map`)
      await db.query(`update expense_categories set name = 'Cura personale' where id = $1`, [PERSONAL_CARE])
      await db.query(`update expense_categories set name = 'Voli' where id = $1`, [FLIGHTS])
      const check = await run()
      expect(await row(`select (select count(*)::int from expense_categories) as money, (select count(*)::int from inventory_categories) as home, (select count(*)::int from category_budget_map) as map`)).toEqual(counts)
      expect((await row(`select count(*)::int as n from expense_categories where name in ('Personal Care', 'Flights')`)).n).toBe(0)
      expect(check.find((r) => r.planned === 'Personal Care')).toMatchObject({ current_name: 'Cura personale', status: 'ok' })
      expect(check.find((r) => r.planned === 'Hairdresser')).toMatchObject({ current_main: 'Cura personale', status: 'ok' })
      expect(check.find((r) => r.planned === 'Flights')).toMatchObject({ current_name: 'Voli', status: 'ok' })
      expect(check.find((r) => r.planned.startsWith('Beauty Care →'))).toMatchObject({ current_main: 'Cura personale › Beauty & Perfume', status: 'ok' })
    })
  })

  it('leaves a health mapping changed by hand alone, and says so', async () => {
    await undone(async () => {
      await db.query(`update category_budget_map set expense_category_id = $1 where id = 'health'`, [PETS])
      const check = await run()
      expect((await row(`select expense_category_id::text as id from category_budget_map where id = 'health'`)).id).toBe(PETS)
      expect(statuses(check)['3 mapping · Health & Medicine → Health › Pharmacy']).toBe('left: changed by hand')
    })
  })

  it('skips a name that already exists in other capitals (HOME and MONEY), and the subs of a skipped main', async () => {
    await undone(async () => {
      await db.exec(`
        insert into inventory_categories (id, name, parent_id, type, sort_order) values ('hand-perfume', ' perfume ', 'personal-care', 'sub', 9), ('baby-care', 'BABY', null, 'parent', 20);
        insert into expense_categories (name, type, parent_id) values ('flights', 'sub', '${TRIPS}'), ('family support', 'parent', null);
      `)
      const check = statuses(await run())
      expect((await row(`select count(*)::int as n from inventory_categories where id in ('personal-care:perfume', 'baby', 'baby:diapers')`)).n).toBe(0)
      expect((await row(`select count(*)::int as n from expense_categories where id in ($1, '54c1355d-5ebb-4237-ae67-1be0ca593443')`, [FLIGHTS])).n).toBe(0)
      expect((await row(`select count(*)::int as n from expense_categories where lower(name) = 'flights'`)).n).toBe(1)
      expect(check['1 HOME · Perfume']).toBe('skipped: name exists')
      expect(check['1 HOME · Baby']).toBe('skipped: name exists')
      expect(check['1 HOME · Diapers']).toBe('skipped: parent missing')
      expect(check['2 MONEY · Flights']).toBe('skipped: name exists')
      expect(check['2 MONEY · Family Support']).toBe('skipped: name exists')
      expect(check['2 MONEY · Souvenirs']).toBe('ok')
      expect(check['5 duplicate names · HOME']).toBe('ok')
    })
  })

  it('skips the subs of a MONEY main that was deleted, and the check says so', async () => {
    await undone(async () => {
      await db.query(`delete from expense_categories where id = 'b498cc5d-95ea-4666-89f2-11973222ec2c'`)
      const check = statuses(await run())
      expect(check['2 MONEY · Taxes & Fines']).toBe('skipped: parent missing')
      expect(check['2 MONEY · Documents & Permits']).toBe('skipped: parent missing')
      expect(check['2 MONEY · Fuel']).toBe('ok')
    })
  })

  it('the real run: every check is ok, existing rows are untouched except the health mapping, income too; run twice gives the same rows', async () => {
    const check = await run()
    expect(check.length).toBeLessThan(100)
    expect(check.filter((r) => r.section.startsWith('1 '))).toHaveLength(16)
    expect(check.filter((r) => r.section.startsWith('2 '))).toHaveLength(23)
    expect(check.filter((r) => r.section.startsWith('3 '))).toHaveLength(4)
    for (const r of check.filter((r) => !r.section.startsWith('4 '))) {
      expect(['ok', 'updated'], `${r.section} · ${r.planned}`).toContain(r.status)
    }
    expect(statuses(check)['3 mapping · Health & Medicine → Health › Pharmacy']).toBe('updated')
    expect(check.find((r) => r.planned === 'Health & Medicine → Health › Pharmacy').current_main).toBe('Health › Pharmacy')
    expect(check.find((r) => r.planned === 'Car Care → Car / Vehicle').current_main).toBe('Car / Vehicle')

    // Every row that existed before is exactly as it was, except the
    // health mapping (Health → Health › Pharmacy).
    const after = await snapshot()
    const same = (list, now) => list.map((r) => now.find((x) => x.id === r.id))
    expect(same(live.home, after.home)).toEqual(live.home)
    expect(same(live.money, after.money)).toEqual(live.money)
    expect(same(live.map, after.map)).toEqual(live.map.map((r) => (r.id === 'health' ? { ...r, expense_category_id: PHARMACY } : r)))
    expect(after.incomeCategories).toEqual(live.incomeCategories)
    expect(after.income).toEqual(live.income)
    expect(after.home.length - live.home.length).toBe(16)
    expect(after.money.length - live.money.length).toBe(23)
    expect(after.map.length - live.map.length).toBe(3)
    expect(await row(`select name, parent_id, type, sort_order from inventory_categories where id = 'baby'`)).toEqual({ name: 'Baby', parent_id: null, type: 'parent', sort_order: 14 })

    // Again: the same rows; the health row now says "already Pharmacy".
    const again = await run()
    expect(await snapshot()).toEqual(after)
    expect(statuses(again)['3 mapping · Health & Medicine → Health › Pharmacy']).toBe('already Pharmacy')
    for (const r of again.filter((r) => !r.section.startsWith('4 '))) {
      expect(['ok', 'already Pharmacy'], `${r.section} · ${r.planned}`).toContain(r.status)
    }
  })
})

describe('025: data fix for the SHOP purchase at Action on 17/10/2026', () => {
  const file = '025_action_17_10_fix.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const MEMBER = '2d8a40ba-d751-4c22-9662-df3b758a4749'
  const TRIP = '1d47dd08-f03a-4df8-a214-ac00f671d54f'
  // The new MONEY sub-categories: fixed ids, the same in 025 and in
  // docs/plan-oct-2026.md (9E).
  const NEW = {
    accessories: 'b13b4e6b-a8d6-4e03-8ca1-0d775c8c2d7e',
    homeTextiles: 'f924edef-bf90-477d-8303-ddc4a2b27391',
    homeDecor: '3472a299-73f6-4249-bee4-a5469d1c807a',
    petAccessories: 'd0c05f29-1418-485f-9433-b4b0e97c2423',
  }
  // Live MONEY ids (tmp-export, 24/10/2026).
  const M = {
    groceries: '61f92237-3392-4f71-aca8-4dbb1df9b256',
    other: '6d9d08f2-c8a7-4f40-bf88-9e5de1b44449',
    pharmacy: '8fbe343f-6fd9-4c58-874b-d9bd809be461',
    beauty: '4eb77042-660a-41e9-a1b6-cd2057605256',
    toiletries: '01a993f2-d9af-4881-bc8e-1df5af027000',
    shopping: '654a80a3-2e6f-4ada-b214-0486d91d869c',
    clothing: '732af8e0-924c-471c-b0e8-ac9286ce074e',
    shoes: '0f7f387b-0c4a-4095-8865-59cfac4c586a',
    homeAppliances: '199ec782-505a-4292-984e-08ae1d76469f',
    kitchenAppliances: '4125ed9e-da65-4b76-8e35-cb1239d8093b',
    kitchenware: 'a364fa44-7513-47ca-aabc-7c5254c0a961',
    pets: 'ecd9a924-7f46-4991-83ce-02825c73ce42',
    health: '06729df9-06b2-4465-955b-17d03f3fe125',
  }
  const HAIR = '3ff635c0-7fd1-46ff-ac49-8e408c032398'
  const PET_TREATS = '3d924169-d334-44ee-947a-3e3a498706fc'

  // The 31 lines as in Irene's export of 24/10/2026 (check-action-1-lines):
  // [line, name, quantity, unit, paid, HOME item, its name, main, sub, 1×,
  // stock now, expense, budget category]. A line without a HOME item was an
  // appliance (expense only); its main / sub is the category in the line.
  const LINES = [
    ['e95ae4da-51f4-40f1-9e49-2058ecd0ebe3', 'big towel', 1, 'pcs', 0.69, 'e4250e5b-910e-466f-9e27-194fb1257af7', 'big towel', 'clothes', null, true, 1, '92b2b31e-5b74-44a9-a2fe-7d3e941befe4', M.shopping],
    ['8cfce438-a1a5-438c-975e-87b42d589683', 'bonnet hair cover for sleeping', 1, 'pcs', 0.35, '68f96d81-a730-4341-8590-dd4d08f36863', 'bonnet hair cover for sleeping', 'clothes', null, true, 1, 'd7575954-3c5e-45d7-aea7-c70189ea18bc', M.shopping],
    ['fef3d676-3ba2-4333-94de-be190232199b', 'bra', 1, 'pcs', 1.74, 'e8c07826-8ecf-4ff2-9f8e-ebc4d653b154', 'bra', 'clothes', null, false, 1, '54dda4c1-dfdc-424a-9578-0e55c2f7d4c5', M.shopping],
    ['e9a8a655-233d-45eb-8554-262ee53dc582', 'Cat House Christmas Tree', 1, 'pcs', 1.74, 'a35c5cfd-e5df-4614-88ce-9ef2d269d228', 'Cat House Christmas Tree', 'misc', 'misc:seasonal', true, 1, 'ecb05397-a0a5-4fe3-9545-383e8a5ab49d', M.groceries],
    ['45089ecd-9bd4-44fa-aba5-abb7e6385b7a', 'cat toy', 1, 'pcs', 0.29, 'c37b962d-19d2-4d8a-bf90-2502cb3305aa', 'cat toy', 'pet', PET_TREATS, true, 1, 'f5577c71-1527-4f8f-bf9a-f877225b4416', M.pets],
    ['718ac5d6-5159-4bd5-88ca-44b7e02b40b0', 'Cat wet food', 8, 'pcs', 1.95, '65e4e9b1-71a6-4dee-8da1-a4df615e5421', 'Cat Wet Food', 'pet', 'pet:food', false, 104, 'f6cbb58a-f032-4563-8f4c-6c40fc00412a', M.pets],
    ['22a8272b-731f-424f-8dc3-fb96c6c1494c', 'ceramic bowl', 1, 'pcs', 0.45, null, null, 'appliances', 'appliances:kitchenware', false, 0, '5bc262b5-8033-4a6d-a4ec-13f52659418f', M.kitchenware],
    ['e404f138-8d15-42cb-8af8-4459fabfea5c', 'cheesy chili sauce', 1, 'btl', 0.83, '6d913041-0e82-45ba-a3fd-60ef08aeaf2b', 'cheesy chili sauce', 'pantry-staples', 'pantry-staples:sauces', false, 1, '71d29dae-8422-4f03-8f6a-0c94736f8324', M.groceries],
    ['3e932369-d04c-4e68-a027-3446c3d5fa77', 'cleaning sponges', 1, 'pack', 0.27, 'c00bce61-acfb-47ff-87a9-5871a866239f', 'cleaning sponges', 'cleaning', 'cleaning:tools', false, 1, 'ef4be733-451a-41d3-bd8c-80d8671cbfc1', M.groceries],
    ['e75e3734-5380-401d-bcf3-81545e2124d2', 'coffee syrup', 6, 'pcs', 1.39, 'f3556bde-425d-4bdf-b58a-cd8de81bf74c', 'coffee syrup', null, null, true, 6, '6c27e414-ff8d-46d9-86a5-f01be3b57b27', M.groceries],
    ['49fb0cbd-89eb-4e36-9a32-a447a37eb61d', 'Dish soap', 1, 'btl', 0.47, '71009106-c8f8-4a1b-9046-e00312377410', 'Dish soap', 'cleaning', 'cleaning:dish', false, 1, '09183598-bf28-4389-a2fd-db39cbd4329b', M.groceries],
    ['e7dacee7-5037-467e-998c-4176f70cb818', 'Dishwasher Detergent', 1, 'pack', 0.83, null, null, 'appliances', 'appliances:kitchen', false, 0, '5b04fc1c-153a-412e-960b-1465656339b0', M.kitchenAppliances],
    ['747ed6ad-4882-469f-962b-60e3419baad7', 'eletrolytes powder', 1, 'pcs', 1.74, '4e0c3dd0-88de-4c38-9267-0f039d0005b0', 'eletrolytes powder', 'misc', null, true, 1, '1d96c083-ef57-4d5e-b380-e1da9fe6f254', M.groceries],
    ['3d12223f-4e83-4094-8cec-22a5c2639a77', 'eye mask', 1, 'pcs', 0.35, 'c2ba9a90-6c56-4945-b0b6-7b320836f870', 'eye mask', 'personal-care', null, true, 1, 'f46ff8fe-27b7-4884-9a04-8ea35c62ca28', M.beauty],
    ['6590160e-15f2-4614-9dc5-7bd678afba4e', 'face serum milk', 1, 'pack', 0.63, '0d2cfa7e-6dc6-4aa3-8282-15ca888ddff8', 'face serum milk', 'personal-care', 'personal-care:skin', true, 1, '1ed4614b-ff05-4d26-9f1a-d985f3d84046', M.beauty],
    ['04be8150-492a-4813-b372-c6ebbcce109d', 'hair clip', 1, 'pcs', 0.35, 'f02fe6a2-8daf-469d-b5a9-faf893da60fb', 'hair clip', 'personal-care', null, false, 1, 'df31b3d4-b0ff-4e9b-afbc-dcc871139cb0', M.beauty],
    ['d4a11c6a-ca81-410f-8abc-27e078af70b1', 'hair oil', 1, 'btl', 0.8, 'ea21e2e4-8ed6-43f8-b9a3-8750aa296250', 'hair oil', 'toiletries', 'toiletries:hair', false, 1, '8ad2e519-fea1-43ad-b663-2af866c1d3b3', M.toiletries],
    ['c5a57022-370b-4e11-b0a9-6d735e83a943', 'hair water', 1, 'btl', 0.68, '5fa2c1d5-fb3c-4eec-a74f-9745aa1ef547', 'hair water', 'personal-care', HAIR, true, 1, '18dffaeb-cdf0-4f32-9c09-928be13cf7ae', M.beauty],
    ['f2eb0500-a8c0-497c-927a-e96b282d8b08', 'hairband', 1, 'pcs', 0.41, '53cbd441-1ba1-4243-9cf5-391666296b5e', 'hairband', 'personal-care', null, true, 1, 'b3154fe2-b92f-4172-be9f-c01db9176963', M.beauty],
    ['14e49fbc-c52b-41ef-82a5-d97fe7b9f8b3', 'incense holder', 1, 'pcs', 0.97, 'afd18a37-53de-472e-835b-4687c740d342', 'incense holder', 'household', 'household:air', true, 1, '10985ab4-80d1-43c3-807a-7d03dcee51d0', M.groceries],
    ['fd04417a-a40d-483a-a71e-80f092d71668', 'inox sponges', 4, 'pcs', 0.19, 'cef3aefe-fd62-40d2-9c50-7e38c3d10f72', 'inox sponges', 'cleaning', 'cleaning:tools', false, 4, 'c18b5a63-298e-466c-aadd-4728812ec9c4', M.groceries],
    ['4840f450-d4b3-4f3e-8301-376233f613a7', 'liquid measuring glass', 1, 'pcs', 1.04, null, null, 'appliances', 'appliances:kitchenware', false, 0, 'f4d618b5-bce3-40ae-8016-382375e04ebb', M.kitchenware],
    ['48bfc064-2515-498f-9f74-ac89e495553d', 'Oven Detergent', 1, 'btl', 0.61, null, null, 'appliances', 'appliances:kitchen', false, 0, 'b0558eea-4dde-4094-a743-440cc72ab83d', M.kitchenAppliances],
    ['17580f08-9827-45fd-8109-982607ac30d0', 'perfume', 2, 'btl', 1.79, '7e59e4f4-e044-49d6-94ad-6ec461b4aed4', 'perfume', 'personal-care', 'personal-care:perfume', false, 2, '608e5e2f-c27e-4bae-894b-c84901944b20', M.beauty],
    ['d7a06b7b-1f6b-4a90-9f32-5b7602b895b3', 'powder set makeup', 1, 'pcs', 1.04, '5c926e35-1cdb-4902-8ab0-6917d2015384', 'powder set makeup', 'personal-care', 'personal-care:makeup', false, 1, '781effa6-4b77-4777-be8d-2d168d956bd3', M.beauty],
    ['440bfc12-7065-4417-b08b-a1d9a9664ab6', 'shower gel', 1, 'pcs', 0.55, '3f702df8-4a06-4f6e-9bbc-c4a4fceb1800', 'shower gel', 'toiletries', 'toiletries:soap', false, 1, 'aa5b2ea8-9392-4250-a068-c34358a746ca', M.toiletries],
    ['aaa18000-cc38-4e1a-887f-d2c4862c4557', 'small towel', 1, 'pcs', 0.24, 'd3365efa-e523-4d3c-93a3-d4fadd5218c9', 'small towel', 'clothes', null, true, 1, '8e5dff64-b8e3-4b3d-869f-f592a922a2ea', M.shopping],
    ['ba22a5e1-7366-4007-a04a-808255524464', 'Spicy truffle sauce', 1, 'btl', 0.83, 'a987bf2f-2386-4a34-b71f-c7b8ef7ef162', 'Spicy truffle sauce', 'pantry-staples', 'pantry-staples:sauces', false, 1, 'c3806be3-0db8-4d69-a440-d37a062bdafb', M.groceries],
    ['0f71336a-648f-44b5-a864-b3b868b1dc46', 'Toilet Paper', 10, 'pcs', 0.99, '5ffdeba2-dec6-4b70-9737-157ea4b9a34b', 'Toilet Paper', 'toiletries', 'toiletries:paper', false, 14, 'e19dada4-bfa9-4f6f-ae03-2af118de7cb6', M.toiletries],
    ['faec2ec3-915e-4992-a901-ce13884b9003', 'toy elf Christmas', 1, 'pcs', 1.04, '8b164c9e-524f-4ed5-9fd0-1deaed235956', 'toy elf Christmas', 'misc', 'misc:seasonal', true, 1, 'a4473501-f21b-49f8-9118-0c5e1ab899cf', M.groceries],
    ['c11feacd-2761-474c-99a1-b6cb7c7772ba', 'washing machine powder', 1, 'pcs', 1.51, 'c97a568a-2807-48f0-8de5-d671ddd048ac', 'washing machine powder', 'laundry', 'laundry:stain', false, 1, '9051246b-53be-4c8d-bcde-29c87c3060ce', M.groceries],
  ].map(([id, name, qty, unit, paid, item, itemName, main, sub, oneTime, stock, expense, budget]) => ({ id, name, qty, unit, paid, item, itemName, main, sub, oneTime, stock, expense, budget }))
  // HOME items bought before this purchase: their stock before it, and their minimum.
  const BOUGHT_BEFORE = { '65e4e9b1-71a6-4dee-8da1-a4df615e5421': { before: 96, min: 24 }, '5ffdeba2-dec6-4b70-9737-157ea4b9a34b': { before: 4, min: 5 } }
  // Not in the real purchase: discounts on two lines, so the tests see them stay.
  const DISCOUNTS = {
    '0f71336a-648f-44b5-a864-b3b868b1dc46': { list: 1.29, kind: 'amount', value: 0.3, coupon: 0 },
    'e95ae4da-51f4-40f1-9e49-2058ecd0ebe3': { list: 0.99, kind: 'percent', value: 30, coupon: 0 },
  }
  const DURABLE = ['big towel', 'small towel', 'toy elf Christmas', 'incense holder', 'bra', 'bonnet hair cover for sleeping', 'hair clip', 'hairband', 'Cat House Christmas Tree', 'cat toy']
  const durableLines = LINES.filter((l) => DURABLE.includes(l.name))
  const lineNamed = (name) => LINES.find((l) => l.name === name)

  let fx
  const rows = async (text, params) => (await fx.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  // The file as Irene runs it (its own begin … commit); the result of its
  // last SELECT (the check).
  const run = async () => (await fx.exec(sql)).at(-1).rows
  // Inside a scenario that is rolled back afterwards: the same file without
  // its own begin / commit (a commit would end the scenario's transaction).
  const runInside = async () => (await fx.exec(sql.replace(/^begin;$/m, '').replace(/^commit;$/m, ''))).at(-1).rows
  async function undone(fn) {
    await fx.exec('begin')
    try {
      return await fn()
    } finally {
      await fx.exec('rollback')
    }
  }
  async function asMember(fn) {
    await fx.query(`select set_config('request.jwt.claim.sub', $1, false)`, [MEMBER])
    await fx.exec('set role authenticated')
    try {
      return await fn()
    } finally {
      await fx.exec('reset role')
    }
  }
  const lineRow = (check, item) => check.find((r) => r.section === '1 line' && r.item === item)
  const statusOf = (check, section, item) => check.find((r) => r.section === section && r.item === item)?.status

  // What must never change: the purchase, its money, its lines' amounts
  // and discounts, and the stock and 1× of every HOME item that stays.
  const untouchable = async () => ({
    trip: await row(`select id, trip_date::text as date, total::float as total, shop_id, paid_by, source, coupon_kind, coupon_value::float as coupon_value, coupon_total::float as coupon_total, receipt_match from shopping_trips where id = $1`, [TRIP]),
    expenses: await rows(`select id, amount::float as amount, expense_date::text as date, paid_by, shop_id, trip_id, merged_at, travel_id from expenses order by id`),
    lines: await rows(`select id, trip_id, position, line_total::float as total, list_total::float as list, item_discount_kind, item_discount_value::float as discount, coupon_share::float as coupon, quantity::float as quantity, unit, expense_id, grocery_item_id, line_kind from shopping_trip_items order by id`),
    stock: await rows(`select id, current_stock::float as stock, min_stock::float as min, one_time, unit, price::float as price, expiry_date::text as expiry from pantry_items where id <> all($1::uuid[]) order by id`, [durableLines.map((l) => l.item)]),
  })
  // Every row 025 may touch, as stored (with their update times).
  const everything = async () => ({
    expenses: await rows(`select * from expenses order by id`),
    lines: await rows(`select * from shopping_trip_items order by id`),
    entries: await rows(`select * from grocery_items order by id`),
    items: await rows(`select * from pantry_items order by id`),
    logs: await rows(`select * from stock_logs order by id`),
    memory: await rows(`select * from category_memory order by id`),
    home: await rows(`select * from inventory_categories order by id`),
    money: await rows(`select * from expense_categories order by id`),
    map: await rows(`select * from category_budget_map order by id`),
    trips: await rows(`select * from shopping_trips order by id`),
  })

  beforeAll(async () => {
    // Its own database: the MONEY categories need their live ids, and
    // Groceries / Home & Appliances already exist (from 008) with other
    // ids in the shared one.
    fx = await newDatabase()
    for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-3])_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
      await fx.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    // The live MONEY categories (by their ids), the two mapping rows of
    // 21/10, then 024 as it was run.
    await fx.exec(`delete from expense_categories`)
    for (const c of [...LIVE_MONEY_CATEGORIES.filter((c) => !c.parent_id), ...LIVE_MONEY_CATEGORIES.filter((c) => c.parent_id)]) {
      await fx.query(`insert into expense_categories (id, name, type, parent_id) values ($1, $2, $3, $4)`, [c.id, c.name, c.parent_id ? 'sub' : 'parent', c.parent_id])
    }
    await fx.query(`insert into category_budget_map (id, expense_category_id) values ('pet', $1), ('health', $2)`, [M.pets, M.health])
    await fx.exec(fs.readFileSync(path.join(dir, '024_categories.sql'), 'utf8'))

    // HOME categories made by hand: Hair Water, Pet Treats & Care, and the
    // main "clothes" (24/10, booked to Shopping).
    await fx.exec(`
      insert into inventory_categories (id, name, parent_id, type, sort_order) values
        ('${HAIR}', 'Hair Water', 'personal-care', 'sub', 6),
        ('${PET_TREATS}', 'Pet Treats & Care', 'pet', 'sub', 3),
        ('clothes', 'clothes', null, 'parent', 20);
      insert into category_budget_map (id, expense_category_id) values ('clothes', '${M.shopping}');
      insert into shops (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Action');
      -- Not part of this purchase: never touched.
      insert into pantry_items (name, unit, current_stock, category_id, subcategory_id) values ('Rice', 'pcs', 3, 'pantry-staples', 'pantry-staples:grains');
      insert into expenses (category_id, amount, description, expense_date) values ('${M.shoes}', 3.5, 'Shoe Deodorizer', '2026-10-10');
    `)

    // The purchase, as SHOP Confirm purchase made it on 24/10 (dated
    // 17/10): each entry in the cart is copied into its line, then
    // marked bought.
    await fx.query(`insert into shopping_trips (id, trip_date, total, shop_id, paid_by, source) values ($1, '2026-10-17', 26.76, 'aaaaaaaa-0000-4000-8000-000000000001', 'shared', 'shop')`, [TRIP])
    for (const [i, l] of LINES.entries()) {
      const before = BOUGHT_BEFORE[l.item]
      if (l.item) {
        await fx.query(
          `insert into pantry_items (id, name, unit, current_stock, category_id, subcategory_id, one_time, min_stock, last_purchased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, '2026-10-24T10:00:00Z', $9)`,
          [l.item, l.itemName, l.unit, l.stock, l.main, l.sub, l.oneTime, before?.min ?? 0, before ? '2026-10-04T10:00:00Z' : '2026-10-24T10:00:00Z']
        )
      }
      const entry = (
        await row(
          `insert into grocery_items (name, quantity, unit, price, price_qty, price_unit, category_id, subcategory_id, in_cart, pantry_item_id, payer) values ($1, $2, $3, $4, $2, $3, $5, $6, true, $7, 'shared') returning id`,
          [l.name, l.qty, l.unit, l.paid, l.main, l.sub, before ? l.item : null]
        )
      ).id
      await fx.query(`insert into expenses (id, category_id, amount, description, paid_by, expense_date, trip_id, shop_id) values ($1, $2, $3, $4, 'shared', '2026-10-17', $5, 'aaaaaaaa-0000-4000-8000-000000000001')`, [l.expense, l.budget, l.paid, l.name, TRIP])
      const logs = l.item ? [(await row(`insert into stock_logs (item_id, item_name, change, new_stock, unit, reason) values ($1, $2, $3, $4, $5, 'purchased') returning id`, [l.item, l.itemName, l.qty, l.stock, l.unit])).id] : []
      const d = DISCOUNTS[l.id]
      await fx.query(
        `insert into shopping_trip_items (id, trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created, pantry_before, stock_added, expense_id, log_ids, line_kind, quantity, unit, list_total, item_discount_kind, item_discount_value, coupon_share)
         select $1, $2, $3, g.id, to_jsonb(g), g.name, $4, $5, $6, $7, $8, $9, $10, 'shop', g.quantity, g.unit, $11, $12, $13, $14 from grocery_items g where g.id = $15`,
        [l.id, TRIP, i + 1, l.paid, l.item, Boolean(l.item) && !before, before ? { price: null, price_qty: null, price_unit: null, payer: 'shared' } : null, l.item ? l.qty : 0, l.expense, logs, d?.list ?? null, d?.kind ?? null, d?.value ?? null, d?.coupon ?? 0, entry]
      )
      await fx.query(`update grocery_items set completed = true, in_cart = false, expense_id = $1, pantry_item_id = $2, trip_id = $3 where id = $4`, [l.expense, l.item, TRIP, entry])
    }

    // Remembered names as in the export.
    await fx.exec(`
      insert into category_memory (id, name, category_id, subcategory_id, source) values
        ('big towel', 'big towel', 'clothes', null, 'user'),
        ('bonnet hair cover for sleeping', 'bonnet hair cover for sleeping', 'clothes', null, 'user'),
        ('bra', 'bra', 'clothes', null, 'user'),
        ('cat wet food', 'Cat wet food', 'pet', 'pet:food', 'user'),
        ('eletrolytes powder', 'eletrolytes powder', 'misc', null, 'user'),
        ('eye mask', 'eye mask', 'personal-care', null, 'user'),
        ('face serum milk', 'face serum milk', 'personal-care', 'personal-care:skin', 'user'),
        ('hair clip', 'hair clip', 'personal-care', null, 'user'),
        ('hair water', 'hair water', 'personal-care', '${HAIR}', 'user'),
        ('hairband', 'hairband', 'personal-care', null, 'user'),
        ('small towel', 'small towel', 'clothes', null, 'user'),
        ('washing machine powder', 'washing machine powder', 'laundry', 'laundry:stain', 'user');
    `)
  }, 120000)

  it('the fixture is the purchase of the export: 31 lines, 31 expenses, € 26.76', async () => {
    expect(await row(`select count(*)::int as n, sum(amount)::float as total from expenses where trip_id = $1`, [TRIP])).toEqual({ n: 31, total: 26.76 })
    expect((await row(`select count(*)::int as n from shopping_trip_items where trip_id = $1`, [TRIP])).n).toBe(31)
  })

  it('one transaction; no table, policy or grant; the purchase itself and its amounts are never written', () => {
    const code = sql.replace(/--.*$/gm, '')
    expect(code.match(/^begin;$/gm)).toHaveLength(1)
    expect(code.match(/^commit;$/gm)).toHaveLength(1)
    expect(code).not.toMatch(/\b(drop|truncate|alter|create|grant|revoke|policy|anon)\b/i)
    expect(code).not.toMatch(/\bupdate\s+shopping_trips\b/i)
    expect(code.match(/\b(?:update|delete from|insert into)\s+\w+/gi).map((s) => s.toLowerCase().replace(/\s+/g, ' ')).sort()).toEqual(
      [
        'delete from category_memory',
        'delete from inventory_categories',
        'delete from pantry_items',
        'delete from stock_logs',
        'insert into category_memory',
        'insert into expense_categories',
        'insert into inventory_categories',
        'update category_memory',
        'update expense_categories',
        'update expenses',
        'update expenses',
        'update grocery_items',
        'update grocery_items',
        'update grocery_items',
        'update inventory_categories',
        'update pantry_items',
        'update pantry_items',
        'update shopping_trip_items',
        'update shopping_trip_items',
        'update shopping_trip_items',
      ].sort()
    )
    // No SET ever writes an amount, a date, a payer, a store, a purchase
    // link, a quantity, a discount, stock or 1×.
    const sets = [...code.matchAll(/\bset\b([\s\S]*?)(?:\bfrom\b|\bwhere\b)/gi)].map((m) => m[1])
    expect(sets.length).toBeGreaterThan(10)
    for (const s of sets) {
      expect(s).not.toMatch(/\b(amount|expense_date|paid_by|shop_id|trip_id|merged_at|line_total|list_total|item_discount_kind|item_discount_value|coupon_share|quantity|unit|current_stock|min_stock|one_time|total|completed|in_cart)\s*=/)
    }
    // MONEY categories are found by id: no name of a MONEY category in what
    // the file writes (the check reads Groceries and Home & Appliances by
    // name, as the app does).
    const writes = code.split(/^commit;$/m)[0]
    expect(writes).not.toMatch(/name\s*=\s*'(Groceries|Home & Appliances|Shopping|Pets|Health|Personal Care|Other)'/)
  })

  it('the new MONEY ids are fixed: the same in 025 and in the plan', () => {
    const plan = fs.readFileSync(path.join(dir, '..', 'docs', 'plan-oct-2026.md'), 'utf8')
    for (const id of Object.values(NEW)) {
      expect(sql).toContain(id)
      expect(plan).toContain(id)
    }
  })

  it('the remembered-name keys are what the app makes of the names (normalizeName)', () => {
    const keys = {
      'eletrolytes powder': 'eletrolytes powder',
      'washing machine powder': 'washing machine powder',
      hairband: 'hairband',
      'bonnet hair cover for sleeping': 'bonnet hair cover for sleeping',
      'Electrolytes Powder': 'electrolytes powder',
      'eye mask': 'eye mask',
      'hair oil': 'hair oil',
      'hair water': 'hair water',
      'coffee syrup': 'coffee syrup',
      'Stain Remover Powder': 'stain remover powder',
      'Dishwasher Detergent': 'dishwasher detergent',
      'Oven Detergent': 'oven detergent',
      'big towel': 'big towel',
      'small towel': 'small towel',
      'toy elf Christmas': 'toy elf christmas',
      'incense holder': 'incense holder',
      bra: 'bra',
      'Satin Bonnet': 'satin bonnet',
      'hair clip': 'hair clip',
      Headband: 'headband',
      'Cat House Christmas Tree': 'cat house christmas tree',
      'cat toy': 'cat toy',
    }
    for (const [name, key] of Object.entries(keys)) {
      expect(normalizeName(name), name).toBe(key)
      expect(sql).toContain(`('${key}', `)
    }
  })

  it('a category renamed by hand before 025 is never renamed back; one renamed after it stays too', async () => {
    await undone(async () => {
      await fx.query(`update expense_categories set name = 'Scarpe' where id = $1`, [M.shoes])
      await fx.query(`update inventory_categories set name = 'Capelli' where id = $1`, [HAIR])
      const check = await runInside()
      expect((await row(`select name from expense_categories where id = $1`, [M.shoes])).name).toBe('Scarpe')
      expect((await row(`select name from inventory_categories where id = $1`, [HAIR])).name).toBe('Capelli')
      expect(statusOf(check, '4 renamed', 'MONEY Shoes & Accessories → Footwear')).toBe('left: renamed by hand')
      expect(statusOf(check, '4 renamed', 'HOME Hair Water → Hair Care')).toBe('left: renamed by hand')
      expect(check.filter((r) => r.section !== '4 renamed').every((r) => r.status === 'ok')).toBe(true)
    })
    await undone(async () => {
      await runInside()
      await fx.query(`update expense_categories set name = 'Shoes' where id = $1`, [M.shoes])
      await fx.query(`update inventory_categories set name = 'Hair' where id = $1`, [HAIR])
      await fx.query(`update expense_categories set name = 'Gatti' where id = $1`, [NEW.petAccessories])
      const check = await runInside()
      expect((await row(`select name from expense_categories where id = $1`, [M.shoes])).name).toBe('Shoes')
      expect((await row(`select name from inventory_categories where id = $1`, [HAIR])).name).toBe('Hair')
      expect((await row(`select count(*)::int as n from expense_categories where lower(name) in ('footwear', 'pet accessories & toys')`)).n).toBe(0)
      expect(lineRow(check, 'cat toy').budget_category).toBe('Pets › Gatti')
    })
  })

  it('a value changed by hand in the app is left alone, and the check says so', async () => {
    await undone(async () => {
      await fx.query(`update expenses set category_id = $1 where id = $2`, [M.other, lineNamed('bra').expense])
      await fx.query(`update category_memory set subcategory_id = 'personal-care:makeup' where id = 'eye mask'`)
      const check = await runInside()
      expect((await row(`select category_id from expenses where id = $1`, [lineNamed('bra').expense])).category_id).toBe(M.other)
      expect(await row(`select category_id, subcategory_id from category_memory where id = 'eye mask'`)).toEqual({ category_id: 'personal-care', subcategory_id: 'personal-care:makeup' })
      expect(lineRow(check, 'bra').status).toBe('CHECK: budget category')
      expect(statusOf(check, '6 remembered names', 'eye mask')).toBe('CHECK: remembered differently (left alone)')
      // Everything else is still fixed.
      expect(lineRow(check, 'Satin Bonnet').status).toBe('ok')
    })
  })

  it('"clothes" is kept while something still uses it, and the check says what', async () => {
    await undone(async () => {
      await fx.query(`insert into pantry_items (name, unit, current_stock, category_id) values ('Scarf', 'pcs', 1, 'clothes')`)
      const check = await runInside()
      expect((await row(`select count(*)::int as n from inventory_categories where id = 'clothes'`)).n).toBe(1)
      expect((await row(`select expense_category_id from category_budget_map where id = 'clothes'`)).expense_category_id).toBe(M.shopping)
      expect(statusOf(check, '5 clothes', 'HOME category "clothes" deleted')).toBe('kept: still used (see the next row)')
      expect(check.find((r) => r.item === 'nothing points to "clothes"')).toMatchObject({ value: 'HOME items 1, budget mapping 1', status: 'CHECK: still used' })
      // The purchase is fixed all the same.
      expect(check.filter((r) => r.section === '1 line').every((r) => r.status === 'ok')).toBe(true)
    })
  })

  it('a HOME item "Shoe Deodorizer" leaves HOME like the other durables (its expense stays); not while it is in a cart', async () => {
    const tigota = 'bbbbbbbb-0000-4000-8000-000000000002'
    const setUp = async (inCart) => {
      const item = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Shoe deodorizer', 'pcs', 1, 'household') returning id`)).id
      const entry = (await row(`insert into grocery_items (name, quantity, unit, price, category_id, completed, pantry_item_id) values ('Shoe deodorizer', 1, 'pcs', 3.5, 'household', true, $1) returning id`, [item])).id
      const expense = (await row(`select id from expenses where description = 'Shoe Deodorizer'`)).id
      const log = (await row(`insert into stock_logs (item_id, item_name, change, new_stock, unit, reason) values ($1, 'Shoe deodorizer', 1, 1, 'pcs', 'purchased') returning id`, [item])).id
      await fx.query(`insert into shopping_trips (id, trip_date, total, source) values ($1, '2026-10-10', 3.5, 'shop')`, [tigota])
      await fx.query(`update expenses set trip_id = $1 where id = $2`, [tigota, expense])
      await fx.query(`update grocery_items set trip_id = $1, expense_id = $2 where id = $3`, [tigota, expense, entry])
      await fx.query(
        `insert into shopping_trip_items (trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created, stock_added, expense_id, log_ids) select $1, 1, g.id, to_jsonb(g), g.name, 3.5, $2, true, 1, $3, $4 from grocery_items g where g.id = $5`,
        [tigota, item, expense, [log], entry]
      )
      if (inCart) await fx.query(`insert into grocery_items (name, quantity, unit, in_cart, pantry_item_id) values ('Shoe deodorizer', 1, 'pcs', true, $1)`, [item])
      return { item, entry, expense }
    }
    await undone(async () => {
      const { item, entry, expense } = await setUp(false)
      const check = await runInside()
      expect((await row(`select count(*)::int as n from pantry_items where id = $1`, [item])).n).toBe(0)
      expect((await row(`select count(*)::int as n from stock_logs where item_id = $1 or item_name = 'Shoe deodorizer'`, [item])).n).toBe(0)
      expect(await row(`select pantry_item_id, pantry_created, stock_added::float as added, log_ids from shopping_trip_items where trip_id = $1`, [tigota])).toEqual({ pantry_item_id: null, pantry_created: false, added: 0, log_ids: [] })
      expect((await row(`select pantry_item_id from grocery_items where id = $1`, [entry])).pantry_item_id).toBe(null)
      expect(await row(`select amount::float as amount, category_id from expenses where id = $1`, [expense])).toEqual({ amount: 3.5, category_id: M.shoes })
      expect(statusOf(check, '7 Shoe Deodorizer', 'no HOME item "Shoe Deodorizer"')).toBe('ok')
      // Reopening that purchase works and puts nothing into HOME.
      expect((await asMember(() => row(`select reopen_shopping_trip($1) as n`, [tigota]))).n).toBe(1)
      expect((await row(`select count(*)::int as n from pantry_items where lower(name) = 'shoe deodorizer'`)).n).toBe(0)
    })
    await undone(async () => {
      const { item } = await setUp(true)
      const check = await runInside()
      expect((await row(`select count(*)::int as n from pantry_items where id = $1`, [item])).n).toBe(1)
      expect(check.find((r) => r.section === '7 Shoe Deodorizer')).toMatchObject({ value: 'Shoe deodorizer (in a cart)', status: 'CHECK: kept (see value)' })
    })
  })

  it('the real run: every check is ok; amounts, discounts, the purchase and the stock that stays are untouched', async () => {
    const before = await untouchable()
    const check = await run()
    expect(check.length).toBeLessThan(100)
    expect(check.filter((r) => r.section === '1 line')).toHaveLength(31)
    for (const r of check) expect(r.status, `${r.section} · ${r.item}: ${r.value ?? ''}`).toBe('ok')
    expect(await untouchable()).toEqual(before)

    // The lines, as the check shows them.
    expect(lineRow(check, 'Electrolytes Powder')).toMatchObject({ line_name: 'Electrolytes Powder', expense_description: 'Electrolytes Powder', home_item: 'Electrolytes Powder', budget_category: 'Health › Pharmacy', mapping_button: 'no change' })
    expect(lineRow(check, 'hair oil')).toMatchObject({ home_category: 'Beauty Care › Hair Care', budget_category: 'Personal Care › Beauty & Perfume', mapping_button: 'no change' })
    expect(lineRow(check, 'Dishwasher Detergent')).toMatchObject({ home_item: 'none', home_category: 'line: Cleaning Supplies › Dishwashing', budget_category: 'Groceries', mapping_button: 'no change' })
    expect(lineRow(check, 'big towel')).toMatchObject({ home_item: 'none', home_category: 'line: Home & Appliances › Home Textiles', budget_category: 'Home & Appliances › Home Textiles', mapping_button: 'no change' })
    expect(lineRow(check, 'incense holder')).toMatchObject({ budget_category: 'Home & Appliances › Home Decor', mapping_button: 'no change' })
    expect(lineRow(check, 'Satin Bonnet')).toMatchObject({ home_item: 'none', home_category: 'line: no category', budget_category: 'Shopping › Accessories', mapping_button: 'would move to Groceries (known: app fix in a later round)' })
    expect(lineRow(check, 'cat toy')).toMatchObject({ budget_category: 'Pets › Pet Accessories & Toys' })
    expect(lineRow(check, 'ceramic bowl')).toMatchObject({ value: 'not changed by 025', budget_category: 'Home & Appliances › Kitchenware & Utensils', mapping_button: 'no change' })
    expect(check.find((r) => r.item === 'MONEY Shoes & Accessories → Footwear').value).toBe('Shopping › Footwear')
    expect(check.find((r) => r.item === 'HOME Home & Appliances › Home Textiles').value).toBe('Home & Appliances › Home Textiles · books to Home & Appliances › Home Textiles')

    // The durable items are gone with their history; their expenses stay,
    // with the new categories; their lines and entries no longer point at them.
    for (const l of durableLines) {
      expect((await row(`select count(*)::int as n from pantry_items where id = $1`, [l.item])).n, l.name).toBe(0)
      expect((await row(`select count(*)::int as n from stock_logs where item_id = $1 or item_name = $2`, [l.item, l.itemName])).n, l.name).toBe(0)
      expect(await row(`select pantry_item_id, pantry_created, pantry_before, stock_added::float as added, log_ids, grocery_snapshot->'pantry_item_id' as snap from shopping_trip_items where id = $1`, [l.id])).toEqual({ pantry_item_id: null, pantry_created: false, pantry_before: null, added: 0, log_ids: [], snap: null })
      expect((await row(`select g.pantry_item_id from grocery_items g join shopping_trip_items l on l.grocery_item_id = g.id where l.id = $1`, [l.id])).pantry_item_id).toBe(null)
    }
    const budgets = Object.fromEntries((await rows(`select description, category_id from expenses where trip_id = $1`, [TRIP])).map((e) => [e.description, e.category_id]))
    expect(budgets).toMatchObject({
      'big towel': NEW.homeTextiles,
      'small towel': NEW.homeTextiles,
      'toy elf Christmas': NEW.homeDecor,
      'incense holder': NEW.homeDecor,
      bra: M.clothing,
      'Satin Bonnet': NEW.accessories,
      'hair clip': NEW.accessories,
      Headband: NEW.accessories,
      'Cat House Christmas Tree': NEW.petAccessories,
      'cat toy': NEW.petAccessories,
      'Electrolytes Powder': M.pharmacy,
      'hair oil': M.beauty,
      'eye mask': M.beauty,
      'Dishwasher Detergent': M.groceries,
      'Oven Detergent': M.groceries,
      'Stain Remover Powder': M.groceries,
      'ceramic bowl': M.kitchenware,
    })
    expect(await rows(`select name, category_id, subcategory_id from pantry_items where id = any($1::uuid[]) order by lower(name)`, [['4e0c3dd0-88de-4c38-9267-0f039d0005b0', 'c97a568a-2807-48f0-8de5-d671ddd048ac', 'f3556bde-425d-4bdf-b58a-cd8de81bf74c', 'ea21e2e4-8ed6-43f8-b9a3-8750aa296250', 'c2ba9a90-6c56-4945-b0b6-7b320836f870']])).toEqual([
      { name: 'coffee syrup', category_id: 'beverages', subcategory_id: 'beverages:coffee-tea' },
      { name: 'Electrolytes Powder', category_id: 'health', subcategory_id: 'health:vitamins' },
      { name: 'eye mask', category_id: 'personal-care', subcategory_id: 'personal-care:skin' },
      { name: 'hair oil', category_id: 'personal-care', subcategory_id: HAIR },
      { name: 'Stain Remover Powder', category_id: 'laundry', subcategory_id: 'laundry:stain' },
    ])
    expect((await row(`select count(*)::int as n from inventory_categories where id = 'clothes'`)).n).toBe(0)
    expect((await row(`select count(*)::int as n from category_budget_map where id = 'clothes'`)).n).toBe(0)
    expect(await rows(`select id, name, category_id, subcategory_id, expense_category_id, source from category_memory where id in ('big towel', 'bra', 'satin bonnet', 'cat wet food') order by id`)).toEqual([
      { id: 'big towel', name: 'big towel', category_id: 'appliances', subcategory_id: 'appliances:textiles', expense_category_id: NEW.homeTextiles, source: 'user' },
      { id: 'bra', name: 'bra', category_id: null, subcategory_id: null, expense_category_id: M.clothing, source: 'user' },
      { id: 'cat wet food', name: 'Cat wet food', category_id: 'pet', subcategory_id: 'pet:food', expense_category_id: null, source: 'user' },
      { id: 'satin bonnet', name: 'Satin Bonnet', category_id: null, subcategory_id: null, expense_category_id: NEW.accessories, source: 'user' },
    ])
    expect((await row(`select count(*)::int as n from expenses where description = 'Shoe Deodorizer' and category_id = $1`, [M.shoes])).n).toBe(1)
  })

  it('"Apply the mapping to past purchases" (the app\'s own code) moves none of the 31 expenses, except the 6 Shopping / Pets durables', async () => {
    const ctx = {
      expenseCategories: await rows(`select id, name, parent_id from expense_categories`),
      inventoryCategories: await rows(`select id, name, parent_id from inventory_categories`),
      mapRows: await rows(`select id, expense_category_id from category_budget_map`),
    }
    const tripLines = await rows(`select id, expense_id, grocery_snapshot, line_kind from shopping_trip_items where expense_id is not null`)
    const groceries = await rows(`select id, expense_id, category_id, subcategory_id from grocery_items where expense_id is not null`)
    const byExpense = purchasedItemsByExpense({ groceries, tripLines })
    const expenses = await rows(`select id, category_id, amount::float as amount, description from expenses where trip_id = $1`, [TRIP])
    const { changes } = pastPurchaseChanges(expenses, (id) => byExpense.get(id) ?? null, ctx)
    expect(changes.map((c) => [c.expense.description, c.to]).sort()).toEqual(
      [['bra', M.groceries], ['Satin Bonnet', M.groceries], ['hair clip', M.groceries], ['Headband', M.groceries], ['Cat House Christmas Tree', M.groceries], ['cat toy', M.groceries]].sort()
    )
    // The check of 025 says the same, line by line.
    const check = (await fx.exec(sql.split(/^commit;$/m)[1])).at(-1).rows
    const moved = check.filter((r) => r.section === '1 line' && r.mapping_button !== 'no change').map((r) => r.item)
    expect(moved.sort()).toEqual(changes.map((c) => c.expense.description).sort())
  })

  it('run again: nothing changes (not even an update time), and every check is still ok', async () => {
    const after = await everything()
    const check = await run()
    expect(await everything()).toEqual(after)
    for (const r of check) expect(r.status, `${r.section} · ${r.item}`).toBe('ok')
  })

  it('Reopen of the purchase still works: it deletes only what this purchase made, and puts nothing into HOME for the durables', async () => {
    await undone(async () => {
      const others = await rows(`select id, name, current_stock::float as stock from pantry_items where id <> all($1::uuid[]) order by id`, [LINES.map((l) => l.item).filter(Boolean)])
      expect((await asMember(() => row(`select reopen_shopping_trip($1) as n`, [TRIP]))).n).toBe(31)
      // Items bought before it get their stock back; items it made are
      // deleted (as Reopen always does); nothing else changes.
      expect(await rows(`select id, current_stock::float as stock from pantry_items where id = any($1::uuid[]) order by id`, [Object.keys(BOUGHT_BEFORE)])).toEqual(
        Object.entries(BOUGHT_BEFORE).map(([id, b]) => ({ id, stock: b.before })).sort((a, b) => a.id.localeCompare(b.id))
      )
      expect((await row(`select count(*)::int as n from pantry_items where id = any($1::uuid[])`, [LINES.map((l) => l.item).filter((id) => id && !BOUGHT_BEFORE[id])])).n).toBe(0)
      expect(others.map((p) => p.name)).toContain('Rice')
      expect(await rows(`select id, name, current_stock::float as stock from pantry_items where id <> all($1::uuid[]) order by id`, [LINES.map((l) => l.item).filter(Boolean)])).toEqual(others)
      // No HOME item for any durable line, and no stock history left.
      expect((await row(`select count(*)::int as n from pantry_items where lower(name) = any($1)`, [[...DURABLE, 'Satin Bonnet', 'Headband'].map((n) => n.toLowerCase())])).n).toBe(0)
      expect((await row(`select count(*)::int as n from stock_logs`)).n).toBe(0)
      // Its expenses are gone (Reopen undoes the purchase); the store's other expense stays.
      expect((await row(`select count(*)::int as n from expenses where trip_id = $1 or id = any($2::uuid[])`, [TRIP, LINES.map((l) => l.expense)])).n).toBe(0)
      expect((await row(`select count(*)::int as n from expenses where description = 'Shoe Deodorizer'`)).n).toBe(1)
      // Every entry is back in the cart with its fixed name and category;
      // the durable ones point at no HOME item.
      const cart = await rows(`select name, category_id, subcategory_id, pantry_item_id from grocery_items where in_cart and not completed order by name`)
      expect(cart).toHaveLength(31)
      expect(cart.find((g) => g.name === 'Satin Bonnet')).toEqual({ name: 'Satin Bonnet', category_id: null, subcategory_id: null, pantry_item_id: null })
      expect(cart.find((g) => g.name === 'big towel')).toEqual({ name: 'big towel', category_id: 'appliances', subcategory_id: 'appliances:textiles', pantry_item_id: null })
      expect(cart.find((g) => g.name === 'Dishwasher Detergent')).toMatchObject({ category_id: 'cleaning', subcategory_id: 'cleaning:dish' })
      expect(cart.find((g) => g.name === 'Electrolytes Powder')).toMatchObject({ category_id: 'health', subcategory_id: 'health:vitamins' })
    })
  })
})
