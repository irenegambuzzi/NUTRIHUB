-- 027: pack size per purchase, for orders (round 9H, docs/plan-oct-2026.md
-- "9H. Pack size per purchase"). Two new columns on orders, nothing else.
--
--   orders.pack_size            how many of the HOME item's stock units are
--                               in 1 package of this order ("1 box = 24
--                               pcs" → 24), typed at Order online or at
--                               Arrived. null = not typed (yet).
--   orders.arrival_pack_before  the HOME item's usual size from before an
--                               Arrived that saved the size typed there as
--                               its usual size (the item had none yet):
--                               { packaging_unit, quantity_per_pack, saved:
--                               { packaging_unit, quantity_per_pack } } —
--                               like pantry_before on a purchase line, plus
--                               what that arrival wrote. "Put back on the
--                               way" puts the old values back (only while the
--                               item still has what was saved) and empties
--                               it. null = that arrival saved nothing.
--
-- The app is deployed before this file is run and works without it: an
-- order is saved without its pack size, and Arrived saves no usual size
-- (so "Put back on the way" stays exact). Safe to run twice (add column if
-- not exists). No function, policy or grant changes: orders keeps its one
-- household_only policy, and anon gets nothing. arrive_order and
-- unarrive_order (021) don't touch the new columns: the app writes them.

alter table orders add column if not exists pack_size numeric check (pack_size > 0);
alter table orders add column if not exists arrival_pack_before jsonb;

-- Check (3 rows): every row says ok.
select "column", type, status from (
  select want.n, want.name as "column",
    coalesce(c.data_type, 'missing') as type,
    case when c.data_type = want.type then 'ok' else 'CHECK: missing or another type' end as status
  from (values (1, 'orders.pack_size', 'pack_size', 'numeric'), (2, 'orders.arrival_pack_before', 'arrival_pack_before', 'jsonb')) as want(n, name, col, type)
  left join information_schema.columns c on c.table_schema = 'public' and c.table_name = 'orders' and c.column_name = want.col
  union all
  select 3, 'orders.pack_size > 0', 'check',
    case when exists (
      select 1 from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
      where k.conrelid = 'public.orders'::regclass and k.contype = 'c' and a.attname = 'pack_size'
    ) then 'ok' else 'CHECK: missing' end
) as checks
order by n;

-- End of 027
