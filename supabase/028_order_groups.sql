-- 028: order groups — several online orders as one order, with one
-- discount for the whole order (docs/plan-oct-2026.md "9I. Order groups").
--
-- Online orders stay one order per item. Orders of the same store, order
-- date and payer can form one "order group", and a group can have ONE
-- discount for the whole order (like "Promotion Applied −€3.23"), spread
-- over its orders by the app (lib/orderGroups.js, with spreadCoupon).
--
--   order_groups            new table: id, shop_id, order_date, paid_by,
--                           discount_kind ('percent' | 'amount', or null),
--                           discount_value, discount_total (€), created_at.
--   orders.group_id         the group the order is in (null = none; the
--                           group deleted → null).
--   orders.group_share      the order's part of the group discount, in €
--                           (0 = none). orders.price stays what is really
--                           paid (= its expense); its price before the group
--                           discount is price + group_share.
--   save_order_group(json)  new function: makes, changes or removes a group
--                           and writes, in one transaction, the group row,
--                           every order's group_id / group_share / price
--                           (and store, date, payer), and their expenses.
--
-- The app is deployed before this file is run and works without it: the
-- group features don't show until the table exists. Nothing existing is
-- replaced or changed: no existing function, policy or grant, and no data
-- (every existing order gets group_id null and group_share 0). The new
-- table is locked like the others (one policy "household_only" for the
-- household account, nothing for anon, live sync on); the new function
-- checks the household login itself and is closed to anon. Safe to run
-- twice. The SELECT at the end is the check: every row must say ok.
--
-- Run in the Supabase SQL Editor.

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.shops') is null then
    raise exception 'Run 019_stores_and_orders.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_kind') then
    raise exception 'Run 023_oct_2026_features.sql first.';
  end if;
end $$;

-- ── 1. The group ─────────────────────────────────────────────────
create table if not exists order_groups (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete set null,
  order_date date not null,
  paid_by text not null,
  discount_kind text,
  discount_value numeric,
  discount_total numeric not null default 0 check (discount_total >= 0),
  created_at timestamptz not null default now()
);

-- The same rule as orders_discount_ok: a percent (0–100) or an amount in €.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.order_groups'::regclass and conname = 'order_groups_discount_ok') then
    alter table order_groups add constraint order_groups_discount_ok
      check (discount_kind is null or (discount_kind in ('percent', 'amount') and discount_value >= 0 and (discount_kind = 'amount' or discount_value <= 100)));
  end if;
end $$;

-- ── 2. Orders: their group and their part of its discount ────────
alter table orders add column if not exists group_id uuid references order_groups(id) on delete set null;
alter table orders add column if not exists group_share numeric not null default 0 check (group_share >= 0);

create index if not exists orders_group_id_idx on orders (group_id) where group_id is not null;

-- ── 3. Locked to the household, live sync on (the new table only) ─
do $$
begin
  alter table public.order_groups enable row level security;
  drop policy if exists "household_only" on public.order_groups;
  create policy "household_only" on public.order_groups for all to authenticated
    using (public.is_household_member()) with check (public.is_household_member());
  revoke all on public.order_groups from anon;
  grant select, insert, update, delete on public.order_groups to authenticated;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_groups'
  ) then
    alter publication supabase_realtime add table public.order_groups;
  end if;
end $$;

-- ── 4. save_order_group(payload) ─────────────────────────────────
-- Puts a group into the state the app asks for, all or nothing:
--
--   { id,                                   the group (made by the app)
--     shop_id, order_date, paid_by,         the group's; every order in it takes them
--     discount_kind, discount_value,        the discount typed (or null)
--     discount_total,                       in €; = the sum of the shares
--     orders:  [{ id, base, share, was }],  every order in the group afterwards
--     leaving: [{ id, base, was }],         orders that leave it (share 0)
--     undo,                                 true: putting back what an Undo restores
--     created_at }                          (only when the group is made again)
--
-- `base` is the order's price before the group discount (after its own
-- discount); its price becomes base − share. `was` is the order as the app
-- saw it ({ price, group_share, group_id }): if it changed meanwhile (the
-- other phone), nothing is written. No orders left → the group is deleted.
--
-- Each order's expense follows: its amount only while it still equals the
-- order's previous price (an amount edited by hand is left alone and named
-- in "kept"); for orders in the group also its date, store and payer when
-- the order's own changed. An order whose expense was deleted just keeps
-- its share.
--
-- Sent again when everything is already as asked: nothing is written, the
-- same answer comes back. → { group, orders, expenses, kept }
create or replace function save_order_group(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_shop uuid := nullif(payload->>'shop_id', '')::uuid;
  v_date date := nullif(payload->>'order_date', '')::date;
  v_payer text := nullif(payload->>'paid_by', '');
  v_kind text := nullif(payload->>'discount_kind', '');
  v_value numeric := nullif(payload->>'discount_value', '')::numeric;
  v_total numeric := round(coalesce(nullif(payload->>'discount_total', '')::numeric, 0), 2);
  v_undo boolean := coalesce((payload->>'undo')::boolean, false);
  v_group order_groups;
  v_exists boolean;
  v_wish jsonb;
  v_ids uuid[];
  v_count integer;
  v_staying integer;
  v_sum_base numeric;
  v_sum_share numeric;
  v_done boolean;
  v_bad text;
  v_kept jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  r record;
  e expenses;
  v_amount numeric;
  v_changed boolean;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'The order group has no id.';
  end if;

  -- Every order named, with what it should become: { id, base, share,
  -- was, stays } (stays = it is in the group afterwards).
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_wish from (
    select o->'id' as id, round((o->>'base')::numeric, 2) as base, round(coalesce((o->>'share')::numeric, 0), 2) as share, o->'was' as was, true as stays
    from jsonb_array_elements(coalesce(payload->'orders', '[]'::jsonb)) o
    union all
    select o->'id', round((o->>'base')::numeric, 2), 0, o->'was', false
    from jsonb_array_elements(coalesce(payload->'leaving', '[]'::jsonb)) o
  ) x;

  select array_agg(w.id), count(*), count(*) filter (where w.stays), coalesce(sum(w.base) filter (where w.stays), 0), coalesce(sum(w.share) filter (where w.stays), 0)
  into v_ids, v_count, v_staying, v_sum_base, v_sum_share
  from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean);
  v_ids := coalesce(v_ids, '{}');
  if v_count <> (select count(distinct w.id) from jsonb_to_recordset(v_wish) as w(id uuid))
     or exists (select 1 from jsonb_to_recordset(v_wish) as w(id uuid, base numeric) where w.id is null or w.base is null) then
    raise exception 'The order group request is not complete — open Orders again.';
  end if;

  select * into v_group from order_groups g where g.id = v_id for update;
  v_exists := found;

  perform 1 from orders o where o.id = any(v_ids) order by o.id for update;
  if (select count(*) from orders o where o.id = any(v_ids)) <> v_count then
    raise exception 'An order was deleted meanwhile — open Orders again. Nothing was changed.';
  end if;

  -- Already as asked (the same request sent again): nothing to do.
  v_done := coalesce(not exists (
      select 1 from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id
      where (w.stays and not coalesce(o.group_id is not distinct from v_id and o.group_share = w.share and o.price = w.base - w.share
                                      and o.shop_id is not distinct from v_shop and o.order_date is not distinct from v_date
                                      and o.paid_by is not distinct from v_payer, false))
         or (not w.stays and not coalesce(o.group_id is null and o.group_share = 0 and o.price = w.base, false))
    )
    and not exists (select 1 from orders o where o.group_id = v_id and not o.id = any(v_ids))
    and case when v_staying = 0 then not v_exists
             else v_exists and v_group.shop_id is not distinct from v_shop and v_group.order_date is not distinct from v_date
                  and v_group.paid_by is not distinct from v_payer and v_group.discount_kind is not distinct from v_kind
                  and v_group.discount_value is not distinct from case when v_kind is null then null else v_value end
                  and v_group.discount_total = v_total end, false);

  if not v_done then
    -- Every order of the group must be in the request (the discount is
    -- always spread over all of them).
    if exists (select 1 from orders o where o.group_id = v_id and not o.id = any(v_ids)) then
      raise exception 'The order group changed meanwhile (on the other phone?) — open Orders again. Nothing was changed.';
    end if;

    select string_agg(format('"%s"', o.item_name), ', ') into v_bad
    from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id
    where w.stays and o.group_id is not null and o.group_id <> v_id;
    if v_bad is not null then
      raise exception '% is already in another order group.', v_bad;
    end if;

    select string_agg(format('"%s"', o.item_name), ', ') into v_bad
    from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id
    where not coalesce(o.price = (w.was->>'price')::numeric
                       and o.group_share = coalesce((w.was->>'group_share')::numeric, 0)
                       and o.group_id is not distinct from nullif(w.was->>'group_id', '')::uuid, false);
    if v_bad is not null then
      raise exception '% changed meanwhile (on the other phone?) — open Orders again. Nothing was changed.', v_bad;
    end if;

    if exists (select 1 from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id where not w.stays and o.group_id is distinct from v_id) then
      raise exception 'Only an order of this group can be taken out of it — open Orders again.';
    end if;

    if v_staying > 0 then
      if not v_exists and v_staying < 2 and not v_undo then
        raise exception 'Pick at least two orders to group them as one order.';
      end if;
      if v_shop is null then
        raise exception 'Set the store on the order first.';
      end if;
      if v_date is null or v_payer is null then
        raise exception 'The order group needs its order date and payer.';
      end if;
      -- Orders joining must already be of the group's store, date and payer.
      select string_agg(format('"%s"', o.item_name), ', ') into v_bad
      from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id
      where w.stays and o.group_id is null
        and (o.shop_id is distinct from v_shop or o.order_date is distinct from v_date or o.paid_by is distinct from v_payer);
      if v_bad is not null then
        raise exception 'Only orders of the same store, order date and payer can be one order (% is different).', v_bad;
      end if;

      -- The discount and its shares.
      if exists (select 1 from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) where w.stays and not coalesce(w.share >= 0 and w.base >= 0 and w.share <= w.base, false)) then
        raise exception 'An order''s part of the discount is bigger than its price — open Orders again.';
      end if;
      if v_kind is null then
        if v_total <> 0 or v_sum_share <> 0 then
          raise exception 'The order discount is missing its kind (%% or €).';
        end if;
      else
        if v_kind not in ('percent', 'amount') or v_value is null or v_value < 0 then
          raise exception 'The order discount must be a percent or an amount in €.';
        end if;
        if v_kind = 'percent' and v_value > 100 then
          raise exception 'A discount can''t be more than 100%%.';
        end if;
        if v_total > v_sum_base
           or (v_kind = 'amount' and v_total > v_value)
           or (v_kind = 'percent' and abs(v_total - round(v_sum_base * v_value / 100, 2)) > 0.01) then
          raise exception 'The order discount (€%) doesn''t match what was typed — open Orders again.', v_total;
        end if;
      end if;
      if v_sum_share <> v_total then
        raise exception 'The parts of the order discount (€%) don''t add up to the discount (€%) — open Orders again.', v_sum_share, v_total;
      end if;

      insert into order_groups (id, shop_id, order_date, paid_by, discount_kind, discount_value, discount_total, created_at)
      values (v_id, v_shop, v_date, v_payer, v_kind, case when v_kind is null then null else v_value end, v_total,
              coalesce(nullif(payload->>'created_at', '')::timestamptz, now()))
      on conflict (id) do update set
        shop_id = excluded.shop_id, order_date = excluded.order_date, paid_by = excluded.paid_by,
        discount_kind = excluded.discount_kind, discount_value = excluded.discount_value, discount_total = excluded.discount_total;
    end if;

    -- Each order, and its expense.
    for r in
      select w.id, w.base, w.share, w.stays, o.price, o.order_date, o.shop_id, o.paid_by, o.expense_id, o.item_name
      from jsonb_to_recordset(v_wish) as w(id uuid, base numeric, share numeric, was jsonb, stays boolean) join orders o on o.id = w.id
    loop
      if r.expense_id is not null then
        select * into e from expenses x where x.id = r.expense_id for update;
        if found then
          v_amount := e.amount;
          v_changed := false;
          if r.base - r.share <> r.price then
            if e.amount = r.price then
              v_amount := r.base - r.share;
              v_changed := true;
            elsif e.amount <> r.base - r.share then
              v_kept := v_kept || jsonb_build_object('order_id', r.id, 'expense_id', e.id, 'name', r.item_name, 'amount', e.amount, 'price', r.base - r.share);
            end if;
          end if;
          if r.stays and (r.order_date <> v_date or r.shop_id is distinct from v_shop or r.paid_by <> v_payer) then
            v_changed := true;
          end if;
          if v_changed then
            update expenses x set
              amount = v_amount,
              expense_date = case when r.stays and r.order_date <> v_date then v_date else x.expense_date end,
              shop_id = case when r.stays and r.shop_id is distinct from v_shop then v_shop else x.shop_id end,
              paid_by = case when r.stays and r.paid_by <> v_payer then v_payer else x.paid_by end
            where x.id = e.id
            returning * into e;
            v_expenses := v_expenses || to_jsonb(e);
          end if;
        end if;
      end if;

      if r.stays then
        update orders o set group_id = v_id, group_share = r.share, price = r.base - r.share,
          shop_id = v_shop, order_date = v_date, paid_by = v_payer
        where o.id = r.id;
      else
        update orders o set group_id = null, group_share = 0, price = r.base where o.id = r.id;
      end if;
    end loop;

    if v_staying = 0 and v_exists then
      delete from order_groups g where g.id = v_id;
    end if;
  end if;

  return jsonb_build_object(
    'group', (select to_jsonb(g) from order_groups g where g.id = v_id),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from orders o where o.id = any(v_ids)), '[]'::jsonb),
    'expenses', v_expenses,
    'kept', v_kept
  );
end $$;

revoke execute on function save_order_group(jsonb) from public, anon;
grant execute on function save_order_group(jsonb) to authenticated;

-- ── Check: every row must say ok ─────────────────────────────────
select n, object, status, detail from (
  select 1 as n, 'table order_groups' as object,
    case when c.oid is null then 'missing'
         when c.relrowsecurity
              and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_groups') = 1
              and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_groups' and p.policyname = 'household_only'
                            and p.cmd = 'ALL' and p.roles = array['authenticated']::name[]
                            and p.qual like '%is_household_member()%' and p.with_check like '%is_household_member()%')
              and not (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
                       or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
              and has_table_privilege('authenticated', c.oid, 'select') and has_table_privilege('authenticated', c.oid, 'insert')
              and exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'order_groups')
         then 'ok' else 'CHECK' end as status,
    case when c.oid is null then '' else format('RLS %s · policy %s · anon: %s · realtime: %s',
      case when c.relrowsecurity then 'on' else 'OFF' end,
      coalesce((select string_agg(p.policyname, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_groups'), 'NONE'),
      case when has_table_privilege('anon', c.oid, 'select') then 'CAN READ' else 'none' end,
      case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'order_groups') then 'on' else 'OFF' end) end as detail
  from (select to_regclass('public.order_groups') as oid) x left join pg_class c on c.oid = x.oid

  union all
  select 2, 'order_groups discount check',
    case when exists (select 1 from pg_constraint where conrelid = to_regclass('public.order_groups') and conname = 'order_groups_discount_ok') then 'ok' else 'missing' end, ''

  union all
  select 2 + w.n, 'column ' || w.name,
    case when col.column_name is null then 'missing'
         when col.data_type = w.type and col.is_nullable = w.nullable then 'ok' else 'CHECK' end,
    coalesce(col.data_type || case when col.is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || col.column_default, ''), '')
  from (values (1, 'orders.group_id', 'group_id', 'uuid', 'YES'), (2, 'orders.group_share', 'group_share', 'numeric', 'NO')) as w(n, name, col, type, nullable)
  left join information_schema.columns col on col.table_schema = 'public' and col.table_name = 'orders' and col.column_name = w.col

  union all
  select 5, 'orders.group_id → order_groups (on delete set null)',
    case when exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                      where k.conrelid = 'public.orders'::regclass and k.contype = 'f' and a.attname = 'group_id'
                        and k.confrelid = to_regclass('public.order_groups') and k.confdeltype = 'n') then 'ok' else 'missing' end, ''

  union all
  select 6, 'orders.group_share >= 0',
    case when exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                      where k.conrelid = 'public.orders'::regclass and k.contype = 'c' and a.attname = 'group_share') then 'ok' else 'missing' end, ''

  union all
  select 7, 'index orders_group_id_idx',
    case when to_regclass('public.orders_group_id_idx') is not null then 'ok' else 'missing' end, ''

  union all
  select 8, 'function save_order_group(jsonb)',
    case when p.oid is null then 'missing'
         when p.proconfig @> array['search_path=public']
              and position('is_household_member()' in p.prosrc) > 0 and position('42501' in p.prosrc) > 0
              and not has_function_privilege('anon', p.oid, 'execute')
              and has_function_privilege('authenticated', p.oid, 'execute') then 'ok' else 'CHECK' end,
    case when p.oid is null then '' else format('search_path=public: %s · login check: %s · anon: %s',
      case when p.proconfig @> array['search_path=public'] then 'yes' else 'NO' end,
      case when position('is_household_member()' in p.prosrc) > 0 then 'yes' else 'NO' end,
      case when has_function_privilege('anon', p.oid, 'execute') then 'CAN RUN IT' else 'none' end) end
  from (select to_regprocedure('public.save_order_group(jsonb)') as oid) x left join pg_proc p on p.oid = x.oid

  union all
  select 9, 'orders in a group (0 the first time)', 'ok',
    (select count(*) from orders o where o.group_id is not null)::text || ' of ' || (select count(*) from orders)::text
) as checks
order by n;

-- End of 028
