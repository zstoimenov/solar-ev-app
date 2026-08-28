-- Defence in depth. Supabase's default grants hand anon and authenticated
-- every privilege on a new table and rely on RLS alone to hold the line, so
-- a single mistake later - a policy with a wrong USING clause, or someone
-- disabling RLS to debug something - exposes read AND write at once.
--
-- Nothing in the app updates a row (snapshots are immutable) and nothing
-- truncates, so those privileges only widen the blast radius. TRUNCATE is
-- worth revoking specifically: unlike SELECT/INSERT/UPDATE/DELETE, row-level
-- security does not apply to it at all, so the grant would be the only thing
-- standing between anon and an empty table if it were ever reachable.
revoke update, truncate, references, trigger on public.backups from anon;
revoke update, truncate, references, trigger on public.backups from authenticated;

-- anon has no policy on this table and never should: every legitimate caller
-- is signed in. Removing the grants as well means an accidental permissive
-- policy is not enough on its own to open the table up.
revoke select, insert, delete on public.backups from anon;

-- Resulting privileges: anon none at all; authenticated exactly
-- SELECT, INSERT, DELETE, each still filtered by its auth.uid() policy.
