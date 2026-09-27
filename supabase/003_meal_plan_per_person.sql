-- Splits the weekly meal plan per person: each of Irene and Akbar
-- gets their own plan instead of sharing one set of slots.
-- Non-destructive: existing rows are assigned to 'irene' by default,
-- Akbar just starts with an empty plan for the current week.

alter table meal_plan_entries add column if not exists profile_id text references profiles(id) not null default 'irene';

alter table meal_plan_entries drop constraint if exists meal_plan_entries_week_start_day_of_week_meal_type_key;
alter table meal_plan_entries drop constraint if exists meal_plan_entries_week_profile_key;
alter table meal_plan_entries add constraint meal_plan_entries_week_profile_key
  unique (week_start, day_of_week, meal_type, profile_id);
