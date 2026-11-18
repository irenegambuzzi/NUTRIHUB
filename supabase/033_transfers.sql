-- 033: money moved between the household's accounts (docs/plan-oct-2026.md
-- "9P. Update round", K210, K218, K228, K229). Every Money pill is one real
-- account: each person's own bank, and "Joint" (the household's shared
-- account). A deposit into the shared account is a TRANSFER: never an
-- expense, never income. The shared account's starting balance is a
-- transfer from no one.
--
--   transfers                 new table, one row per transfer:
--     id                      uuid, made by the app (one id per form, so a
--                             second press after a dropped connection can't
--                             save it twice)
--     transfer_date           the day of the transfer (a local date)
--     from_code               the payer code the money left (the codes of
--                             PAID_BY_OPTIONS); EMPTY (null) = a "Starting
--                             balance" (money from no one)
--     to_code                 the payer code the money went to
--     amount                  € with 2 decimals, above 0
--     note                    optional text
--     created_at              when it was saved
--
-- The payer CODES are not limited here, like expenses.paid_by,
-- income.received_by, orders.paid_by and grocery_items.payer (no file ever
-- limited them; 029 left them open on purpose). The app offers only the
-- accounts of PAID_BY_OPTIONS, and a starting balance only into Joint, at
-- most one (K229: checked by the app, no rule here). Two checks only: the
-- amount is above 0; a code is never empty text, and a transfer never goes
-- from an account to itself.
--
-- The payer "Joint" itself needs no SQL: no column, constraint or function
-- limits a payer code. No existing function is replaced; no other table,
-- function, policy or grant changes; no data is written.
--
-- The app is deployed before this file is run and works before it: until
-- the table answers, the Transfers section says "This needs the database
-- update supabase/033_transfers.sql" and nothing counts transfers. The
-- table, its checks, its policy and live sync are made in ONE transaction,
-- so "the table answers" means all of it is there. Safe to run twice. The
-- SELECT at the end is the check: 16 rows, every one must say ok.
--
-- Run in the Supabase SQL Editor, after 032.

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
end $$;

-- ── 1. The table ─────────────────────────────────────────────────
create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null,
  from_code text,
  to_code text not null,
  amount numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- Above 0; codes never empty; never from an account to itself. A Starting
-- balance has no from_code.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transfers'::regclass and conname = 'transfers_amount_ok') then
    alter table transfers add constraint transfers_amount_ok check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transfers'::regclass and conname = 'transfers_codes_ok') then
    alter table transfers add constraint transfers_codes_ok
      check (btrim(to_code) <> '' and (from_code is null or (btrim(from_code) <> '' and from_code <> to_code)));
  end if;
end $$;

-- The leftover reads every transfer before a day, the period every
-- transfer inside it.
create index if not exists transfers_date_idx on transfers (transfer_date);

-- ── 2. Locked to the household, live sync on (the new table only) ─
do $$
begin
  alter table public.transfers enable row level security;
  drop policy if exists "household_only" on public.transfers;
  create policy "household_only" on public.transfers for all to authenticated
    using (public.is_household_member()) with check (public.is_household_member());
  revoke all on public.transfers from anon;
  grant select, insert, update, delete on public.transfers to authenticated;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transfers'
  ) then
    alter publication supabase_realtime add table public.transfers;
  end if;
end $$;

commit;

-- ── Check: every row must say ok ─────────────────────────────────
select n, object, status, detail from (
  select c.n, 'column transfers.' || c.col as object,
    case when col.column_name is null then 'missing'
         when col.data_type = c.type and col.is_nullable = c.nullable and coalesce(col.column_default, '') like c.def then 'ok' else 'CHECK' end as status,
    coalesce(col.data_type || case when col.is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || col.column_default, ''), '') as detail
  from (values
    (1, 'id', 'uuid', 'NO', 'gen_random_uuid()'),
    (2, 'transfer_date', 'date', 'NO', ''),
    (3, 'from_code', 'text', 'YES', ''),
    (4, 'to_code', 'text', 'NO', ''),
    (5, 'amount', 'numeric', 'NO', ''),
    (6, 'note', 'text', 'YES', ''),
    (7, 'created_at', 'timestamp with time zone', 'NO', 'now()')
  ) as c(n, col, type, nullable, def)
  left join information_schema.columns col on col.table_schema = 'public' and col.table_name = 'transfers' and col.column_name = c.col

  union all
  select c.n, 'constraint ' || c.name,
    case when exists (select 1 from pg_constraint where conrelid = to_regclass('public.transfers') and conname = c.name) then 'ok' else 'missing' end,
    coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.transfers') and conname = c.name), '')
  from (values (8, 'transfers_amount_ok'), (9, 'transfers_codes_ok')) as c(n, name)

  union all
  select 10, 'index transfers_date_idx',
    case when to_regclass('public.transfers_date_idx') is not null then 'ok' else 'missing' end, ''

  union all
  select 11, 'row level security on',
    case when (select relrowsecurity from pg_class where oid = to_regclass('public.transfers')) then 'ok' else 'CHECK' end, ''

  union all
  select 12, 'one policy household_only (all, authenticated, is_household_member)',
    case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'transfers') = 1
              and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transfers' and policyname = 'household_only'
                          and cmd = 'ALL' and roles = array['authenticated']::name[]
                          and qual like '%is_household_member()%' and with_check like '%is_household_member()%') then 'ok' else 'CHECK' end,
    coalesce((select string_agg(policyname || ' ' || cmd || ' ' || roles::text, '; ') from pg_policies where schemaname = 'public' and tablename = 'transfers'), '')

  union all
  select 13, 'anon: no rights',
    case when to_regclass('public.transfers') is not null
              and not has_table_privilege('anon', 'public.transfers', 'select, insert, update, delete') then 'ok' else 'CHECK' end, ''

  union all
  select 14, 'authenticated: select, insert, update, delete',
    case when to_regclass('public.transfers') is not null
              and has_table_privilege('authenticated', 'public.transfers', 'select')
              and has_table_privilege('authenticated', 'public.transfers', 'insert')
              and has_table_privilege('authenticated', 'public.transfers', 'update')
              and has_table_privilege('authenticated', 'public.transfers', 'delete') then 'ok' else 'CHECK' end, ''

  union all
  select 15, 'live sync (supabase_realtime)',
    case when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transfers') then 'ok' else 'missing' end, ''

  union all
  select 16, 'transfers saved (0 the first time)', 'ok',
    (select count(*)::text from transfers)
) as checks
order by n;

-- End of 033
