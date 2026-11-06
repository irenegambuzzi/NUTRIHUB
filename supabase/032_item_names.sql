-- 032: one item, many names (docs/plan-oct-2026.md "9N. One item, many
-- names"). One HOME item keeps one stock, and may have other names: the
-- brands and sizes it is really bought under. Stage 1 of round 6D: this
-- file is written for review; no screen uses it yet.
--
--   pantry_items.names            the item's other names, a list. One
--                         element: name, packaging_unit, quantity_per_pack,
--                         price, price_qty, price_unit, from_item_id,
--                         origin, added_at, added_by_trip, pack_by_trip.
--                         origin is the full row a merge removed (null for
--                         any other name).
--   shopping_trip_items.merged_from   the item the line belonged to before
--   orders.merged_from            a merge moved it (no foreign key: that item
--                         is gone). A line that has it is reopened as stock
--                         only (see reopen_shopping_trip).
--   confirm_shopping_trip(payload)    replaced, starting from the 030 version.
--                         New, all optional, on a line: name, quantity,
--                         unit, price, price_qty, price_unit (a SHOP line:
--                         that line only, and several lines may then share
--                         one SHOP entry), add_name, name_pack. Names are
--                         also matched. A payload without them writes
--                         exactly what 030 writes, with one exception
--                         (K71): expired stock is thrown away only on an
--                         item's first line of a payload, so a later line of
--                         that item no longer throws away what the first
--                         added.
--   reopen_shopping_trip(trip_id)     replaced, starting from the 031 version.
--                         A line with merged_from: stock only. An item with
--                         a merged name is never deleted. A deleted SHOP
--                         entry is put back once, linked to an item that
--                         exists. A name or a name's pack size the purchase
--                         added goes with it.
--   save_item_names(payload)      new: adds, removes and edits names of one
--                         item, guarded with `was`.
--   merge_pantry_items(payload)   new: moves other items into one item.
--   separate_item_name(payload)   new: takes a name out of an item again,
--                         as its own item. There is no Undo for a merge:
--                         this is the way back, at any time.
--
-- An element never gets a second kind: a word on the list is a real name of
-- that item, and of no other item (K58, K59). Names are compared here with
-- capitals and outer spaces ignored (lower(btrim)), like HOME category
-- names; the app also ignores accents and plurals (lib/itemNames.js).
--
-- The app is deployed before this file is run and works exactly as today:
-- nothing reads the new columns until hooks/useItemNamesReady.js sees them.
-- The columns and the functions are changed in ONE transaction, so "the
-- column is there" means "the functions are there". An older app version
-- never writes `names` (usePantryItems.pickFields), and its payloads write
-- what they always wrote. No data changes: every item gets an empty list,
-- every line and order an empty merged_from. confirm_shopping_trip and
-- reopen_shopping_trip keep their signature, return type, search_path =
-- public, household check (42501), security invoker and grants (create or
-- replace keeps them). The three new functions follow save_order_group
-- (028): household check, closed to anon and public, open to authenticated.
-- Safe to run twice. The SELECT at the end is the check: every row must
-- say ok.
--
-- Run in the Supabase SQL Editor, after 031.

begin;

do $$
begin
  if to_regprocedure('public.is_household_member()') is null then
    raise exception 'Run 015_lock_to_household.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopping_trip_items' and column_name = 'stock_unit') then
    raise exception 'Run 030_new_item_units.sql first.';
  end if;
  if position('v_keep_pack' in coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.reopen_shopping_trip(uuid)')), '')) = 0 then
    raise exception 'Run 031_reopen_created_items.sql first.';
  end if;
end $$;

-- ── 1. The names of an item, and where a moved line came from ────
alter table pantry_items add column if not exists names jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pantry_items'::regclass and conname = 'pantry_items_names_array') then
    alter table pantry_items add constraint pantry_items_names_array check (jsonb_typeof(names) = 'array');
  end if;
end $$;

alter table shopping_trip_items add column if not exists merged_from uuid;
alter table orders add column if not exists merged_from uuid;

-- ── 2. Confirm a purchase (SHOP and MONEY): the 030 function, plus ──
-- ── name lines ────────────────────────────────────────────────────
-- payload as in 030. New, optional, on a line:
--   name, quantity, unit, price, price_qty, price_unit
--                    a SHOP line: for this line only. The entry stays as it
--                    is. Several lines with a name may share one
--                    grocery_item_id: they are one card with several names.
--   add_name         true: the line's name becomes a name of its item.
--   name_pack        { packaging_unit, quantity_per_pack }: the first usual
--                    pack size of that name, saved on the name, only while
--                    it has none (K60).
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
  v_shop uuid := nullif(payload->>'shop_id', '')::uuid;
  v_paid text := nullif(payload->>'paid_by', '');
  -- 023: a purchase typed in MONEY; every other payload is a SHOP purchase.
  v_money boolean := coalesce(payload->>'source', '') = 'money';
  v_entry grocery_items;
  v_entry_id uuid;
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
  v_order orders;
  -- 030: the unit a new item is counted in, and its usual pack size.
  v_new_unit text;
  v_new_pack numeric;
  v_stock_unit text;
  -- 032: the entry's own name, the entry as it was (every line of it keeps
  -- that), whether the line sends its own name, whether it is a later name
  -- line of an entry, what the first line of each entry found, the items an
  -- earlier line stocked, the name for the history, and the line's new name.
  v_own text;
  v_snapshot jsonb;
  v_name_line boolean;
  v_repeat boolean;
  v_entries jsonb := '{}'::jsonb;
  v_done uuid[] := '{}';
  v_log_name text;
  v_add_name boolean;
  v_key text;
  v_other text;
  v_pack jsonb;
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

  -- 023: also where it was made, and the coupon (defaults: 'shop', none).
  insert into shopping_trips (id, trip_date, shop_id, paid_by, source, coupon_kind, coupon_value, coupon_total)
  values (
    (payload->>'id')::uuid, v_date, v_shop, v_paid,
    case when v_money then 'money' else 'shop' end,
    nullif(payload->>'coupon_kind', ''), (payload->>'coupon_value')::numeric, coalesce((payload->>'coupon_total')::numeric, 0)
  )
  returning * into v_trip;

  for v_item, v_position in select * from jsonb_array_elements(payload->'items') with ordinality loop
    -- 032: a SHOP line with a name of its own may repeat an entry: one card
    -- with several names. The checks below are for the entry's first line;
    -- a repeat without a name is refused as before.
    v_name_line := not v_money and v_item ? 'name';
    v_repeat := v_name_line and v_entries ? (v_item->>'grocery_item_id');
    if not v_money then
      select * into g from grocery_items where id = (v_item->>'grocery_item_id')::uuid for update;
      if not found then
        raise exception 'An item in the cart was deleted meanwhile — open the cart again.';
      end if;
      if g.completed and not v_repeat then
        raise exception '"%" is already bought (confirmed on the other phone?) — open the cart again.', g.name;
      end if;
      -- Ordered online and on the way: buying it here too would record it twice.
      select * into v_order from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way' limit 1;
      if found and not v_repeat then
        raise exception '"%" is already ordered online (on %), still on the way — cancel the order first, or take it out of the cart.', g.name, to_char(v_order.order_date, 'DD/MM/YYYY');
      end if;
    else
      -- 023: a line typed in MONEY has no SHOP entry: what was typed stands
      -- in for one, and every step below works on it the same way (nothing
      -- is written to grocery_items for it).
      g := jsonb_populate_record(null::grocery_items, jsonb_build_object(
        'name', btrim(coalesce(v_item->>'name', '')),
        'category_id', nullif(v_item->>'category_id', ''),
        'subcategory_id', nullif(v_item->>'subcategory_id', ''),
        'quantity', coalesce((v_item->>'quantity')::numeric, 1),
        'unit', coalesce(nullif(v_item->>'unit', ''), 'pcs'),
        'price', coalesce((v_item->>'price')::numeric, 0),
        'price_qty', (v_item->>'price_qty')::numeric,
        'price_unit', nullif(v_item->>'price_unit', ''),
        'payer', coalesce(nullif(v_item->>'payer', ''), v_paid, 'shared'),
        'one_time', coalesce((v_item->>'one_time')::boolean, false),
        'completed', false,
        'in_cart', false
      ));
      if g.name = '' then
        raise exception 'Every item needs a name.';
      end if;
    end if;

    -- 032: what a name line sends counts for that line only: the item is
    -- found or made by the entry's own name, and the entry stays as it was.
    v_own := g.name;
    v_snapshot := coalesce(v_entries->(v_item->>'grocery_item_id')->'snapshot', to_jsonb(g));
    if v_name_line then
      g := jsonb_populate_record(g, jsonb_strip_nulls(jsonb_build_object(
        'name', nullif(btrim(v_item->>'name'), ''),
        'quantity', (v_item->>'quantity')::numeric,
        'unit', nullif(v_item->>'unit', ''),
        'price', (v_item->>'price')::numeric,
        'price_qty', (v_item->>'price_qty')::numeric,
        'price_unit', nullif(v_item->>'price_unit', '')
      )));
    end if;
    v_add_name := coalesce((v_item->>'add_name')::boolean, false);

    v_pantry := null;
    v_created := false;
    v_before := null;
    v_expense := null;
    v_logs := '{}';
    v_entry_id := null;
    v_add := coalesce((v_item->>'add')::numeric, 0);
    v_discarded := 0;
    v_line := coalesce((v_item->>'line_total')::numeric, 0);
    -- 030: a line making a new item may say to count it in another unit
    -- than the one bought, with how many of it are in 1 of what was bought
    -- (both, or neither). `add` stays in the unit bought.
    v_new_unit := nullif(v_item->>'new_stock_unit', '');
    v_new_pack := nullif(v_item->>'new_pack_size', '')::numeric;
    if v_new_unit is null or v_new_unit = g.unit or v_new_pack is null or v_new_pack <= 0 then
      v_new_unit := null;
      v_new_pack := null;
    end if;
    v_stock_unit := null;

    if v_line > 0 then
      -- 023: also the trip away it belongs to (none unless sent).
      -- 029: also each person's part of a Shared line (both empty unless sent).
      insert into expenses (category_id, amount, description, paid_by, expense_date, trip_id, shop_id, travel_id, part_irene, part_akbar)
      values ((v_item->>'expense_category_id')::uuid, v_line, g.name, coalesce(v_item->>'payer', g.payer, 'shared'), v_date, v_trip.id, v_shop, nullif(v_item->>'travel_id', '')::uuid, (v_item->>'part_irene')::numeric, (v_item->>'part_akbar')::numeric)
      returning id into v_expense;
      v_total := v_total + v_line;
    end if;

    if not coalesce((v_item->>'durable')::boolean, false) then
      v_pantry := (v_item->>'pantry_item_id')::uuid;
      -- 032: lines 2…N of an entry go to the item its first line found or made.
      if v_repeat then
        v_pantry := coalesce((v_entries->(v_item->>'grocery_item_id')->>'pantry')::uuid, v_pantry);
      end if;
      if v_pantry is null then
        -- Same name as a pantry item (e.g. made by an earlier line of this
        -- purchase, or a finished 1× item, which comes back): that one,
        -- rather than a second item. Never a group: a group has no stock of
        -- its own, so a name equal to a group's makes (or finds) a normal
        -- item instead.
        -- 032: also an other name of an item (an item's own name goes first).
        select p.id into v_pantry from pantry_items p
        where (lower(trim(p.name)) = lower(trim(v_own)) or exists (select 1 from jsonb_array_elements(p.names) n where lower(btrim(n->>'name')) = lower(btrim(v_own))))
          and not coalesce(p.is_group, false)
        order by lower(trim(p.name)) = lower(trim(v_own)) desc, p.created_at limit 1;
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
        v_stock_unit := pi.unit;
        -- 032: the history row keeps the name the line was bought under: a
        -- name line, or a name of the item. Any other line: the item's name.
        v_log_name := case when v_name_line or v_add_name or exists (select 1 from jsonb_array_elements(pi.names) n where lower(btrim(n->>'name')) = lower(btrim(g.name))) then g.name else pi.name end;
        -- 030: the line was for a new item counted in another unit, but the
        -- item is there already (an earlier line of this purchase made it,
        -- or the other phone): in that unit, the stock is converted with
        -- the pack size; in the unit bought, it stays as sent; else nothing
        -- is saved.
        if v_new_unit is not null then
          if pi.unit = v_new_unit then
            v_add := v_add * v_new_pack;
          elsif pi.unit is distinct from g.unit then
            raise exception '"%" is in HOME already, counted in % (added meanwhile?) — check the line and save again.', g.name, pi.unit;
          end if;
        end if;

        -- 032: expired stock is thrown away once per item, on its first line.
        if coalesce((v_item->>'discard_expired')::boolean, false) and v_stock > 0 and not pi.id = any(v_done) then
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
          values (pi.id, v_log_name, v_add, v_stock, pi.unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      else
        -- 023: a new item is 1× when its entry (or MONEY line) is, and gets
        -- the minimum sent (0 = the column's default, as before).
        -- 030: counted in another unit, its stock is converted with the
        -- pack size, and the unit bought with that size is its usual pack.
        v_stock_unit := coalesce(v_new_unit, g.unit);
        if v_new_unit is not null then
          v_add := v_add * v_new_pack;
        end if;
        v_log_name := trim(case when v_name_line or v_add_name then g.name else v_own end);
        insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, price, price_qty, price_unit, payer, last_purchased_at, expiry_date, one_time, min_stock, packaging_unit, quantity_per_pack)
        values (
          trim(v_own), g.category_id, g.subcategory_id, v_add, v_stock_unit,
          case when coalesce(g.price, 0) > 0 then g.price end,
          case when coalesce(g.price, 0) > 0 then g.price_qty end,
          case when coalesce(g.price, 0) > 0 then g.price_unit end,
          coalesce(v_item->>'payer', g.payer, 'shared'), v_when,
          case when v_item ? 'expiry_date' then (v_item->>'expiry_date')::date end,
          coalesce(g.one_time, false), coalesce((v_item->>'min_stock')::numeric, 0),
          case when v_new_unit is not null then g.unit end, v_new_pack
        )
        returning id into v_pantry;
        v_created := true;
        if v_add <> 0 then
          insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
          values (v_pantry, v_log_name, v_add, v_add, v_stock_unit, 'purchased') returning id into v_log;
          v_logs := v_logs || v_log;
        end if;
      end if;

      -- 032: a new name of the item, in the same transaction as the purchase
      -- (a word belongs to one item only: K59), and the first usual pack
      -- size of a name, on the name and only while it has none (K60).
      if v_add_name or v_item ? 'name_pack' then
        v_key := lower(btrim(g.name));
        select * into pi from pantry_items where id = v_pantry;
        if v_add_name and v_key <> lower(btrim(pi.name)) and not exists (select 1 from jsonb_array_elements(pi.names) n where lower(btrim(n->>'name')) = v_key) then
          select p.name into v_other from pantry_items p
          where p.id <> pi.id and (lower(btrim(p.name)) = v_key or exists (select 1 from jsonb_array_elements(p.names) n where lower(btrim(n->>'name')) = v_key))
          limit 1;
          if found then
            raise exception '"%" is already a name of "%" in HOME — check the line and save again.', btrim(g.name), v_other;
          end if;
          update pantry_items p set names = p.names || jsonb_build_array(jsonb_build_object(
            'name', btrim(g.name), 'packaging_unit', null, 'quantity_per_pack', null,
            'price', null, 'price_qty', null, 'price_unit', null,
            'from_item_id', null, 'origin', null,
            'added_at', now(), 'added_by_trip', v_trip.id, 'pack_by_trip', null
          ))
          where p.id = pi.id;
        end if;
        v_pack := v_item->'name_pack';
        if coalesce(v_pack->>'packaging_unit', '') <> '' and coalesce((v_pack->>'quantity_per_pack')::numeric, 0) > 0 then
          update pantry_items p set names = coalesce((
            select jsonb_agg(case
              when lower(btrim(e.v->>'name')) = v_key and coalesce((e.v->>'quantity_per_pack')::numeric, 0) <= 0
                   and coalesce(nullif(e.v->>'packaging_unit', ''), v_pack->>'packaging_unit') = v_pack->>'packaging_unit'
              then e.v || jsonb_build_object('packaging_unit', v_pack->'packaging_unit', 'quantity_per_pack', v_pack->'quantity_per_pack', 'pack_by_trip', v_trip.id)
              else e.v end order by e.i)
            from jsonb_array_elements(p.names) with ordinality e(v, i)
          ), '[]'::jsonb)
          where p.id = pi.id;
        end if;
      end if;
      v_done := v_done || v_pantry;
    end if;

    -- 023: a MONEY line that really put stock into HOME closes the open
    -- SHOP entry for it (only one still "to buy": not in a cart, not ordered).
    if v_money and v_pantry is not null and v_add > 0 and nullif(v_item->>'list_entry_id', '') is not null then
      select * into v_entry from grocery_items where id = (v_item->>'list_entry_id')::uuid for update;
      if found and not v_entry.completed and not coalesce(v_entry.in_cart, false)
         and not exists (select 1 from orders o where o.grocery_item_id = v_entry.id and o.status = 'on_the_way') then
        update grocery_items set
          completed = true,
          in_cart = false,
          expense_id = v_expense,
          pantry_item_id = coalesce(v_pantry, pantry_item_id),
          trip_id = v_trip.id
        where id = v_entry.id;
        v_entry_id := v_entry.id;
      end if;
    end if;

    -- 023: also what kind of line, what was bought and its discounts.
    -- 030: also the unit the item's stock is counted in (null: no item).
    insert into shopping_trip_items (
      trip_id, position, grocery_item_id, grocery_snapshot, name, line_total, pantry_item_id, pantry_created,
      pantry_before, stock_added, stock_discarded, expense_id, log_ids,
      line_kind, quantity, unit, list_total, item_discount_kind, item_discount_value, coupon_share, stock_unit
    ) values (
      v_trip.id, v_position, case when v_money then v_entry_id else g.id end, v_snapshot, g.name, v_line, v_pantry, v_created,
      v_before, case when v_pantry is null then 0 else v_add end, v_discarded, v_expense, v_logs,
      case when v_money then 'money' else 'shop' end, g.quantity, g.unit,
      (v_item->>'list_total')::numeric, nullif(v_item->>'item_discount_kind', ''), (v_item->>'item_discount_value')::numeric,
      coalesce((v_item->>'coupon_share')::numeric, 0), case when v_pantry is not null then v_stock_unit end
    );

    -- 032: an entry with several name lines is bought once: by its first line.
    if not v_money and not v_repeat then
      update grocery_items set
        completed = true,
        in_cart = false,
        expense_id = v_expense,
        pantry_item_id = coalesce(v_pantry, pantry_item_id),
        trip_id = v_trip.id
      where id = g.id;
      v_entries := v_entries || jsonb_build_object(v_item->>'grocery_item_id', jsonb_build_object('snapshot', v_snapshot, 'pantry', v_pantry));
    end if;
  end loop;

  update receipt_photos set trip_id = v_trip.id, receipt_date = v_date
  where id in (select value::uuid from jsonb_array_elements_text(coalesce(payload->'photo_ids', '[]'::jsonb)));

  update shopping_trips set total = v_total where id = v_trip.id returning * into v_trip;
  return v_trip;
end $$;

-- ── 3. Reopen (undo) a purchase: the 031 function, plus name lines ──
-- ── and lines a merge moved ───────────────────────────────────────
-- Returns how many lines were undone, as before.
create or replace function reopen_shopping_trip(trip_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  ti shopping_trip_items;
  v_count integer := 0;
  v_snapshot jsonb;
  v_source text;
  -- 031: the line's item, the unit the line counted its stock in, the
  -- factor to the item's unit now (null: can't be converted), whether a
  -- created item got stock or an order from elsewhere, and the history
  -- rows of every line of this purchase (never "from elsewhere").
  pi pantry_items;
  v_unit text;
  v_factor numeric;
  v_elsewhere boolean;
  v_trip_logs uuid[];
  -- 031 (K33): the item keeps its usual pack size of now.
  v_keep_pack boolean;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select t.source into v_source from shopping_trips t where t.id = reopen_shopping_trip.trip_id for update;
  if not found then
    return 0;
  end if;
  -- 023: a purchase made by merging old expenses can't be reopened: those
  -- expenses existed before it and must never be deleted. Split undoes it.
  if v_source = 'merged' then
    raise exception 'This purchase was made by merging expenses — use Split to undo it. Nothing was changed.';
  end if;
  -- 031: every history row written by a line of this purchase.
  select coalesce(array_agg(l.id), '{}') into v_trip_logs
  from shopping_trip_items i cross join lateral unnest(i.log_ids) as l(id)
  where i.trip_id = reopen_shopping_trip.trip_id;

  -- Last line first, so a pantry item changed by several lines ends up
  -- exactly as it was before the first.
  for ti in select * from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id order by i.position desc loop
    if ti.pantry_item_id is not null then
      -- 031: the item is locked; one deleted meanwhile is skipped (as before).
      select * into pi from pantry_items p where p.id = ti.pantry_item_id for update;
      if found then
        -- 031: the unit the line counted its stock in: stock_unit (030), else
        -- its own "Bought" row's; without either, the line's unit, only as is.
        v_unit := coalesce(ti.stock_unit, (select l.unit from stock_logs l where l.id = any(ti.log_ids) and l.reason = 'purchased' order by l.created_at limit 1));
        v_factor := case
          when v_unit is null then case when ti.unit is not distinct from pi.unit then 1 end
          when v_unit is not distinct from pi.unit then 1
          when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000
          when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001
          when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack
        end;
        v_unit := coalesce(v_unit, ti.unit);
        -- 031: stock or an order from elsewhere: a history row of another line
        -- that put stock in (a "Unit changed" row only when its numbers are
        -- not a plain conversion), another purchase's line, any order.
        v_elsewhere := ti.pantry_created and (
          exists (select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.change > 0 and l.reason <> 'converted')
          or exists (
            select 1 from stock_logs l where l.item_id = pi.id and not (l.id = any(v_trip_logs)) and l.reason = 'converted'
              and not exists (
                select 1 from unnest(array[1, 1000, 0.001, pi.quantity_per_pack]) as f(n)
                where f.n > 0 and l.new_stock - l.change >= 0
                  and abs(l.new_stock - (l.new_stock - l.change) * f.n) <= 0.0001 * greatest(abs(l.new_stock), 1)
              )
          )
          or exists (select 1 from shopping_trip_items o where o.pantry_item_id = pi.id and o.trip_id <> reopen_shopping_trip.trip_id)
          or exists (select 1 from orders o where o.pantry_item_id = pi.id or o.arrived_item_id = pi.id)
          -- 032: an item something was merged into is never deleted.
          or exists (select 1 from jsonb_array_elements(pi.names) n where n->>'from_item_id' is not null)
        );
        if ti.merged_from is not null then
          -- 032: the line was moved by a merge or a separation, so its
          -- pantry_before belongs to another item, and it never created this
          -- one: only its stock (converted, as below). Nothing else changes.
          if v_factor is not null then
            update pantry_items p set current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor) + ti.stock_discarded * v_factor
            where p.id = pi.id;
          end if;
        elsif ti.pantry_created and not v_elsewhere then
          -- 031: "this purchase never happened": its automatic "to buy" SHOP
          -- entries (as the HOME trash; never one of this purchase's lines),
          -- all its history, then the item.
          delete from grocery_items g
          where g.pantry_item_id = pi.id and g.auto_generated and not g.completed and not coalesce(g.in_cart, false)
            and not exists (select 1 from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way')
            and not exists (select 1 from shopping_trip_items i where i.trip_id = reopen_shopping_trip.trip_id and i.grocery_item_id = g.id);
          delete from stock_logs l where l.item_id = pi.id;
          delete from pantry_items where id = ti.pantry_item_id;
        elsif ti.pantry_created then
          -- 031: kept: only this line's stock comes out (none if it can't be
          -- converted); the other history rows stay.
          if v_factor is not null then
            update pantry_items p set current_stock = greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor)
            where p.id = pi.id;
          end if;
        else
          -- 031: converted (not at all if it can't be); a unit changed after
          -- the purchase keeps the usual pack size of now. So does a usual
          -- size complete before the purchase (K33): a purchase never
          -- overwrites one (9H), so one different now was changed by hand.
          v_keep_pack := v_unit is distinct from pi.unit
            or (coalesce(ti.pantry_before->>'packaging_unit', '') <> '' and coalesce((ti.pantry_before->>'quantity_per_pack')::numeric, 0) > 0);
          update pantry_items p set
            current_stock = case when v_factor is null then p.current_stock
                                 else greatest(0, coalesce(p.current_stock, 0) - ti.stock_added * v_factor) + ti.stock_discarded * v_factor end,
            price = (ti.pantry_before->>'price')::numeric,
            price_qty = (ti.pantry_before->>'price_qty')::numeric,
            price_unit = case when v_unit is distinct from p.unit and ti.pantry_before->>'price' is not null
                              then coalesce(ti.pantry_before->>'price_unit', v_unit) else ti.pantry_before->>'price_unit' end,
            payer = ti.pantry_before->>'payer',
            last_purchased_at = (ti.pantry_before->>'last_purchased_at')::timestamptz,
            expiry_date = (ti.pantry_before->>'expiry_date')::date,
            packaging_unit = case when v_keep_pack then p.packaging_unit else ti.pantry_before->>'packaging_unit' end,
            quantity_per_pack = case when v_keep_pack then p.quantity_per_pack else (ti.pantry_before->>'quantity_per_pack')::numeric end
          where p.id = pi.id;
        end if;
      end if;
    end if;

    delete from stock_logs where id = any(ti.log_ids);
    if ti.expense_id is not null then
      -- 023: never an expense merged into the purchase (a merged expense is
      -- never a line; this only makes sure).
      delete from expenses e where e.id = ti.expense_id and e.merged_at is null;
    end if;

    if ti.line_kind = 'money' then
      -- 023: a line typed in MONEY has no cart to go back to. The SHOP entry
      -- it closed (if any) is "to buy" again.
      if ti.grocery_item_id is not null then
        update grocery_items set completed = false, in_cart = false, expense_id = null, trip_id = null
        where id = ti.grocery_item_id;
      end if;
    elsif ti.grocery_item_id is not null then
      update grocery_items set completed = false, in_cart = true, expense_id = null, trip_id = null
      where id = ti.grocery_item_id;
    else
      -- The entry was deleted meanwhile: put it back as it was.
      v_snapshot := ti.grocery_snapshot || jsonb_build_object('completed', false, 'in_cart', true, 'expense_id', null, 'trip_id', null);
      -- 032: linked to the line's item of now: the snapshot's may be merged away.
      if (ti.merged_from is not null or v_snapshot->>'pantry_item_id' is not null) and exists (select 1 from pantry_items where id = ti.pantry_item_id) then
        v_snapshot := v_snapshot || jsonb_build_object('pantry_item_id', ti.pantry_item_id);
      end if;
      if not exists (select 1 from pantry_items where id = (v_snapshot->>'pantry_item_id')::uuid) then
        v_snapshot := v_snapshot || jsonb_build_object('pantry_item_id', null);
      end if;
      -- 032: lines sharing an entry put it back once.
      insert into grocery_items select * from jsonb_populate_record(null::grocery_items, v_snapshot)
      on conflict (id) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;

  -- 023: expenses merged into this purchase are never deleted: they become
  -- single expenses again, with the store they had before.
  update expenses e set trip_id = null, shop_id = e.shop_before_merge, shop_before_merge = null, merged_at = null
  where e.trip_id = reopen_shopping_trip.trip_id and e.merged_at is not null;

  -- 032 (K61): a name this purchase added goes with it, unless another
  -- purchase line or an order of the item uses it (a merged name stays);
  -- a pack size this purchase saved on a name goes back to empty. An edit
  -- in HOME (save_item_names) clears pack_by_trip, so an edited size stays.
  update pantry_items p set names = coalesce((
    select jsonb_agg(case when e.v->>'pack_by_trip' = reopen_shopping_trip.trip_id::text
                          then e.v || jsonb_build_object('packaging_unit', null, 'quantity_per_pack', null, 'pack_by_trip', null)
                          else e.v end order by e.i)
    from jsonb_array_elements(p.names) with ordinality e(v, i)
    where e.v->>'added_by_trip' is distinct from reopen_shopping_trip.trip_id::text
      or e.v->>'origin' is not null
      or exists (select 1 from shopping_trip_items i where i.pantry_item_id = p.id and i.trip_id <> reopen_shopping_trip.trip_id and lower(btrim(i.name)) = lower(btrim(e.v->>'name')))
      or exists (select 1 from orders o where (o.pantry_item_id = p.id or o.arrived_item_id = p.id) and lower(btrim(o.item_name)) = lower(btrim(e.v->>'name')))
  ), '[]'::jsonb)
  where exists (select 1 from jsonb_array_elements(p.names) n where n->>'added_by_trip' = reopen_shopping_trip.trip_id::text or n->>'pack_by_trip' = reopen_shopping_trip.trip_id::text);

  delete from shopping_trips t where t.id = reopen_shopping_trip.trip_id;
  return v_count;
end $$;

-- ── 4. save_item_names(payload) ──────────────────────────────────
-- Adds, removes and edits the names of one item, all or nothing:
--
--   { item_id,
--     add:    [{ name, packaging_unit, quantity_per_pack, price, price_qty, price_unit }],
--     remove: [name, …],
--     edit:   [{ name, packaging_unit, quantity_per_pack, price, price_qty, price_unit }],
--     was:    { names } }     the list as the app saw it
--
-- `edit` changes only the fields it sends. If the list changed meanwhile
-- (the other phone), nothing is written. A name is unique over all items
-- (K59), and an item's own name is never one of its other names. A name
-- with an `origin` is refused in `remove`: the row it keeps is the only way
-- back, so it leaves with separate_item_name. Sent again when everything is
-- already as asked: nothing is written, the item comes back.
create or replace function save_item_names(payload jsonb)
returns pantry_items
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'item_id', '')::uuid;
  v_add jsonb := coalesce(payload->'add', '[]'::jsonb);
  v_remove jsonb := coalesce(payload->'remove', '[]'::jsonb);
  v_edit jsonb := coalesce(payload->'edit', '[]'::jsonb);
  pi pantry_items;
  v_names jsonb;
  v_name jsonb;
  v_fields jsonb;
  v_key text;
  v_other text;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select * into pi from pantry_items p where p.id = v_id for update;
  if not found then
    raise exception 'This item was deleted meanwhile — open it again. Nothing was changed.';
  end if;

  -- Already as asked (the same request sent again): nothing to do.
  if not exists (select 1 from jsonb_array_elements(v_add || v_edit) a where not exists (select 1 from jsonb_array_elements(pi.names) n where n @> a))
     and not exists (select 1 from jsonb_array_elements_text(v_remove) r join jsonb_array_elements(pi.names) n on lower(btrim(n->>'name')) = lower(btrim(r))) then
    return pi;
  end if;

  if pi.names is distinct from payload->'was'->'names' then
    raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', pi.name;
  end if;
  v_names := pi.names;

  for v_other in select btrim(r) from jsonb_array_elements_text(v_remove) r loop
    v_key := lower(v_other);
    if exists (select 1 from jsonb_array_elements(v_names) n where lower(btrim(n->>'name')) = v_key and n->>'origin' is not null) then
      raise exception '"%" came from a merge — separate it from "%" instead. Nothing was changed.', v_other, pi.name;
    end if;
    select coalesce(jsonb_agg(n.v order by n.i), '[]'::jsonb) into v_names
    from jsonb_array_elements(v_names) with ordinality n(v, i) where lower(btrim(n.v->>'name')) <> v_key;
  end loop;

  for v_name in select * from jsonb_array_elements(v_add || v_edit) loop
    if v_name ? 'quantity_per_pack' and coalesce((v_name->>'quantity_per_pack')::numeric, 1) <= 0 then
      raise exception 'The pack size of "%" must be more than 0. Nothing was changed.', btrim(v_name->>'name');
    end if;
  end loop;

  for v_name in select * from jsonb_array_elements(v_edit) loop
    v_key := lower(btrim(v_name->>'name'));
    if not exists (select 1 from jsonb_array_elements(v_names) n where lower(btrim(n->>'name')) = v_key) then
      raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', pi.name;
    end if;
    select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_fields
    from jsonb_each(v_name) k where k.key in ('packaging_unit', 'quantity_per_pack', 'price', 'price_qty', 'price_unit');
    -- A size changed by hand is no longer the one a purchase saved: Reopen keeps it.
    if v_fields ? 'packaging_unit' or v_fields ? 'quantity_per_pack' then
      v_fields := v_fields || jsonb_build_object('pack_by_trip', null);
    end if;
    select coalesce(jsonb_agg(case when lower(btrim(n.v->>'name')) = v_key then n.v || v_fields else n.v end order by n.i), '[]'::jsonb) into v_names
    from jsonb_array_elements(v_names) with ordinality n(v, i);
  end loop;

  for v_name in select * from jsonb_array_elements(v_add) loop
    v_key := lower(btrim(coalesce(v_name->>'name', '')));
    if v_key = '' then
      raise exception 'Every name needs some text. Nothing was changed.';
    end if;
    if pi.category_id = 'appliances' then
      raise exception '"%" is a durable, so it has no other names. Nothing was changed.', pi.name;
    end if;
    if v_key = lower(btrim(pi.name)) then
      raise exception '"%" is already the name of this item. Nothing was changed.', pi.name;
    end if;
    if exists (select 1 from jsonb_array_elements(v_names) n where lower(btrim(n->>'name')) = v_key) then
      raise exception '"%" is already a name of "%". Nothing was changed.', btrim(v_name->>'name'), pi.name;
    end if;
    select p.name into v_other from pantry_items p
    where p.id <> pi.id and (lower(btrim(p.name)) = v_key or exists (select 1 from jsonb_array_elements(p.names) n where lower(btrim(n->>'name')) = v_key))
    limit 1;
    if found then
      raise exception '"%" is already a name of "%" in HOME. Nothing was changed.', btrim(v_name->>'name'), v_other;
    end if;
    v_names := v_names || jsonb_build_array(jsonb_build_object(
      'name', btrim(v_name->>'name'), 'packaging_unit', v_name->'packaging_unit', 'quantity_per_pack', v_name->'quantity_per_pack',
      'price', v_name->'price', 'price_qty', v_name->'price_qty', 'price_unit', v_name->'price_unit',
      'from_item_id', null, 'origin', null,
      'added_at', now(), 'added_by_trip', null, 'pack_by_trip', null
    ));
  end loop;

  update pantry_items p set names = v_names where p.id = pi.id returning * into pi;
  return pi;
end $$;

revoke execute on function save_item_names(jsonb) from public, anon;
grant execute on function save_item_names(jsonb) to authenticated;

-- ── 5. merge_pantry_items(payload) ───────────────────────────────
-- One action, on the item that stays (K46). Several items become names of
-- it, all or nothing:
--
--   { into_id,                   the item that stays: a normal item or a group row
--     from_ids: [id, …],         normal items, or variants of into_id: a group
--                                row needs ALL its variants here (K70)
--     was: { id: { current_stock, unit, updated_at } } }
--                                every item named, as the app saw it
--
-- Refused, nothing written: a row changed meanwhile, a durable, into_id is a
-- variant, a variant of into_id is left out, also when from_ids holds only
-- normal items (K70), a source is a group with variants or a variant of
-- another group, a name already belongs to a third item (K59), or a source
-- with stock that can't be converted to the target's unit (K44). A source at
-- 0 is never refused for its unit. A group row with no variants may be a
-- target. No variant can remain, so the target is never a group afterwards.
--
-- The target's price, pack size, payer, notes, usual store, 1× and minimum
-- stay its own (K46, K49, K62). Its stock grows, its expiry becomes the
-- earliest non-empty one (a source's date counts only when that source has
-- stock above 0: K72), its last purchase the latest. Each source's rows
-- move to it: history, purchase lines and orders (with merged_from), SHOP
-- entries; an automatic "to buy" entry goes (the app judges the item again).
-- Each source is kept whole in `origin` on its name: separate_item_name
-- puts it back. Expenses, order groups and category_memory are not touched
-- (K63). Sent again: a source that is gone and is on the target's list was
-- merged already; nothing left to do → { already_merged: true }.
-- → { already_merged, into_id, moved_stock, stock, lines, logs, orders, entries_moved, entries_deleted }
create or replace function merge_pantry_items(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_into uuid := nullif(payload->>'into_id', '')::uuid;
  v_was jsonb := coalesce(payload->'was', '{}'::jsonb);
  v_from uuid[];
  t pantry_items;
  f pantry_items;
  v_w jsonb;
  v_factor numeric;
  v_stock numeric;
  v_moved numeric;
  v_now numeric;
  v_total numeric := 0;
  v_names jsonb;
  v_element jsonb;
  v_key text;
  v_at integer;
  v_other text;
  v_expiry date;
  v_bought timestamptz;
  v_count integer;
  v_lines integer := 0;
  v_logs integer := 0;
  v_orders integer := 0;
  v_entries_moved integer := 0;
  v_entries_deleted integer := 0;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_from from jsonb_array_elements_text(coalesce(payload->'from_ids', '[]'::jsonb)) x;
  if v_into is null or cardinality(v_from) = 0 then
    raise exception 'Choose what to merge. Nothing was changed.';
  end if;
  if v_into = any(v_from) then
    raise exception 'An item can''t be merged into itself. Nothing was changed.';
  end if;

  perform 1 from pantry_items p where p.id = v_into or p.id = any(v_from) or p.group_id = v_into order by p.id for update;
  select * into t from pantry_items p where p.id = v_into;
  if not found then
    raise exception 'The item to merge into was deleted meanwhile — open it again. Nothing was changed.';
  end if;

  -- A source that is gone: merged here already (the same request sent
  -- again), or deleted meanwhile.
  if exists (
    select 1 from unnest(v_from) x(id)
    where not exists (select 1 from pantry_items p where p.id = x.id)
      and not exists (select 1 from jsonb_array_elements(t.names) n where n->>'from_item_id' = x.id::text)
  ) then
    raise exception 'An item to merge was deleted meanwhile — open it again. Nothing was changed.';
  end if;
  select coalesce(array_agg(p.id), '{}') into v_from from pantry_items p where p.id = any(v_from);
  if cardinality(v_from) = 0 then
    return jsonb_build_object('already_merged', true, 'into_id', t.id, 'moved_stock', 0, 'stock', t.current_stock, 'lines', 0, 'logs', 0, 'orders', 0, 'entries_moved', 0, 'entries_deleted', 0);
  end if;

  if t.group_id is not null then
    raise exception '"%" is a variant — merge into its group, or take it out of the group first. Nothing was changed.', t.name;
  end if;
  if t.category_id = 'appliances' then
    raise exception '"%" is a durable, so it can''t be merged. Nothing was changed.', t.name;
  end if;
  v_w := v_was->(t.id::text);
  if v_w is null or coalesce((v_w->>'current_stock')::numeric, 0) <> coalesce(t.current_stock, 0) or v_w->>'unit' is distinct from t.unit
     or (v_w ? 'updated_at' and (v_w->>'updated_at')::timestamptz is distinct from t.updated_at) then
    raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', t.name;
  end if;
  -- K70: a group goes all at once: the stock sits on the row HOME doesn't show.
  if exists (select 1 from pantry_items v where v.group_id = t.id and not v.id = any(v_from)) then
    raise exception '"%" still has variants — choose all of them. Nothing was changed.', t.name;
  end if;

  v_now := coalesce(t.current_stock, 0);
  v_names := t.names;
  v_expiry := t.expiry_date;
  v_bought := t.last_purchased_at;

  for f in select * from pantry_items p where p.id = any(v_from) order by lower(p.name), p.id loop
    v_w := v_was->(f.id::text);
    if v_w is null or coalesce((v_w->>'current_stock')::numeric, 0) <> coalesce(f.current_stock, 0) or v_w->>'unit' is distinct from f.unit
       or (v_w ? 'updated_at' and (v_w->>'updated_at')::timestamptz is distinct from f.updated_at) then
      raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', f.name;
    end if;
    if f.category_id = 'appliances' then
      raise exception '"%" is a durable, so it can''t be merged. Nothing was changed.', f.name;
    end if;
    if f.group_id is not null and f.group_id <> t.id then
      raise exception '"%" is a variant of another group — take it out of that group first. Nothing was changed.', f.name;
    end if;
    if exists (select 1 from pantry_items v where v.group_id = f.id) then
      raise exception '"%" is a group with variants — merge its variants into it first. Nothing was changed.', f.name;
    end if;

    -- How many of the target's unit are in 1 of the source's (K44).
    v_stock := coalesce(f.current_stock, 0);
    v_factor := case
      when f.unit is not distinct from t.unit then 1
      when (f.unit, t.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000
      when (f.unit, t.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001
      when t.packaging_unit = f.unit and t.quantity_per_pack > 0 then t.quantity_per_pack
    end;
    if v_stock > 0 and v_factor is null then
      raise exception '"%" is counted in %, "%" in %, and they can''t be converted — change the unit first. Nothing was changed.', f.name, f.unit, t.name, t.unit;
    end if;
    v_moved := case when v_stock > 0 then v_stock * v_factor else 0 end;

    -- Its own name first (with the whole row), then the names it had. A pack
    -- size counts in the source's unit: converted, or empty when it can't be.
    for v_element in
      select e from jsonb_array_elements(jsonb_build_array(jsonb_build_object(
        'name', f.name, 'packaging_unit', f.packaging_unit, 'quantity_per_pack', f.quantity_per_pack,
        'price', case when coalesce(f.price, 0) > 0 then f.price end,
        'price_qty', case when coalesce(f.price, 0) > 0 then f.price_qty end,
        'price_unit', case when coalesce(f.price, 0) > 0 then coalesce(f.price_unit, f.unit) end,
        'from_item_id', f.id, 'origin', to_jsonb(f),
        'added_at', now(), 'added_by_trip', null, 'pack_by_trip', null
      )) || f.names) e
    loop
      v_key := lower(btrim(v_element->>'name'));
      select p.name into v_other from pantry_items p
      where p.id <> t.id and not p.id = any(v_from)
        and (lower(btrim(p.name)) = v_key or exists (select 1 from jsonb_array_elements(p.names) n where lower(btrim(n->>'name')) = v_key))
      limit 1;
      if found then
        raise exception '"%" is already a name of "%" in HOME. Nothing was changed.', btrim(v_element->>'name'), v_other;
      end if;
      v_element := v_element || jsonb_build_object(
        'packaging_unit', case when v_factor is not null then v_element->'packaging_unit' end,
        'quantity_per_pack', case when v_factor is not null then to_jsonb((v_element->>'quantity_per_pack')::numeric * v_factor) end,
        'from_item_id', coalesce(nullif(v_element->'from_item_id', 'null'::jsonb), to_jsonb(f.id))
      );
      select (n.i - 1)::integer into v_at from jsonb_array_elements(v_names) with ordinality n(v, i)
      where lower(btrim(n.v->>'name')) = v_key and n.v->>'origin' is null limit 1;
      if v_element->>'origin' is null then
        -- A plain name the target has already: nothing to add.
        if v_key <> lower(btrim(t.name)) and not exists (select 1 from jsonb_array_elements(v_names) n where lower(btrim(n->>'name')) = v_key) then
          v_names := v_names || jsonb_build_array(v_element);
        end if;
      elsif v_at is not null then
        -- The target has this name already: it keeps what it has, and now
        -- also the source's row.
        v_names := jsonb_set(v_names, array[v_at::text], (v_element || jsonb_strip_nulls(v_names->v_at)) || jsonb_build_object('origin', v_element->'origin', 'from_item_id', v_element->'from_item_id'));
      else
        -- Also when it is the target's own name, or a name another source
        -- brought: the row it keeps is the only way back.
        v_names := v_names || jsonb_build_array(v_element);
      end if;
    end loop;

    -- Its history, purchase lines, orders and SHOP entries. A line moved
    -- before keeps the item it really came from.
    update stock_logs l set item_id = t.id where l.item_id = f.id;
    get diagnostics v_count = row_count;
    v_logs := v_logs + v_count;
    update shopping_trip_items i set pantry_item_id = t.id, merged_from = coalesce(i.merged_from, f.id) where i.pantry_item_id = f.id;
    get diagnostics v_count = row_count;
    v_lines := v_lines + v_count;
    update orders o set
      pantry_item_id = case when o.pantry_item_id = f.id then t.id else o.pantry_item_id end,
      arrived_item_id = case when o.arrived_item_id = f.id then t.id else o.arrived_item_id end,
      merged_from = coalesce(o.merged_from, f.id)
    where o.pantry_item_id = f.id or o.arrived_item_id = f.id;
    get diagnostics v_count = row_count;
    v_orders := v_orders + v_count;
    delete from grocery_items g
    where g.pantry_item_id = f.id and g.auto_generated and not g.completed and not coalesce(g.in_cart, false)
      and not exists (select 1 from orders o where o.grocery_item_id = g.id and o.status = 'on_the_way');
    get diagnostics v_count = row_count;
    v_entries_deleted := v_entries_deleted + v_count;
    update grocery_items g set pantry_item_id = t.id where g.pantry_item_id = f.id;
    get diagnostics v_count = row_count;
    v_entries_moved := v_entries_moved + v_count;

    v_now := v_now + v_moved;
    v_total := v_total + v_moved;
    if v_moved > 0 then
      insert into stock_logs (item_id, item_name, change, new_stock, unit, reason)
      values (t.id, f.name, v_moved, v_now, t.unit, 'merged');
    end if;
    -- least / greatest skip an empty date. K72: a source at 0 has no date
    -- that counts (it stays in `origin`).
    v_expiry := least(v_expiry, case when v_stock > 0 then f.expiry_date end);
    v_bought := greatest(v_bought, f.last_purchased_at);

    delete from pantry_items p where p.id = f.id;
  end loop;

  update pantry_items p set
    current_stock = v_now,
    names = v_names,
    expiry_date = v_expiry,
    last_purchased_at = v_bought,
    is_group = false
  where p.id = t.id;

  return jsonb_build_object(
    'already_merged', false, 'into_id', t.id, 'moved_stock', v_total, 'stock', v_now,
    'lines', v_lines, 'logs', v_logs, 'orders', v_orders,
    'entries_moved', v_entries_moved, 'entries_deleted', v_entries_deleted
  );
end $$;

revoke execute on function merge_pantry_items(jsonb) from public, anon;
grant execute on function merge_pantry_items(jsonb) to authenticated;

-- ── 6. separate_item_name(payload) ───────────────────────────────
-- The way back from a merge, at any time (K48, K67–K69): a name leaves the
-- item and becomes an item of its own, all or nothing:
--
--   { item_id,                 the item that has the name
--     name,                    the name
--     stock_moved,             how much of its stock goes along, in its unit
--     was: { current_stock, unit, updated_at } }
--
-- With an `origin` the row comes back with the SAME id and its old fields.
-- Without one it is a new item: category, sub-category and unit of the
-- parent, minimum 0, the price and pack size of the name, and the parent's
-- expiry only when stock goes along (K77).
--
-- The stock counts in the old unit when the conversion is known (the same
-- unit, kg/gr, L/ml, the name's pack size, or the parent's usual pack: K75),
-- rounded to 3 decimals with no trailing zeros, else in the parent's unit,
-- so no stock is ever lost. Moved along: its purchase lines (those a merge
-- moved get merged_from empty again; the parent's own lines with that name
-- get merged_from = the parent, so their Reopen is stock only: their
-- pantry_before is the parent's), its history rows (never a "merged" row),
-- orders and SHOP entries. Expenses are never touched. A later merge of the
-- same item works again.
-- → { item_id, parent_id, stock_moved, stock, parent_stock, lines, logs, orders, entries }
create or replace function separate_item_name(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_parent uuid := nullif(payload->>'item_id', '')::uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_key text := lower(btrim(coalesce(payload->>'name', '')));
  v_moved numeric := nullif(payload->>'stock_moved', '')::numeric;
  v_w jsonb := payload->'was';
  pi pantry_items;
  v_element jsonb;
  v_at bigint;
  v_origin jsonb;
  v_new uuid;
  v_unit text;
  v_factor numeric;
  v_stock numeric;
  v_left numeric;
  v_other text;
  v_lines integer;
  v_logs integer;
  v_orders integer;
  v_entries integer;
begin
  -- Only for the household's account (see is_household_member).
  if not is_household_member() then
    raise exception 'Not allowed: log in with the household account.' using errcode = '42501';
  end if;
  select * into pi from pantry_items p where p.id = v_parent for update;
  if not found then
    raise exception 'This item was deleted meanwhile — open it again. Nothing was changed.';
  end if;
  if v_w is null or coalesce((v_w->>'current_stock')::numeric, 0) <> coalesce(pi.current_stock, 0) or v_w->>'unit' is distinct from pi.unit
     or (v_w ? 'updated_at' and (v_w->>'updated_at')::timestamptz is distinct from pi.updated_at) then
    raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', pi.name;
  end if;
  if v_key = lower(btrim(pi.name)) then
    raise exception '"%" is the item''s own name, so it can''t be separated. Nothing was changed.', pi.name;
  end if;
  select e.v, e.i into v_element, v_at from jsonb_array_elements(pi.names) with ordinality e(v, i)
  where lower(btrim(e.v->>'name')) = v_key order by e.i limit 1;
  if not found then
    raise exception '"%" is not a name of "%". Nothing was changed.', v_name, pi.name;
  end if;
  if v_moved is null or v_moved < 0 or v_moved > coalesce(pi.current_stock, 0) then
    raise exception 'The stock to move must be between 0 and % %. Nothing was changed.', coalesce(pi.current_stock, 0), pi.unit;
  end if;
  select p.name into v_other from pantry_items p
  where p.id <> pi.id and (lower(btrim(p.name)) = v_key or exists (select 1 from jsonb_array_elements(p.names) n where lower(btrim(n->>'name')) = v_key))
  limit 1;
  if found then
    raise exception '"%" is already a name of "%" in HOME. Nothing was changed.', v_name, v_other;
  end if;

  v_origin := nullif(v_element->'origin', 'null'::jsonb);
  v_unit := coalesce(v_origin->>'unit', pi.unit);
  -- How many of the parent's unit are in 1 of the old unit (none known: the
  -- item counts in the parent's unit).
  v_factor := case
    when v_unit is not distinct from pi.unit then 1
    when (v_unit, pi.unit) in (('kg', 'gr'), ('L', 'ml')) then 1000
    when (v_unit, pi.unit) in (('gr', 'kg'), ('ml', 'L')) then 0.001
    when v_element->>'packaging_unit' = v_unit and (v_element->>'quantity_per_pack')::numeric > 0 then (v_element->>'quantity_per_pack')::numeric
    when pi.packaging_unit = v_unit and pi.quantity_per_pack > 0 then pi.quantity_per_pack
  end;
  if v_factor is null then
    v_unit := pi.unit;
    v_factor := 1;
  end if;
  v_stock := trim_scale(round(v_moved / v_factor, 3));

  if v_origin is not null then
    v_new := (v_origin->>'id')::uuid;
    if exists (select 1 from pantry_items p where p.id = v_new) then
      raise exception '"%" changed meanwhile (on the other phone?) — open it again. Nothing was changed.', pi.name;
    end if;
    -- A category, sub-category or store deleted since the merge can't come back.
    insert into pantry_items
    select * from jsonb_populate_record(null::pantry_items, v_origin || jsonb_build_object(
      'current_stock', v_stock, 'unit', v_unit, 'group_id', null, 'is_group', false, 'names', '[]'::jsonb,
      'category_id', case when exists (select 1 from inventory_categories c where c.id = v_origin->>'category_id') then v_origin->>'category_id' else pi.category_id end,
      'subcategory_id', case when exists (select 1 from inventory_categories c where c.id = v_origin->>'subcategory_id') then v_origin->>'subcategory_id' end,
      'usual_shop_id', case when exists (select 1 from shops s where s.id = (v_origin->>'usual_shop_id')::uuid) then v_origin->>'usual_shop_id' end
    ));
  else
    insert into pantry_items (name, category_id, subcategory_id, current_stock, unit, min_stock, price, price_qty, price_unit, packaging_unit, quantity_per_pack, expiry_date)
    values (
      v_element->>'name', pi.category_id, pi.subcategory_id, v_stock, v_unit, 0,
      (v_element->>'price')::numeric, (v_element->>'price_qty')::numeric, v_element->>'price_unit',
      v_element->>'packaging_unit', (v_element->>'quantity_per_pack')::numeric,
      case when v_moved > 0 then pi.expiry_date end
    )
    returning id into v_new;
  end if;

  update shopping_trip_items t set
    pantry_item_id = v_new,
    merged_from = case when t.merged_from = v_new then null else v_parent end
  where t.pantry_item_id = v_parent
    and (t.merged_from = v_new or (lower(btrim(t.name)) = v_key and (t.merged_from is null or t.merged_from = v_parent)));
  get diagnostics v_lines = row_count;
  update stock_logs l set item_id = v_new
  where l.item_id = v_parent and lower(btrim(l.item_name)) = v_key and l.reason is distinct from 'merged';
  get diagnostics v_logs = row_count;
  update orders o set
    pantry_item_id = case when o.pantry_item_id = v_parent then v_new else o.pantry_item_id end,
    arrived_item_id = case when o.arrived_item_id = v_parent then v_new else o.arrived_item_id end,
    merged_from = case when o.merged_from = v_new then null else o.merged_from end
  where o.merged_from = v_new or ((o.pantry_item_id = v_parent or o.arrived_item_id = v_parent) and lower(btrim(o.item_name)) = v_key);
  get diagnostics v_orders = row_count;
  update grocery_items g set pantry_item_id = v_new where g.pantry_item_id = v_parent and lower(btrim(g.name)) = v_key;
  get diagnostics v_entries = row_count;

  v_left := coalesce(pi.current_stock, 0) - v_moved;
  update pantry_items p set
    current_stock = v_left,
    names = coalesce((select jsonb_agg(e.v order by e.i) from jsonb_array_elements(p.names) with ordinality e(v, i) where e.i <> v_at), '[]'::jsonb)
  where p.id = pi.id;

  if v_moved > 0 then
    insert into stock_logs (item_id, item_name, change, new_stock, unit, reason) values
      (pi.id, v_name, -v_moved, v_left, pi.unit, 'separated'),
      (v_new, v_name, v_stock, v_stock, v_unit, 'separated');
  end if;

  return jsonb_build_object(
    'item_id', v_new, 'parent_id', pi.id, 'stock_moved', v_moved, 'stock', v_stock, 'parent_stock', v_left,
    'lines', v_lines, 'logs', v_logs, 'orders', v_orders, 'entries', v_entries
  );
end $$;

revoke execute on function separate_item_name(jsonb) from public, anon;
grant execute on function separate_item_name(jsonb) to authenticated;

commit;

-- ── Check: every row must say ok ─────────────────────────────────
select n, object, status, detail from (
  select c.n, 'column ' || c.tab || '.' || c.col as object,
    case when col.column_name is null then 'missing'
         when col.data_type = c.type and col.is_nullable = c.nullable and coalesce(col.column_default, '') like c.def then 'ok' else 'CHECK' end as status,
    coalesce(col.data_type || case when col.is_nullable = 'NO' then ' not null' else '' end || coalesce(' default ' || col.column_default, ''), '') as detail
  from (values
    (1, 'pantry_items', 'names', 'jsonb', 'NO', '''[]''%'),
    (3, 'shopping_trip_items', 'merged_from', 'uuid', 'YES', ''),
    (4, 'orders', 'merged_from', 'uuid', 'YES', '')
  ) as c(n, tab, col, type, nullable, def)
  left join information_schema.columns col on col.table_schema = 'public' and col.table_name = c.tab and col.column_name = c.col

  union all
  select 2, 'pantry_items.names is a list',
    case when exists (select 1 from pg_constraint where conrelid = 'public.pantry_items'::regclass and conname = 'pantry_items_names_array') then 'ok' else 'missing' end, ''

  union all
  select c.n, 'function ' || c.sig,
    case when p.oid is null then 'missing'
         when pg_get_function_result(p.oid) = c.result
              and p.proconfig @> array['search_path=public'] and not p.prosecdef
              and position('is_household_member()' in p.prosrc) > 0 and position('42501' in p.prosrc) > 0
              and position(c.mark in p.prosrc) > 0
              and not has_function_privilege('anon', p.oid, 'execute')
              and has_function_privilege('authenticated', p.oid, 'execute') then 'ok' else 'CHECK' end,
    case when p.oid is null then '' else format('returns %s · search_path=public: %s · %s · login check: %s · anon: %s',
      pg_get_function_result(p.oid),
      case when p.proconfig @> array['search_path=public'] then 'yes' else 'NO' end,
      case when p.prosecdef then 'definer' else 'invoker' end,
      case when position('is_household_member()' in p.prosrc) > 0 then 'yes' else 'NO' end,
      case when has_function_privilege('anon', p.oid, 'execute') then 'CAN RUN IT' else 'none' end) end
  from (values
    (5, 'confirm_shopping_trip(jsonb)', 'shopping_trips', 'name_pack'),
    (6, 'reopen_shopping_trip(uuid)', 'integer', 'ti.merged_from'),
    (7, 'save_item_names(jsonb)', 'pantry_items', 'was'),
    (8, 'merge_pantry_items(jsonb)', 'jsonb', 'merged_from'),
    (9, 'separate_item_name(jsonb)', 'jsonb', 'merged_from')
  ) as c(n, sig, result, mark)
  left join pg_proc p on p.oid = to_regprocedure('public.' || c.sig)
) as checks
order by n;

-- End of 032
