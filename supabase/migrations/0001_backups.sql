-- 0001_backups.sql - the table behind the app's optional encrypted cloud
-- backup (src/data/cloud.js).
--
-- This schema ALREADY EXISTS in the hosted project; the file is here so it is
-- under version control and can be recreated, not because it needs applying.
-- Everything below is idempotent for that reason.
--
-- Three properties carry the safety, and all three are deliberate:
--
--   1. RLS keyed on auth.uid(). The publishable key shipped in the public
--      bundle can therefore read nothing without a signed-in session.
--   2. NO UPDATE POLICY. The table is append-only, so a bad push can never
--      overwrite a good snapshot - it can only add a worse one alongside it,
--      which the app's truncation guard warns about before it happens.
--   3. `payload` is AES-GCM ciphertext produced by src/data/crypto.js on the
--      device. The database holds bytes it cannot read. The four metadata
--      columns are plaintext on purpose so the app can list snapshots without
--      asking for the passphrase; they carry a month count and a date range
--      and nothing else.
--
-- One setting cannot be expressed here and must be set in the dashboard:
-- Authentication -> "Allow new users to sign up" must be OFF once the
-- household's own account exists.

create table if not exists public.backups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  payload     text not null,
  month_count integer,
  first_month text,
  last_month  text,
  app_version text
);

alter table public.backups enable row level security;

-- Newest-first listing per user is the only read pattern the app has.
create index if not exists backups_user_created_idx
  on public.backups (user_id, created_at desc);

drop policy if exists backups_select_own on public.backups;
create policy backups_select_own on public.backups
  for select using ((select auth.uid()) = user_id);

drop policy if exists backups_insert_own on public.backups;
create policy backups_insert_own on public.backups
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists backups_delete_own on public.backups;
create policy backups_delete_own on public.backups
  for delete using ((select auth.uid()) = user_id);

-- Intentionally no UPDATE policy. See note 2 above.
