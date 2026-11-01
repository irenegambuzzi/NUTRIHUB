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
const { emptyRow, listEntryFor, moneyPurchasePayload, pricedLines, rowLine, rowProblem } = await import('../src/lib/moneyPurchase.js')
// For 025: the remembered-name keys and "Apply the mapping to past purchases", as the app works them out.
const { normalizeName } = await import('../src/lib/categoryGuess.js')
const { budgetCategoryFor, pastPurchaseChanges, purchasedItemsByExpense } = await import('../src/lib/budgetMap.js')
const { LIVE_MONEY_CATEGORIES } = await import('../src/data/moneyCategories.fixture.js')
// For 026: Confirm purchase again after Reopen, with the app's own code.
const { confirmationPayload, purchaseLine, purchasePricing } = await import('../src/lib/purchase.js')
const { DURABLE_MONEY_CATEGORY_IDS, WORK_CATEGORY_ID } = await import('../src/data/constants.js')
const { MONEY_CATEGORY_IDS_026 } = await import('../src/data/budgetKeywords.js')
// For 028: order groups, with the requests the app builds (lib/orderGroups.js).
const { GROUPS_NOTICE, groupErrorMessage, groupPayload, placeOf, undoGroupPayload } = await import('../src/lib/orderGroups.js')
// For 029: each person's part of a Shared expense, as the app works it out (lib/sharedParts.js).
const { PARTS_NOTICE, PEOPLE, checkSplit, emptySplit, missingPartsColumn, partColumn, partFields, partsColumnsReady, spreadParts, typePart } = await import('../src/lib/sharedParts.js')
// For 030: a new item counted in another unit than the one bought, as the app asks it (lib/newItemUnit.js).
const { missingStockUnitColumn } = await import('../src/lib/newItemUnit.js')
const { purchasedPackLabel } = await import('../src/lib/packSize.js')
// For 031: what the app tells after Reopen / Back on the way (lib/reopenUnits.js).
const { arrivalNotTakenOutText, keptNotTakenOutText, keptText, notTakenOutText, reopenNotes, unarriveNote } = await import('../src/lib/reopenUnits.js')

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

// ── The Action purchase of 17/10/2026 as Irene's export showed it on
// 24/10 (025 fixes it; 026 builds on that) ─────────────────────────
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


// Its own database: the MONEY categories need their live ids, and
// Groceries / Home & Appliances already exist (from 008) with other ids
// in the shared one. The purchase as SHOP Confirm purchase made it.
async function actionDatabase() {
  const fx = await newDatabase()
  const row = async (text, params) => (await fx.query(text, params)).rows[0]
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
  return fx
}

describe('025: data fix for the SHOP purchase at Action on 17/10/2026', () => {
  const file = '025_action_17_10_fix.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
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
    fx = await actionDatabase()
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

  it('"Apply the mapping to past purchases" (the app\'s own code) moves none of the 31 expenses; 025\'s check still names the 6 it expected the app to move', async () => {
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
    // Round 9F: a line without a HOME category is never moved (the six
    // Shopping / Pets durables stay where 025 put them).
    expect(changes).toEqual([])
    // 025's check (written before that fix) still marks those six as
    // "known: app fix in a later round" — that fix is this round.
    const check = (await fx.exec(sql.split(/^commit;$/m)[1])).at(-1).rows
    const moved = check.filter((r) => r.section === '1 line' && r.mapping_button !== 'no change').map((r) => r.item)
    expect(moved.sort()).toEqual(['bra', 'Satin Bonnet', 'hair clip', 'Headband', 'Cat House Christmas Tree', 'cat toy'].sort())
    expect(check.filter((r) => r.section === '1 line' && r.mapping_button?.includes('known: app fix'))).toHaveLength(6)
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

describe('026: the durable lock — Durables tree, mapping rows by id, the Action durables, Work', () => {
  const file = '026_durable_lock.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const sql025 = fs.readFileSync(path.join(dir, '025_action_17_10_fix.sql'), 'utf8')
  // Live ids 026 works with (the fixture of the 025 block, plus these).
  const ID = {
    work: WORK_CATEGORY_ID,
    furniture: MONEY_CATEGORY_IDS_026.furniture,
    electronics: '2a05cb39-e90c-4349-9f77-4b1e679d42b4', // Home & Appliances › Electronics & Work Equipment
    shopElectronics: '1697124e-22a7-4417-b5b9-0439ccc67e17', // Shopping › Electronics
    gifts: '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c',
    accessories: NEW.accessories,
    petAccessories: NEW.petAccessories,
    glassesLenses: 'f81fa3cb-8dfc-45f5-b351-f22d877761cd',
    washer: 'fb053da7-b1e3-49e6-9e15-dab6d5abd6a4', // HOME item Washing Machine Cleaner
    washerEntry: 'd84c6427-edf1-41bf-a588-ab26bef0869a',
    hairGel: '7f586552-9cbb-449a-a059-a546dabf6f28',
    earPlug: '62babc6c-234a-4549-9136-e8a82d8f1d16', // expense Working Ear Plug
  }
  const EAR_TRIP = 'cccccccc-0000-4000-8000-000000000003'
  // The six Shopping / Pets durables of the Action purchase: their lines,
  // and the HOME sub each gets (by its name after 025).
  const SIX_LINES = ['fef3d676-3ba2-4333-94de-be190232199b', '8cfce438-a1a5-438c-975e-87b42d589683', '04be8150-492a-4813-b372-c6ebbcce109d', 'f2eb0500-a8c0-497c-927a-e96b282d8b08', 'e9a8a655-233d-45eb-8554-262ee53dc582', '45089ecd-9bd4-44fa-aba5-abb7e6385b7a']
  const SIX = { bra: 'appliances:clothing', 'Satin Bonnet': 'appliances:accessories', 'hair clip': 'appliances:accessories', Headband: 'appliances:accessories', 'Cat House Christmas Tree': 'appliances:pet', 'cat toy': 'appliances:pet' }
  const DURABLE_AFTER_025 = ['big towel', 'small towel', 'toy elf Christmas', 'incense holder', 'bra', 'Satin Bonnet', 'hair clip', 'Headband', 'Cat House Christmas Tree', 'cat toy', 'ceramic bowl', 'liquid measuring glass']

  let fx
  const rows = async (text, params) => (await fx.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  const run = async () => (await fx.exec(sql)).at(-1).rows
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
  const statusOf = (check, step, item) => check.find((r) => r.step === step && r.item === item)?.status
  const notOk = (check) => check.filter((r) => r.status !== 'ok' && !r.status.startsWith('ok:')).map((r) => `${r.step} · ${r.item}: ${r.status} (${r.value})`)
  const ctx = async () => ({
    expenseCategories: await rows(`select id, name, parent_id from expense_categories`),
    inventoryCategories: await rows(`select id, name, parent_id from inventory_categories`),
    mapRows: await rows(`select id, expense_category_id from category_budget_map`),
  })
  // What 026 must never write: money, dates, payers, stores, quantities,
  // discounts, stock, 1×, and which line / entry / item belongs to what.
  const untouchable = async () => ({
    trips: await rows(`select id, trip_date::text as date, total::float as total, shop_id, paid_by, source, coupon_kind, coupon_value::float as cv, coupon_total::float as ct from shopping_trips order by id`),
    expenses: await rows(`select id, amount::float as amount, expense_date::text as date, paid_by, shop_id, trip_id, merged_at, travel_id, description from expenses order by id`),
    lines: await rows(`select id, trip_id, position, line_total::float as total, list_total::float as list, item_discount_kind, item_discount_value::float as discount, coupon_share::float as coupon, quantity::float as quantity, unit, expense_id, grocery_item_id, pantry_item_id, stock_added::float as added, line_kind from shopping_trip_items order by id`),
    stock: await rows(`select id, name, current_stock::float as stock, min_stock::float as min, one_time, unit, price::float as price, expiry_date::text as expiry from pantry_items order by id`),
    entries: await rows(`select id, name, quantity::float as quantity, unit, price::float as price, in_cart, completed, pantry_item_id, expense_id, trip_id, one_time from grocery_items order by id`),
  })
  const everything = async () => ({
    expenses: await rows(`select * from expenses order by id`),
    lines: await rows(`select * from shopping_trip_items order by id`),
    entries: await rows(`select * from grocery_items order by id`),
    items: await rows(`select * from pantry_items order by id`),
    memory: await rows(`select * from category_memory order by id`),
    home: await rows(`select * from inventory_categories order by id`),
    money: await rows(`select * from expense_categories order by id`),
    map: await rows(`select * from category_budget_map order by id`),
  })

  beforeAll(async () => {
    // The Action purchase after 025 (Irene runs 025 first), then the live
    // rows 026 fixes by id.
    fx = await actionDatabase()
    await fx.exec(sql025)
    await fx.exec(`
      insert into pantry_items (id, name, unit, current_stock, min_stock, category_id, subcategory_id) values
        ('${ID.washer}', 'Washing Machine Cleaner', 'pcs', 0, 1, 'cleaning', 'cleaning:surface'),
        ('${ID.hairGel}', 'Hair Gel', 'pcs', 1, 0, 'toiletries', 'toiletries:hair');
      insert into grocery_items (id, name, quantity, unit, category_id, subcategory_id, pantry_item_id, auto_generated) values
        ('${ID.washerEntry}', 'Washing Machine Cleaner', 1, 'pcs', 'cleaning', 'cleaning:surface', '${ID.washer}', true);
      insert into category_memory (id, name, category_id, subcategory_id, source) values
        ('washing machine cleaner', 'Washing Machine Cleaner', 'cleaning', 'cleaning:surface', 'user'),
        ('hair gel', 'Hair Gel', 'toiletries', 'toiletries:hair', 'user');
    `)
    // "Working Ear Plug": a SHOP purchase of 20/10, booked to Home &
    // Appliances › Electronics & Work Equipment.
    await fx.query(`insert into shopping_trips (id, trip_date, total, source) values ($1, '2026-10-20', 2.99, 'shop')`, [EAR_TRIP])
    const entry = (await row(`insert into grocery_items (name, quantity, unit, price, category_id, subcategory_id, completed, trip_id, expense_id) values ('Working Ear Plug', 1, 'pcs', 2.99, 'appliances', 'appliances:electronics', true, $1, null) returning id`, [EAR_TRIP])).id
    await fx.query(`insert into expenses (id, category_id, amount, description, expense_date, trip_id) values ($1, $2, 2.99, 'Working Ear Plug', '2026-10-20', $3)`, [ID.earPlug, ID.electronics, EAR_TRIP])
    await fx.query(`update grocery_items set expense_id = $1 where id = $2`, [ID.earPlug, entry])
    await fx.query(
      `insert into shopping_trip_items (trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, stock_added, expense_id, line_kind, quantity, unit) select $1, 1, g.id, to_jsonb(g), g.name, 2.99, null, 0, $2, 'shop', 1, 'pcs' from grocery_items g where g.id = $3`,
      [EAR_TRIP, ID.earPlug, entry]
    )
  }, 120000)

  it('one transaction; no table, function, policy or grant; never writes money, dates, payers, stores, quantities or stock', () => {
    const code = sql.replace(/--.*$/gm, '')
    expect(code.match(/^begin;$/gm)).toHaveLength(1)
    expect(code.match(/^commit;$/gm)).toHaveLength(1)
    expect(code).not.toMatch(/\b(drop|truncate|alter|create|grant|revoke|policy|function|trigger|anon)\b/i)
    expect(code).not.toMatch(/\bupdate\s+shopping_trips\b/i)
    const writes = code.split(/^commit;$/m)[0]
    expect(writes.match(/\b(?:update|delete from|insert into)\s+\w+/gi).map((w) => w.toLowerCase().replace(/\s+/g, ' ')).sort()).toEqual(
      [
        'insert into inventory_categories',
        'update inventory_categories',
        'update inventory_categories',
        'update inventory_categories',
        'insert into expense_categories',
        'insert into expense_categories',
        'delete from expense_categories',
        'update expense_categories',
        'insert into category_budget_map',
        'update shopping_trip_items',
        'update grocery_items',
        'update category_memory',
        'update pantry_items',
        'update grocery_items',
        'update category_memory',
        'update pantry_items',
        'update category_memory',
        'update expenses',
      ].sort()
    )
    const sets = [...writes.matchAll(/\bset\b([\s\S]*?)(?:\bfrom\b|\bwhere\b)/gi)].map((m) => m[1])
    expect(sets.length).toBeGreaterThan(10)
    for (const s of sets) {
      expect(s).not.toMatch(/\b(amount|expense_date|paid_by|shop_id|trip_id|merged_at|line_total|list_total|item_discount_kind|item_discount_value|coupon_share|quantity|unit|current_stock|min_stock|one_time|total|completed|in_cart|price|pantry_item_id|stock_added|expense_category_id)\s*=/)
    }
    // MONEY categories by id: no MONEY statement finds a category by a name
    // (the rename checks the old name of the same id; HOME's own rename of
    // "Home & Appliances" is a HOME name; the check reads Groceries / Home
    // & Appliances by name, as the app does).
    for (const statement of writes.split(';').filter((w) => /expense_categories|expenses\b/.test(w) && !/inventory_categories/.test(w))) {
      expect(statement).not.toMatch(/name\s*=\s*'(Groceries|Home & Appliances|Shopping|Pets|Health|Work|Other)'/)
    }
  })

  it('the fixed ids are the same in 026, in the app (constants, budgetKeywords) and in the plan', () => {
    const plan = fs.readFileSync(path.join(dir, '..', 'docs', 'plan-oct-2026.md'), 'utf8')
    const fixed = [ID.work, ID.furniture, ID.electronics, ID.shopElectronics, ID.gifts, ID.glassesLenses, ID.washer, ID.washerEntry, ID.hairGel, ID.earPlug]
    for (const id of [...fixed, ...DURABLE_MONEY_CATEGORY_IDS]) expect(plan, id).toContain(id)
    for (const id of fixed) expect(sql, id).toContain(id)
    for (const line of LINES.filter((l) => SIX_LINES.includes(l.id))) {
      expect(sql, line.name).toContain(line.id)
      expect(sql, line.name).toContain(line.expense)
    }
  })

  it('the remembered-name keys are what the app makes of the names (normalizeName)', () => {
    for (const [name, key] of Object.entries({ bra: 'bra', 'Satin Bonnet': 'satin bonnet', 'hair clip': 'hair clip', Headband: 'headband', 'Cat House Christmas Tree': 'cat house christmas tree', 'cat toy': 'cat toy', 'Washing Machine Cleaner': 'washing machine cleaner', 'Hair Gel': 'hair gel' })) {
      expect(normalizeName(name), name).toBe(key)
      expect(sql).toContain(`'${key}'`)
    }
  })

  it('a mapping row chosen by hand is kept; Gifts & Party stays where it is while something uses it', async () => {
    await undone(async () => {
      await fx.query(`insert into category_budget_map (id, expense_category_id) values ('appliances:kitchen', $1)`, [M.other])
      await fx.query(`insert into pantry_items (name, unit, current_stock, category_id, subcategory_id) values ('Balloons', 'pcs', 3, 'misc', 'misc:gifts')`)
      const check = await runInside()
      expect((await row(`select expense_category_id from category_budget_map where id = 'appliances:kitchen'`)).expense_category_id).toBe(M.other)
      expect(statusOf(check, '5 mapping', 'Durables › Kitchen Appliances → Home & Appliances › Kitchen Appliances')).toBe('skipped: chosen by hand (kept)')
      expect((await row(`select parent_id from inventory_categories where id = 'misc:gifts'`)).parent_id).toBe('misc')
      expect(statusOf(check, '3 Gifts & Party', 'HOME Gifts & Party (misc:gifts) under Durables')).toBe('CHECK: still used (HOME items 1)')
      // Its mapping row is added all the same (Gifts & Party → Shopping › Gifts).
      expect((await row(`select expense_category_id from category_budget_map where id = 'misc:gifts'`)).expense_category_id).toBe(ID.gifts)
    })
  })

  it('Shopping › Electronics is not deleted while it has an expense; then the H&A sub keeps its old name', async () => {
    await undone(async () => {
      await fx.query(`insert into expenses (category_id, amount, description, expense_date) values ($1, 49, 'Cuffie Sony', '2026-09-01')`, [ID.shopElectronics])
      const check = await runInside()
      expect((await row(`select name, parent_id from expense_categories where id = $1`, [ID.shopElectronics]))).toEqual({ name: 'Electronics', parent_id: M.shopping })
      expect((await row(`select name from expense_categories where id = $1`, [ID.electronics])).name).toBe('Electronics & Work Equipment')
      expect(statusOf(check, '4 MONEY', 'MONEY Shopping › Electronics deleted')).toBe('skipped: still used (see value)')
      expect(check.find((r) => r.item === 'MONEY Shopping › Electronics deleted').value).toBe('Shopping › Electronics · expenses 1')
      expect(statusOf(check, '2 renamed', 'MONEY Home & Appliances › Electronics & Work Equipment → Electronics')).toBe('skipped: name exists')
      // The mapping row is by id, so it is there anyway.
      expect((await row(`select expense_category_id from category_budget_map where id = 'appliances:electronics'`)).expense_category_id).toBe(ID.electronics)
    })
  })

  it('a MONEY category renamed by hand before 026 is never renamed back; renames after it change nothing either', async () => {
    await undone(async () => {
      await fx.query(`update expense_categories set name = 'Elettronica' where id = $1`, [ID.electronics])
      await fx.query(`update expense_categories set name = 'Scarpe' where id = $1`, [M.shoes])
      const check = await runInside()
      expect((await row(`select name from expense_categories where id = $1`, [ID.electronics])).name).toBe('Elettronica')
      expect(statusOf(check, '2 renamed', 'MONEY Home & Appliances › Electronics & Work Equipment → Electronics')).toBe('skipped: renamed by hand')
      expect(check.find((r) => r.step === '5 mapping' && r.item.startsWith('Durables › Footwear'))).toMatchObject({ item: 'Durables › Footwear → Shopping › Scarpe', status: 'ok' })
      expect(notOk(check).filter((r) => !r.startsWith('2 renamed'))).toEqual([])
    })
    await undone(async () => {
      await runInside()
      await fx.query(`update expense_categories set name = 'Lavoro' where id = $1`, [ID.work])
      await fx.query(`update expense_categories set name = 'Mobili' where id = $1`, [ID.furniture])
      await fx.query(`update expense_categories set name = 'Regali' where id = $1`, [ID.gifts])
      await fx.query(`update inventory_categories set name = 'Cose durevoli' where id = 'appliances'`)
      const before = await everything()
      const check = await runInside()
      expect(await everything()).toEqual(before)
      expect((await row(`select count(*)::int as n from expense_categories where lower(name) in ('work', 'furniture', 'gifts')`)).n).toBe(0)
      expect(statusOf(check, '2 renamed', 'HOME Home & Appliances → Durables')).toBe('skipped: renamed by hand')
      // The links are by id: the app still books there, under the new names.
      const c = await ctx()
      const path = (id) => {
        const cat = c.expenseCategories.find((x) => x.id === id)
        const parent = c.expenseCategories.find((x) => x.id === cat.parent_id)
        return parent ? `${parent.name} › ${cat.name}` : cat.name
      }
      expect(path(budgetCategoryFor({ category_id: 'appliances', subcategory_id: 'misc:gifts' }, c))).toBe('Shopping › Regali')
      expect(path(budgetCategoryFor({ category_id: 'appliances', subcategory_id: 'appliances:furniture' }, c))).toBe('Home & Appliances › Mobili')
      expect(path((await row(`select category_id from expenses where id = $1`, [ID.earPlug])).category_id)).toBe('Lavoro')
    })
  })

  it('the real run: every check is ok; money, dates, stock and quantities are untouched', async () => {
    const before = await untouchable()
    const check = await run()
    expect(check.length).toBeLessThan(100)
    expect(notOk(check)).toEqual([])
    expect(await untouchable()).toEqual(before)

    // HOME: the Durables tree and the two consumable subs.
    expect(await rows(`select id, name from inventory_categories where parent_id = 'appliances' order by id`)).toEqual([
      { id: 'appliances:accessories', name: 'Accessories' },
      { id: 'appliances:air', name: 'Air & Climate' },
      { id: 'appliances:cleaning', name: 'Cleaning Appliances' },
      { id: 'appliances:clothing', name: 'Clothing' },
      { id: 'appliances:decor', name: 'Home Decor' },
      { id: 'appliances:electronics', name: 'Electronics' },
      { id: 'appliances:footwear', name: 'Footwear' },
      { id: 'appliances:furniture', name: 'Furniture' },
      { id: 'appliances:glasses', name: 'Glasses' },
      { id: 'appliances:kitchen', name: 'Kitchen Appliances' },
      { id: 'appliances:kitchenware', name: 'Kitchenware & Utensils' },
      { id: 'appliances:pet', name: 'Pet Accessories & Toys' },
      { id: 'appliances:textiles', name: 'Home Textiles' },
      { id: 'misc:gifts', name: 'Gifts & Party' },
    ])
    expect((await row(`select name from inventory_categories where id = 'appliances'`)).name).toBe('Durables')
    expect(await rows(`select id, parent_id from inventory_categories where id in ('health:contact-lenses', 'laundry:machine-care') order by id`)).toEqual([
      { id: 'health:contact-lenses', parent_id: 'health' },
      { id: 'laundry:machine-care', parent_id: 'laundry' },
    ])
    // MONEY: Work, Furniture, one Electronics; the MONEY main keeps its name.
    expect(await row(`select name, parent_id from expense_categories where id = $1`, [ID.work])).toEqual({ name: 'Work', parent_id: null })
    expect(await row(`select name, parent_id from expense_categories where id = $1`, [ID.furniture])).toEqual({ name: 'Furniture', parent_id: M.homeAppliances })
    expect(await row(`select name from expense_categories where id = $1`, [ID.electronics])).toEqual({ name: 'Electronics' })
    expect((await row(`select count(*)::int as n from expense_categories where id = $1`, [ID.shopElectronics])).n).toBe(0)
    expect((await row(`select name from expense_categories where id = $1`, [M.homeAppliances])).name).toBe('Home & Appliances')
    expect((await row(`select count(*)::int as n from expense_categories where parent_id = '54c1355d-5ebb-4237-ae67-1be0ca593443'`)).n).toBe(0)
    // Mapping rows by id: 15.
    expect((await row(`select count(*)::int as n from category_budget_map where id like 'appliances:%' or id in ('misc:gifts', 'health:contact-lenses')`)).n).toBe(15)

    // The six: line, SHOP entry and remembered name; their expenses as 025 left them.
    for (const l of LINES.filter((x) => SIX_LINES.includes(x.id))) {
      const line = await row(`select l.name, l.grocery_snapshot->>'category_id' as main, l.grocery_snapshot->>'subcategory_id' as sub, g.category_id as g_main, g.subcategory_id as g_sub, e.category_id as budget from shopping_trip_items l join grocery_items g on g.id = l.grocery_item_id join expenses e on e.id = l.expense_id where l.id = $1`, [l.id])
      expect(line, l.name).toMatchObject({ main: 'appliances', sub: SIX[line.name], g_main: 'appliances', g_sub: SIX[line.name] })
      const memory = await row(`select category_id, subcategory_id, expense_category_id from category_memory where id = $1`, [normalizeName(line.name)])
      expect(memory, line.name).toEqual({ category_id: 'appliances', subcategory_id: SIX[line.name], expense_category_id: line.budget })
    }
    expect(await row(`select category_id, subcategory_id from pantry_items where id = $1`, [ID.washer])).toEqual({ category_id: 'laundry', subcategory_id: 'laundry:machine-care' })
    expect(await row(`select category_id, subcategory_id from grocery_items where id = $1`, [ID.washerEntry])).toEqual({ category_id: 'laundry', subcategory_id: 'laundry:machine-care' })
    expect(await row(`select category_id, subcategory_id from category_memory where id = 'washing machine cleaner'`)).toEqual({ category_id: 'laundry', subcategory_id: 'laundry:machine-care' })
    expect(await row(`select category_id, subcategory_id from pantry_items where id = $1`, [ID.hairGel])).toEqual({ category_id: 'personal-care', subcategory_id: HAIR })
    expect(await row(`select category_id, subcategory_id from category_memory where id = 'hair gel'`)).toEqual({ category_id: 'personal-care', subcategory_id: HAIR })
    expect((await row(`select category_id from expenses where id = $1`, [ID.earPlug])).category_id).toBe(ID.work)
  })

  it('run again: nothing changes (not even an update time), and every check is still ok', async () => {
    const after = await everything()
    const check = await run()
    expect(await everything()).toEqual(after)
    expect(notOk(check)).toEqual([])
  })

  it('"Apply the mapping to past purchases" (the app\'s own code) moves none of the 31 Action expenses, nor "Working Ear Plug" (Work)', async () => {
    const c = await ctx()
    const tripLines = await rows(`select id, expense_id, grocery_snapshot, line_kind from shopping_trip_items where expense_id is not null`)
    const groceries = await rows(`select id, expense_id, category_id, subcategory_id from grocery_items where expense_id is not null`)
    const byExpense = purchasedItemsByExpense({ groceries, tripLines })
    const expenses = await rows(`select id, category_id, amount::float as amount, description from expenses where trip_id in ($1, $2)`, [TRIP, EAR_TRIP])
    expect(expenses).toHaveLength(32)
    expect(pastPurchaseChanges(expenses, (id) => byExpense.get(id) ?? null, c).changes).toEqual([])
    // Without the Work rule the ear plug would go back to Electronics.
    expect(budgetCategoryFor(byExpense.get(ID.earPlug), c)).toBe(ID.electronics)
    // The check of 026 says the same for the Action purchase.
    expect(statusOf(await run(), '6 Action 17/10', '"Apply the mapping…" moves none of its expenses')).toBe('ok')
  })

  it('after 026, Reopen of the Action purchase and Confirm again (the app\'s own code) put nothing durable into HOME', async () => {
    await undone(async () => {
      expect((await asMember(() => row(`select reopen_shopping_trip($1) as n`, [TRIP]))).n).toBe(31)
      const cart = await rows(`select * from grocery_items where in_cart and not completed order by name`)
      expect(cart).toHaveLength(31)
      const pantryItems = await rows(`select * from pantry_items`)
      const lines = cart.map((item) => purchaseLine({ ...item, quantity: Number(item.quantity), price: Number(item.price), price_qty: Number(item.price_qty) }, pantryItems))
      expect(lines.filter((l) => l.durable).map((l) => l.item.name).sort()).toEqual([...DURABLE_AFTER_025].sort())
      const c = await ctx()
      const payload = confirmationPayload({
        id: 'dddddddd-0000-4000-8000-000000000004',
        date: '2026-10-17',
        at: '2026-10-25T10:00:00Z',
        lines,
        answers: {},
        totalOf: (item) => Number(item.price),
        expenseCategoryFor: (item) => budgetCategoryFor(item, c),
        paidBy: 'shared',
      })
      await asMember(() => fx.query(`select confirm_shopping_trip($1::jsonb)`, [payload]))
      const names = (await rows(`select lower(name) as n from pantry_items`)).map((p) => p.n)
      for (const name of DURABLE_AFTER_025) expect(names, name).not.toContain(name.toLowerCase())
      // The six book to their Shopping / Pets subs through the mapping rows.
      const budgets = Object.fromEntries((await rows(`select description, category_id from expenses where trip_id = 'dddddddd-0000-4000-8000-000000000004'`)).map((e) => [e.description, e.category_id]))
      expect(budgets).toMatchObject({ bra: M.clothing, 'Satin Bonnet': ID.accessories, 'hair clip': ID.accessories, Headband: ID.accessories, 'Cat House Christmas Tree': ID.petAccessories, 'cat toy': ID.petAccessories })
    })
  })
})

describe('027: pack size per purchase — two columns on orders, nothing else', () => {
  const file = '027_order_pack_size.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  let fx, groceries
  const rows = async (text, params) => (await fx.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  const run = async () => (await fx.exec(sql)).at(-1).rows
  const fails = async (text, params) => {
    try {
      await fx.query(text, params)
      return null
    } catch (error) {
      return error.message
    }
  }
  async function as(role, userId, fn) {
    await fx.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await fx.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await fx.exec('reset role')
    }
  }
  const asMember = (fn) => as('authenticated', MEMBER, fn)
  const item = (id) => row(`select current_stock::float as stock, packaging_unit, quantity_per_pack::float as per from pantry_items where id = $1`, [id])
  const newItem = (name, packagingUnit = null, perPack = null) =>
    row(`insert into pantry_items (name, unit, current_stock, category_id, packaging_unit, quantity_per_pack) values ($1, 'pcs', 5, 'misc', $2, $3) returning *`, [name, packagingUnit, perPack]).then((r) => ({ ...r, current_stock: Number(r.current_stock), quantity_per_pack: r.quantity_per_pack === null ? null : Number(r.quantity_per_pack) }))
  // A purchase typed in MONEY, built by the app's own code (one row).
  const buyInMoney = async (id, pantry, { quantityText, unit, packText }) => {
    const r = { ...emptyRow(1), name: pantry.name, priceText: '9', quantityText, unit, unitTouched: true, categoryId: 'misc', addToHome: true, packSizeText: packText, packUnit: unit }
    const { lines, priced } = pricedLines([rowLine(r, [pantry])])
    const payload = moneyPurchasePayload({ id, date: '2026-10-28', at: '2026-10-28T10:00:00Z', paidBy: 'shared', lines, budgetFor: () => groceries, priced })
    await asMember(() => fx.query(`select confirm_shopping_trip($1::jsonb)`, [payload]))
    return { line: lines[0], payload }
  }
  const order = (pantryId, quantity, unit) =>
    row(`insert into orders (item_name, price, pantry_item_id, quantity, unit) values ('Order', 20, $1, $2, $3) returning id`, [pantryId, quantity, unit]).then((r) => r.id)

  beforeAll(async () => {
    fx = await newDatabase()
    for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-3])_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
      await fx.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    groceries = (await row(`select id from expense_categories where name = 'Groceries'`)).id
  }, 120000)

  it('only adds the two columns: no function, policy, grant, data or anything for anon', () => {
    const code = sql.replace(/--.*$/gm, '')
    expect(code.match(/alter table orders add column if not exists/g)).toHaveLength(2)
    expect(code).toMatch(/add column if not exists pack_size numeric check \(pack_size > 0\);/)
    expect(code).toMatch(/add column if not exists arrival_pack_before jsonb;/)
    expect(code).not.toMatch(/\b(drop|truncate|create|grant|revoke|policy|function|trigger|anon|insert|update|delete)\b/i)
  })

  it('before 027 (deployed first): orders have no pack columns, and Arrived / Put back on the way work as before', async () => {
    const columns = (await rows(`select column_name from information_schema.columns where table_name = 'orders'`)).map((c) => c.column_name)
    expect(columns).not.toContain('pack_size')
    expect(columns).not.toContain('arrival_pack_before')
    const cat = await newItem('Cat Wet Food before 027', 'box', 48)
    const o = await order(cat.id, 1, 'box')
    await asMember(() => fx.query(`select arrive_order($1, $2, 30, '2026-10-28')`, [o, cat.id]))
    expect(await item(cat.id)).toEqual({ stock: 35, packaging_unit: 'box', per: 48 })
    await asMember(() => fx.query(`select unarrive_order($1)`, [o]))
    expect(await item(cat.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 48 })
  })

  it('run twice: the check says ok for every column, nothing else changes, orders stay locked to the household', async () => {
    const before = await rows(`select * from orders order by id`)
    const policies = await rows(`select policyname, cmd, roles::text, qual from pg_policies where tablename = 'orders' order by policyname`)
    const first = await run()
    const second = await run()
    expect(first).toEqual([
      { column: 'orders.pack_size', type: 'numeric', status: 'ok' },
      { column: 'orders.arrival_pack_before', type: 'jsonb', status: 'ok' },
      { column: 'orders.pack_size > 0', type: 'check', status: 'ok' },
    ])
    expect(second).toEqual(first)
    const after = await rows(`select * from orders order by id`)
    expect(after.every((o) => o.pack_size === null && o.arrival_pack_before === null)).toBe(true)
    expect(after.map(({ pack_size: _size, arrival_pack_before: _before, ...rest }) => rest)).toEqual(before)
    expect(await rows(`select policyname, cmd, roles::text, qual from pg_policies where tablename = 'orders' order by policyname`)).toEqual(policies)
    expect(await as('anon', null, () => fails(`select pack_size from orders`))).toMatch(/permission denied/)
  })

  it('a pack size is a number above 0, or empty', async () => {
    const cat = await newItem('Pack check')
    const o = await order(cat.id, 1, 'box')
    expect(await fails(`update orders set pack_size = 0 where id = $1`, [o])).toMatch(/check/)
    expect(await fails(`update orders set pack_size = -2 where id = $1`, [o])).toMatch(/check/)
    await fx.query(`update orders set pack_size = 24 where id = $1`, [o])
    await fx.query(`update orders set pack_size = null where id = $1`, [o])
    expect((await row(`select pack_size from orders where id = $1`, [o])).pack_size).toBeNull()
  })

  describe('purchases (no SQL needed): stock = quantity × the pack typed, the usual size only the first time, Undo exact', () => {
    it('usual "box 48", 1 box typed 30: +30, usual stays 48; Undo purchase −30', async () => {
      const cat = await newItem('Cat Wet Food', 'box', 48)
      const { line, payload } = await buyInMoney('27000000-0000-4000-8000-000000000001', cat, { quantityText: '1', unit: 'box', packText: '30' })
      expect(line.pack).toMatchObject({ value: 30, usual: 48, differs: true, firstTime: false })
      expect(payload.items[0]).not.toHaveProperty('packaging_unit')
      expect(await item(cat.id)).toEqual({ stock: 35, packaging_unit: 'box', per: 48 })
      await asMember(() => fx.query(`select reopen_shopping_trip('27000000-0000-4000-8000-000000000001')`))
      expect(await item(cat.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 48 })
    })

    it('2 box × 30 = +60 while the usual is 48; Undo −60', async () => {
      const cat = await newItem('Cat Wet Food 2', 'box', 48)
      await buyInMoney('27000000-0000-4000-8000-000000000002', cat, { quantityText: '2', unit: 'box', packText: '30' })
      expect(await item(cat.id)).toEqual({ stock: 65, packaging_unit: 'box', per: 48 })
      await asMember(() => fx.query(`select reopen_shopping_trip('27000000-0000-4000-8000-000000000002')`))
      expect(await item(cat.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 48 })
    })

    it('no usual size, 1 box typed 12: +12 and box 12 becomes the usual; Undo puts the stock and the empty usual size back', async () => {
      const tuna = await newItem('Tuna cans')
      const { line, payload } = await buyInMoney('27000000-0000-4000-8000-000000000003', tuna, { quantityText: '1', unit: 'box', packText: '12' })
      expect(line.pack).toMatchObject({ value: 12, usual: null, firstTime: true })
      expect(payload.items[0]).toMatchObject({ add: 12, packaging_unit: 'box', quantity_per_pack: 12 })
      expect(await item(tuna.id)).toEqual({ stock: 17, packaging_unit: 'box', per: 12 })
      await asMember(() => fx.query(`select reopen_shopping_trip('27000000-0000-4000-8000-000000000003')`))
      expect(await item(tuna.id)).toEqual({ stock: 5, packaging_unit: null, per: null })
    })

    it('usual "box", 2 pack typed 5: +10, nothing saved; Undo −10', async () => {
      const cat = await newItem('Cat Wet Food 3', 'box', 48)
      const { line, payload } = await buyInMoney('27000000-0000-4000-8000-000000000004', cat, { quantityText: '2', unit: 'pack', packText: '5' })
      expect(line.pack).toMatchObject({ value: 5, usual: null, firstTime: false, total: 10 })
      expect(payload.items[0]).toMatchObject({ add: 10 })
      expect(payload.items[0]).not.toHaveProperty('packaging_unit')
      expect(await item(cat.id)).toEqual({ stock: 15, packaging_unit: 'box', per: 48 })
      await asMember(() => fx.query(`select reopen_shopping_trip('27000000-0000-4000-8000-000000000004')`))
      expect(await item(cat.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 48 })
    })
  })

  describe('Arrived and "Put back on the way" with 027 (the writes the app makes, lib/useOrders)', () => {
    // What the app does after arrive_order when the arrival saved a
    // first-time usual size, and what "Put back on the way" does after
    // unarrive_order — the same guarded writes as hooks/useOrders.js.
    const rememberFirstTime = async (o, id, unit, value) => {
      const before = await row(`select packaging_unit, quantity_per_pack from pantry_items where id = $1`, [id])
      await fx.query(`update orders set pack_size = $2, arrival_pack_before = $3 where id = $1`, [o, value, { ...before, saved: { packaging_unit: unit, quantity_per_pack: value } }])
      return (await rows(`update pantry_items set packaging_unit = $2, quantity_per_pack = $3 where id = $1 and quantity_per_pack is null and packaging_unit is null returning id`, [id, unit, value])).length
    }
    const restore = async (o, id) => {
      const { arrival_pack_before: before } = await row(`select arrival_pack_before from orders where id = $1`, [o])
      if (before) {
        await fx.query(`update pantry_items set packaging_unit = $2, quantity_per_pack = $3 where id = $1 and packaging_unit = $4 and quantity_per_pack = $5`, [id, before.packaging_unit, before.quantity_per_pack, before.saved.packaging_unit, before.saved.quantity_per_pack])
      }
      await fx.query(`update orders set arrival_pack_before = null where id = $1`, [o])
    }

    it('no usual size: Arrived 1 box typed 12 → +12, usual box 12; Put back on the way → −12, usual empty again', async () => {
      const tuna = await newItem('Tuna arrived')
      const o = await order(tuna.id, 1, 'box')
      await asMember(() => fx.query(`select arrive_order($1, $2, 12, '2026-10-28')`, [o, tuna.id]))
      expect(await rememberFirstTime(o, tuna.id, 'box', 12)).toBe(1)
      expect(await item(tuna.id)).toEqual({ stock: 17, packaging_unit: 'box', per: 12 })
      await asMember(() => fx.query(`select unarrive_order($1)`, [o]))
      // unarrive_order never touches the new columns: the app restores.
      expect((await row(`select arrival_pack_before from orders where id = $1`, [o])).arrival_pack_before).toMatchObject({ packaging_unit: null, quantity_per_pack: null })
      await restore(o, tuna.id)
      expect(await item(tuna.id)).toEqual({ stock: 5, packaging_unit: null, per: null })
      expect(await row(`select status, stock_added::float as added, arrival_pack_before from orders where id = $1`, [o])).toEqual({ status: 'on_the_way', added: 0, arrival_pack_before: null })
    })

    it('the same, but the usual size changed to 15 in the HOME editor before Put back on the way: stock −12, usual stays 15', async () => {
      const tuna = await newItem('Tuna edited')
      const o = await order(tuna.id, 1, 'box')
      await asMember(() => fx.query(`select arrive_order($1, $2, 12, '2026-10-28')`, [o, tuna.id]))
      await rememberFirstTime(o, tuna.id, 'box', 12)
      await fx.query(`update pantry_items set quantity_per_pack = 15 where id = $1`, [tuna.id])
      await asMember(() => fx.query(`select unarrive_order($1)`, [o]))
      await restore(o, tuna.id)
      expect(await item(tuna.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 15 })
      expect((await row(`select arrival_pack_before from orders where id = $1`, [o])).arrival_pack_before).toBeNull()
    })

    it('an existing usual size (box 48), Arrived 2 box typed 30: +60, nothing saved, Put back on the way −60', async () => {
      const cat = await newItem('Cat arrived', 'box', 48)
      const o = await order(cat.id, 2, 'box')
      await asMember(() => fx.query(`select arrive_order($1, $2, 60, '2026-10-28')`, [o, cat.id]))
      await fx.query(`update orders set pack_size = 30 where id = $1`, [o])
      expect(await item(cat.id)).toEqual({ stock: 65, packaging_unit: 'box', per: 48 })
      await asMember(() => fx.query(`select unarrive_order($1)`, [o]))
      expect(await item(cat.id)).toEqual({ stock: 5, packaging_unit: 'box', per: 48 })
      expect((await row(`select pack_size::float as size from orders where id = $1`, [o])).size).toBe(30)
    })
  })
})

describe('028: order groups — one discount for the whole online order', () => {
  const file = '028_order_groups.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  let fx, shop, zalando, pets, home
  const rows = async (text, params) => (await fx.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  const run = async () => (await fx.exec(sql)).at(-1).rows
  async function as(role, userId, fn) {
    await fx.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await fx.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await fx.exec('reset role')
    }
  }
  const fails = async (fn) => {
    try {
      await fn()
      return null
    } catch (error) {
      return error.message
    }
  }
  // save_order_group as the app calls it (logged in as the household).
  const save = (payload) => as('authenticated', MEMBER, async () => (await fx.query(`select save_order_group($1::jsonb) as r`, [payload])).rows[0].r)
  // Orders and groups as the app reads them (numbers as numbers).
  const ordersNow = async (ids) => (await rows(`select to_jsonb(o) as o from orders o where o.id = any($1) order by o.created_at, o.id`, [ids])).map((r) => r.o)
  const groupNow = async (id) => (await row(`select to_jsonb(g) as g from order_groups g where g.id = $1`, [id]))?.g ?? null
  const amounts = async (ids) => (await rows(`select e.amount::float as a from orders o join expenses e on e.id = o.expense_id where o.id = any($1) order by o.created_at, o.id`, [ids])).map((r) => r.a)
  const prices = async (ids) => (await ordersNow(ids)).map((o) => o.price)
  let seq = 0
  // An order and its expense, as "Add order" saves them (the expense = the price).
  async function newOrder(name, price, { shopId = shop, date = '2026-10-17', payer = 'akbar', category = home, extra = {} } = {}) {
    seq += 1
    const expense = (await row(`insert into expenses (amount, description, paid_by, expense_date, shop_id, category_id) values ($1, $2, $3, $4, $5, $6) returning id`, [price, name, payer, date, shopId, category])).id
    const created = new Date(Date.UTC(2026, 9, 17, 10, 0, seq)).toISOString()
    const id = (await row(
      `insert into orders (item_name, price, shop_id, order_date, paid_by, expense_id, category_id, created_at, list_price, discount_kind, discount_value) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [name, price, shopId, date, payer, expense, category, created, extra.list_price ?? null, extra.discount_kind ?? null, extra.discount_value ?? null]
    )).id
    return id
  }
  const placeAmazon = () => ({ shop_id: shop, order_date: '2026-10-17', paid_by: 'akbar' })
  // What the database has besides 028, to compare before and after it.
  const untouched = async () => ({
    functions: await rows(`select p.proname, md5(p.prosrc) as src, p.proconfig::text as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'save_order_group' order by 1, 2`),
    policies: await rows(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename <> 'order_groups' order by 1, 2`),
    grants: await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name <> 'order_groups' order by 1, 2, 3`),
    functionGrants: await rows(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema = 'public' and routine_name <> 'save_order_group' order by 1, 2, 3`),
    expenses: await rows(`select * from expenses order by id`),
  })
  let before

  beforeAll(async () => {
    fx = await newDatabase()
    for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-3]|27)_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
      await fx.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    shop = (await row(`insert into shops (name, is_online) values ('Amazon.it', true) returning id`)).id
    zalando = (await row(`insert into shops (name, is_online) values ('Zalando', true) returning id`)).id
    pets = (await row(`select id from expense_categories where name = 'Pets'`))?.id ?? (await row(`insert into expense_categories (name) values ('Pets') returning id`)).id
    home = (await row(`select id from expense_categories where name = 'Groceries'`)).id
    await newOrder('An order from before 028', 12.5)
    before = await untouched()
  }, 120000)

  it('only adds the table, two columns, indexes and one new function: nothing existing is replaced, no data written', () => {
    const code = sql.replace(/--.*$/gm, '')
    const outside = code.replace(/as \$\$[\s\S]*?end \$\$;/g, '')
    expect([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1])).toEqual(['save_order_group'])
    expect([...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1])).toEqual(['order_groups'])
    expect([...outside.matchAll(/alter table (?:public\.)?(\w+)/g)].map((m) => m[1])).toEqual(['order_groups', 'orders', 'orders', 'order_groups'])
    expect([...code.matchAll(/(?:create|drop) policy[^;]* on public\.(\w+)/g)].map((m) => m[1])).toEqual(['order_groups', 'order_groups'])
    expect([...code.matchAll(/(?:grant|revoke) [^;]* on (?:function )?(?:public\.)?(\w+)/g)].map((m) => m[1])).toEqual(['order_groups', 'order_groups', 'save_order_group', 'save_order_group'])
    // No data statement outside the function, no drop of anything but the new policy.
    expect(outside).not.toMatch(/\b(insert into|update \w+ set|delete from|truncate)\b/i)
    expect(code.match(/\bdrop\b[^;]*/gi)).toEqual(['drop policy if exists "household_only" on public.order_groups'])
    expect(code.match(/^select /gm)).toHaveLength(1)
  })

  it('before 028 (the app is deployed first): no group columns, no function — the app says "This needs the database update supabase/028_order_groups.sql"', async () => {
    const columns = (await rows(`select column_name from information_schema.columns where table_name = 'orders'`)).map((c) => c.column_name)
    expect(columns).not.toContain('group_id')
    expect(columns).not.toContain('group_share')
    const error = await as('authenticated', MEMBER, async () => {
      try {
        await fx.query(`select save_order_group('{}'::jsonb)`)
      } catch (e) {
        return e
      }
    })
    expect(groupErrorMessage({ code: error.code, message: error.message })).toBe(GROUPS_NOTICE)
    expect(await fails(() => fx.query(`select * from order_groups`))).toMatch(/does not exist/)
  })

  it('run twice: every check is ok; existing functions, policies, grants and data are unchanged; anon gets nothing', async () => {
    const first = await run()
    const second = await run()
    expect(first.map((r) => [r.object, r.status])).toEqual([
      ['table order_groups', 'ok'],
      ['order_groups discount check', 'ok'],
      ['column orders.group_id', 'ok'],
      ['column orders.group_share', 'ok'],
      ['orders.group_id → order_groups (on delete set null)', 'ok'],
      ['orders.group_share >= 0', 'ok'],
      ['index orders_group_id_idx', 'ok'],
      ['function save_order_group(jsonb)', 'ok'],
      ['orders in a group (0 the first time)', 'ok'],
    ])
    expect(first.at(-1).detail).toBe('0 of 1')
    expect(second).toEqual(first)
    expect(first.length).toBeLessThan(100)
    expect(await untouched()).toEqual(before)
    expect(await rows(`select group_id, group_share::float as share from orders`)).toEqual([{ group_id: null, share: 0 }])
    expect(await as('anon', null, () => fails(() => fx.query(`select * from order_groups`)))).toMatch(/permission denied/)
    expect(await as('anon', null, () => fails(() => fx.query(`select save_order_group('{}'::jsonb)`)))).toMatch(/permission denied/)
  })

  it('the household check: a logged-in stranger is refused (42501), and sees no group', async () => {
    const message = await as('authenticated', STRANGER, () => fails(() => fx.query(`select save_order_group($1::jsonb)`, [{ id: '28000000-0000-4000-8000-0000000000ff', orders: [] }])))
    expect(message).toMatch(/Not allowed: log in with the household account/)
    expect(await as('authenticated', STRANGER, async () => (await fx.query(`select count(*)::int as n from order_groups`)).rows[0].n)).toBe(0)
  })

  describe('the order of 17/10 at Amazon.it (7 orders, −€3.23), with the app\'s own requests', () => {
    const G = '28000000-0000-4000-8000-000000000017'
    let ids
    const names = ['Cat Dry Food', 'Cat Wet Food', 'Hairs all Relief', 'Working Ear Plug', 'Wood Cleaner Spray', 'Silicone Gun', 'Catnip Snack']
    const list = [30.79, 26.6, 21.99, 8.49, 10.99, 4.99, 9.99]

    beforeAll(async () => {
      ids = []
      for (const [i, name] of names.entries()) ids.push(await newOrder(name, list[i], { category: ['Cat Dry Food', 'Cat Wet Food', 'Hairs all Relief', 'Catnip Snack'].includes(name) ? pets : home }))
    })

    it('"Group orders" → a group of the 7; then the discount −€3.23: shares 0.87 … 0.30, paid €110.61, the expenses follow', async () => {
      const singles = await ordersNow(ids)
      await save(groupPayload({ id: G, place: placeOf(singles[0]), members: singles }))
      expect(await groupNow(G)).toMatchObject({ shop_id: shop, order_date: '2026-10-17', paid_by: 'akbar', discount_kind: null, discount_total: 0 })
      const members = await ordersNow(ids)
      const answer = await save(groupPayload({ id: G, place: placeAmazon(), discount: { kind: 'amount', value: 3.23 }, members }))
      expect(answer.orders.map((o) => o.group_share)).toEqual([0.87, 0.75, 0.62, 0.24, 0.31, 0.14, 0.3])
      expect(await prices(ids)).toEqual([29.92, 25.85, 21.37, 8.25, 10.68, 4.85, 9.69])
      expect(await amounts(ids)).toEqual([29.92, 25.85, 21.37, 8.25, 10.68, 4.85, 9.69])
      expect((await row(`select sum(e.amount)::float as t from orders o join expenses e on e.id = o.expense_id where o.group_id = $1`, [G])).t).toBe(110.61)
      expect((await row(`select sum(e.amount)::float as t, sum(o.group_share)::float as s from orders o join expenses e on e.id = o.expense_id where o.group_id = $1 and e.category_id = $2`, [G, pets]))).toEqual({ t: 86.83, s: 2.54 })
      expect(await groupNow(G)).toMatchObject({ discount_kind: 'amount', discount_value: 3.23, discount_total: 3.23 })
      expect(answer.kept).toEqual([])
    })

    it('the same request again (pressed twice, or a lost answer): nothing changes, the same answer', async () => {
      const members = await ordersNow(ids)
      const payload = groupPayload({ id: G, place: placeAmazon(), discount: { kind: 'amount', value: 3.23 }, members })
      const snapshot = await rows(`select * from expenses order by id`)
      const answer = await save(payload)
      expect(answer.orders).toEqual(members)
      expect(answer.expenses).toEqual([])
      expect(await rows(`select * from expenses order by id`)).toEqual(snapshot)
    })

    it('Return of Working Ear Plug with "Delete the expense" (the app\'s own writes): its €8.25 expense is gone, the other six unchanged, €102.36 left, the group still −€3.23', async () => {
      const ear = ids[3]
      const { expense_id: expense } = await row(`select expense_id from orders where id = $1`, [ear])
      expect((await row(`select amount::float as a from expenses where id = $1`, [expense])).a).toBe(8.25)
      await as('authenticated', MEMBER, async () => {
        await fx.query(`update orders set status = 'returned', arrived_date = '2026-10-29', expense_outcome = 'deleted' where id = $1`, [ear])
        await fx.query(`delete from expenses where id = $1`, [expense])
      })
      expect(await amounts(ids)).toEqual([29.92, 25.85, 21.37, 10.68, 4.85, 9.69])
      expect((await row(`select sum(e.amount)::float as t from orders o join expenses e on e.id = o.expense_id where o.group_id = $1`, [G])).t).toBe(102.36)
      expect((await row(`select sum(group_share)::float as s from orders where group_id = $1`, [G])).s).toBe(3.23)
      expect(await row(`select price::float as p, group_share::float as s, expense_id from orders where id = $1`, [ear])).toEqual({ p: 8.25, s: 0.24, expense_id: null })
      expect((await groupNow(G)).discount_total).toBe(3.23)
    })

    it('existing functions still work on a member: arrive_order / unarrive_order never touch its share or price', async () => {
      const cat = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Cat Dry Food', 'pcs', 1, 'misc') returning id`)).id
      await fx.query(`update orders set pantry_item_id = $2 where id = $1`, [ids[0], cat])
      await as('authenticated', MEMBER, () => fx.query(`select arrive_order($1, $2, 2, '2026-10-20')`, [ids[0], cat]))
      await as('authenticated', MEMBER, () => fx.query(`select unarrive_order($1)`, [ids[0]]))
      expect(await row(`select status, price::float as p, group_share::float as s, group_id from orders where id = $1`, [ids[0]])).toEqual({ status: 'on_the_way', p: 29.92, s: 0.87, group_id: G })
    })
  })

  describe('other groups (the rules are general)', () => {
    it('2 orders 30.79 + 4.99 with −€1.00 → 0.86 / 0.14', async () => {
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99)]
      const id = '28000000-0000-4000-8000-000000000201'
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      expect((await ordersNow(ids)).map((o) => o.group_share)).toEqual([0.86, 0.14])
      expect(await amounts(ids)).toEqual([29.93, 4.85])
    })

    it('−10% on 10 + 8.40 + 20 → €3.84', async () => {
      const ids = [await newOrder('A', 10), await newOrder('B', 8.4), await newOrder('C', 20)]
      const id = '28000000-0000-4000-8000-000000000202'
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'percent', value: 10 }, members: await ordersNow(ids) }))
      expect(await prices(ids)).toEqual([9, 7.56, 18])
      expect(await groupNow(id)).toMatchObject({ discount_kind: 'percent', discount_value: 10, discount_total: 3.84 })
    })

    it('an order with its own −30% (€80 → €56) plus the group discount: its own first, then its share', async () => {
      const sneakers = await newOrder('Sneakers', 56, { extra: { list_price: 80, discount_kind: 'percent', discount_value: 30 } })
      const ids = [sneakers, await newOrder('Socks', 37.33)]
      await save(groupPayload({ id: '28000000-0000-4000-8000-000000000203', place: placeAmazon(), discount: { kind: 'amount', value: 2 }, members: await ordersNow(ids) }))
      expect(await row(`select price::float as p, group_share::float as s, list_price::float as l, discount_value::float as v from orders where id = $1`, [sneakers])).toEqual({ p: 54.8, s: 1.2, l: 80, v: 30 })
    })

    it('a 3rd order joining a group with a discount (K2, as the order form saves it): spread again over all three', async () => {
      const id = '28000000-0000-4000-8000-000000000204'
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      const third = await newOrder('C', 10)
      const group = await groupNow(id)
      await save(groupPayload({ id, place: placeOf(group), discount: { kind: group.discount_kind, value: group.discount_value }, members: await ordersNow([...ids, third]) }))
      expect((await ordersNow([...ids, third])).map((o) => o.group_share)).toEqual([0.67, 0.11, 0.22])
      expect(await amounts([...ids, third])).toEqual([30.12, 4.88, 9.78])
    })

    it('"Take out of the group", then Undo: exactly as before, every share and expense', async () => {
      const id = '28000000-0000-4000-8000-000000000205'
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99), await newOrder('C', 10)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      const members = await ordersNow(ids)
      const group = await groupNow(id)
      const snapshot = await amounts(ids)
      const answer = await save(groupPayload({ id, place: placeOf(group), discount: { kind: 'amount', value: 1 }, members: members.slice(0, 2), leaving: [members[2]] }))
      expect((await ordersNow(ids)).map((o) => [o.group_share, o.group_id === id])).toEqual([[0.86, true], [0.14, true], [0, false]])
      expect(await amounts(ids)).toEqual([29.93, 4.85, 10])
      await save(undoGroupPayload({ id, groupBefore: group, before: members, now: answer.orders }))
      expect(await ordersNow(ids)).toEqual(members)
      expect(await amounts(ids)).toEqual(snapshot)
    })

    it('"Ungroup", then Undo: every share 0, prices and expenses back; Undo makes the same group again', async () => {
      const id = '28000000-0000-4000-8000-000000000206'
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      const members = await ordersNow(ids)
      const group = await groupNow(id)
      const answer = await save(groupPayload({ id, place: placeOf(group), members: [], leaving: members }))
      expect(await groupNow(id)).toBeNull()
      expect(await amounts(ids)).toEqual([30.79, 4.99])
      expect((await ordersNow(ids)).every((o) => o.group_id === null && o.group_share === 0)).toBe(true)
      await save(undoGroupPayload({ id, groupBefore: group, before: members, now: answer.orders }))
      expect(await groupNow(id)).toEqual(group)
      expect(await ordersNow(ids)).toEqual(members)
      expect(await amounts(ids)).toEqual([29.93, 4.85])
    })

    for (const alsoExpense of [false, true]) {
      it(`deleting a member with "${alsoExpense ? 'Delete the order and its expense' : 'Delete the order only'}" (the app's steps), then Undo`, async () => {
        const id = alsoExpense ? '28000000-0000-4000-8000-000000000208' : '28000000-0000-4000-8000-000000000207'
        const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99), await newOrder('C', 10)]
        await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
        const members = await ordersNow(ids)
        const group = await groupNow(id)
        const snapshot = await amounts(ids)
        // 1. it leaves the group (its expense back to €10), 2. it is deleted.
        const answer = await save(groupPayload({ id, place: placeOf(group), discount: { kind: 'amount', value: 1 }, members: members.slice(0, 2), leaving: [members[2]] }))
        const removed = await as('authenticated', MEMBER, async () => (await fx.query(`delete from orders where id = $1 returning *`, [ids[2]])).rows[0])
        const expense = alsoExpense ? await as('authenticated', MEMBER, async () => (await fx.query(`delete from expenses where id = $1 returning *`, [removed.expense_id])).rows[0]) : null
        expect(await amounts(ids.slice(0, 2))).toEqual([29.93, 4.85])
        expect((await row(`select count(*)::int as n from expenses where id = $1`, [removed.expense_id])).n).toBe(alsoExpense ? 0 : 1)
        if (!alsoExpense) expect((await row(`select amount::float as a from expenses where id = $1`, [removed.expense_id])).a).toBe(10)
        // Undo: the expense, the order, then every share as it was.
        await as('authenticated', MEMBER, async () => {
          if (expense) await fx.query(`insert into expenses select * from jsonb_populate_record(null::expenses, $1::jsonb)`, [expense])
          await fx.query(`insert into orders select * from jsonb_populate_record(null::orders, $1::jsonb)`, [removed])
        })
        const now = answer.orders.map((o) => (o.id === ids[2] ? { ...o } : o))
        await save(undoGroupPayload({ id, groupBefore: group, before: members, now }))
        expect(await ordersNow(ids)).toEqual(members)
        expect(await amounts(ids)).toEqual(snapshot)
      })
    }

    it('an expense edited by hand is left alone when the discount changes, and named in "kept"', async () => {
      const id = '28000000-0000-4000-8000-000000000209'
      const ids = [await newOrder('A', 30.79), await newOrder('Hand edited', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      await fx.query(`update expenses set amount = 20 where id = (select expense_id from orders where id = $1)`, [ids[1]])
      const answer = await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 2 }, members: await ordersNow(ids) }))
      expect(await amounts(ids)).toEqual([29.07, 20])
      expect(await prices(ids)).toEqual([29.07, 4.71])
      expect(answer.kept).toEqual([expect.objectContaining({ order_id: ids[1], name: 'Hand edited', amount: 20, price: 4.71 })])
    })

    it('a member\'s price edited (K3): its new base, everything spread again, the expenses follow', async () => {
      const id = '28000000-0000-4000-8000-000000000210'
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids), bases: { [ids[1]]: 9.21 } }))
      expect((await ordersNow(ids)).map((o) => [o.group_share, o.price])).toEqual([[0.77, 30.02], [0.23, 8.98]])
      expect(await amounts(ids)).toEqual([30.02, 8.98])
    })

    it('store, date and payer changed on the group (K7): every order and its expense', async () => {
      const id = '28000000-0000-4000-8000-000000000211'
      const ids = [await newOrder('A', 30.79), await newOrder('B', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), members: await ordersNow(ids) }))
      await save(groupPayload({ id, place: { shop_id: zalando, order_date: '2026-10-16', paid_by: 'shared' }, members: await ordersNow(ids) }))
      expect(await rows(`select shop_id, order_date::text as d, paid_by from orders where id = any($1)`, [ids])).toEqual([
        { shop_id: zalando, d: '2026-10-16', paid_by: 'shared' },
        { shop_id: zalando, d: '2026-10-16', paid_by: 'shared' },
      ])
      expect(await rows(`select e.shop_id, e.expense_date::text as d, e.paid_by from orders o join expenses e on e.id = o.expense_id where o.id = any($1)`, [ids])).toEqual([
        { shop_id: zalando, d: '2026-10-16', paid_by: 'shared' },
        { shop_id: zalando, d: '2026-10-16', paid_by: 'shared' },
      ])
      expect(await groupNow(id)).toMatchObject({ shop_id: zalando, order_date: '2026-10-16', paid_by: 'shared' })
    })
  })

  describe('refusals: nothing is written', () => {
    let ids, members
    const id = '28000000-0000-4000-8000-000000000301'
    const refuse = async (payload) => {
      const snapshot = { orders: await rows(`select * from orders order by id`), expenses: await rows(`select * from expenses order by id`), groups: await rows(`select * from order_groups order by id`) }
      const message = await fails(() => save(payload))
      expect({ orders: await rows(`select * from orders order by id`), expenses: await rows(`select * from expenses order by id`), groups: await rows(`select * from order_groups order by id`) }).toEqual(snapshot)
      return message
    }
    beforeAll(async () => {
      ids = [await newOrder('R1', 30.79), await newOrder('R2', 4.99)]
      await save(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: await ordersNow(ids) }))
      members = await ordersNow(ids)
    })

    it('an order changed meanwhile on the other phone', async () => {
      const stale = members.map((o, i) => (i === 0 ? { ...o, price: 30 } : o))
      expect(await refuse(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 2 }, members: stale }))).toMatch(/"R1" changed meanwhile \(on the other phone\?\) — open Orders again\. Nothing was changed\./)
    })

    it('a group not named whole; an order deleted meanwhile; a new group of one', async () => {
      expect(await refuse(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: members.slice(0, 1) }))).toMatch(/The order group changed meanwhile/)
      expect(await refuse(groupPayload({ id, place: placeAmazon(), members: [...members, { ...members[0], id: '28000000-0000-4000-8000-0000000003ff' }] }))).toMatch(/An order was deleted meanwhile/)
      const lone = await ordersNow([await newOrder('Lone', 5)])
      expect(await refuse(groupPayload({ id: '28000000-0000-4000-8000-000000000302', place: placeAmazon(), members: lone }))).toMatch(/Pick at least two orders/)
    })

    it('another store, date or payer; no store; an order of another group', async () => {
      const other = await ordersNow([await newOrder('Elsewhere', 5, { shopId: zalando })])
      expect(await refuse(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: [...members, ...other] }))).toMatch(/Only orders of the same store, order date and payer can be one order \("Elsewhere" is different\)/)
      const later = await ordersNow([await newOrder('Later', 5, { date: '2026-10-18' })])
      expect(await refuse(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: [...members, ...later] }))).toMatch(/"Later" is different/)
      const nowhere = await ordersNow([await newOrder('N1', 5, { shopId: null }), await newOrder('N2', 6, { shopId: null })])
      expect(await refuse(groupPayload({ id: '28000000-0000-4000-8000-000000000303', place: placeOf(nowhere[0]), members: nowhere }))).toMatch(/Set the store on the order first\./)
      const two = await ordersNow([await newOrder('X1', 5), await newOrder('X2', 6)])
      await save(groupPayload({ id: '28000000-0000-4000-8000-000000000304', place: placeAmazon(), members: two }))
      const inOther = await ordersNow([two[0].id])
      expect(await refuse(groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 1 }, members: [...members, ...inOther] }))).toMatch(/"X1" is already in another order group/)
    })

    it('shares that don\'t add up, a share bigger than its order, a percent above 100', async () => {
      const good = groupPayload({ id, place: placeAmazon(), discount: { kind: 'amount', value: 2 }, members })
      expect(await refuse({ ...good, orders: good.orders.map((o, i) => (i === 0 ? { ...o, share: o.share + 0.01 } : o)) })).toMatch(/don't add up/)
      expect(await refuse({ ...good, discount_total: 40, discount_value: 40, orders: [{ ...good.orders[0], share: 30.79 }, { ...good.orders[1], share: 9.21 }] })).toMatch(/bigger than its price/)
      expect(await refuse({ ...good, discount_kind: 'percent', discount_value: 150 })).toMatch(/can't be more than 100%/)
    })
  })
})

describe('9J: "It arrived!" through arrive_order / unarrive_order as they are (no new SQL)', () => {
  let fx
  const rows = async (text, params) => (await fx.query(text, params)).rows
  const row = async (text, params) => (await rows(text, params))[0]
  async function asMember(fn) {
    await fx.query(`select set_config('request.jwt.claim.sub', $1, false)`, [MEMBER])
    await fx.exec('set role authenticated')
    try {
      return await fn()
    } finally {
      await fx.exec('reset role')
    }
  }
  const arrive = async (o, item, qty) => (await asMember(() => fx.query(`select arrive_order($1, $2, $3, '2026-10-30') as r`, [o, item, qty]))).rows[0].r
  const unarrive = (o) => asMember(() => fx.query(`select unarrive_order($1)`, [o]))
  const stock = async (id) => (await row(`select current_stock::float as s from pantry_items where id = $1`, [id]))?.s ?? null
  const orderNow = (id) => row(`select status, arrived_date::text as day, stock_added::float as added, arrived_item_id, arrived_log_id, pantry_item_id from orders where id = $1`, [id])
  const logsOf = (id) => rows(`select id, change::float as change, new_stock::float as new_stock, reason from stock_logs where item_id = $1`, [id])
  // An order as Money → Orders → "Add order" saves it: not linked to HOME.
  const unlinked = async (name, price, extra = {}) =>
    (await row(`insert into orders (item_name, price, order_date, paid_by, grocery_item_id) values ($1, $2, '2026-10-24', 'shared', $3) returning id`, [name, price, extra.grocery ?? null])).id

  beforeAll(async () => {
    fx = await newDatabase()
    for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-3]|2[78])_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
      await fx.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
  }, 120000)

  it('no SQL file after 028 touches them (029 and 030 replace only confirm_shopping_trip; 031 replaces unarrive_order, tested in its own block, and never arrive_order), and here arrive_order / unarrive_order are still the ones of 021', async () => {
    const later = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && f >= '029').sort()
    expect(later).toEqual(['029_shared_parts.sql', '030_new_item_units.sql', '031_reopen_created_items.sql'])
    for (const f of later.filter((f) => f < '031')) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/arrive_order/)
    const v031 = fs.readFileSync(path.join(dir, '031_reopen_created_items.sql'), 'utf8').replace(/--.*$/gm, '')
    expect([...v031.matchAll(/create or replace function (\w+)/g)].map((m) => m[1])).toEqual(['reopen_shopping_trip', 'unarrive_order'])
    expect(v031).not.toMatch(/\barrive_order/)
    const sql = fs.readFileSync(path.join(dir, '021_connected_flow.sql'), 'utf8')
    for (const name of ['arrive_order', 'unarrive_order']) {
      const body = sql.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))[1]
      expect((await row(`select prosrc from pg_proc where proname = $1`, [name])).prosrc).toBe(body)
    }
  })

  it('an order with pantry_item_id null into an existing item: +5000 gr as "purchased", the order stays unlinked; unarrive takes out exactly that and deletes the row', async () => {
    const rice = (await row(`insert into pantry_items (name, unit, current_stock, min_stock, category_id) values ('Basmati Rice', 'gr', 200, 500, 'misc') returning id`)).id
    const o = await unlinked('Basmati rice 5 kg', 21.5)
    const answer = await arrive(o, rice, 5000)
    expect(answer.added).toBe(true)
    expect(await stock(rice)).toBe(5200)
    const [log] = await logsOf(rice)
    expect(log).toMatchObject({ change: 5000, new_stock: 5200, reason: 'purchased' })
    expect(await orderNow(o)).toEqual({ status: 'arrived', day: '2026-10-30', added: 5000, arrived_item_id: rice, arrived_log_id: log.id, pantry_item_id: null })
    // The other phone presses Arrived too: nothing is added again.
    expect((await arrive(o, rice, 5000)).added).toBe(false)
    expect(await stock(rice)).toBe(5200)
    await unarrive(o)
    expect(await stock(rice)).toBe(200)
    expect(await logsOf(rice)).toEqual([])
    expect(await orderNow(o)).toEqual({ status: 'on_the_way', day: null, added: 0, arrived_item_id: null, arrived_log_id: null, pantry_item_id: null })
  })

  it('"Create a new item": made with stock 0 (as the app upserts it), then arrive_order +2; created before its history row; unarrive → 0 and the app\'s guarded delete removes it', async () => {
    const id = '9a000000-0000-4000-8000-000000000001'
    const o = await unlinked('Catnip Snack', 4.2)
    const make = () => asMember(() => fx.query(`insert into pantry_items (id, name, unit, current_stock, min_stock, category_id) values ($1, 'Catnip Snack', 'pcs', 0, 1, 'misc') on conflict (id) do nothing`, [id]))
    await make()
    await make() // pressed again after a dropped answer: still one item
    expect(Number((await row(`select count(*) from pantry_items where name = 'Catnip Snack'`)).count)).toBe(1)
    await arrive(o, id, 2)
    expect(await stock(id)).toBe(2)
    const logs = await logsOf(id)
    expect(logs.map((l) => l.reason)).toEqual(['purchased'])
    const gap = await row(`select extract(epoch from (l.created_at - p.created_at))::float as s from stock_logs l join pantry_items p on p.id = l.item_id where l.id = $1`, [logs[0].id])
    expect(gap.s).toBeGreaterThanOrEqual(0)
    expect(gap.s).toBeLessThanOrEqual(30)
    await unarrive(o)
    expect(await stock(id)).toBe(0)
    expect(await logsOf(id)).toEqual([])
    await asMember(() => fx.query(`delete from pantry_items where id = $1 and current_stock = 0`, [id]))
    expect(await stock(id)).toBeNull()
    expect((await orderNow(o)).status).toBe('on_the_way')
  })

  it('a new item with "Current stock" 0: arrive_order adds nothing (the order arrives, the item is not recorded on it)', async () => {
    const id = '9a000000-0000-4000-8000-000000000002'
    const o = await unlinked('Lint Roller', 5.5)
    await asMember(() => fx.query(`insert into pantry_items (id, name, unit, current_stock, category_id) values ($1, 'Lint Roller', 'pcs', 0, 'misc') on conflict (id) do nothing`, [id]))
    await arrive(o, id, 0)
    expect(await orderNow(o)).toMatchObject({ status: 'arrived', added: 0, arrived_item_id: null, arrived_log_id: null })
    expect(await logsOf(id)).toEqual([])
  })

  it('"Don\'t add to HOME": arrive_order(order, null, 0) then unarrive_order — the SHOP entry leaves the list and comes back', async () => {
    const entry = (await row(`insert into grocery_items (name, quantity, unit, completed) values ('Shoe Insoles', 1, 'pcs', false) returning id`)).id
    const o = await unlinked('Shoe Insoles', 9, { grocery: entry })
    const before = await row(`select sum(current_stock)::float as s, count(*)::int as n from pantry_items`)
    await arrive(o, null, 0)
    expect(await orderNow(o)).toMatchObject({ status: 'arrived', day: '2026-10-30', added: 0, arrived_item_id: null, arrived_log_id: null })
    expect((await row(`select completed from grocery_items where id = $1`, [entry])).completed).toBe(true)
    await unarrive(o)
    expect(await orderNow(o)).toMatchObject({ status: 'on_the_way', day: null })
    expect((await row(`select completed from grocery_items where id = $1`, [entry])).completed).toBe(false)
    expect(await row(`select sum(current_stock)::float as s, count(*)::int as n from pantry_items`)).toEqual(before)
  })
})

describe('029: "Shared" with each person\'s part — two columns on expenses, confirm_shopping_trip writes them', () => {
  const file = '029_shared_parts.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  // The two people, as PAID_BY_OPTIONS lists them (never written out here).
  const [P1, P2] = PEOPLE
  const [C1, C2] = PEOPLE.map(partColumn)
  // fx gets 029; base stays at 028, to compare a purchase without parts.
  let fx, base, groceries
  const on = (d) => ({
    rows: async (text, params) => (await d.query(text, params)).rows,
    row: async (text, params) => (await d.query(text, params)).rows[0],
  })
  const rows = (text, params) => on(fx).rows(text, params)
  const row = (text, params) => on(fx).row(text, params)
  async function as(d, role, userId, fn) {
    await d.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await d.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await d.exec('reset role')
    }
  }
  const member = (d, fn) => as(d, 'authenticated', MEMBER, fn)
  const fails = async (fn) => {
    try {
      await fn()
      return null
    } catch (error) {
      return error.message
    }
  }
  const run = async () => (await fx.exec(sql)).at(-1).rows
  const confirm = (d, payload) => member(d, async () => (await d.query(`select * from confirm_shopping_trip($1::jsonb)`, [payload])).rows[0])
  const reopen = (d, id) => member(d, async () => (await d.query(`select reopen_shopping_trip($1) as n`, [id])).rows[0].n)

  const SHOP = '29000000-0000-4000-8000-0000000000a1'
  const BUDGET = '29000000-0000-4000-8000-0000000000b1'
  const P = { oil: '29000000-0000-4000-8000-000000000101', yogurt: '29000000-0000-4000-8000-000000000102', coffee: '29000000-0000-4000-8000-000000000103' }
  const G = {
    oil: '29000000-0000-4000-8000-000000000201',
    yogurt: '29000000-0000-4000-8000-000000000202',
    basil: '29000000-0000-4000-8000-000000000203',
    bulb: '29000000-0000-4000-8000-000000000204',
    coffee: '29000000-0000-4000-8000-000000000205',
  }
  // The same HOME items and cart in both databases (fixed ids).
  async function seed(d) {
    await d.query(`insert into shops (id, name) values ($1, 'Esselunga 029')`, [SHOP])
    await d.query(`insert into expense_categories (id, name) values ($1, 'Groceries 029')`, [BUDGET])
    await d.query(
      `insert into pantry_items (id, name, unit, current_stock, min_stock, category_id, price, price_qty, price_unit, expiry_date, payer) values
        ($1, 'Olive oil 029', 'btl', 1, 1, 'misc', 8.99, 1, 'btl', null, 'shared'),
        ($2, 'Yogurt 029', 'pcs', 2, 4, 'dairy', 0.9, 1, 'pcs', '2020-01-01', $4),
        ($3, 'Coffee 029', 'pack', 0, 1, 'beverages', 5.4, 1, 'pack', null, $5)`,
      [P.oil, P.yogurt, P.coffee, P1, P2]
    )
    await d.query(
      `insert into grocery_items (id, name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id, payer) values
        ($1, 'Olive oil 029', 1, 'btl', 8.99, 1, 'btl', $6, true, 'misc', 'shared'),
        ($2, 'Yogurt 029', 4, 'pcs', 3.6, 4, 'pcs', $7, true, 'dairy', $9),
        ($3, 'Basil 029', 1, 'pcs', 0, 1, 'pcs', null, true, 'misc', 'shared'),
        ($4, 'Bulb 029', 1, 'pcs', 4.2, 1, 'pcs', null, true, 'appliances', $10),
        ($5, 'Coffee 029', 2, 'pack', 10.8, 2, 'pack', $8, true, 'beverages', 'shared')`,
      [G.oil, G.yogurt, G.basil, G.bulb, G.coffee, P.oil, P.yogurt, P.coffee, P1, P2]
    )
  }
  // Everything a purchase writes, without ids and times made by the database.
  const state = async (d) => {
    const { rows: r } = on(d)
    return {
      expenses: await r(`select description, amount::float as amount, paid_by, category_id, expense_date::text as date, trip_id, shop_id, travel_id, merged_at from expenses where description like '% 029' order by description, amount`),
      pantry: await r(`select name, current_stock::float as stock, payer, expiry_date::text as expiry, price::float as price, one_time, min_stock::float as min from pantry_items where name like '% 029' order by name`),
      logs: await r(`select item_name, change::float as change, new_stock::float as stock, reason from stock_logs where item_name like '% 029' order by item_name, change`),
      grocery: await r(`select id, completed, in_cart, expense_id is not null as has_expense, trip_id, pantry_item_id is not null as linked from grocery_items where name like '% 029' order by id`),
      trips: await r(`select id, total::float as total, source, paid_by, shop_id, coupon_total::float as coupon from shopping_trips where id::text like '29000000%' order by id`),
      lines: await r(`select trip_id, position, name, line_total::float as total, stock_added::float as added, stock_discarded::float as discarded, pantry_created, coupon_share::float as coupon, line_kind, quantity::float as quantity, unit, list_total::float as list, expense_id is not null as has_expense from shopping_trip_items where trip_id::text like '29000000%' order by trip_id, position`),
    }
  }
  // What the database has besides 029, to compare before and after it.
  const untouched = async () => ({
    functions: await rows(`select p.proname, md5(p.prosrc) as src, p.proconfig::text as config, p.prosecdef, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'confirm_shopping_trip' order by 1, 2`),
    confirm: await row(`select p.proconfig::text as config, p.prosecdef, p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result from pg_proc p where p.oid = 'public.confirm_shopping_trip(jsonb)'::regprocedure`),
    policies: await rows(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies order by 1, 2`),
    grants: await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3`),
    functionGrants: await rows(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema = 'public' order by 1, 2, 3`),
    expenses: (await rows(`select to_jsonb(e) - $1::text - $2::text as e from expenses e order by id`, [C1, C2])).map((r) => r.e),
  })
  // The SHOP payload the app sends today (no parts): mixed payers, a coupon, a free line, a durable.
  const shopPayload = (id) => ({
    id,
    trip_date: '2026-10-27',
    at: '2026-10-27T18:00:00Z',
    photo_ids: [],
    shop_id: SHOP,
    paid_by: null,
    coupon_kind: 'amount',
    coupon_value: 1,
    coupon_total: 1,
    items: [
      { grocery_item_id: G.oil, line_total: 8.49, list_total: 8.99, coupon_share: 0.5, payer: 'shared', expense_category_id: groceries, durable: false, pantry_item_id: P.oil, add: 1 },
      { grocery_item_id: G.yogurt, line_total: 3.1, list_total: 3.6, coupon_share: 0.5, payer: P1, expense_category_id: groceries, durable: false, pantry_item_id: P.yogurt, add: 4, discard_expired: true, expiry_date: '2026-11-10' },
      { grocery_item_id: G.basil, line_total: 0, payer: 'shared', expense_category_id: groceries, durable: false, pantry_item_id: null, add: 1 },
      { grocery_item_id: G.bulb, line_total: 4.2, payer: P2, expense_category_id: groceries, durable: true, pantry_item_id: null, add: 0 },
      { grocery_item_id: G.coffee, line_total: 10.8, payer: 'shared', expense_category_id: groceries, durable: false, pantry_item_id: P.coffee, add: 2 },
    ],
  })
  let before

  beforeAll(async () => {
    const make = async () => {
      const d = await newDatabase()
      for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-8])_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
        await d.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
      }
      await seed(d)
      return d
    }
    ;[fx, base] = await Promise.all([make(), make()])
    groceries = BUDGET
    await fx.query(`insert into expenses (amount, description, paid_by, expense_date, category_id) values (268.58, 'SPESE CONDOMINIO', 'shared', '2026-10-27', $1)`, [groceries])
    before = await untouched()
  }, 180000)

  it('only adds two columns and one constraint, and replaces confirm_shopping_trip — all in one transaction; no table, policy, grant or data change', () => {
    const code = sql.replace(/--.*$/gm, '')
    const outside = code.replace(/as \$\$[\s\S]*?end \$\$;/g, '')
    expect([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1])).toEqual(['confirm_shopping_trip'])
    expect(code).not.toMatch(/create table|drop |policy|\bgrant\b|\brevoke\b|security definer|truncate/i)
    expect([...outside.matchAll(/alter table (?:public\.)?(\w+)/g)].map((m) => m[1])).toEqual(['expenses', 'expenses', 'expenses'])
    expect(outside).not.toMatch(/\b(insert into|update \w+ set|delete from)\b/i)
    expect(outside.match(/add column if not exists \w+ [^;]*/g)).toEqual([`add column if not exists ${C1} numeric(12, 2)`, `add column if not exists ${C2} numeric(12, 2)`])
    // begin … commit around everything that changes, then the one check.
    const at = (text) => code.indexOf(text)
    expect(code.match(/^begin;$/gm)).toHaveLength(1)
    expect(code.match(/^commit;$/gm)).toHaveLength(1)
    expect(at('begin;')).toBeLessThan(at('alter table'))
    expect(at('commit;')).toBeGreaterThan(code.lastIndexOf('end $$;'))
    expect(code.match(/^select /gm)).toHaveLength(1)
    expect(at('commit;')).toBeLessThan(code.search(/^select /m))
  })

  it('confirm_shopping_trip: every line is the 023 version except the expense insert (two lines) and one comment', () => {
    const body = (text) => {
      const start = text.indexOf('create or replace function confirm_shopping_trip(payload jsonb)')
      return text.slice(start, text.indexOf('end $$;', start) + 7).split('\n')
    }
    const old = body(fs.readFileSync(path.join(dir, '023_oct_2026_features.sql'), 'utf8'))
    const now = body(sql)
    const i = old.findIndex((l) => l.includes('insert into expenses (category_id'))
    expect(old[i + 1]).toMatch(/^\s+values \(\(v_item->>'expense_category_id'\)::uuid/)
    const expected = [
      ...old.slice(0, i),
      `      -- 029: also each person's part of a Shared line (both empty unless sent).`,
      old[i].replace('travel_id)', `travel_id, ${C1}, ${C2})`),
      old[i + 1].replace(/\)$/, `, (v_item->>'${C1}')::numeric, (v_item->>'${C2}')::numeric)`),
      ...old.slice(i + 2),
    ]
    expect(now).toEqual(expected)
  })

  it('before 029 (the app is deployed first): no part columns, the app sees none; a save with parts says "This needs the database update supabase/029_shared_parts.sql"', async () => {
    const all = await rows(`select * from expenses limit 5`)
    expect(all.length).toBeGreaterThan(0)
    expect(partsColumnsReady(all)).toBe(false)
    const error = await member(fx, async () => {
      try {
        await fx.query(`insert into expenses (amount, description, paid_by, expense_date, ${C1}, ${C2}) values (10, 'Parts 029', 'shared', '2026-10-27', 4, 6)`)
      } catch (e) {
        return e
      }
    })
    expect(error.code).toBe('42703')
    expect(missingPartsColumn({ code: error.code, message: error.message })).toBe(true)
    expect(PARTS_NOTICE).toBe(`This needs the database update supabase/${file}`)
  })

  it('run twice: every check is ok; other functions, policies, grants and data unchanged; anon gets nothing', async () => {
    const first = await run()
    const second = await run()
    expect(first.map((r) => [r.object, r.status])).toEqual([
      [`column expenses.${C1}`, 'ok'],
      [`column expenses.${C2}`, 'ok'],
      ['expenses_parts_ok (both empty, or both >= 0)', 'ok'],
      ['function confirm_shopping_trip(jsonb)', 'ok'],
      ['expenses with parts (0 the first time)', 'ok'],
    ])
    expect(first[0].detail).toBe('numeric(12, 2)')
    expect(first[3].detail).toBe('writes the parts: yes · search_path=public: yes · security invoker: yes · login check: yes · anon: none')
    expect(first.at(-1).detail).toMatch(/^0 of \d+$/)
    expect(second).toEqual(first)
    expect(first.length).toBeLessThan(100)
    expect(await untouched()).toEqual(before)
    expect(partsColumnsReady(await rows(`select * from expenses limit 1`))).toBe(true)
    expect(await rows(`select ${C1}, ${C2} from expenses where ${C1} is not null or ${C2} is not null`)).toEqual([])
    expect(await as(fx, 'anon', null, () => fails(() => fx.query(`select confirm_shopping_trip('{}'::jsonb)`)))).toMatch(/permission denied/)
    expect(await as(fx, 'anon', null, () => fails(() => fx.query(`select ${C1} from expenses`)))).toMatch(/permission denied/)
  })

  it('the household check: a logged-in stranger is refused (42501) and nothing is written', async () => {
    const message = await as(fx, 'authenticated', STRANGER, () => fails(() => fx.query(`select confirm_shopping_trip($1::jsonb)`, [shopPayload('29000000-0000-4000-8000-0000000000ff')])))
    expect(message).toMatch(/Not allowed: log in with the household account/)
    expect((await row(`select count(*)::int as n from shopping_trips where id = '29000000-0000-4000-8000-0000000000ff'`)).n).toBe(0)
  })

  it('a SHOP payload without parts writes exactly what 023 writes (stock, history, expenses), and Reopen gives the same result', async () => {
    const id = '29000000-0000-4000-8000-000000000001'
    expect(await state(fx)).toEqual(await state(base))
    const t = await confirm(fx, shopPayload(id))
    const t0 = await confirm(base, shopPayload(id))
    expect(Number(t.total)).toBe(26.59)
    expect(Number(t0.total)).toBe(26.59)
    const after = await state(fx)
    expect(after).toEqual(await state(base))
    expect(after.expenses.map((e) => [e.description, e.amount, e.paid_by])).toEqual([
      ['Bulb 029', 4.2, P2],
      ['Coffee 029', 10.8, 'shared'],
      ['Olive oil 029', 8.49, 'shared'],
      ['Yogurt 029', 3.1, P1],
    ])
    expect(await rows(`select ${C1}, ${C2} from expenses where trip_id = $1`, [id])).toEqual(Array(4).fill({ [C1]: null, [C2]: null }))
    // Sent again: nothing new, in both.
    await confirm(fx, shopPayload(id))
    expect(await state(fx)).toEqual(after)
    expect(await reopen(fx, id)).toBe(5)
    expect(await reopen(base, id)).toBe(5)
    expect(await state(fx)).toEqual(await state(base))
    expect((await state(fx)).grocery.every((g) => g.in_cart && !g.completed && !g.has_expense)).toBe(true)
  })

  it('a MONEY payload without parts, as the app builds it, writes exactly what 023 writes', async () => {
    const id = '29000000-0000-4000-8000-000000000002'
    const { lines, priced } = pricedLines(
      [
        { ...emptyRow(1), name: 'Detergent 029', priceText: '6,50', addToHome: false },
        { ...emptyRow(2), name: 'Sponges 029', priceText: '2', addToHome: false },
      ].map((r) => rowLine(r, [])),
      { kind: 'amount', text: '0,50' }
    )
    const payload = moneyPurchasePayload({ id, date: '2026-10-27', at: '2026-10-27T18:00:00Z', shopId: SHOP, paidBy: 'shared', lines, budgetFor: () => groceries, priced })
    expect(payload.items.some((i) => C1 in i || C2 in i)).toBe(false)
    await confirm(fx, payload)
    await confirm(base, payload)
    expect(await state(fx)).toEqual(await state(base))
    expect(await rows(`select ${C1}, ${C2} from expenses where trip_id = $1`, [id])).toEqual(Array(2).fill({ [C1]: null, [C2]: null }))
    expect(await reopen(fx, id)).toBe(2)
    expect(await reopen(base, id)).toBe(2)
    expect(await state(fx)).toEqual(await state(base))
  })

  it('a MONEY purchase paid by Shared, with the parts typed in the form: each expense keeps its parts (each line adds up, the totals are what was typed); Undo takes them away with the expenses', async () => {
    const id = '29000000-0000-4000-8000-000000000003'
    // €38.40 as on the receipt (10 + 12 −30% + 20), coupon −€5 → paid 8.70 + 7.31 + 17.39 = €33.40.
    const { lines, priced } = pricedLines(
      [
        { ...emptyRow(1), name: 'Cat litter 029', priceText: '10', addToHome: false },
        { ...emptyRow(2), name: 'Sun cream 029', priceText: '12', discountKind: 'percent', discountText: '30', addToHome: false },
        { ...emptyRow(3), name: 'Dinner 029', priceText: '20', addToHome: false },
      ].map((r) => rowLine(r, [])),
      { kind: 'amount', text: '5' }
    )
    expect(lines.map((l) => l.paid)).toEqual([8.7, 7.31, 17.39])
    for (const [who, other, typed, rest] of [
      [P1, P2, '20', 13.4],
      [P2, P1, '13,40', 20],
    ]) {
      const check = checkSplit(typePart(emptySplit(), who, typed, priced.paidTotal), priced.paidTotal)
      expect(check.problem).toBe('')
      expect(check.parts[other]).toBe(rest)
      const lineParts = spreadParts(lines.map((l) => l.paid), check.parts)
      const payload = moneyPurchasePayload({ id, date: '2026-10-27', at: '2026-10-27T18:00:00Z', shopId: SHOP, paidBy: 'shared', lines, budgetFor: () => groceries, priced, lineParts })
      await confirm(fx, payload)
      const saved = await rows(`select description, amount::float as amount, paid_by, ${C1}::float as a, ${C2}::float as b from expenses where trip_id = $1 order by amount`, [id])
      expect(saved).toHaveLength(3)
      for (const e of saved) expect(Math.round((e.a + e.b) * 100) / 100).toBe(e.amount)
      expect(saved.every((e) => e.paid_by === 'shared')).toBe(true)
      const total = (k) => Math.round(saved.reduce((s, e) => s + e[k], 0) * 100) / 100
      expect({ [P1]: total('a'), [P2]: total('b') }).toEqual(check.parts)
      expect(await reopen(fx, id)).toBe(3)
      expect((await row(`select count(*)::int as n from expenses where trip_id = $1 or description in ('Cat litter 029', 'Sun cream 029', 'Dinner 029')`, [id])).n).toBe(0)
    }
  })

  it('a SHOP purchase with lines paid by each person and Shared lines (the app\'s confirmationPayload): only the Shared lines get parts; a free line none; Reopen takes them away', async () => {
    const id = '29000000-0000-4000-8000-000000000004'
    const pantryItems = await rows(`select id, name, unit, current_stock::float as current_stock, min_stock::float as min_stock, is_group, group_id, expiry_date::text as expiry_date, category_id, packaging_unit, quantity_per_pack from pantry_items`)
    const cart = (await rows(`select * from grocery_items where in_cart and name like '% 029' order by created_at, id`)).map((g) => ({ ...g, quantity: Number(g.quantity), price: Number(g.price), price_qty: Number(g.price_qty) }))
    const lines = cart.map((item) => purchaseLine(item, pantryItems, item.id === G.yogurt ? { discard: true } : {}))
    const totalOf = (item) => Math.round(item.price * 100) / 100
    // Oil −10%, a €1 coupon spread over everything.
    const pricing = purchasePricing(cart, totalOf, { [G.oil]: { kind: 'percent', text: '10' } }, { kind: 'amount', text: '1' })
    const shared = cart.filter((i) => i.payer === 'shared' && pricing.byItem.get(i.id).paid > 0)
    expect(shared.map((i) => i.name)).toEqual(['Olive oil 029', 'Coffee 029'])
    const sharedTotal = Math.round(shared.reduce((s, i) => s + pricing.byItem.get(i.id).paid, 0) * 100) / 100
    const check = checkSplit(typePart(emptySplit(), P2, '7,77', sharedTotal), sharedTotal)
    expect(check.problem).toBe('')
    const spread = spreadParts(shared.map((i) => pricing.byItem.get(i.id).paid), check.parts)
    const partsByItem = new Map(shared.map((i, k) => [i.id, spread[k]]))
    const payload = confirmationPayload({ id, date: '2026-10-27', at: '2026-10-27T18:00:00Z', lines, answers: { [G.yogurt]: { discard: true } }, totalOf, expenseCategoryFor: () => groceries, shopId: SHOP, paidBy: null, pricing, partsByItem })
    expect(payload.items.filter((i) => C1 in i).map((i) => i.grocery_item_id)).toEqual([G.oil, G.coffee])
    await confirm(fx, payload)
    const saved = await rows(`select description, amount::float as amount, paid_by, ${C1}::float as a, ${C2}::float as b from expenses where trip_id = $1 order by description`, [id])
    expect(saved.map((e) => [e.description, e.paid_by, e.a === null])).toEqual([
      ['Bulb 029', P2, true],
      ['Coffee 029', 'shared', false],
      ['Olive oil 029', 'shared', false],
      ['Yogurt 029', P1, true],
    ])
    const withParts = saved.filter((e) => e.a !== null)
    for (const e of withParts) expect(Math.round((e.a + e.b) * 100) / 100).toBe(e.amount)
    expect(Math.round(withParts.reduce((s, e) => s + e.b, 0) * 100) / 100).toBe(7.77)
    expect(Math.round(withParts.reduce((s, e) => s + e.a, 0) * 100) / 100).toBe(Math.round((sharedTotal - 7.77) * 100) / 100)
    expect(await reopen(fx, id)).toBe(5)
    expect((await row(`select count(*)::int as n from expenses where description like '% 029'`)).n).toBe(0)
  })

  it('a plain expense keeps its parts as the app writes them; the constraint refuses a negative part and one part without the other; €0 is allowed', async () => {
    await member(fx, async () => {
      const id = (await fx.query(`insert into expenses (amount, description, paid_by, expense_date, ${C1}, ${C2}) values (268.58, 'Parts plain 029', 'shared', '2026-10-27', $1, $2) returning id`, [100, 168.58])).rows[0].id
      expect(await row(`select ${C1}::float as a, ${C2}::float as b from expenses where id = $1`, [id])).toEqual({ a: 100, b: 168.58 })
      expect(await fails(() => fx.query(`update expenses set ${C1} = -1 where id = $1`, [id]))).toMatch(/expenses_parts_ok/)
      expect(await fails(() => fx.query(`update expenses set ${C2} = null where id = $1`, [id]))).toMatch(/expenses_parts_ok/)
      expect(await fails(() => fx.query(`insert into expenses (amount, description, paid_by, expense_date, ${C1}) values (5, 'One part 029', 'shared', '2026-10-27', 5)`))).toMatch(/expenses_parts_ok/)
      expect(await fails(() => fx.query(`update expenses set ${C1} = 0, ${C2} = 268.58 where id = $1`, [id]))).toBeNull()
      // Emptied (a payer that isn't Shared), and the 27/10 numbers the other way round.
      expect(await fails(() => fx.query(`update expenses set ${C1} = null, ${C2} = null, paid_by = $2 where id = $1`, [id, P1]))).toBeNull()
      expect(await fails(() => fx.query(`update expenses set paid_by = 'shared', ${C1} = 168.58, ${C2} = 100 where id = $1`, [id]))).toBeNull()
      // No "adds up" check: an order group or Edit order may change the amount.
      expect(await fails(() => fx.query(`update expenses set amount = 260 where id = $1`, [id]))).toBeNull()
      // Cents only.
      await fx.query(`update expenses set ${C1} = 1.005, ${C2} = 2 where id = $1`, [id])
      expect((await row(`select ${C1}::float as a from expenses where id = $1`, [id])).a).toBe(1.01)
      await fx.query(`delete from expenses where id = $1`, [id])
    })
    expect(partFields({ [P1]: 100, [P2]: 168.58 })).toEqual({ [C1]: 100, [C2]: 168.58 })
  })
})

describe('030: units for a new item made by a purchase — one column on purchase lines, confirm_shopping_trip makes the item in the chosen unit', () => {
  const file = '030_new_item_units.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const [P1, P2] = PEOPLE
  const [C1, C2] = PEOPLE.map(partColumn)
  // fx gets 030; base stays at 029, to compare a purchase without the new keys.
  let fx, base, before
  const on = (d) => ({
    rows: async (text, params) => (await d.query(text, params)).rows,
    row: async (text, params) => (await d.query(text, params)).rows[0],
  })
  const rows = (text, params) => on(fx).rows(text, params)
  const row = (text, params) => on(fx).row(text, params)
  async function as(d, role, userId, fn) {
    await d.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await d.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await d.exec('reset role')
    }
  }
  const member = (d, fn) => as(d, 'authenticated', MEMBER, fn)
  const fails = async (fn) => {
    try {
      await fn()
      return null
    } catch (error) {
      return error.message
    }
  }
  const run = async () => (await fx.exec(sql)).at(-1).rows
  const confirm = (d, payload) => member(d, async () => (await d.query(`select * from confirm_shopping_trip($1::jsonb)`, [payload])).rows[0])
  const reopen = (d, id) => member(d, async () => (await d.query(`select reopen_shopping_trip($1) as n`, [id])).rows[0].n)
  const body = (text) => {
    const start = text.indexOf('create or replace function confirm_shopping_trip(payload jsonb)')
    return text.slice(start, text.indexOf('end $$;', start) + 7).split('\n')
  }
  // A real line diff (longest common subsequence): the lines only in `a`
  // and the lines only in `b`, in order.
  const lineDiff = (a, b) => {
    const n = a.length
    const m = b.length
    const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    const removed = []
    const added = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        i++
        j++
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed.push(a[i++])
      else added.push(b[j++])
    }
    return { removed: [...removed, ...a.slice(i)], added: [...added, ...b.slice(j)] }
  }

  const BUDGET = '30000000-0000-4000-8000-0000000000b1'
  const P = { cola: '30000000-0000-4000-8000-000000000101', rice: '30000000-0000-4000-8000-000000000102', juice: '30000000-0000-4000-8000-000000000103' }
  const G = {
    soda: '30000000-0000-4000-8000-000000000201',
    beef: '30000000-0000-4000-8000-000000000202',
    cola: '30000000-0000-4000-8000-000000000203',
    lamp: '30000000-0000-4000-8000-000000000204',
    rice: '30000000-0000-4000-8000-000000000205',
  }
  async function seed(d) {
    await d.query(`insert into expense_categories (id, name) values ($1, 'Groceries 030')`, [BUDGET])
    await d.query(
      `insert into pantry_items (id, name, unit, current_stock, min_stock, category_id, price, price_qty, price_unit, packaging_unit, quantity_per_pack) values
        ($1, 'Cola 030', 'pcs', 2, 4, 'beverages', 3, 1, 'pack', 'pack', 4),
        ($2, 'Rice 030', 'gr', 500, 500, 'pantry-staples', 2.5, 1, 'kg', null, null),
        ($3, 'Juice 030', 'btl', 1, 1, 'beverages', 1.2, 1, 'btl', null, null)`,
      [P.cola, P.rice, P.juice]
    )
    // The cart: a new soft drink "1 pack" €3.00, new beef slices "1 pack", Cola restocked "2 pack", a durable, rice "1 kg".
    await d.query(
      `insert into grocery_items (id, name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id, payer) values
        ($1, 'Soft drink 030', 1, 'pack', 3, 1, 'pack', null, true, 'beverages', 'shared'),
        ($2, 'Beef slices 030', 1, 'pack', 4.5, 1, 'pack', null, true, 'meat', 'shared'),
        ($3, 'Cola 030', 2, 'pack', 3, 1, 'pack', $6, true, 'beverages', 'shared'),
        ($4, 'Lamp 030', 1, 'pcs', 12, 1, 'pcs', null, true, 'appliances', $7),
        ($5, 'Rice 030', 1, 'kg', 2.5, 1, 'kg', $8, true, 'pantry-staples', 'shared')`,
      [G.soda, G.beef, G.cola, G.lamp, G.rice, P.cola, P1, P.rice]
    )
  }
  const items = (d) => on(d).rows(`select id, name, unit, current_stock::float as current_stock, min_stock::float as min_stock, is_group, group_id, expiry_date::text as expiry_date, category_id, packaging_unit, quantity_per_pack::float as quantity_per_pack from pantry_items`)
  const cartOf = async (d) => (await on(d).rows(`select * from grocery_items where in_cart and name like '% 030' order by name`)).map((g) => ({ ...g, quantity: Number(g.quantity), price: Number(g.price), price_qty: Number(g.price_qty) }))
  const totalOf = (item) => Math.round(item.price * 100) / 100
  // The SHOP payload the app builds (lib/purchase.js), with the answers typed on the confirm screen.
  async function shopPayload(d, id, answers, { unitsReady = true, names = null, partsByItem = null } = {}) {
    const pantryItems = await items(d)
    const cart = (await cartOf(d)).filter((g) => !names || names.includes(g.name))
    const lines = cart.map((item) => purchaseLine(item, pantryItems, answers[item.id] ?? {}, { unitsReady }))
    return { lines, payload: confirmationPayload({ id, date: '2026-11-01', at: '2026-11-01T10:00:00Z', lines, answers, totalOf, expenseCategoryFor: () => BUDGET, paidBy: null, partsByItem }) }
  }
  const state = async (d) => {
    const { rows: r } = on(d)
    return {
      expenses: await r(`select description, amount::float as amount, paid_by, ${C1}::float as a, ${C2}::float as b from expenses where description like '% 030' order by description, amount`),
      pantry: await r(`select name, unit, current_stock::float as stock, packaging_unit, quantity_per_pack::float as per, price::float as price, price_qty::float as price_qty, price_unit, min_stock::float as min from pantry_items where name like '% 030' order by name`),
      logs: await r(`select item_name, change::float as change, new_stock::float as stock, unit, reason from stock_logs where item_name like '% 030' order by item_name, change`),
      grocery: await r(`select id, completed, in_cart, expense_id is not null as has_expense from grocery_items where name like '% 030' order by id`),
      lines: await r(`select position, name, line_total::float as total, stock_added::float as added, pantry_created, quantity::float as quantity, unit from shopping_trip_items where trip_id::text like '30000000%' order by trip_id, position`),
    }
  }
  const linesOf = (id) => rows(`select name, quantity::float as quantity, unit, stock_added::float as stock_added, stock_unit, pantry_created from shopping_trip_items where trip_id = $1 order by position`, [id])
  const untouched = async () => ({
    functions: await rows(`select p.proname, md5(p.prosrc) as src, p.proconfig::text as config, p.prosecdef, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'confirm_shopping_trip' order by 1, 2`),
    confirm: await row(`select p.proconfig::text as config, p.prosecdef, p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result from pg_proc p where p.oid = 'public.confirm_shopping_trip(jsonb)'::regprocedure`),
    policies: await rows(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies order by 1, 2`),
    grants: await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3`),
    functionGrants: await rows(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema = 'public' order by 1, 2, 3`),
    lines: (await rows(`select to_jsonb(t) - 'stock_unit' as t from shopping_trip_items t order by id`)).map((r) => r.t),
    pantry: (await rows(`select to_jsonb(p) as p from pantry_items p order by id`)).map((r) => r.p),
  })
  const SOFT = { newUnit: { unit: 'pack', stockUnit: 'pcs', text: '4' } }

  beforeAll(async () => {
    const make = async () => {
      const d = await newDatabase()
      for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-9])_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
        await d.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
      }
      await seed(d)
      return d
    }
    ;[fx, base] = await Promise.all([make(), make()])
    // One purchase line from before 030, to see it is never changed.
    await confirm(fx, { id: '3f000000-0000-4000-8000-0000000000f0', trip_date: '2026-10-30', items: [{ name: 'A line from before', quantity: 1, unit: 'pcs', price: 1, line_total: 1, payer: 'shared', expense_category_id: BUDGET, durable: true }], source: 'money', paid_by: 'shared' })
    before = await untouched()
  }, 180000)

  it('only adds one column and replaces confirm_shopping_trip — in one transaction; no table, policy, grant or data change; reopen_shopping_trip untouched; ends with one check and "-- End of 030"', () => {
    const code = sql.replace(/--.*$/gm, '')
    const outside = code.replace(/as \$\$[\s\S]*?end \$\$;/g, '')
    expect([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1])).toEqual(['confirm_shopping_trip'])
    expect(code).not.toMatch(/create table|drop |policy|\bgrant\b|\brevoke\b|security definer|truncate|reopen_shopping_trip|arrive_order/i)
    expect([...outside.matchAll(/alter table (?:public\.)?(\w+)/g)].map((m) => m[1])).toEqual(['shopping_trip_items'])
    expect(outside).not.toMatch(/\b(insert into|update \w+ set|delete from)\b/i)
    expect(outside.match(/add column if not exists \w+ [^;]*/g)).toEqual(['add column if not exists stock_unit text'])
    const at = (text) => code.indexOf(text)
    expect(code.match(/^begin;$/gm)).toHaveLength(1)
    expect(code.match(/^commit;$/gm)).toHaveLength(1)
    expect(at('begin;')).toBeLessThan(at('alter table'))
    expect(at('commit;')).toBeGreaterThan(code.lastIndexOf('end $$;'))
    expect(code.match(/^select /gm)).toHaveLength(1)
    expect(at('commit;')).toBeLessThan(code.search(/^select /m))
    expect(sql.trimEnd().split('\n').at(-1)).toBe('-- End of 030')
  })

  it('confirm_shopping_trip: the 029 version except exactly these lines (a real line diff)', () => {
    const { removed, added } = lineDiff(body(fs.readFileSync(path.join(dir, '029_shared_parts.sql'), 'utf8')), body(sql))
    expect(removed).toEqual([
      `        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date, one_time, min_stock)`,
      `          trim(g.name), g.category_id, g.subcategory_id, v_add, g.unit,`,
      `          coalesce(g.one_time, false), coalesce((v_item->>'min_stock')::numeric, 0)`,
      `          values (v_pantry, trim(g.name), v_add, v_add, g.unit, 'purchased') returning id into v_log;`,
      `      line_kind, quantity, unit, list_total, item_discount_kind, item_discount_value, coupon_share`,
      `      coalesce((v_item->>'coupon_share')::numeric, 0)`,
    ])
    const code = added.filter((l) => !/^\s*--/.test(l))
    expect(code).toEqual([
      '  v_new_unit text;',
      '  v_new_pack numeric;',
      '  v_stock_unit text;',
      "    v_new_unit := nullif(v_item->>'new_stock_unit', '');",
      "    v_new_pack := nullif(v_item->>'new_pack_size', '')::numeric;",
      '    if v_new_unit is null or v_new_unit = g.unit or v_new_pack is null or v_new_pack <= 0 then',
      '      v_new_unit := null;',
      '      v_new_pack := null;',
      '    end if;',
      '    v_stock_unit := null;',
      '        v_stock_unit := pi.unit;',
      '        if v_new_unit is not null then',
      '          if pi.unit = v_new_unit then',
      '            v_add := v_add * v_new_pack;',
      '          elsif pi.unit is distinct from g.unit then',
      `            raise exception '"%" is in HOME already, counted in % (added meanwhile?) — check the line and save again.', g.name, pi.unit;`,
      '          end if;',
      '        end if;',
      '        v_stock_unit := coalesce(v_new_unit, g.unit);',
      '        if v_new_unit is not null then',
      '          v_add := v_add * v_new_pack;',
      '        end if;',
      `        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date, one_time, min_stock, packaging_unit, quantity_per_pack)`,
      `          trim(g.name), g.category_id, g.subcategory_id, v_add, v_stock_unit,`,
      `          coalesce(g.one_time, false), coalesce((v_item->>'min_stock')::numeric, 0),`,
      '          case when v_new_unit is not null then g.unit end, v_new_pack',
      `          values (v_pantry, trim(g.name), v_add, v_add, v_stock_unit, 'purchased') returning id into v_log;`,
      `      line_kind, quantity, unit, list_total, item_discount_kind, item_discount_value, coupon_share, stock_unit`,
      `      coalesce((v_item->>'coupon_share')::numeric, 0), case when v_pantry is not null then v_stock_unit end`,
    ])
    // The 029 expense insert, with each person's part, is still there word for word.
    const now = body(sql)
    expect(now.filter((l) => l.includes(`${C1}, ${C2})`) || l.includes(`(v_item->>'${C1}')::numeric`))).toHaveLength(2)
  })

  it('before 030 (the app is deployed first): no column, the app sees "does not exist"; the 029 function ignores the new keys and makes "1 pack", exactly today\'s item', async () => {
    const error = await member(base, async () => {
      try {
        await base.query(`select stock_unit from shopping_trip_items limit 1`)
      } catch (e) {
        return e
      }
    })
    expect(error.code).toBe('42703')
    expect(missingStockUnitColumn({ code: error.code, message: error.message })).toBe(true)
    expect(missingStockUnitColumn({ code: '42703', message: `column expenses.${C1} does not exist` })).toBe(false)
    const id = '30000000-0000-4000-8000-000000000009'
    const { payload } = await shopPayload(base, id, { [G.soda]: SOFT }, { names: ['Soft drink 030'] })
    expect(payload.items[0]).toMatchObject({ add: 1, new_stock_unit: 'pcs', new_pack_size: 4 })
    await confirm(base, payload)
    expect(await on(base).row(`select unit, current_stock::float as stock, packaging_unit, quantity_per_pack from pantry_items where name = 'Soft drink 030'`)).toEqual({ unit: 'pack', stock: 1, packaging_unit: null, quantity_per_pack: null })
    expect(await reopen(base, id)).toBe(1)
    expect(await on(base).row(`select count(*)::int as n from pantry_items where name = 'Soft drink 030'`)).toEqual({ n: 0 })
  })

  it('run twice: every check is ok; other functions, policies, grants and data unchanged; anon gets nothing', async () => {
    const first = await run()
    const second = await run()
    expect(first.map((r) => [r.object, r.status])).toEqual([
      ['column shopping_trip_items.stock_unit', 'ok'],
      ['function confirm_shopping_trip(jsonb): writes stock_unit on the line', 'ok'],
      ['function confirm_shopping_trip(jsonb): new-item keys new_stock_unit / new_pack_size', 'ok'],
      ["function confirm_shopping_trip(jsonb): still writes each person's part (029)", 'ok'],
      ['function confirm_shopping_trip(jsonb): search_path = public', 'ok'],
      ['function confirm_shopping_trip(jsonb): security invoker', 'ok'],
      ['function confirm_shopping_trip(jsonb): household check (42501)', 'ok'],
      ['function confirm_shopping_trip(jsonb): anon none, authenticated can run it', 'ok'],
      ['purchase lines with stock_unit (0 the first time)', 'ok'],
    ])
    expect(first[0].detail).toBe('text')
    expect(first.at(-1).detail).toMatch(/^0 of 1$/)
    expect(second).toEqual(first)
    expect(first.length).toBeLessThan(100)
    expect(await untouched()).toEqual(before)
    expect(await rows(`select stock_unit from shopping_trip_items`)).toEqual([{ stock_unit: null }])
    expect(await as(fx, 'anon', null, () => fails(() => fx.query(`select confirm_shopping_trip('{}'::jsonb)`)))).toMatch(/permission denied/)
    expect(await as(fx, 'anon', null, () => fails(() => fx.query(`select stock_unit from shopping_trip_items`)))).toMatch(/permission denied/)
  })

  it('the household check: a logged-in stranger is refused (42501) and nothing is written', async () => {
    const { payload } = await shopPayload(fx, '30000000-0000-4000-8000-0000000000ff', { [G.soda]: SOFT })
    const message = await as(fx, 'authenticated', STRANGER, () => fails(() => fx.query(`select confirm_shopping_trip($1::jsonb)`, [payload])))
    expect(message).toMatch(/Not allowed: log in with the household account/)
    expect((await row(`select count(*)::int as n from shopping_trips where id = '30000000-0000-4000-8000-0000000000ff'`)).n).toBe(0)
  })

  it('a SHOP payload without the new keys (030 not known yet) writes exactly what 029 writes, plus stock_unit; Reopen gives the same result', async () => {
    const id = '30000000-0000-4000-8000-000000000001'
    const { payload } = await shopPayload(fx, id, { [G.cola]: { pack: { text: '4', unit: 'pack' } } }, { unitsReady: null })
    expect(payload.items.some((i) => 'new_stock_unit' in i || 'new_pack_size' in i)).toBe(false)
    expect(await state(fx)).toEqual(await state(base))
    await confirm(fx, payload)
    await confirm(base, payload)
    const after = await state(fx)
    expect(after).toEqual(await state(base))
    expect(after.pantry.find((p) => p.name === 'Soft drink 030')).toMatchObject({ unit: 'pack', stock: 1, packaging_unit: null })
    expect(after.pantry.find((p) => p.name === 'Cola 030')).toMatchObject({ unit: 'pcs', stock: 10 })
    expect((await linesOf(id)).map((l) => [l.name, l.stock_unit])).toEqual([
      ['Beef slices 030', 'pack'],
      ['Cola 030', 'pcs'],
      ['Lamp 030', null],
      ['Rice 030', 'gr'],
      ['Soft drink 030', 'pack'],
    ])
    expect(await reopen(fx, id)).toBe(5)
    expect(await reopen(base, id)).toBe(5)
    expect(await state(fx)).toEqual(await state(base))
  })

  it('a MONEY payload without the new keys, as the app builds it, writes exactly what 029 writes, plus stock_unit', async () => {
    const id = '30000000-0000-4000-8000-000000000002'
    const { lines, priced } = pricedLines([{ ...emptyRow(1), name: 'Eggs 030', priceText: '2,90', unit: 'box', categoryId: 'dairy', addToHome: true }].map((r) => rowLine(r, [], undefined, { unitsReady: false })))
    expect(lines[0].stockUnit).toBeNull()
    const payload = moneyPurchasePayload({ id, date: '2026-11-01', at: '2026-11-01T10:00:00Z', paidBy: 'shared', lines, budgetFor: () => BUDGET, priced })
    expect('new_stock_unit' in payload.items[0]).toBe(false)
    await confirm(fx, payload)
    await confirm(base, payload)
    expect(await state(fx)).toEqual(await state(base))
    expect(await linesOf(id)).toEqual([{ name: 'Eggs 030', quantity: 1, unit: 'box', stock_added: 1, stock_unit: 'box', pantry_created: true }])
    expect(await reopen(fx, id)).toBe(1)
    expect(await reopen(base, id)).toBe(1)
    expect(await state(fx)).toEqual(await state(base))
  })

  it('SHOP with the keys: soft drink "1 pack" €3.00 counted in pcs, 4 per pack → 4 pcs, usual pack 4, €3.00 per 1 pack, history +4 pcs, line "1 pack · 4 pcs"; beef slices kept in packs = today; the expense as today; Reopen deletes the new item exactly', async () => {
    const id = '30000000-0000-4000-8000-000000000003'
    const answers = { [G.soda]: SOFT, [G.beef]: { newUnit: { unit: 'pack', stockUnit: 'pack', text: '' } }, [G.cola]: { pack: { text: '4', unit: 'pack' } } }
    const { lines, payload } = await shopPayload(fx, id, answers)
    expect(lines.map((l) => [l.item.name, l.stockUnit?.stockUnit ?? null, l.ready])).toEqual([
      ['Beef slices 030', 'pack', true],
      ['Cola 030', null, true],
      ['Lamp 030', null, true],
      ['Rice 030', null, true],
      ['Soft drink 030', 'pcs', true],
    ])
    const soda = payload.items.find((i) => i.grocery_item_id === G.soda)
    expect(soda).toMatchObject({ add: 1, line_total: 3, new_stock_unit: 'pcs', new_pack_size: 4, pantry_item_id: null })
    expect(payload.items.filter((i) => 'new_stock_unit' in i)).toHaveLength(1)
    const pantryBefore = await rows(`select id from pantry_items order by id`)
    await confirm(fx, payload)
    expect(await row(`select unit, current_stock::float as stock, packaging_unit, quantity_per_pack::float as per, price::float as price, price_qty::float as qty, price_unit from pantry_items where name = 'Soft drink 030'`)).toEqual({ unit: 'pcs', stock: 4, packaging_unit: 'pack', per: 4, price: 3, qty: 1, price_unit: 'pack' })
    expect(await row(`select unit, current_stock::float as stock, packaging_unit from pantry_items where name = 'Beef slices 030'`)).toEqual({ unit: 'pack', stock: 1, packaging_unit: null })
    expect(await rows(`select change::float as change, new_stock::float as stock, unit, reason from stock_logs where item_name = 'Soft drink 030'`)).toEqual([{ change: 4, stock: 4, unit: 'pcs', reason: 'purchased' }])
    const saved = await linesOf(id)
    expect(saved.find((l) => l.name === 'Soft drink 030')).toEqual({ name: 'Soft drink 030', quantity: 1, unit: 'pack', stock_added: 4, stock_unit: 'pcs', pantry_created: true })
    expect(purchasedPackLabel(saved.find((l) => l.name === 'Soft drink 030'), null)).toBe('1 pack · 4 pcs')
    expect(await rows(`select description, amount::float as amount from expenses where trip_id = $1 and description = 'Soft drink 030'`, [id])).toEqual([{ description: 'Soft drink 030', amount: 3 }])
    expect(await reopen(fx, id)).toBe(5)
    expect(await rows(`select id from pantry_items order by id`)).toEqual(pantryBefore)
    expect(await rows(`select count(*)::int as n from stock_logs where item_name in ('Soft drink 030', 'Beef slices 030')`)).toEqual([{ n: 0 }])
    expect((await cartOf(fx)).map((g) => g.name)).toContain('Soft drink 030')
  })

  it('the next purchase "2 pack" €6.00 finds the item: the 9H pack field starts at 4 → +8 pcs; no question, no new keys', async () => {
    const first = '30000000-0000-4000-8000-000000000004'
    await confirm(fx, (await shopPayload(fx, first, { [G.soda]: SOFT }, { names: ['Soft drink 030'] })).payload)
    // On the list again "2 pack" €6.00 (linked now), in the cart.
    const again = '30000000-0000-4000-8000-000000000206'
    const soda = (await row(`select id from pantry_items where name = 'Soft drink 030'`)).id
    await fx.query(`insert into grocery_items (id, name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, category_id, payer) values ($1, 'Soft drink 030', 2, 'pack', 6, 2, 'pack', $2, true, 'beverages', 'shared')`, [again, soda])
    const second = '30000000-0000-4000-8000-000000000005'
    const { lines, payload } = await shopPayload(fx, second, {}, { names: ['Soft drink 030'] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ stockUnit: null, add: 8 })
    expect(lines[0].pack).toMatchObject({ text: '4', value: 4, usual: 4, total: 8 })
    expect('new_stock_unit' in payload.items[0]).toBe(false)
    await confirm(fx, payload)
    expect(await row(`select current_stock::float as stock, unit from pantry_items where id = $1`, [soda])).toEqual({ stock: 12, unit: 'pcs' })
    expect((await linesOf(second))[0]).toMatchObject({ quantity: 2, unit: 'pack', stock_added: 8, stock_unit: 'pcs', pantry_created: false })
    expect(await reopen(fx, second)).toBe(1)
    expect(await reopen(fx, first)).toBe(1)
    expect(await row(`select count(*)::int as n from pantry_items where name = 'Soft drink 030'`)).toEqual({ n: 0 })
    await fx.query(`delete from grocery_items where id = $1`, [again])
  })

  it('MONEY with the keys, as the app builds it: eggs "1 box" €2.90 → 10 pcs (usual box 10, min in pcs); tissues "1 pack" €2.40 → 6 roll; Shared parts still written; Undo deletes both items', async () => {
    const id = '30000000-0000-4000-8000-000000000006'
    const rowsTyped = [
      { ...emptyRow(1), name: 'Eggs 030', priceText: '2,90', unit: 'box', categoryId: 'dairy', addToHome: true, minText: '6', newUnit: { unit: 'box', stockUnit: 'pcs', text: '10' } },
      { ...emptyRow(2), name: 'Tissues 030', priceText: '2,40', unit: 'pack', categoryId: 'toiletries', addToHome: true, newUnit: { unit: 'pack', stockUnit: 'roll', text: '6' } },
    ]
    const { lines, priced } = pricedLines(rowsTyped.map((r) => rowLine(r, [], undefined, { unitsReady: true })))
    expect(lines.map((l) => [l.stockUnit.stockUnit, l.stockUnit.pack.total, l.minUnit, rowProblem(l)])).toEqual([
      ['pcs', 10, 'pcs', ''],
      ['roll', 6, 'roll', ''],
    ])
    const check = checkSplit(typePart(emptySplit(), P1, '2', priced.paidTotal), priced.paidTotal)
    const lineParts = spreadParts(lines.map((l) => l.paid), check.parts)
    const payload = moneyPurchasePayload({ id, date: '2026-11-01', at: '2026-11-01T10:00:00Z', paidBy: 'shared', lines, budgetFor: () => BUDGET, priced, lineParts })
    expect(payload.items.map((i) => [i.add, i.new_stock_unit, i.new_pack_size, i.min_stock])).toEqual([
      [1, 'pcs', 10, 6],
      [1, 'roll', 6, 0],
    ])
    await confirm(fx, payload)
    expect(await rows(`select name, unit, current_stock::float as stock, packaging_unit, quantity_per_pack::float as per, min_stock::float as min, price::float as price, price_unit from pantry_items where name in ('Eggs 030', 'Tissues 030') order by name`)).toEqual([
      { name: 'Eggs 030', unit: 'pcs', stock: 10, packaging_unit: 'box', per: 10, min: 6, price: 2.9, price_unit: 'box' },
      { name: 'Tissues 030', unit: 'roll', stock: 6, packaging_unit: 'pack', per: 6, min: 0, price: 2.4, price_unit: 'pack' },
    ])
    expect(await linesOf(id)).toEqual([
      { name: 'Eggs 030', quantity: 1, unit: 'box', stock_added: 10, stock_unit: 'pcs', pantry_created: true },
      { name: 'Tissues 030', quantity: 1, unit: 'pack', stock_added: 6, stock_unit: 'roll', pantry_created: true },
    ])
    const saved = await rows(`select amount::float as amount, ${C1}::float as a, ${C2}::float as b from expenses where trip_id = $1 order by amount`, [id])
    expect(saved.map((e) => e.amount)).toEqual([2.4, 2.9])
    for (const e of saved) expect(Math.round((e.a + e.b) * 100) / 100).toBe(e.amount)
    expect(Math.round(saved.reduce((s, e) => s + e.a, 0) * 100) / 100).toBe(check.parts[P1])
    expect(Math.round(saved.reduce((s, e) => s + e.b, 0) * 100) / 100).toBe(check.parts[P2])
    expect(await reopen(fx, id)).toBe(2)
    expect(await row(`select count(*)::int as n from pantry_items where name in ('Eggs 030', 'Tissues 030')`)).toEqual({ n: 0 })
    expect(await row(`select count(*)::int as n from expenses where trip_id = $1`, [id])).toEqual({ n: 0 })
  })

  it('the same name twice in one purchase: line 1 makes the item in pcs, line 2 finds it (counted in pcs) → +4 more; in the unit bought → as sent; in another unit → refused, nothing saved', async () => {
    const twice = (id, second) => ({
      id,
      trip_date: '2026-11-01',
      source: 'money',
      paid_by: 'shared',
      items: [
        { name: 'Water pack 030', category_id: 'beverages', quantity: 1, unit: 'pack', price: 3, price_qty: 1, price_unit: 'pack', line_total: 3, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: null, add: 1, min_stock: 0, new_stock_unit: 'btl', new_pack_size: 6 },
        { name: 'water PACK 030 ', category_id: 'beverages', quantity: 2, unit: 'pack', price: 6, price_qty: 2, price_unit: 'pack', line_total: 6, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: null, add: 2, min_stock: 0, ...second },
      ],
    })
    const a = '30000000-0000-4000-8000-000000000007'
    await confirm(fx, twice(a, { new_stock_unit: 'btl', new_pack_size: 6 }))
    expect(await rows(`select unit, current_stock::float as stock from pantry_items where lower(trim(name)) = 'water pack 030'`)).toEqual([{ unit: 'btl', stock: 18 }])
    expect((await linesOf(a)).map((l) => [l.stock_added, l.stock_unit, l.pantry_created])).toEqual([
      [6, 'btl', true],
      [12, 'btl', false],
    ])
    expect(await reopen(fx, a)).toBe(2)
    expect(await row(`select count(*)::int as n from pantry_items where lower(trim(name)) = 'water pack 030'`)).toEqual({ n: 0 })

    // Found counted in the unit bought (made "1 pack" on the other phone meanwhile): added as sent.
    const packs = (await row(`insert into pantry_items (name, unit, current_stock, category_id) values ('Crackers 030', 'pack', 1, 'snacks') returning id`)).id
    const b = '30000000-0000-4000-8000-000000000008'
    const one = (id, name) => ({ id, trip_date: '2026-11-01', source: 'money', paid_by: 'shared', items: [{ name, category_id: 'snacks', quantity: 2, unit: 'pack', price: 4, price_qty: 2, price_unit: 'pack', line_total: 4, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: null, add: 2, new_stock_unit: 'pcs', new_pack_size: 5 }] })
    await confirm(fx, one(b, 'Crackers 030'))
    expect(await row(`select current_stock::float as stock, unit from pantry_items where id = $1`, [packs])).toEqual({ stock: 3, unit: 'pack' })
    expect((await linesOf(b))[0]).toMatchObject({ stock_added: 2, stock_unit: 'pack', pantry_created: false })
    expect(await reopen(fx, b)).toBe(1)

    // Found counted in another unit (btl): refused with a clear message, nothing saved.
    await fx.query(`update pantry_items set unit = 'btl' where id = $1`, [packs])
    const c = '30000000-0000-4000-8000-00000000000a'
    const snapshot = await untouched()
    expect(await fails(() => confirm(fx, one(c, 'Crackers 030')))).toBe('"Crackers 030" is in HOME already, counted in btl (added meanwhile?) — check the line and save again.')
    expect(await untouched()).toEqual(snapshot)
    expect(await row(`select count(*)::int as n from shopping_trips where id = $1`, [c])).toEqual({ n: 0 })
    await fx.query(`delete from pantry_items where id = $1`, [packs])
  })

  it('only one of the two keys, or the unit bought itself, or a size of 0: ignored — made exactly as today', async () => {
    const make = (id, extra) => ({ id, trip_date: '2026-11-01', source: 'money', paid_by: 'shared', items: [{ name: 'Napkins 030', category_id: 'household', quantity: 1, unit: 'pack', price: 1, price_qty: 1, price_unit: 'pack', line_total: 1, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: null, add: 1, ...extra }] })
    const cases = [{ new_stock_unit: 'pcs' }, { new_pack_size: 4 }, { new_stock_unit: 'pack', new_pack_size: 4 }, { new_stock_unit: 'pcs', new_pack_size: 0 }]
    for (const [k, extra] of cases.entries()) {
      const id = `30000000-0000-4000-8000-00000000010${k}`
      await confirm(fx, make(id, extra))
      expect(await row(`select unit, current_stock::float as stock, packaging_unit, quantity_per_pack from pantry_items where name = 'Napkins 030'`)).toEqual({ unit: 'pack', stock: 1, packaging_unit: null, quantity_per_pack: null })
      expect(await reopen(fx, id)).toBe(1)
    }
  })
})

// 031: the lines of reopen_shopping_trip (023) and unarrive_order (021) that 031 changes, from a real diff (comments left out of the added ones).
const REOPEN_REMOVED = [
  "      if ti.pantry_created then",
  "        delete from pantry_items where id = ti.pantry_item_id;",
  "      else",
  "        update pantry_items p set",
  "          current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added) + ti.stock_discarded,",
  "          price = (ti.pantry_before->>'price')::numeric,",
  "          price_qty = (ti.pantry_before->>'price_qty')::numeric,",
  "          price_unit = ti.pantry_before->>'price_unit',",
  "          payer = ti.pantry_before->>'payer',",
  "          last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,",
  "          expiry_date = (ti.pantry_before->>'expiry_date')::date,",
  "          packaging_unit = ti.pantry_before->>'packaging_unit',",
  "          quantity_per_pack = (ti.pantry_before->>'quantity_per_pack')::numeric",
  "        where p.id = ti.pantry_item_id;",
]
const REOPEN_ADDED = [
  "  pi pantry_items;",
  "  v_unit text;",
  "  v_factor numeric;",
  "  v_elsewhere boolean;",
  "  v_trip_logs uuid[];",
  "  select coalesce(array_agg(l.id), '{}') into v_trip_logs",
  "  from shopping_trip_items i cross join lateral unnest(i.log_ids) as l(id)",
  "  where i.trip_id = reopen_shopping_trip.trip_id;",
  "      select * into pi from pantry_items p where p.id = ti.pantry_item_id for update;",
  "      if found then",
  "        v_unit := coalesce(ti.stock_unit, (select l.unit from stock_logs l where l.id = any(ti.log_ids) and l.reason = 'purchased' order by l.created_at limit 1));",
  "        v_factor := case",
  "          when v_unit is null then case when ti.unit is not distinct from pi.unit then 1 end",
  "          when v_unit is not distinct from pi.unit then 1",
  "          when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000",
  "          when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001",
  "          when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack",
  "        end;",
  "        v_unit := coalesce(v_unit, ti.unit);",
  "        v_elsewhere := ti.pantry_created and (",
  "          exists (select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.change > 0 and l.reason <> 'converted')",
  "          or exists (",
  "            select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.reason = 'converted'",
  "              and not exists (",
  "                select 1 from unnest(array[1, 1000, 0.001, pi.quantity_per_pack]) as f(n)",
  "                where f.n > 0 and l.new_stock - l.change >= 0",
  "                  and abs(l.new_stock - (l.new_stock - l.change) * f.n) <= 0.0001 * greatest(abs(l.new_stock), 1)",
  "              )",
  "          )",
  "          or exists (select 1 from shopping_trip_items o where o.pantry_item_id = pi.id and o.trip_id <> reopen_shopping_trip.trip_id)",
  "          or exists (select 1 from orders o where o.pantry_item_id = pi.id or o.arrived_item_id = pi.id)",
  "        );",
  "        if ti.pantry_created and not v_elsewhere then",
  "          delete from grocery_items g",
  "          where g.pantry_item_id = pi.id and g.auto_generated and not g.completed and not coalesce(g.in_cart, false)",
  "            and not exists (select 1 from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way')",
  "            and not exists (select 1 from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id and i.grocery_item_id = g.id);",
  "          delete from stock_logs l where l.item_id = pi.id;",
  "          delete from pantry_items where id = ti.pantry_item_id;",
  "        elsif ti.pantry_created then",
  "          if v_factor is not null then",
  "            update pantry_items p set current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor)",
  "            where p.id = pi.id;",
  "          end if;",
  "        else",
  "          update pantry_items p set",
  "            current_stock = case when v_factor is null then p.current_stock",
  "                                 else greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor) + ti.stock_discarded * v_factor end,",
  "            price = (ti.pantry_before->>'price')::numeric,",
  "            price_qty = (ti.pantry_before->>'price_qty')::numeric,",
  "            price_unit = case when v_unit is distinct from p.unit and ti.pantry_before->>'price' is not null",
  "                              then coalesce(ti.pantry_before->>'price_unit', v_unit) else ti.pantry_before->>'price_unit' end,",
  "            payer = ti.pantry_before->>'payer',",
  "            last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,",
  "            expiry_date = (ti.pantry_before->>'expiry_date')::date,",
  "            packaging_unit = case when v_unit is distinct from p.unit then p.packaging_unit else ti.pantry_before->>'packaging_unit' end,",
  "            quantity_per_pack = case when v_unit is distinct from p.unit then p.quantity_per_pack else (ti.pantry_before->>'quantity_per_pack')::numeric end",
  "          where p.id = pi.id;",
  "        end if;",
]
const UNARRIVE_REMOVED = [
  "      v_stock := greatest(0, coalesce(pi.current_stock, 0) - o.stock_added);",
  "      update pantry_items set current_stock = v_stock where id = pi.id;",
]
const UNARRIVE_ADDED = [
  "  v_unit text;",
  "  v_factor numeric;",
  "      v_unit := coalesce((select l.unit from stock_logs l where l.id = o.arrived_log_id), pi.unit);",
  "      v_factor := case",
  "        when v_unit is not distinct from pi.unit then 1",
  "        when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000",
  "        when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001",
  "        when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack",
  "      end;",
  "      if v_factor is not null then",
  "        v_stock := greatest(0, coalesce(pi.current_stock, 0) - o.stock_added * v_factor);",
  "        update pantry_items set current_stock = v_stock where id = pi.id;",
  "      end if;",
]

describe('031: Reopen of items a purchase created, and unit changes after a purchase or an arrival — reopen_shopping_trip and unarrive_order replaced', () => {
  const file = '031_reopen_created_items.sql'
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  const STRANGER = '99999999-9999-9999-9999-999999999999'
  const [C1, C2] = PEOPLE.map(partColumn)
  // fx gets 031; base stays at 030, to compare what must not change.
  let fx, base, before
  const on = (d) => ({
    rows: async (text, params) => (await d.query(text, params)).rows,
    row: async (text, params) => (await d.query(text, params)).rows[0],
  })
  const rows = (text, params) => on(fx).rows(text, params)
  const row = (text, params) => on(fx).row(text, params)
  async function as(d, role, userId, fn) {
    await d.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
    await d.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await d.exec('reset role')
    }
  }
  const member = (d, fn) => as(d, 'authenticated', MEMBER, fn)
  const fails = async (fn) => {
    try {
      await fn()
      return null
    } catch (error) {
      return error.message
    }
  }
  const run = async () => (await fx.exec(sql)).at(-1).rows
  const confirm = (d, payload) => member(d, async () => (await d.query(`select * from confirm_shopping_trip($1::jsonb)`, [payload])).rows[0])
  const arrive = (d, order, item, qty) => member(d, async () => (await d.query(`select arrive_order($1, $2, $3, '2026-11-01') as r`, [order, item, qty])).rows[0].r)
  const uuids = (ids) => `{${ids.join(',')}}`
  // Reopen as the app does it (usePurchase.reopenTrip): the lines, their
  // items and the purchase's own history rows read before, the items after,
  // and what the toasts say (lib/reopenUnits.reopenNotes).
  async function reopen(d, tripId) {
    const r = on(d)
    const lines = await r.rows(`select * from shopping_trip_items where trip_id = $1`, [tripId])
    const ids = [...new Set(lines.map((l) => l.pantry_item_id).filter(Boolean))]
    const items = async () => (ids.length ? r.rows(`select * from pantry_items where id = any($1::uuid[])`, [uuids(ids)]) : [])
    const was = await items()
    const logIds = lines.flatMap((l) => l.log_ids ?? [])
    const logs = logIds.length ? await r.rows(`select id, unit, reason from stock_logs where id = any($1::uuid[])`, [uuids(logIds)]) : []
    const n = await member(d, async () => (await d.query(`select reopen_shopping_trip($1) as n`, [tripId])).rows[0].n)
    return { n, notes: reopenNotes({ lines, before: was, after: await items(), logs }) }
  }
  // "Back on the way" as the app does it (useOrders.unarriveOrder): the
  // item and the arrival's own history row before, the item after.
  async function backOnTheWay(d, orderId) {
    const r = on(d)
    const order = await r.row(`select * from orders where id = $1`, [orderId])
    const item = order.arrived_item_id ? await r.row(`select * from pantry_items where id = $1`, [order.arrived_item_id]) : null
    const log = order.arrived_log_id ? ((await r.row(`select id, unit from stock_logs where id = $1`, [order.arrived_log_id])) ?? null) : null
    await member(d, () => d.query(`select * from unarrive_order($1)`, [orderId]))
    const after = item ? await r.row(`select * from pantry_items where id = $1`, [item.id]) : null
    return unarriveNote({ order, before: item, after, log })
  }
  const body = (text, name) => {
    const start = text.indexOf(`create or replace function ${name}(`)
    return text.slice(start, text.indexOf('end $$;', start) + 7).split('\n')
  }
  // A real line diff (longest common subsequence): the lines only in `a`
  // and the lines only in `b`, in order.
  const lineDiff = (a, b) => {
    const n = a.length
    const m = b.length
    const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    const removed = []
    const added = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        i++
        j++
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed.push(a[i++])
      else added.push(b[j++])
    }
    return { removed: [...removed, ...a.slice(i)], added: [...added, ...b.slice(j)] }
  }

  const BUDGET = '31000000-0000-4000-8000-0000000000b1'
  const id = (n) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const addItem = (d, itemId, name, unit, stock, extra = {}) =>
    d.query(`insert into pantry_items (id, name, unit, current_stock, category_id, price, price_qty, price_unit, packaging_unit, quantity_per_pack) values ($1, $2, $3, $4, 'beverages', $5, $6, $7, $8, $9)`, [
      itemId,
      name,
      unit,
      stock,
      extra.price ?? null,
      extra.price_qty ?? null,
      extra.price_unit ?? null,
      extra.packaging_unit ?? null,
      extra.quantity_per_pack ?? null,
    ])
  const addEntry = (d, entryId, name, { quantity = 1, unit = 'pack', price = 3, pantry = null, inCart = true, auto = false } = {}) =>
    d.query(`insert into grocery_items (id, name, quantity, unit, price, price_qty, price_unit, pantry_item_id, in_cart, auto_generated, category_id, payer) values ($1, $2, $3, $4, $5, $3, $4, $6, $7, $8, 'beverages', 'shared')`, [entryId, name, quantity, unit, price, pantry, inCart, auto])
  const addOrder = (d, orderId, name, { pantry = null, entry = null, status = 'on_the_way' } = {}) =>
    d.query(`insert into orders (id, item_name, price, pantry_item_id, grocery_item_id, status) values ($1, $2, 5, $3, $4, $5)`, [orderId, name, pantry, entry, status])
  // A SHOP purchase of cart entries ([{ entry, add, total, pantry, extra }]),
  // as confirmationPayload sends it.
  const shop = (d, tripId, lines) =>
    confirm(d, {
      id: tripId,
      trip_date: '2026-11-01',
      at: '2026-11-01T10:00:00Z',
      items: lines.map((l) => ({ grocery_item_id: l.entry, line_total: l.total ?? 3, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: l.pantry ?? null, add: l.add, ...l.extra })),
    })
  const idOf = async (d, name) => (await on(d).row(`select id from pantry_items where name = $1`, [name]))?.id ?? null
  // HOME "Edit item" → "Convert with the pack size" (n of `to` in 1 of the
  // old unit), as usePantryItems.updateItem saves it (plan 9L K8 / K11):
  // counted in `to`, stock and minimum × n, the usual pack = the old unit ×
  // n, the price still per the old unit, one "Unit changed" row.
  async function convert(d, itemId, to, n) {
    const p = await on(d).row(`select name, unit, current_stock::float as stock from pantry_items where id = $1`, [itemId])
    const next = p.stock * n
    await d.query(`update pantry_items set unit = $2, current_stock = $3, min_stock = min_stock * $4, packaging_unit = $5, quantity_per_pack = $4, price_unit = coalesce(price_unit, $5) where id = $1`, [itemId, to, next, n, p.unit])
    await d.query(`insert into stock_logs (item_id, item_name, change, new_stock, unit, reason) values ($1, $2, $3, $4, $5, 'converted')`, [itemId, p.name, Math.round((next - p.stock) * 100) / 100, next, to])
  }
  // "Keep the numbers as they are": only the unit changes, no history row (9L K11).
  const keepNumbers = (d, itemId, to) => d.query(`update pantry_items set unit = $2 where id = $1`, [itemId, to])
  // − / + on the tile, or a stock typed in "Edit item": the stock and its one
  // history row (lib/inventory.stockChangeWithLog).
  async function change(d, itemId, delta, reason) {
    const p = await on(d).row(`update pantry_items set current_stock = greatest(0, current_stock + $2) where id = $1 returning name, unit, current_stock`, [itemId, delta])
    await d.query(`insert into stock_logs (item_id, item_name, change, new_stock, unit, reason) values ($1, $2, $3, $4, $5, $6)`, [itemId, p.name, delta, p.current_stock, p.unit, reason])
  }
  const itemOf = (d, name) => on(d).row(`select unit, current_stock::float as stock, packaging_unit, quantity_per_pack::float as per, price::float as price, price_unit from pantry_items where name = $1`, [name])
  const logsOf = (d, name) => on(d).rows(`select item_id is not null as linked, change::float as change, new_stock::float as stock, unit, reason from stock_logs where item_name = $1 order by created_at, change`, [name])
  const entryOf = (d, entryId) => on(d).row(`select completed, in_cart, pantry_item_id is not null as linked from grocery_items where id = $1`, [entryId])
  const expensesOf = async (d, tripId) => (await on(d).row(`select count(*)::int as n from expenses where trip_id = $1`, [tripId])).n
  // Everything a case touches, by its name tag, without ids made by the database.
  const everything = async (d, tag) => {
    const r = on(d).rows
    const like = `% ${tag}`
    return {
      pantry: await r(`select name, unit, current_stock::float as stock, min_stock::float as min, packaging_unit, quantity_per_pack::float as per, price::float as price, price_qty::float as qty, price_unit, payer, expiry_date::text as expiry from pantry_items where name like $1 order by name`, [like]),
      logs: await r(`select item_name, item_id is not null as linked, change::float as change, new_stock::float as stock, unit, reason from stock_logs where item_name like $1 order by item_name, change, reason`, [like]),
      grocery: await r(`select id, completed, in_cart, pantry_item_id is not null as linked, expense_id is not null as has_expense, trip_id from grocery_items where name like $1 order by id`, [like]),
      expenses: await r(`select description, amount::float as amount, paid_by, trip_id, merged_at is not null as merged, ${C1}::float as a, ${C2}::float as b from expenses where description like $1 order by description, amount`, [like]),
      orders: await r(`select id, status, stock_added::float as added, arrived_item_id is not null as arrived_in, arrived_log_id is not null as logged from orders where item_name like $1 order by id`, [like]),
      lines: await r(`select trip_id, position, name, stock_added::float as added, stock_unit, pantry_created from shopping_trip_items where name like $1 order by trip_id, position`, [like]),
    }
  }
  const untouched = async () => ({
    functions: await rows(`select p.proname, md5(p.prosrc) as src, p.proconfig::text as config, p.prosecdef, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not in ('reopen_shopping_trip', 'unarrive_order') order by 1, 2`),
    replaced: await rows(`select p.proname, p.proconfig::text as config, p.prosecdef, p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('reopen_shopping_trip', 'unarrive_order') order by 1`),
    policies: await rows(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies order by 1, 2`),
    grants: await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3`),
    functionGrants: await rows(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema = 'public' order by 1, 2, 3`),
    columns: await rows(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`),
    data: await rows(
      ['pantry_items', 'stock_logs', 'grocery_items', 'expenses', 'shopping_trips', 'shopping_trip_items', 'orders']
        .map((t) => `select '${t}' as t, md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) as h from ${t} x`)
        .join(' union all ')
    ),
  })

  beforeAll(async () => {
    const make = async () => {
      const d = await newDatabase()
      for (const f of fs.readdirSync(dir).filter((f) => /^0(1[5-9]|2[0-9]|30)_.*\.sql$/.test(f) && !f.includes('ROLLBACK')).sort()) {
        await d.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
      }
      await d.query(`insert into expense_categories (id, name) values ($1, 'Groceries 031')`, [BUDGET])
      // A purchase from before 031, never changed by it.
      await addEntry(d, id(901), 'Before 031 x', {})
      await shop(d, id(902), [{ entry: id(901), add: 1 }])
      return d
    }
    ;[fx, base] = await Promise.all([make(), make()])
    before = await untouched()
  }, 180000)

  it('replaces only reopen_shopping_trip and unarrive_order — in one transaction; no table, column, policy, grant or data change; ends with one check and "-- End of 031"', () => {
    const code = sql.replace(/--.*$/gm, '')
    // Outside the function bodies, and outside the check's texts.
    const outside = code.replace(/as \$\$[\s\S]*?end \$\$;/g, '').replace(/'(?:[^']|'')*'/g, "''")
    expect([...code.matchAll(/create or replace function (\w+)/g)].map((m) => m[1])).toEqual(['reopen_shopping_trip', 'unarrive_order'])
    expect(code).not.toMatch(/create table|alter table|drop |policy|\bgrant\b|\brevoke\b|security definer|truncate|confirm_shopping_trip|\barrive_order/i)
    expect(outside).not.toMatch(/\b(insert into|update \w+ set|delete from)\b/i)
    const at = (text) => code.indexOf(text)
    expect(code.match(/^begin;$/gm)).toHaveLength(1)
    expect(code.match(/^commit;$/gm)).toHaveLength(1)
    expect(at('begin;')).toBeLessThan(at('create or replace function'))
    expect(at('commit;')).toBeGreaterThan(code.lastIndexOf('end $$;'))
    expect(code.match(/^select /gm)).toHaveLength(1)
    expect(at('commit;')).toBeLessThan(code.search(/^select /m))
    expect(sql.trimEnd().split('\n').at(-1)).toBe('-- End of 031')
  })

  it('reopen_shopping_trip: the 023 version (the last one) except exactly these lines (a real line diff)', () => {
    const { removed, added } = lineDiff(body(fs.readFileSync(path.join(dir, '023_oct_2026_features.sql'), 'utf8'), 'reopen_shopping_trip'), body(sql, 'reopen_shopping_trip'))
    expect(removed).toEqual(REOPEN_REMOVED)
    expect(added.filter((l) => !/^\s*--/.test(l))).toEqual(REOPEN_ADDED)
    // Nothing later than 023 defines it.
    for (const f of fs.readdirSync(dir).filter((f) => /^0(2[4-9]|30)_.*\.sql$/.test(f))) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/create or replace function reopen_shopping_trip/)
  })

  it('unarrive_order: the 021 version (the last one) except exactly these lines (a real line diff)', () => {
    const { removed, added } = lineDiff(body(fs.readFileSync(path.join(dir, '021_connected_flow.sql'), 'utf8'), 'unarrive_order'), body(sql, 'unarrive_order'))
    expect(removed).toEqual(UNARRIVE_REMOVED)
    expect(added.filter((l) => !/^\s*--/.test(l))).toEqual(UNARRIVE_ADDED)
    for (const f of fs.readdirSync(dir).filter((f) => /^0(2[2-9]|30)_.*\.sql$/.test(f))) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/create or replace function unarrive_order/)
  })

  it('before 031 (the app is deployed first): Reopen deletes the created item but leaves its "Unit changed" row, and the app says nothing new', async () => {
    await addEntry(base, id(801), 'Plonk before', {})
    await shop(base, id(802), [{ entry: id(801), add: 1 }])
    await convert(base, await idOf(base, 'Plonk before'), 'pcs', 4)
    expect(await reopen(base, id(802))).toEqual({ n: 1, notes: [] })
    expect(await idOf(base, 'Plonk before')).toBeNull()
    expect(await logsOf(base, 'Plonk before')).toEqual([{ linked: false, change: 3, stock: 4, unit: 'pcs', reason: 'converted' }])
    await base.query(`delete from stock_logs where item_name = 'Plonk before'`)
    await base.query(`delete from grocery_items where id = $1`, [id(801)])
  })

  it('run twice: every check is ok; other functions, policies, grants, columns and data unchanged; anon gets nothing', async () => {
    const first = await run()
    const second = await run()
    expect(first.map((r) => [r.object, r.status])).toEqual([
      ["function reopen_shopping_trip(uuid): converts the line's stock to the item's unit (031)", 'ok'],
      ['function reopen_shopping_trip(uuid): a created item untouched: all its history goes with it', 'ok'],
      ['function reopen_shopping_trip(uuid): a created item untouched: its automatic "to buy" entries go too', 'ok'],
      ['function reopen_shopping_trip(uuid): returns integer', 'ok'],
      ['function reopen_shopping_trip(uuid): search_path = public', 'ok'],
      ['function reopen_shopping_trip(uuid): security invoker', 'ok'],
      ['function reopen_shopping_trip(uuid): household check (42501)', 'ok'],
      ['function reopen_shopping_trip(uuid): anon none, authenticated can run it', 'ok'],
      ["function unarrive_order(uuid): converts the arrival's stock to the item's unit (031)", 'ok'],
      ['function unarrive_order(uuid): returns orders', 'ok'],
      ['function unarrive_order(uuid): search_path = public', 'ok'],
      ['function unarrive_order(uuid): security invoker', 'ok'],
      ['function unarrive_order(uuid): household check (42501)', 'ok'],
      ['function unarrive_order(uuid): anon none, authenticated can run it', 'ok'],
    ])
    expect(second).toEqual(first)
    expect(first.length).toBeLessThan(100)
    expect(await untouched()).toEqual(before)
    for (const call of [`select reopen_shopping_trip('${id(902)}')`, `select unarrive_order('${id(902)}')`]) {
      expect(await as(fx, 'anon', null, () => fails(() => fx.query(call)))).toMatch(/permission denied/)
    }
  })

  it('the household check: a logged-in stranger is refused (42501) by both, and nothing changes', async () => {
    const snapshot = await untouched()
    for (const call of [`select reopen_shopping_trip('${id(902)}')`, `select unarrive_order('${id(902)}')`]) {
      expect(await as(fx, 'authenticated', STRANGER, () => fails(() => fx.query(call)))).toMatch(/Not allowed: log in with the household account/)
    }
    expect(await untouched()).toEqual(snapshot)
  })

  it('1: created "1 pack", "Unit changed" to 4 pcs, then Reopen → the item, ALL its history and its automatic "to buy" entry are gone; entries in a cart, ordered or typed by hand stay; its own entry is back in the cart; the expense is gone', async () => {
    const [entry, trip, auto, inCart, typed, ordered, order] = [id(11), id(12), id(13), id(14), id(15), id(16), id(17)]
    await addEntry(fx, entry, 'Plonk 031 c1')
    await shop(fx, trip, [{ entry, add: 1 }])
    const plonk = await idOf(fx, 'Plonk 031 c1')
    await convert(fx, plonk, 'pcs', 4)
    expect(await itemOf(fx, 'Plonk 031 c1')).toMatchObject({ unit: 'pcs', stock: 4, packaging_unit: 'pack', per: 4 })
    await addEntry(fx, auto, 'Plonk 031 c1', { pantry: plonk, inCart: false, auto: true })
    await addEntry(fx, inCart, 'Plonk 031 c1', { pantry: plonk, inCart: true, auto: true })
    await addEntry(fx, typed, 'Plonk 031 c1', { pantry: plonk, inCart: false, auto: false })
    await addEntry(fx, ordered, 'Plonk 031 c1', { pantry: plonk, inCart: false, auto: true })
    await addOrder(fx, order, 'Ordered 031 c1', { entry: ordered })
    expect(await expensesOf(fx, trip)).toBe(1)
    expect(await reopen(fx, trip)).toEqual({ n: 1, notes: [] })
    expect(await idOf(fx, 'Plonk 031 c1')).toBeNull()
    expect(await logsOf(fx, 'Plonk 031 c1')).toEqual([])
    expect(await entryOf(fx, auto)).toBeUndefined()
    expect(await entryOf(fx, entry)).toEqual({ completed: false, in_cart: true, linked: false })
    expect(await entryOf(fx, inCart)).toEqual({ completed: false, in_cart: true, linked: false })
    expect(await entryOf(fx, typed)).toEqual({ completed: false, in_cart: false, linked: false })
    expect(await entryOf(fx, ordered)).toEqual({ completed: false, in_cart: false, linked: false })
    expect(await expensesOf(fx, trip)).toBe(0)
    expect(await row(`select count(*)::int as n from shopping_trips where id = $1`, [trip])).toEqual({ n: 0 })
  })

  it('2: created "2 pack", one "Used", then Reopen → the item and all its history are gone', async () => {
    await addEntry(fx, id(21), 'Plonk 031 c2', { quantity: 2 })
    await shop(fx, id(22), [{ entry: id(21), add: 2 }])
    await change(fx, await idOf(fx, 'Plonk 031 c2'), -1, 'used')
    expect((await logsOf(fx, 'Plonk 031 c2')).map((l) => l.reason)).toEqual(['purchased', 'used'])
    expect(await reopen(fx, id(22))).toEqual({ n: 1, notes: [] })
    expect(await idOf(fx, 'Plonk 031 c2')).toBeNull()
    expect(await logsOf(fx, 'Plonk 031 c2')).toEqual([])
  })

  it('3: created "1 pack", another purchase +2 pack, Reopen of the first → kept with 2 pack; the other purchase\'s history, line and expense untouched', async () => {
    await addEntry(fx, id(31), 'Plonk 031 c3')
    await shop(fx, id(32), [{ entry: id(31), add: 1 }])
    const plonk = await idOf(fx, 'Plonk 031 c3')
    await addEntry(fx, id(33), 'Plonk 031 c3', { quantity: 2, price: 6, pantry: plonk })
    await shop(fx, id(34), [{ entry: id(33), add: 2, total: 6, pantry: plonk }])
    expect(await itemOf(fx, 'Plonk 031 c3')).toMatchObject({ unit: 'pack', stock: 3 })
    expect(await reopen(fx, id(32))).toEqual({ n: 1, notes: [keptText('Plonk 031 c3', '1 pack')] })
    expect(keptText('Plonk 031 c3', '1 pack')).toBe('"Plonk 031 c3" stays in HOME — it also got stock or an order from elsewhere; this purchase\'s 1 pack were taken out.')
    expect(await itemOf(fx, 'Plonk 031 c3')).toMatchObject({ unit: 'pack', stock: 2 })
    expect(await logsOf(fx, 'Plonk 031 c3')).toEqual([{ linked: true, change: 2, stock: 3, unit: 'pack', reason: 'purchased' }])
    expect(await rows(`select amount::float as amount from expenses where trip_id = $1`, [id(34)])).toEqual([{ amount: 6 }])
    expect(await rows(`select pantry_item_id = $2 as same, stock_added::float as added from shopping_trip_items where trip_id = $1`, [id(34), plonk])).toEqual([{ same: true, added: 2 }])
    expect(await entryOf(fx, id(31))).toEqual({ completed: false, in_cart: true, linked: true })
    expect(await expensesOf(fx, id(32))).toBe(0)
  })

  it('4: created "1 pack", converted to 4 pcs (1 pack = 4), another purchase +8 pcs (12 pcs), Reopen of the first → 8 pcs, kept with "1 pack = 4"', async () => {
    await addEntry(fx, id(41), 'Plonk 031 c4')
    await shop(fx, id(42), [{ entry: id(41), add: 1 }])
    const plonk = await idOf(fx, 'Plonk 031 c4')
    await convert(fx, plonk, 'pcs', 4)
    await addEntry(fx, id(43), 'Plonk 031 c4', { quantity: 2, price: 6, pantry: plonk })
    await shop(fx, id(44), [{ entry: id(43), add: 8, total: 6, pantry: plonk }])
    expect(await itemOf(fx, 'Plonk 031 c4')).toMatchObject({ unit: 'pcs', stock: 12 })
    expect(await reopen(fx, id(42))).toEqual({ n: 1, notes: [keptText('Plonk 031 c4', '4 pcs')] })
    expect(await itemOf(fx, 'Plonk 031 c4')).toMatchObject({ unit: 'pcs', stock: 8, packaging_unit: 'pack', per: 4 })
    expect((await logsOf(fx, 'Plonk 031 c4')).map((l) => [l.reason, l.change, l.unit])).toEqual([
      ['converted', 3, 'pcs'],
      ['purchased', 8, 'pcs'],
    ])
  })

  it('5–7: created, then "Adjusted" +2, a "+" restock, or an order pointing to it (any status) → kept, this purchase\'s 1 pack taken out', async () => {
    const cases = [
      ['c5', (p) => change(fx, p, 2, 'edited'), 2],
      ['c6', (p) => change(fx, p, 1, 'restocked'), 1],
      ['c7', (p) => addOrder(fx, id(79), 'Order 031 c7', { pantry: p, status: 'cancelled' }), 0],
    ]
    for (const [k, [tag, touch, more]] of cases.entries()) {
      const name = `Plonk 031 ${tag}`
      await addEntry(fx, id(50 + k * 2), name)
      await shop(fx, id(51 + k * 2), [{ entry: id(50 + k * 2), add: 1 }])
      await touch(await idOf(fx, name))
      expect(await reopen(fx, id(51 + k * 2))).toEqual({ n: 1, notes: [keptText(name, '1 pack')] })
      expect(await itemOf(fx, name)).toMatchObject({ unit: 'pack', stock: more })
    }
  })

  it('8: an existing item 1 pack + a purchase of 1 pack, converted to 8 pcs (1 pack = 4), Reopen → 4 pcs, the usual "1 pack = 4" kept, the price still per 1 pack (030: 7 pcs and no usual size)', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(81), 'Fizz 031 c8', 'pack', 1, { price: 3, price_qty: 1 })
      await addEntry(d, id(82), 'Fizz 031 c8', { pantry: id(81) })
      await shop(d, id(83), [{ entry: id(82), add: 1, pantry: id(81) }])
      await convert(d, id(81), 'pcs', 4)
      expect(await itemOf(d, 'Fizz 031 c8')).toEqual({ unit: 'pcs', stock: 8, packaging_unit: 'pack', per: 4, price: 3, price_unit: 'pack' })
    }
    expect(await reopen(fx, id(83))).toEqual({ n: 1, notes: [] })
    expect(await itemOf(fx, 'Fizz 031 c8')).toEqual({ unit: 'pcs', stock: 4, packaging_unit: 'pack', per: 4, price: 3, price_unit: 'pack' })
    expect(await reopen(base, id(83))).toEqual({ n: 1, notes: [] })
    expect(await itemOf(base, 'Fizz 031 c8')).toEqual({ unit: 'pcs', stock: 7, packaging_unit: null, per: null, price: 3, price_unit: null })
  })

  it('9: converted with "Keep the numbers as they are" and no usual size → nothing taken out, and the app says so (030: taken out in the wrong unit, nothing said)', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(91), 'Gum 031 c9', 'pack', 1)
      await addEntry(d, id(92), 'Gum 031 c9', { pantry: id(91) })
      await shop(d, id(93), [{ entry: id(92), add: 1, pantry: id(91) }])
      await keepNumbers(d, id(91), 'pcs')
    }
    expect(await reopen(fx, id(93))).toEqual({ n: 1, notes: [notTakenOutText('Gum 031 c9')] })
    expect(notTakenOutText('Gum 031 c9')).toBe('"Gum 031 c9": this purchase\'s stock couldn\'t be taken out (its unit changed) — check it in HOME.')
    expect(await itemOf(fx, 'Gum 031 c9')).toMatchObject({ unit: 'pcs', stock: 2 })
    expect(await logsOf(fx, 'Gum 031 c9')).toEqual([])
    expect(await reopen(base, id(93))).toEqual({ n: 1, notes: [] })
    expect(await itemOf(base, 'Gum 031 c9')).toMatchObject({ unit: 'pcs', stock: 1 })

    // A created item kept (another purchase), its unit changed the same way: kept, nothing taken out.
    await addEntry(fx, id(94), 'Gum 031 c9b')
    await shop(fx, id(95), [{ entry: id(94), add: 1 }])
    const gum = await idOf(fx, 'Gum 031 c9b')
    await addEntry(fx, id(96), 'Gum 031 c9b', { pantry: gum })
    await shop(fx, id(97), [{ entry: id(96), add: 1, pantry: gum }])
    await keepNumbers(fx, gum, 'pcs')
    expect(await reopen(fx, id(95))).toEqual({ n: 1, notes: [keptNotTakenOutText('Gum 031 c9b')] })
    expect(await itemOf(fx, 'Gum 031 c9b')).toMatchObject({ unit: 'pcs', stock: 2 })
  })

  it('10: lines saved before 030 (stock_unit empty) with no unit change → exactly as today: an existing item with expired stock thrown away, a 9H "2 pack" × 4 into pcs, a new item', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(101), 'Milk 031 c10', 'btl', 2, { price: 1, price_qty: 1, price_unit: 'btl' })
      await addItem(d, id(102), 'Cola 031 c10', 'pcs', 3, { packaging_unit: 'pack', quantity_per_pack: 4 })
      await addEntry(d, id(103), 'Milk 031 c10', { unit: 'btl', price: 1.2, pantry: id(101) })
      await addEntry(d, id(104), 'Cola 031 c10', { quantity: 2, price: 6, pantry: id(102) })
      await addEntry(d, id(105), 'Bread 031 c10', { unit: 'pcs', price: 2 })
      await shop(d, id(106), [
        { entry: id(103), add: 1, total: 1.2, pantry: id(101), extra: { discard_expired: true } },
        { entry: id(104), add: 8, total: 6, pantry: id(102) },
        { entry: id(105), add: 1, total: 2 },
      ])
      await d.query(`update shopping_trip_items set stock_unit = null where trip_id = $1`, [id(106)])
    }
    expect(await everything(fx, 'c10')).toEqual(await everything(base, 'c10'))
    expect(await itemOf(fx, 'Milk 031 c10')).toMatchObject({ stock: 1 })
    expect(await itemOf(fx, 'Cola 031 c10')).toMatchObject({ stock: 11 })
    expect(await reopen(fx, id(106))).toEqual({ n: 3, notes: [] })
    expect(await reopen(base, id(106))).toEqual({ n: 3, notes: [] })
    const after = await everything(fx, 'c10')
    expect(after).toEqual(await everything(base, 'c10'))
    expect(after.pantry.map((p) => [p.name, p.stock, p.price])).toEqual([
      ['Cola 031 c10', 3, null],
      ['Milk 031 c10', 2, 1],
    ])
    expect(after.logs).toEqual([])
  })

  it('10b (Kata ragu): a line before 030 whose "Bought" row was deleted by hand, "2 pack" into an item counted in pcs → nothing taken out and said so (030: −8 pcs)', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(111), 'Cola 031 c10b', 'pcs', 3, { packaging_unit: 'pack', quantity_per_pack: 4 })
      await addEntry(d, id(112), 'Cola 031 c10b', { quantity: 2, price: 6, pantry: id(111) })
      await shop(d, id(113), [{ entry: id(112), add: 8, total: 6, pantry: id(111) }])
      await d.query(`update shopping_trip_items set stock_unit = null where trip_id = $1`, [id(113)])
      await d.query(`delete from stock_logs where item_id = $1`, [id(111)])
    }
    expect(await reopen(fx, id(113))).toEqual({ n: 1, notes: [notTakenOutText('Cola 031 c10b')] })
    expect(await itemOf(fx, 'Cola 031 c10b')).toMatchObject({ stock: 11 })
    expect(await reopen(base, id(113))).toEqual({ n: 1, notes: [] })
    expect(await itemOf(base, 'Cola 031 c10b')).toMatchObject({ stock: 3 })
  })

  it('11: "Back on the way" after an arrival of +1 pack and a conversion to pcs (1 pack = 4) → −4 pcs; not convertible → nothing taken out and said so; no unit change → as 021', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(121), 'Soap 031 c11', 'pack', 2)
      await addOrder(d, id(122), 'Soap 031 c11')
      await arrive(d, id(122), id(121), 1)
      await convert(d, id(121), 'pcs', 4)
      await addItem(d, id(123), 'Wipes 031 c11', 'pack', 2)
      await addOrder(d, id(124), 'Wipes 031 c11')
      await arrive(d, id(124), id(123), 1)
      await keepNumbers(d, id(123), 'pcs')
      await addItem(d, id(125), 'Tea 031 c11', 'pcs', 2)
      await addOrder(d, id(126), 'Tea 031 c11', { pantry: id(125) })
      await arrive(d, id(126), id(125), 3)
    }
    expect(await itemOf(fx, 'Soap 031 c11')).toMatchObject({ unit: 'pcs', stock: 12, per: 4 })
    expect(await backOnTheWay(fx, id(122))).toBeNull()
    expect(await itemOf(fx, 'Soap 031 c11')).toMatchObject({ unit: 'pcs', stock: 8, packaging_unit: 'pack', per: 4 })
    expect(await backOnTheWay(base, id(122))).toBeNull()
    expect(await itemOf(base, 'Soap 031 c11')).toMatchObject({ unit: 'pcs', stock: 11 })

    expect(await backOnTheWay(fx, id(124))).toBe(arrivalNotTakenOutText('Wipes 031 c11'))
    expect(arrivalNotTakenOutText('Wipes 031 c11')).toBe('"Wipes 031 c11": this arrival\'s stock couldn\'t be taken out (its unit changed) — check it in HOME.')
    expect(await itemOf(fx, 'Wipes 031 c11')).toMatchObject({ unit: 'pcs', stock: 3 })
    expect(await backOnTheWay(base, id(124))).toBeNull()
    expect(await itemOf(base, 'Wipes 031 c11')).toMatchObject({ unit: 'pcs', stock: 2 })

    expect(await backOnTheWay(fx, id(126))).toBeNull()
    expect(await backOnTheWay(base, id(126))).toBeNull()
    const after = await everything(fx, 'c11')
    expect(after.orders.map((o) => o.status)).toEqual(['on_the_way', 'on_the_way', 'on_the_way'])
    expect(after.logs.filter((l) => l.reason === 'purchased')).toEqual([])
    expect(after.pantry.find((p) => p.name === 'Tea 031 c11')).toMatchObject({ stock: 2 })
    expect({ ...after, pantry: after.pantry.filter((p) => p.name === 'Tea 031 c11') }).toEqual({ ...(await everything(base, 'c11')), pantry: (await everything(base, 'c11')).pantry.filter((p) => p.name === 'Tea 031 c11') })
  })

  it('12: Shared parts (029), merged expenses, a MONEY purchase closing a "to buy" entry, and the 9J arrival rules → exactly as 030', async () => {
    for (const d of [fx, base]) {
      await addItem(d, id(131), 'Rice 031 c12', 'gr', 500, { price: 2.5, price_qty: 1, price_unit: 'kg' })
      await addEntry(d, id(132), 'Rice 031 c12', { unit: 'kg', price: 2.5, pantry: id(131) })
      await addEntry(d, id(133), 'Soda 031 c12', { price: 3 })
      await shop(d, id(134), [
        { entry: id(132), add: 1000, total: 2.5, pantry: id(131), extra: { [C1]: 1.25, [C2]: 1.25 } },
        { entry: id(133), add: 1, total: 3, extra: { [C1]: 1, [C2]: 2 } },
      ])
      await d.query(`insert into expenses (id, category_id, amount, description, paid_by, expense_date) values ($1, $2, 2, 'Snack 031 c12', 'shared', '2026-11-01')`, [id(135), BUDGET])
      await member(d, () => d.query(`select merge_expenses_into_purchase($1::jsonb)`, [{ trip_id: id(134), expense_ids: [id(135)] }]))
      // MONEY: a new item, closing its automatic "to buy" entry.
      await addEntry(d, id(136), 'Eggs 031 c12', { unit: 'box', inCart: false, auto: true })
      await confirm(d, {
        id: id(137),
        trip_date: '2026-11-01',
        source: 'money',
        paid_by: 'shared',
        items: [{ name: 'Eggs 031 c12', category_id: 'dairy', quantity: 1, unit: 'box', price: 2.9, price_qty: 1, price_unit: 'box', line_total: 2.9, payer: 'shared', expense_category_id: BUDGET, durable: false, pantry_item_id: null, add: 1, list_entry_id: id(136) }],
      })
      // 9J: an arrival into a new item made by the app (stock 0 first), then Back on the way.
      await addItem(d, id(138), 'Catnip 031 c12', 'pcs', 0)
      await addOrder(d, id(139), 'Catnip 031 c12')
      await arrive(d, id(139), id(138), 2)
    }
    expect(await everything(fx, 'c12')).toEqual(await everything(base, 'c12'))
    expect(await rows(`select ${C1}::float as a, ${C2}::float as b from expenses where trip_id = $1 and description = 'Soda 031 c12'`, [id(134)])).toEqual([{ a: 1, b: 2 }])
    for (const d of [fx, base]) {
      expect(await reopen(d, id(134))).toEqual({ n: 2, notes: [] })
      expect(await reopen(d, id(137))).toEqual({ n: 1, notes: [] })
      expect(await backOnTheWay(d, id(139))).toBeNull()
    }
    const after = await everything(fx, 'c12')
    expect(after).toEqual(await everything(base, 'c12'))
    expect(after.expenses).toEqual([{ description: 'Snack 031 c12', amount: 2, paid_by: 'shared', trip_id: null, merged: false, a: null, b: null }])
    expect(after.pantry.map((p) => [p.name, p.stock])).toEqual([
      ['Catnip 031 c12', 0],
      ['Rice 031 c12', 500],
    ])
    expect(after.grocery.find((g) => g.id === id(136))).toEqual({ id: id(136), completed: false, in_cart: false, linked: false, has_expense: false, trip_id: null })
    expect(after.logs).toEqual([])
  })
})
