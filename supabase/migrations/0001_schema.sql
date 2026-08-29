-- =====================================================================
-- Talentbank Career Fair OS — schema
-- Run this in the Supabase SQL Editor (or `supabase db push`).
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.events (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  title               text not null check (char_length(title) between 3 and 120),
  description         text not null default '',
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  location            text not null,
  state               text not null,
  category            text not null check (category in (
                        'UNIVERSITY_CAMPUS_FAIR','SECTOR_FOCUSED_FAIR','PUBLIC_CAREER_FAIR',
                        'NETWORKING','MENTORING','SKILLS_WORKSHOP')),
  audience            text not null default 'EVERYONE'
                        check (audience in ('EVERYONE','CANDIDATES','EMPLOYERS')),
  status              text not null default 'UPCOMING' check (status in (
                        'UPCOMING','FULL','CANCELLED','COMPLETED','RESCHEDULED')),
  capacity            integer not null check (capacity > 0),
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- An event that ends before it begins is not a business rule, it is a
  -- corruption. The database refuses it no matter which code path asks.
  constraint events_end_after_start check (end_at > start_at)
);

create index if not exists events_start_at_idx on public.events (start_at);
create index if not exists events_status_idx on public.events (status);
-- Conflict detection scans by time range; this is the index it uses.
create index if not exists events_range_idx on public.events (start_at, end_at);

create table if not exists public.registrations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (email ~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$'),
  user_type  text not null check (user_type in ('CANDIDATE','EMPLOYER')),
  created_at timestamptz not null default now(),

  -- Duplicate registration guard. Emails are stored already-lowercased by
  -- register_for_event(), so a plain unique constraint is enough and stays
  -- index-friendly.
  constraint registrations_unique_per_event unique (event_id, email)
);

create index if not exists registrations_event_id_idx on public.registrations (event_id);

create table if not exists public.admin_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.event_history (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  action         text not null check (action in (
                   'CREATED','UPDATED','RESCHEDULED','CANCELLED','REOPENED','MARKED_FULL','COMPLETED')),
  previous_value jsonb,
  new_value      jsonb,
  reason         text,
  changed_by     text not null,
  -- Records whether a human typed this change or accepted a Copilot proposal.
  -- Makes "what did the AI actually do" answerable after the fact.
  source         text not null default 'MANUAL' check (source in ('MANUAL','COPILOT')),
  created_at     timestamptz not null default now()
);

create index if not exists event_history_event_id_idx on public.event_history (event_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. updated_at maintenance
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Availability view
--
-- registered_count is COMPUTED, never stored. A stored counter needs every
-- insert and delete to remember to update it; a count cannot drift.
--
-- WHY THIS VIEW IS SECURITY DEFINER (i.e. NOT security_invoker):
-- The public must see "17 places left", but must NOT see who registered.
-- Running the view with the owner's rights lets it aggregate `registrations`
-- while anonymous visitors still have no read policy on that table at all.
-- The view exposes a COUNT and nothing else — no names, no emails.
-- ---------------------------------------------------------------------

create or replace view public.event_availability as
  select
    e.id, e.slug, e.title, e.description, e.start_at, e.end_at,
    e.location, e.state, e.category, e.audience, e.status, e.capacity,
    e.cancellation_reason, e.created_at, e.updated_at,
    coalesce(r.registered_count, 0)::int as registered_count
  from public.events e
  left join (
    select event_id, count(*) as registered_count
    from public.registrations
    group by event_id
  ) r on r.event_id = e.id;

comment on view public.event_availability is
  'Events plus a live registration COUNT. Intentionally runs with definer rights so the public can see remaining places without being able to read registrant rows.';

-- ---------------------------------------------------------------------
-- 4. Admin identity helper
-- ---------------------------------------------------------------------

-- SECURITY DEFINER so that policies on admin_users cannot recurse into
-- themselves when this is called from inside those same policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users a where a.id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 5. Capacity invariant
--
-- This trigger is the LAST line of defence, not the first. The app checks
-- capacity too, but only the database can make the check race-proof: two
-- visitors clicking "Register" in the same millisecond both pass an
-- application-level check and both insert. Locking the event row here forces
-- the second transaction to wait for the first to commit before it counts.
-- ---------------------------------------------------------------------

create or replace function public.enforce_registration_rules()
returns trigger
language plpgsql
as $$
declare
  v_event   public.events%rowtype;
  v_taken   integer;
begin
  -- FOR UPDATE serialises concurrent registrations for the SAME event.
  select * into v_event from public.events where id = new.event_id for update;

  if not found then
    raise exception 'Event does not exist' using errcode = 'TB404';
  end if;

  if v_event.status = 'CANCELLED' then
    raise exception 'Event is cancelled' using errcode = 'TB409';
  end if;

  if v_event.status = 'COMPLETED' or v_event.end_at < now() then
    raise exception 'Event has already taken place' using errcode = 'TB410';
  end if;

  select count(*) into v_taken from public.registrations where event_id = new.event_id;

  if v_event.status = 'FULL' or v_taken >= v_event.capacity then
    raise exception 'Event is at capacity' using errcode = 'TB411';
  end if;

  return new;
end;
$$;

drop trigger if exists registrations_enforce_rules on public.registrations;
create trigger registrations_enforce_rules
  before insert on public.registrations
  for each row execute function public.enforce_registration_rules();

-- ---------------------------------------------------------------------
-- 6. Public registration entry point
--
-- SECURITY DEFINER because anonymous visitors deliberately have NO insert
-- policy on `registrations`. This function is the only door, it normalises
-- input, and it turns database errors into codes the UI can phrase nicely.
-- ---------------------------------------------------------------------

create or replace function public.register_for_event(
  p_event_id  uuid,
  p_name      text,
  p_email     text,
  p_user_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_name  text := trim(p_name);
  v_id    uuid;
  v_count integer;
  v_capacity integer;
begin
  if p_user_type not in ('CANDIDATE','EMPLOYER') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_USER_TYPE');
  end if;

  if v_email !~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EMAIL');
  end if;

  if char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
  end if;

  insert into public.registrations (event_id, name, email, user_type)
  values (p_event_id, v_name, v_email, p_user_type)
  returning id into v_id;

  select count(*), max(e.capacity) into v_count, v_capacity
  from public.registrations r
  join public.events e on e.id = r.event_id
  where r.event_id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'registration_id', v_id,
    'registered_count', v_count,
    'remaining', greatest(0, v_capacity - v_count)
  );

exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE');
  when sqlstate 'TB404' then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  when sqlstate 'TB409' then
    return jsonb_build_object('ok', false, 'code', 'CANCELLED');
  when sqlstate 'TB410' then
    return jsonb_build_object('ok', false, 'code', 'COMPLETED');
  when sqlstate 'TB411' then
    return jsonb_build_object('ok', false, 'code', 'FULL');
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Admin mutations
--
-- These are SECURITY INVOKER (the default), so row-level security still
-- applies: a non-admin calling them gets a permission error from Postgres,
-- not just from the application. Each one writes its audit row in the SAME
-- transaction as the change, so history can never be missing for a change
-- that actually happened.
-- ---------------------------------------------------------------------

create or replace function public.admin_create_event(
  p_slug        text,
  p_title       text,
  p_description text,
  p_start_at    timestamptz,
  p_end_at      timestamptz,
  p_location    text,
  p_state       text,
  p_category    text,
  p_audience    text,
  p_status      text,
  p_capacity    integer,
  p_changed_by  text,
  p_source      text default 'MANUAL'
)
returns public.events
language plpgsql
as $$
declare
  v_event public.events%rowtype;
begin
  insert into public.events (
    slug, title, description, start_at, end_at, location, state,
    category, audience, status, capacity
  ) values (
    p_slug, p_title, p_description, p_start_at, p_end_at, p_location, p_state,
    p_category, p_audience, p_status, p_capacity
  ) returning * into v_event;

  insert into public.event_history (event_id, action, previous_value, new_value, changed_by, source)
  values (v_event.id, 'CREATED', null, to_jsonb(v_event), p_changed_by, p_source);

  return v_event;
end;
$$;

create or replace function public.admin_update_event(
  p_event_id    uuid,
  p_title       text,
  p_description text,
  p_start_at    timestamptz,
  p_end_at      timestamptz,
  p_location    text,
  p_state       text,
  p_category    text,
  p_audience    text,
  p_status      text,
  p_capacity    integer,
  p_reason      text,
  p_changed_by  text,
  p_source      text default 'MANUAL'
)
returns public.events
language plpgsql
as $$
declare
  v_before public.events%rowtype;
  v_after  public.events%rowtype;
  v_action text;
begin
  select * into v_before from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event does not exist' using errcode = 'TB404';
  end if;

  update public.events set
    title       = p_title,
    description = p_description,
    start_at    = p_start_at,
    end_at      = p_end_at,
    location    = p_location,
    state       = p_state,
    category    = p_category,
    audience    = p_audience,
    status      = p_status,
    capacity    = p_capacity
  where id = p_event_id
  returning * into v_after;

  -- A change to the date/time is a reschedule, which is what the events team
  -- and anyone reading the audit log actually care about.
  v_action := case
    when v_before.start_at <> v_after.start_at or v_before.end_at <> v_after.end_at
      then 'RESCHEDULED'
    else 'UPDATED'
  end;

  insert into public.event_history (event_id, action, previous_value, new_value, reason, changed_by, source)
  values (p_event_id, v_action, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_changed_by, p_source);

  return v_after;
end;
$$;

create or replace function public.admin_set_event_status(
  p_event_id   uuid,
  p_status     text,
  p_reason     text,
  p_changed_by text,
  p_source     text default 'MANUAL'
)
returns public.events
language plpgsql
as $$
declare
  v_before public.events%rowtype;
  v_after  public.events%rowtype;
  v_action text;
begin
  select * into v_before from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event does not exist' using errcode = 'TB404';
  end if;

  update public.events set
    status = p_status,
    -- Cancelling stores the reason on the event so the public page can explain
    -- itself; any other transition clears it.
    cancellation_reason = case when p_status = 'CANCELLED' then p_reason else null end
  where id = p_event_id
  returning * into v_after;

  v_action := case p_status
    when 'CANCELLED' then 'CANCELLED'
    when 'FULL'      then 'MARKED_FULL'
    when 'COMPLETED' then 'COMPLETED'
    when 'UPCOMING'  then case when v_before.status = 'CANCELLED' then 'REOPENED' else 'UPDATED' end
    else 'UPDATED'
  end;

  insert into public.event_history (event_id, action, previous_value, new_value, reason, changed_by, source)
  values (p_event_id, v_action, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_changed_by, p_source);

  return v_after;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Row Level Security
--
-- Default deny. Anonymous visitors can read events and nothing else; they
-- cannot even see that `registrations` has rows. Admin writes are gated on
-- membership of admin_users, checked by Postgres itself — so a bug in a
-- Next.js route handler cannot become a data breach on its own.
-- ---------------------------------------------------------------------

alter table public.events         enable row level security;
alter table public.registrations  enable row level security;
alter table public.event_history  enable row level security;
alter table public.admin_users    enable row level security;

-- events: world-readable (a cancelled fair must stay visible), admin-writable.
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select using (true);

drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- registrations: NO anonymous access of any kind. Inserts happen only through
-- register_for_event(), which is SECURITY DEFINER and therefore bypasses this.
drop policy if exists registrations_admin_read on public.registrations;
create policy registrations_admin_read on public.registrations
  for select using (public.is_admin());

drop policy if exists registrations_admin_delete on public.registrations;
create policy registrations_admin_delete on public.registrations
  for delete using (public.is_admin());

-- history: admin-only, append-only in practice (no update/delete policy exists).
drop policy if exists event_history_admin_read on public.event_history;
create policy event_history_admin_read on public.event_history
  for select using (public.is_admin());

drop policy if exists event_history_admin_insert on public.event_history;
create policy event_history_admin_insert on public.event_history
  for insert with check (public.is_admin());

-- admin_users: a signed-in admin can see the team; nobody else sees anything.
drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read on public.admin_users
  for select using (auth.uid() = id or public.is_admin());

-- ---------------------------------------------------------------------
-- 9. Grants
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
