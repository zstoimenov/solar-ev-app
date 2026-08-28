-- A CHECK constraint passes when its expression evaluates to NULL, not just
-- when it is true. The previous version compared `payload::jsonb ->>
-- 'encrypted'` directly, which is NULL for a payload that simply has no
-- `encrypted` key - i.e. exactly a plaintext state object, the one thing
-- this constraint exists to refuse. Collapsing the whole expression through
-- coalesce(..., false) makes "missing key" a rejection instead of a pass.
--
-- Verified against all six cases: plaintext state, encrypted:false, a true
-- flag with no data/iv/salt, a non-string data field, and a real envelope in
-- both key orders. Only the last two are accepted.
alter table public.backups drop constraint if exists backups_payload_is_encrypted;

alter table public.backups add constraint backups_payload_is_encrypted
  check (
    coalesce(
      (payload::jsonb ->> 'encrypted') = 'true'
      and jsonb_typeof(payload::jsonb -> 'data') = 'string'
      and jsonb_typeof(payload::jsonb -> 'iv') = 'string'
      and jsonb_typeof(payload::jsonb -> 'salt') = 'string',
      false
    )
  );
