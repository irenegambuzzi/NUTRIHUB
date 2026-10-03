-- Lets the app send stock changes made without signal later, without
-- ever counting one twice (e.g. when the connection drops just after
-- Supabase saved it and the phone tries again).
--
--   1. applied_ops: the id of every offline change already saved.
--   2. apply_stock_change(op_id, item_id, delta, reason): adds delta to
--      the item's stock (never below 0) and logs it in stock_logs, in one
--      transaction — unless op_id was already applied, in which case it
--      changes nothing. Returns the item as it is now (null if it no
--      longer exists).
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

create table if not exists applied_ops (
  op_id uuid primary key,
  created_at timestamptz not null default now()
);

grant all on applied_ops to anon, authenticated;
alter table applied_ops enable row level security;
drop policy if exists "public_access" on applied_ops;
create policy "public_access" on applied_ops for all using (true) with check (true);

create or replace function apply_stock_change(op_id uuid, item_id uuid, delta numeric, reason text)
returns pantry_items
language plpgsql
set search_path = public
as $$
declare
  before_stock numeric;
  result pantry_items;
begin
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

grant execute on function apply_stock_change(uuid, uuid, numeric, text) to anon, authenticated;
