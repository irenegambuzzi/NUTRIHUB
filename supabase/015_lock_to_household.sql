-- Locks the database to the household's login.
--
-- Until now every table was open to the app's public (anon) key: anyone
-- with the app's address could read and change the data. After this
-- file, only a logged-in user listed in household_members can — the one
-- shared household account (2d8a40ba-d751-4c22-9662-df3b758a4749).
--
--   1. household_members (who may use the data) and is_household_member().
--   2. Every app table: all old policies (the open "public_access" ones)
--      removed; one policy "household_only" for logged-in members, for
--      select, insert, update and delete. anon loses all access; realtime
--      keeps working for the logged-in app (it follows these policies).
--   3. App functions (RPC): anon can no longer call them; each one also
--      checks is_household_member() itself.
--   4. Storage bucket "receipts": members only.
--   5. A check at the end: everything must say "none".
--
-- RUN ONLY AFTER the app with login is live and you've logged in on
-- every device (see the steps in the commit/notes). Safe to re-run.
-- To undo in an emergency: 015_ROLLBACK.sql.

-- ── 1. Members ───────────────────────────────────────────────────
create table if not exists household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

insert into household_members (user_id) values ('2d8a40ba-d751-4c22-9662-df3b758a4749')
on conflict (user_id) do nothing;

-- Security definer, so it can read household_members whatever the policies.
create or replace function is_household_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from household_members where user_id = auth.uid())
$$;

alter table household_members enable row level security;
revoke all on household_members from anon, authenticated;
grant select on household_members to authenticated;
drop policy if exists "members_see_themselves" on household_members;
create policy "members_see_themselves" on household_members for select to authenticated using (user_id = auth.uid());

-- ── 2. Tables ────────────────────────────────────────────────────
do $$
declare
  t text;
  p record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'household_members'
  loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy "household_only" on public.%I for all to authenticated using (public.is_household_member()) with check (public.is_household_member())',
      t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;

-- New tables and sequences don't open up to anon by themselves either.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ── 3. Functions ─────────────────────────────────────────────────
create or replace function increment_stock(item_id uuid, delta numeric)
returns pantry_items
language plpgsql
set search_path = public
as $$
declare
  result pantry_items;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  update pantry_items
  set current_stock = greatest(0, coalesce(pantry_items.current_stock, 0) + increment_stock.delta)
  where pantry_items.id = increment_stock.item_id
  returning * into result;
  return result;
end $$;

create or replace function apply_stock_change(op_id uuid, item_id uuid, delta numeric, reason text)
returns pantry_items
language plpgsql
set search_path = public
as $$
declare
  before_stock numeric;
  result pantry_items;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  insert into applied_ops (op_id) values (apply_stock_change.op_id) on conflict do nothing;
  if not found then
    -- Already applied: just report the item.
    select * into result from pantry_items p where p.id = apply_stock_change.item_id;
    return result;
  end if;

  select coalesce(p.current_stock, 0) into before_stock
  from pantry_items p where p.id = apply_stock_change.item_id for update;
  if not found then
    return null;
  end if;

  update pantry_items p
  set current_stock = greatest(0, before_stock + apply_stock_change.delta)
  where p.id = apply_stock_change.item_id
  returning * into result;

  if result.current_stock <> before_stock then
    insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
    values (result.id, result.name, result.current_stock - before_stock, result.current_stock, result.unit, apply_stock_change.reason);
  end if;
  return result;
end $$;

create or replace function confirm_shopping_trip(payload jsonb)
returns shopping_trips
language plpgsql
set search_path = public
as $$
declare
  v_trip shopping_trips;
  v_item jsonb;
  g grocery_items;
  pi pantry_items;
  v_date date := (payload->>'trip_date')::date;
  v_when timestamptz := coalesce((payload->>'at')::timestamptz, now());
  v_pantry uuid;
  v_created boolean;
  v_before jsonb;
  v_expense uuid;
  v_logs uuid[];
  v_log uuid;
  v_stock numeric;
  v_add numeric;
  v_discarded numeric;
  v_line numeric;
  v_total numeric := 0;
  v_position bigint;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  -- Already confirmed (the same confirmation sent again): nothing to do.
  select * into v_trip from shopping_trips where id = (payload->>'id')::uuid;
  if found then
    return v_trip;
  end if;

  insert into shopping_trips (id, trip_date) values ((payload->>'id')::uuid, v_date) returning * into v_trip;

  for v_item, v_position in select * from jsonb_array_elements(payload->'items') with ordinality loop
    select * into g from grocery_items where id = (v_item->>'grocery_item_id')::uuid for update;
    if not found then
      raise exception 'An item in the cart was deleted meanwhile — open the cart again.';
    end if;
    if g.completed then
      raise exception '"%" is already bought (confirmed on the other phone?) — open the cart again.', g.name;
    end if;

    v_pantry := null;
    v_created := false;
    v_before := null;
    v_expense := null;
    v_logs := '{}';
    v_add := coalesce((v_item->>'add')::numeric, 0);
    v_discarded := 0;
    v_line := coalesce((v_item->>'line_total')::numeric, 0);

    if v_line > 0 then
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id)
      returning id into v_expense;
      v_total := v_total + v_line;
    end if;

    if not coalesce((v_item->>'durable')::boolean, false) then
      v_pantry := (v_item->>'pantry_item_id')::uuid;
      if v_pantry is null then
        -- Same name as a pantry item (e.g. made by an earlier line of this
        -- purchase): that one, rather than a second item.
        select p.id into v_pantry from pantry_items p where lower(trim(p.name)) = lower(trim(g.name)) order by p.created_at limit 1;
      end if;
      if v_pantry is not null then
        select * into pi from pantry_items where id = v_pantry for update;
        if not found then
          raise exception 'The pantry item for "%" was deleted meanwhile — open the cart again.', g.name;
        end if;
        v_before := jsonb_build_object(
          'price', pi.price, 'price_qty', pi.price_qty, 'price_unit', pi.price_unit, 'payer', pi.payer,
          'last_purchased_at', pi.last_purchased_at, 'expiry_date', pi.expiry_date,
          'packaging_unit', pi.packaging_unit, 'quantity_per_pack', pi.quantity_per_pack
        );
        v_stock := coalesce(pi.current_stock, 0);

        if coalesce((v_item->>'discard_expired')::boolean, false) and v_stock > 0 then
          v_discarded := v_stock;
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (pi.id, pi.name, -v_stock, 0, pi.unit, 'discarded') returning id into v_log;
          v_logs := v_logs || v_log;
          v_stock := 0;
        end if;

        v_stock := v_stock + v_add;
        update pantry_items set
          current_stock = v_stock,
          payer = coalesce(v_item->>'payer', g.payer, payer),
          last_purchased_at = v_when,
          price = case when coalesce(g.price, 0) > 0 then g.price else price end,
          price_qty = case when coalesce(g.price, 0) > 0 then g.price_qty else price_qty end,
          price_unit = case when coalesce(g.price, 0) > 0 then g.price_unit else price_unit end,
          expiry_date = case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date else expiry_date end,
          packaging_unit = coalesce(v_item->>'packaging_unit', packaging_unit),
          quantity_per_pack = coalesce((v_item->>'quantity_per_pack')::numeric, quantity_per_pack)
        where id = pi.id;

        if v_add <> 0 then
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (pi.id, pi.name, v_add, v_stock, pi.unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      else
        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date)
        values (
          trim(g.name), g.category_id, g.subcategory_id, v_add, g.unit,
          case when coalesce(g.price, 0) > 0 then g.price end,
          case when coalesce(g.price, 0) > 0 then g.price_qty end,
          case when coalesce(g.price, 0) > 0 then g.price_unit end,
          coalesce(v_item->>'payer', g.payer, 'shared'), v_when,
          case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date end
        )
        returning id into v_pantry;
        v_created := true;
        if v_add <> 0 then
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (v_pantry, trim(g.name), v_add, v_add, g.unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      end if;
    end if;

    insert into shopping_trip_items (
      trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created,
      pantry_before, stock_added, stock_discarded, expense_id, log_ids
    ) values (
      v_trip.id, v_position, g.id, to_jsonb(g), g.name, v_line, v_pantry, v_created,
      v_before, case when v_pantry is null then 0 else v_add end, v_discarded, v_expense, v_logs
    );

    update grocery_items set
      completed = true,
      in_cart = false,
      expense_id = v_expense,
      pantry_item_id = coalesce(v_pantry, pantry_item_id),
      trip_id = v_trip.id
    where id = g.id;
  end loop;

  update receipt_photos set trip_id = v_trip.id, receipt_date = v_date
  where id in (select value::uuid from jsonb_array_elements_text(coalesce(payload->'photo_ids', '[]'::jsonb)));

  update shopping_trips set total = v_total where id = v_trip.id returning * into v_trip;
  return v_trip;
end $$;

create or replace function reopen_shopping_trip(trip_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  ti shopping_trip_items;
  v_count integer := 0;
  v_snapshot jsonb;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  perform 1 from shopping_trips t where t.id = reopen_shopping_trip.trip_id for update;
  if not found then
    return 0;
  end if;

  -- Last line first, so a pantry item changed by several lines ends up
  -- exactly as it was before the first.
  for ti in select * from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id order by i.position desc loop
    if ti.pantry_item_id is not null then
      if ti.pantry_created then
        delete from pantry_items where id = ti.pantry_item_id;
      else
        update pantry_items p set
          current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added) + ti.stock_discarded,
          price = (ti.pantry_before->>'price')::numeric,
          price_qty = (ti.pantry_before->>'price_qty')::numeric,
          price_unit = ti.pantry_before->>'price_unit',
          payer = ti.pantry_before->>'payer',
          last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,
          expiry_date = (ti.pantry_before->>'expiry_date')::date,
          packaging_unit = ti.pantry_before->>'packaging_unit',
          quantity_per_pack = (ti.pantry_before->>'quantity_per_pack')::numeric
        where p.id = ti.pantry_item_id;
      end if;
    end if;

    delete from stock_logs where id = any(ti.log_ids);
    if ti.expense_id is not null then
      delete from expenses where id = ti.expense_id;
    end if;

    if ti.grocery_item_id is not null then
      update grocery_items set completed = false, in_cart = true, expense_id = null, trip_id = null
      where id = ti.grocery_item_id;
    else
      -- The entry was deleted meanwhile: put it back as it was.
      v_snapshot := ti.grocery_snapshot || jsonb_build_object('completed', false, 'in_cart', true, 'expense_id', null, 'trip_id', null);
      if not exists (select 1 from pantry_items where id = (v_snapshot->>'pantry_item_id')::uuid) then
        v_snapshot := v_snapshot || jsonb_build_object('pantry_item_id', null);
      end if;
      insert into grocery_items select * from jsonb_populate_record(null::grocery_items, v_snapshot);
    end if;
    v_count := v_count + 1;
  end loop;

  delete from shopping_trips t where t.id = reopen_shopping_trip.trip_id;
  return v_count;
end $$;

revoke execute on function increment_stock(uuid, numeric) from public, anon;
grant execute on function increment_stock(uuid, numeric) to authenticated;
revoke execute on function apply_stock_change(uuid, uuid, numeric, text) from public, anon;
grant execute on function apply_stock_change(uuid, uuid, numeric, text) to authenticated;
revoke execute on function confirm_shopping_trip(jsonb) from public, anon;
grant execute on function confirm_shopping_trip(jsonb) to authenticated;
revoke execute on function reopen_shopping_trip(uuid) from public, anon;
grant execute on function reopen_shopping_trip(uuid) to authenticated;
revoke execute on function is_household_member() from public, anon;
grant execute on function is_household_member() to authenticated;
revoke execute on function set_updated_at() from public, anon;

-- ── 4. Storage: receipts ─────────────────────────────────────────
drop policy if exists "receipts_read" on storage.objects;
drop policy if exists "receipts_add" on storage.objects;
drop policy if exists "receipts_change" on storage.objects;
drop policy if exists "receipts_remove" on storage.objects;
drop policy if exists "receipts_household_read" on storage.objects;
create policy "receipts_household_read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_household_member());
drop policy if exists "receipts_household_add" on storage.objects;
create policy "receipts_household_add" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_household_member());
drop policy if exists "receipts_household_change" on storage.objects;
create policy "receipts_household_change" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.is_household_member())
  with check (bucket_id = 'receipts' and public.is_household_member());
drop policy if exists "receipts_household_remove" on storage.objects;
create policy "receipts_household_remove" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_household_member());

-- ── 5. Check: every column must say "none" (members must be 1) ───
select
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))) as tables_open_to_anon,
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('increment_stock', 'apply_stock_change', 'confirm_shopping_trip', 'reopen_shopping_trip', 'set_updated_at', 'is_household_member')
       and has_function_privilege('anon', p.oid, 'execute')) as functions_open_to_anon,
  (select coalesce(string_agg(tablename || '.' || policyname, ', '), 'none')
     from pg_policies
     where (schemaname = 'public' or (schemaname = 'storage' and policyname like 'receipts%'))
       and roles && array['anon', 'public']::name[]) as policies_for_anon,
  (select coalesce(string_agg(c.relname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls,
  (select count(*) from household_members) as members;
