-- Home & Nutri Hub — single-household schema (no auth/login)
-- Run this once in the Supabase Dashboard -> SQL Editor.
-- This DROPS the old multi-tenant tables (user_profiles, households,
-- purchase_history, home_essentials) and replaces them with a shared
-- schema for exactly two people (Irene & Akbar). Existing data in the
-- old tables is discarded (confirmed OK — this project has no
-- production data yet).

drop table if exists purchase_history cascade;
drop table if exists grocery_items cascade;
drop table if exists home_essentials cascade;
drop table if exists recipes cascade;
drop table if exists user_profiles cascade;
drop table if exists households cascade;
drop table if exists meal_plan_entries cascade;
drop table if exists expenses cascade;
drop table if exists expense_categories cascade;
drop table if exists pantry_items cascade;
drop table if exists profiles cascade;

-- Two fixed people, no auth.users relation.
create table profiles (
  id text primary key,
  display_name text not null,
  daily_calories integer not null default 2000,
  protein_g integer not null default 0,
  carbs_g integer not null default 0,
  fat_g integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into profiles (id, display_name, daily_calories, protein_g, carbs_g, fat_g) values
  ('irene', 'Irene', 1800, 100, 180, 60),
  ('akbar', 'Akbar', 2400, 140, 260, 80);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  calories integer,
  instructions text,
  is_ai_generated boolean not null default false,
  created_at timestamptz not null default now()
);

create table meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  day_of_week text not null,
  meal_type text not null,
  recipe_id uuid references recipes(id) on delete set null,
  custom_text text,
  created_at timestamptz not null default now(),
  unique (week_start, day_of_week, meal_type)
);

create table grocery_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Kitchen',
  price numeric not null default 0,
  quantity numeric not null default 1,
  unit text not null default 'pcs',
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table pantry_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Home',
  status text not null default 'ok',
  quantity numeric not null default 1,
  unit text not null default 'pcs',
  created_at timestamptz not null default now()
);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into expense_categories (name) values
  ('Groceries'), ('Cigarettes'), ('Going out'), ('Other');

create table expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references expense_categories(id) on delete set null,
  amount numeric not null,
  description text,
  paid_by text not null default 'shared',
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- No login anymore, so there's no auth.uid() to scope rows by.
-- This is a private two-person app; open access to the anon key is
-- an accepted tradeoff (equivalent to what the anon key could already
-- reach via household lookups before this migration).
--
-- Supabase enables RLS by default on new tables, so rather than rely
-- on disabling it (which can get re-forced by project defaults), we
-- enable it explicitly and add a permissive "allow everything" policy.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'recipes', 'meal_plan_entries', 'grocery_items',
      'pantry_items', 'expense_categories', 'expenses'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public_access" on %I', t);
    execute format('create policy "public_access" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Live sync: lets both of you see each other's changes without
-- reloading the page. Guarded so it's safe to re-run.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'recipes', 'meal_plan_entries', 'grocery_items',
      'pantry_items', 'expense_categories', 'expenses'
    ])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
