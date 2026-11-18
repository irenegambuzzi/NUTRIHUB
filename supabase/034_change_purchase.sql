-- 034: change the date or the payer of a whole purchase at once
-- (docs/plan-oct-2026.md "9P. Update round", K204–K209, K236, K237).
-- Money → a purchase row → "Change purchase ▾" → Date / Paid by. One new
-- function, nothing else:
--
--   change_purchase(payload)   new. Writes, for ONE purchase, in one go or
--                         not at all:
--     expenses with this trip_id (merged ones too)   expense_date, paid_by,
--                                                    part_irene, part_akbar
--     shopping_trips (the purchase itself)           trip_date, paid_by
--     receipt_photos with this trip_id               receipt_date
--     grocery_items with this trip_id (SHOP cards)   payer
--   and nothing else: never an amount, stock, HOME items (also not
--   pantry_items.payer or last_purchased_at), stock_logs, purchase lines
--   (shopping_trip_items), orders, merged_at or shop_before_merge. The store
--   of a purchase is not part of it (the app changes it as before).
--
-- The request (made by the app, src/lib/changePurchase.js):
--
--   { trip_id,
--     was: { trip:     { trip_date, paid_by },                 what the app saw
--            expenses: [{ id, expense_date, paid_by, part_irene, part_akbar }],
--            photos:   [{ id, receipt_date }],
--            cards:    [{ id, payer }] },
--     now: { the same shape, the same ids: the values wanted } }
--
--   Every row of the purchase is in both lists, each with ALL its values,
--   so the Undo is the same call with `was` and `now` swapped and puts back
--   exactly what was there, row by row (mixed payers, each Shared part, a
--   photo that was on a day of its own, an empty paid_by of a mixed
--   purchase).
--
-- What it does, in this order:
--   1. Only for the household's account (42501), like 032.
--   2. The purchase is locked (for update), and every row it may write.
--      Gone (deleted or reopened meanwhile) → refused.
--   3. The rows already equal `now` (the same request sent twice) → nothing
--      is written, the purchase comes back (the save_item_names rule of 032).
--   4. The rows differ from `was` (any value, or a row added or missing:
--      another device changed the purchase) → refused with "This purchase
--      changed meanwhile (on another device?) — open it again. Nothing was
--      changed." Nothing is written.
--   5. `now` names other rows than the purchase has → refused the same way.
--      A Shared expense needs both parts (each 0 or more) and any other payer
--      none (029's expenses_parts_ok holds) → else refused. Payer codes are
--      not limited (029 left them open on purpose). The date is not checked
--      here: the app refuses a day after today by the device's own date,
--      like transfers (033), so a time zone can never refuse "today".
--   6. Writes the rows whose values change, then the purchase; returns the
--      purchase (the shopping_trips row), like confirm_shopping_trip.
--
-- security invoker, search_path = public, closed to public and anon, open to
-- authenticated (like save_order_group, 028). No existing function is
-- replaced; no table, column, constraint, policy or other grant changes.
-- Running this file writes no data. Safe to run twice (create or replace).
--
-- Words Supabase may warn about ("destructive operation"):
--   drop     no
--   delete   no
--   truncate no
--   update   yes — four times, only INSIDE the body of change_purchase (the
--            rows listed above, when the app calls it later); none runs
--            while this file is run.
--
-- The app is deployed before this file is run and works before it: until
-- the function answers, Date and Paid by say "This needs the database update
-- supabase/034_change_purchase.sql" in the panel; Store keeps working.
-- The SELECT at the end is the check: 10 rows, every one must say ok.
--
-- Run in the Supabase SQL Editor, after 033.

begin;

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pantry_items' and column_name = 'names')
     or to_regprocedure('public.save_item_names(jsonb)') is null then
    raise exception 'Run 032_item_names.sql first.';
  end if;
  if to_regclass('public.transfers') is null then
    raise exception 'Run 033_transfers.sql first.';
  end if;
end $$;

create or replace function change_purchase(payload jsonb)
returns shopping_trips
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'trip_id', '')::uuid;
  v_now jsonb := coalesce(payload->'now', '{}'::jsonb);
  v_trip shopping_trips;
  v_side text;
  v_same boolean;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;

  -- The purchase and every row this call may write, held until the end.
  select * into v_trip from shopping_trips t where t.id = v_id for update;
  if not found then
    raise exception 'This purchase changed meanwhile (on another device?) — open it again. Nothing was changed.';
  end if;
  perform 1 from expenses e where e.trip_id = v_id for update;
  perform 1 from receipt_photos p where p.trip_id = v_id for update;
  perform 1 from grocery_items g where g.trip_id = v_id for update;

  -- The rows as they are, compared first with `now` (already so: nothing
  -- to do), then with `was` (what the app saw).
  foreach v_side in array array['now', 'was'] loop
    v_same :=
      v_trip.trip_date is not distinct from (payload->v_side->'trip'->>'trip_date')::date
      and v_trip.paid_by is not distinct from (payload->v_side->'trip'->>'paid_by')
      and not exists (
        select 1
        from (select e.id, e.expense_date, e.paid_by, e.part_irene, e.part_akbar from expenses e where e.trip_id = v_id) cur
        full join jsonb_to_recordset(coalesce(payload->v_side->'expenses', '[]'::jsonb))
          as x(id uuid, expense_date date, paid_by text, part_irene numeric, part_akbar numeric) on x.id = cur.id
        where cur.id is null or x.id is null
           or (cur.expense_date, cur.paid_by, cur.part_irene, cur.part_akbar) is distinct from (x.expense_date, x.paid_by, x.part_irene, x.part_akbar)
      )
      and not exists (
        select 1
        from (select p.id, p.receipt_date from receipt_photos p where p.trip_id = v_id) cur
        full join jsonb_to_recordset(coalesce(payload->v_side->'photos', '[]'::jsonb)) as x(id uuid, receipt_date date) on x.id = cur.id
        where cur.id is null or x.id is null or cur.receipt_date is distinct from x.receipt_date
      )
      and not exists (
        select 1
        from (select g.id, g.payer from grocery_items g where g.trip_id = v_id) cur
        full join jsonb_to_recordset(coalesce(payload->v_side->'cards', '[]'::jsonb)) as x(id uuid, payer text) on x.id = cur.id
        where cur.id is null or x.id is null or cur.payer is distinct from x.payer
      );
    if v_side = 'now' and v_same then
      return v_trip;
    end if;
    if v_side = 'was' and not v_same then
      raise exception 'This purchase changed meanwhile (on another device?) — open it again. Nothing was changed.';
    end if;
  end loop;

  -- `now` names exactly the rows of the purchase.
  if exists (
       select 1 from (select e.id from expenses e where e.trip_id = v_id) cur
       full join jsonb_to_recordset(coalesce(v_now->'expenses', '[]'::jsonb)) as x(id uuid) on x.id = cur.id
       where cur.id is null or x.id is null)
     or exists (
       select 1 from (select p.id from receipt_photos p where p.trip_id = v_id) cur
       full join jsonb_to_recordset(coalesce(v_now->'photos', '[]'::jsonb)) as x(id uuid) on x.id = cur.id
       where cur.id is null or x.id is null)
     or exists (
       select 1 from (select g.id from grocery_items g where g.trip_id = v_id) cur
       full join jsonb_to_recordset(coalesce(v_now->'cards', '[]'::jsonb)) as x(id uuid) on x.id = cur.id
       where cur.id is null or x.id is null) then
    raise exception 'This purchase changed meanwhile (on another device?) — open it again. Nothing was changed.';
  end if;
  if (v_now->'trip'->>'trip_date') is null then
    raise exception 'A purchase needs a date. Nothing was changed.';
  end if;
  -- Each person's part only on a Shared expense, and there both (9K).
  if exists (
       select 1 from jsonb_to_recordset(coalesce(v_now->'expenses', '[]'::jsonb)) as x(id uuid, paid_by text, part_irene numeric, part_akbar numeric)
       where case when x.paid_by = 'shared'
                  then x.part_irene is null or x.part_akbar is null or x.part_irene < 0 or x.part_akbar < 0
                  else x.part_irene is not null or x.part_akbar is not null end) then
    raise exception 'A Shared expense needs both parts (each 0 or more); any other payer has none. Nothing was changed.';
  end if;

  -- The rows whose values change; then the purchase.
  update expenses e set
    expense_date = x.expense_date, paid_by = x.paid_by, part_irene = x.part_irene, part_akbar = x.part_akbar
  from jsonb_to_recordset(v_now->'expenses') as x(id uuid, expense_date date, paid_by text, part_irene numeric, part_akbar numeric)
  where e.id = x.id and e.trip_id = v_id
    and (e.expense_date, e.paid_by, e.part_irene, e.part_akbar) is distinct from (x.expense_date, x.paid_by, x.part_irene, x.part_akbar);

  update receipt_photos p set receipt_date = x.receipt_date
  from jsonb_to_recordset(coalesce(v_now->'photos', '[]'::jsonb)) as x(id uuid, receipt_date date)
  where p.id = x.id and p.trip_id = v_id and p.receipt_date is distinct from x.receipt_date;

  update grocery_items g set payer = x.payer
  from jsonb_to_recordset(coalesce(v_now->'cards', '[]'::jsonb)) as x(id uuid, payer text)
  where g.id = x.id and g.trip_id = v_id and g.payer is distinct from x.payer;

  update shopping_trips t set
    trip_date = (v_now->'trip'->>'trip_date')::date,
    paid_by = v_now->'trip'->>'paid_by'
  where t.id = v_id
  returning * into v_trip;
  return v_trip;
end $$;

revoke execute on function change_purchase(jsonb) from public, anon;
grant execute on function change_purchase(jsonb) to authenticated;

commit;

-- ── Check: every row must say ok ─────────────────────────────────
with f as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc, p.proacl, pg_get_function_result(p.oid) as result
  from pg_proc p
  where p.oid = to_regprocedure('public.change_purchase(jsonb)')
)
select n, object, status, detail from (
  select 1 as n, 'function change_purchase(jsonb)' as object,
    case when exists (select 1 from f where result = 'shopping_trips') then 'ok' when exists (select 1 from f) then 'CHECK' else 'missing' end as status,
    coalesce((select 'returns ' || result from f), '') as detail

  union all
  select 2, 'one version only (no other change_purchase)',
    case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'change_purchase') = 1 then 'ok' else 'CHECK' end,
    (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'change_purchase')

  union all
  select 3, 'security invoker',
    case when exists (select 1 from f where not prosecdef) then 'ok' else 'CHECK' end,
    coalesce((select case when prosecdef then 'definer' else 'invoker' end from f), '')

  union all
  select 4, 'search_path = public',
    case when exists (select 1 from f where proconfig @> array['search_path=public']) then 'ok' else 'CHECK' end,
    coalesce((select proconfig::text from f), '')

  union all
  select 5, 'household check (is_household_member, 42501)',
    case when exists (select 1 from f where position('is_household_member()' in prosrc) > 0 and position('42501' in prosrc) > 0) then 'ok' else 'CHECK' end, ''

  union all
  select 6, 'guard: locks the purchase, compares "was", refuses when it changed meanwhile',
    case when exists (select 1 from f where position('for update' in prosrc) > 0 and position('''was''' in prosrc) > 0 and position('changed meanwhile' in prosrc) > 0) then 'ok' else 'CHECK' end, ''

  union all
  select 7, 'parts: both on a Shared expense, none on any other (expenses_parts_ok there)',
    case when exists (select 1 from f where position('A Shared expense needs both parts' in prosrc) > 0)
              and exists (select 1 from pg_constraint where conrelid = 'public.expenses'::regclass and conname = 'expenses_parts_ok') then 'ok' else 'CHECK' end, ''

  union all
  select 8, 'public: cannot run it',
    case when exists (select 1 from f where proacl is not null
                        and not exists (select 1 from aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) then 'ok' else 'CHECK' end,
    coalesce((select proacl::text from f), '')

  union all
  select 9, 'anon: cannot run it',
    case when exists (select 1 from f where not has_function_privilege('anon', oid, 'execute')) then 'ok' else 'CHECK' end, ''

  union all
  select 10, 'authenticated: can run it',
    case when exists (select 1 from f where has_function_privilege('authenticated', oid, 'execute')) then 'ok' else 'CHECK' end, ''
) as checks
order by n;

-- End of 034
