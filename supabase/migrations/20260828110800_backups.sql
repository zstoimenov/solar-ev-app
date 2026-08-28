-- Cloud backup slot for the Solar/EV ROI PWA.
--
-- The app stays local-first: IndexedDB remains the source of truth and this
-- table only ever holds an OPAQUE CIPHERTEXT envelope produced by
-- src/data/crypto.js (AES-GCM, PBKDF2-derived key, encrypted in the browser
-- before upload). The server never sees a passphrase and cannot decrypt a
-- row, which is the condition CLAUDE.md sets for putting this data anywhere
-- off-device.
--
-- Snapshots are append-only rather than one row per user: overwriting a
-- single slot would reintroduce exactly the truncated-backup data loss the
-- app's local export guard exists to prevent. The client prunes to the most
-- recent few after each upload.

create table if not exists public.backups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),

  -- The encrypted envelope, stored as text. Never plaintext state - see the
  -- check constraint, which is a server-side backstop against a client bug.
  payload      text not null,

  -- Plaintext metadata, deliberately limited to what the restore picker has
  -- to show before decryption (which month range, how many months, which app
  -- version wrote it). Nothing here is household energy or financial data.
  month_count  integer,
  first_month  text,
  last_month   text,
  app_version  text,

  constraint backups_payload_is_encrypted check (payload like '%"encrypted":true%'),
  constraint backups_payload_size check (octet_length(payload) <= 20 * 1024 * 1024)
);

create index if not exists backups_user_created_idx
  on public.backups (user_id, created_at desc);

alter table public.backups enable row level security;

-- One policy per action, all keyed on auth.uid(). Wrapped in a scalar
-- subselect so Postgres evaluates auth.uid() once per statement instead of
-- once per row.
create policy "backups_select_own" on public.backups
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "backups_insert_own" on public.backups
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "backups_delete_own" on public.backups
  for delete to authenticated using ((select auth.uid()) = user_id);

-- No update policy on purpose: a snapshot is immutable once written. The
-- client replaces by inserting a new row and pruning old ones.
