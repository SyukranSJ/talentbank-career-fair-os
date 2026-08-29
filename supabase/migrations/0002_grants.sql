-- =====================================================================
-- 0002 — table grants
--
-- Run this if you already ran 0001_schema.sql before the grants were
-- added to it. Safe to run more than once; GRANT is idempotent.
-- (0001_schema.sql now contains this same block, so a fresh project
--  only needs that one file)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Grants
--
-- WHY THIS SECTION EXISTS, AND WHY IT IS NOT OPTIONAL:
-- Postgres has TWO independent access layers, and both must allow an
-- operation for it to succeed:
--
--   1. GRANT  — "may this role touch this table at all?"
--   2. RLS    — "which ROWS of it may this role touch?"
--
-- A policy can only ever NARROW what a grant has already permitted. Without
-- the grants below, every query fails with `42501 permission denied` before
-- any policy is even consulted — which looks like working security but is
-- really a broken database.
--
-- Older Supabase projects auto-granted the whole `public` schema to anon and
-- authenticated. Newer projects do not, so these grants are written out
-- explicitly rather than assumed. Being explicit is better anyway: the
-- permission surface of the whole app is visible in one place.
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- events: world-readable, because a cancelled or completed fair must stay
-- visible to the public. Writes are granted to signed-in users but then
-- narrowed to events-team members by the events_admin_write policy.
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- registrations: NO grant to anon, deliberately. Anonymous sign-ups go
-- exclusively through register_for_event(), which is SECURITY DEFINER and so
-- runs with the owner's rights. That keeps the validation and the capacity
-- check on a single code path that the public cannot bypass.
grant select, delete on public.registrations to authenticated;

-- history: readable by admins, insertable by the admin_* functions (which run
-- as the caller). No update or delete grant to anyone, so the audit trail is
-- append-only in practice as well as in policy.
grant select, insert on public.event_history to authenticated;

grant select on public.admin_users to authenticated;

-- The aggregate view. Anonymous visitors get remaining-places counts here and
-- still have no grant at all on the underlying registrations table.
grant select on public.event_availability to anon, authenticated;

-- service_role is the trusted backend identity used by `npm run seed`.
-- It bypasses RLS by design and is never exposed to a browser.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Functions.
grant execute on function public.register_for_event(uuid, text, text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.admin_create_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.admin_update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, integer, text, text, text) to authenticated;
grant execute on function public.admin_set_event_status(uuid, text, text, text, text) to authenticated;
