-- Replace the substring test with a structural one: matching the literal
-- text '"encrypted":true' silently depends on JSON.stringify key order, so a
-- later refactor of crypto.js could start failing uploads for no visible
-- reason. Checking the parsed value is order- and whitespace-independent.
alter table public.backups drop constraint if exists backups_payload_is_encrypted;

alter table public.backups add constraint backups_payload_is_encrypted
  check (
    (payload::jsonb ->> 'encrypted') = 'true'
    and jsonb_typeof(payload::jsonb -> 'data') = 'string'
    and jsonb_typeof(payload::jsonb -> 'iv') = 'string'
    and jsonb_typeof(payload::jsonb -> 'salt') = 'string'
  );
