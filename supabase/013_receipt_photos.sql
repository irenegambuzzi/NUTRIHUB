-- Photos (or PDFs) of grocery receipts, kept in Supabase Storage and
-- linked to a shopping day:
--
--   1. A private Storage bucket "receipts" (images and PDFs, up to 10 MB
--      each) that the app can read and write, like the rest of the data.
--   2. receipt_photos: one row per photo, with the shopping day
--      (receipt_date) it belongs to and where the file is in the bucket.
--      parsed / parsed_at are for reading receipts automatically later
--      and stay empty for now.
--
-- Non-destructive. Run in the Supabase SQL Editor. Safe to re-run.

-- ── 1. Storage bucket ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No login yet, so the app's key gets the same open access as the tables
-- (only to this bucket).
drop policy if exists "receipts_read" on storage.objects;
create policy "receipts_read" on storage.objects for select to anon, authenticated using (bucket_id = 'receipts');
drop policy if exists "receipts_add" on storage.objects;
create policy "receipts_add" on storage.objects for insert to anon, authenticated with check (bucket_id = 'receipts');
drop policy if exists "receipts_change" on storage.objects;
create policy "receipts_change" on storage.objects for update to anon, authenticated using (bucket_id = 'receipts') with check (bucket_id = 'receipts');
drop policy if exists "receipts_remove" on storage.objects;
create policy "receipts_remove" on storage.objects for delete to anon, authenticated using (bucket_id = 'receipts');

-- ── 2. Photos table ──────────────────────────────────────────────
create table if not exists receipt_photos (
  id uuid primary key default gen_random_uuid(),
  receipt_date date not null,
  path text not null,
  content_type text,
  file_name text,
  parsed jsonb,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists receipt_photos_date_idx on receipt_photos (receipt_date);

grant all on receipt_photos to anon, authenticated;

do $$
begin
  execute 'alter table receipt_photos enable row level security';
  execute 'drop policy if exists "public_access" on receipt_photos';
  execute 'create policy "public_access" on receipt_photos for all using (true) with check (true)';
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'receipt_photos'
  ) then
    execute 'alter publication supabase_realtime add table public.receipt_photos';
  end if;
end $$;

-- ── Check ────────────────────────────────────────────────────────
select
  exists (select 1 from storage.buckets where id = 'receipts') as bucket_ok,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'receipts_%') as storage_policies,
  (select count(*) from receipt_photos) as photos;
