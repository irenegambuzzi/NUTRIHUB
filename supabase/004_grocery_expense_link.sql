-- Links a grocery item to the expense it generated, so editing the
-- price after checking it off updates that expense instead of never
-- creating one (or creating duplicates).
-- Non-destructive: existing rows just get expense_id = null.

alter table grocery_items add column if not exists expense_id uuid references expenses(id) on delete set null;
