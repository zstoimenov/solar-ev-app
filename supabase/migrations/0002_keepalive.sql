-- 0002_keepalive.sql - the one thing an anonymous caller may do on this
-- project, and it is to ask what time it is.
--
-- WHY THIS EXISTS. A free Supabase project pauses after ~7 days of
-- inactivity, so `.github/workflows/supabase-keepalive.yml` knocks on the
-- door daily. It used to knock by selecting one id from public.backups,
-- which can never work: `anon` holds no privilege on that table (see
-- 0001_backups.sql - only `authenticated` is granted anything), so every run
-- of that job since it was added answered HTTP 401. The request was refused
-- at table privileges, one layer BEFORE the row-level security the app's
-- safety actually rests on.
--
-- Two ways out were rejected before this one:
--
--   - Granting `anon` select on public.backups so it returns an empty list.
--     That leaves the household's rows behind RLS alone rather than behind
--     privileges AND RLS. The keep-alive is not a good enough reason to
--     spend a layer of defence.
--   - Teaching the workflow to read the 401 as proof of life. It is proof -
--     a PAUSED project is refused earlier, by the API gateway, with 540 -
--     but a revoked key would then look identical to a healthy one, and a
--     monitor that cannot tell those apart is not worth running.
--
-- WHAT IT EXPOSES. Nothing. The function takes no argument, reads no table,
-- and returns now(). It cannot see a backup, count them, or reveal that any
-- exist. It is `security invoker`, so it carries no privilege of its own,
-- and `set search_path = ''` so nothing can be resolved out from under it.
-- Undoing it is one `drop function` away.

create or replace function public.keepalive()
  returns timestamptz
  language sql
  stable
  security invoker
  set search_path = ''
as $$ select now() $$;

comment on function public.keepalive() is
  'Liveness ping for the daily keep-alive workflow. Reads nothing, returns now().';

-- Explicit rather than inherited: `anon` and `authenticated` may call it,
-- and the grant is written down here rather than left to Supabase's default
-- privileges for new functions.
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- PostgREST caches the schema; without this the new function is a 404 until
-- something else makes it reload.
notify pgrst, 'reload schema';
