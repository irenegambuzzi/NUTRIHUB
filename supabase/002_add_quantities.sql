-- Adds quantity tracking to grocery_items and pantry_items so that
-- checking off a grocery item can merge its quantity into the
-- matching pantry item (e.g. 100g + 300g chicken = 400g).
-- Non-destructive: safe to run without losing existing data.

alter table grocery_items add column if not exists quantity numeric not null default 1;
alter table grocery_items add column if not exists unit text not null default 'pcs';

alter table pantry_items add column if not exists quantity numeric not null default 1;
alter table pantry_items add column if not exists unit text not null default 'pcs';
