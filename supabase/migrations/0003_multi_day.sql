-- =====================================================================
-- 0003 — daily hours for multi-day events
--
-- THE PROBLEM THIS FIXES
-- A two-day career fair runs 10:00-17:00 ON EACH DAY. It was stored as a
-- single interval from day one's opening to day two's closing, i.e. one
-- continuous 31-hour session. That is not what happens, and it had real
-- consequences: conflict detection reported an evening event on night one as
-- a HIGH venue clash, because the fair "occupied" the venue overnight.
--
-- THE CHANGE — one nullable column, and a redefinition of the two that exist:
--
--   start_at    first day's start        2026-10-01 10:00
--   end_at      FIRST day's end          2026-10-01 17:00   <- the daily window
--   last_date   last calendar day        2026-10-02         (null = single day)
--
-- Single-day events keep last_date NULL and unchanged instants, so nothing
-- about them changes. The existing CHECK (end_at > start_at) still holds,
-- because both instants are now on the same day.
--
-- Safe to re-run.
-- =====================================================================

alter table public.events
  add column if not exists last_date date;

comment on column public.events.last_date is
  'Last calendar day of a multi-day event (Malaysia time). NULL for single-day events. Daily hours are time(start_at)..time(end_at), repeated on every day from date(start_at) through last_date.';

-- ---------------------------------------------------------------------
-- Backfill: pull end_at back to the first day and record the last day.
--
-- Deterministic because every multi-day row currently ends at the closing
-- time of its final day, which IS the daily closing time. Guarded by the
-- date comparison so it cannot touch a single-day row, and idempotent
-- because after it runs no row satisfies the WHERE clause any more.
-- ---------------------------------------------------------------------
update public.events
set
  last_date = (end_at at time zone 'Asia/Kuala_Lumpur')::date,
  end_at = ((start_at at time zone 'Asia/Kuala_Lumpur')::date
             + (end_at at time zone 'Asia/Kuala_Lumpur')::time)
           at time zone 'Asia/Kuala_Lumpur'
where (end_at at time zone 'Asia/Kuala_Lumpur')::date
    > (start_at at time zone 'Asia/Kuala_Lumpur')::date;

-- A last day before the first day is nonsense; a last day equal to it is just
-- a single-day event and should be NULL instead.
--
-- Guarded, because a CHECK constraint may only use IMMUTABLE expressions and
-- `AT TIME ZONE` with a named zone is immutable on current PostgreSQL but has
-- not always been treated that way. If this server refuses it (42P17), the
-- migration reports it and carries on rather than failing outright: this is a
-- defence-in-depth constraint, and the same rule is enforced in the
-- application by validateEventInput() and in the seed script. Any other error
-- is re-raised, so a real problem is not swallowed.
alter table public.events drop constraint if exists events_last_date_after_start;

do $$
begin
  alter table public.events add constraint events_last_date_after_start
    check (
      last_date is null
      or last_date > (start_at at time zone 'Asia/Kuala_Lumpur')::date
    );
  raise notice 'events_last_date_after_start: added';
exception
  when invalid_object_definition then
    raise notice 'events_last_date_after_start: SKIPPED (%). Application validation still enforces it.', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------
-- When an event is genuinely over: the END of its LAST day.
-- Used by the registration cut-off, which would otherwise close a two-day
-- fair to registrations at the end of day one.
-- ---------------------------------------------------------------------
create or replace function public.event_finishes_at(
  p_start_at  timestamptz,
  p_end_at    timestamptz,
  p_last_date date
)
returns timestamptz
language sql
-- STABLE rather than IMMUTABLE: the result depends on the timezone database.
-- Nothing indexes this, so stable is sufficient and is the honest marking.
stable
as $$
  select case
    when p_last_date is null then p_end_at
    else (p_last_date + (p_end_at at time zone 'Asia/Kuala_Lumpur')::time)
         at time zone 'Asia/Kuala_Lumpur'
  end;
$$;

-- ---------------------------------------------------------------------
-- Availability view: expose the new column.
--
-- WHY last_date IS APPENDED AT THE END RATHER THAN PUT NEXT TO end_at:
-- CREATE OR REPLACE VIEW may only ADD columns to the END of an existing
-- view. It cannot insert one in the middle, because that renumbers every
-- column after it — Postgres reports this as
--
--   42P16: cannot change name of view column "location" to "last_date"
--
-- which is what happened when this file first placed last_date after end_at:
-- column 7 was "location" before and would have become "last_date" after.
--
-- The 16 existing columns are therefore reproduced below in their exact
-- current order, and last_date becomes column 17. Nothing selects from this
-- view positionally — the application asks for columns by name — so the
-- position carries no meaning beyond satisfying this rule.
--
-- The alternative, DROP VIEW then CREATE, would work and lose no data, but it
-- also drops the view's grants and would fail if anything ever came to depend
-- on it. Replacing in place is the smaller, safer operation.
-- ---------------------------------------------------------------------

create or replace view public.event_availability as
  select
    e.id,
    e.slug,
    e.title,
    e.description,
    e.start_at,
    e.end_at,
    e.location,
    e.state,
    e.category,
    e.audience,
    e.status,
    e.capacity,
    e.cancellation_reason,
    e.created_at,
    e.updated_at,
    coalesce(r.registered_count, 0)::int as registered_count,
    -- New column, appended last. See the note above.
    e.last_date
  from public.events e
  left join (
    select event_id, count(*) as registered_count
    from public.registrations
    group by event_id
  ) r on r.event_id = e.id;

comment on view public.event_availability is
  'Events plus a live registration COUNT. Intentionally runs with definer rights so the public can see remaining places without being able to read registrant rows.';

-- ---------------------------------------------------------------------
-- Registration rules: use the last day's end, not the first day's.
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

  -- A two-day fair is still open on the morning of day two.
  if v_event.status = 'COMPLETED'
     or public.event_finishes_at(v_event.start_at, v_event.end_at, v_event.last_date) < now() then
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
-- Admin mutations: accept and record last_date.
-- The previous signatures are dropped so no stale overload remains callable.
-- ---------------------------------------------------------------------
drop function if exists public.admin_create_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text, integer, text, text);
drop function if exists public.admin_update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, integer, text, text, text);

create or replace function public.admin_create_event(
  p_slug        text,
  p_title       text,
  p_description text,
  p_start_at    timestamptz,
  p_end_at      timestamptz,
  p_last_date   date,
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
    slug, title, description, start_at, end_at, last_date, location, state,
    category, audience, status, capacity
  ) values (
    p_slug, p_title, p_description, p_start_at, p_end_at, p_last_date, p_location, p_state,
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
  p_last_date   date,
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
    last_date   = p_last_date,
    location    = p_location,
    state       = p_state,
    category    = p_category,
    audience    = p_audience,
    status      = p_status,
    capacity    = p_capacity
  where id = p_event_id
  returning * into v_after;

  -- A change to any part of the schedule is a reschedule, including gaining or
  -- losing a day.
  v_action := case
    when v_before.start_at <> v_after.start_at
      or v_before.end_at <> v_after.end_at
      or v_before.last_date is distinct from v_after.last_date
      then 'RESCHEDULED'
    else 'UPDATED'
  end;

  insert into public.event_history (event_id, action, previous_value, new_value, reason, changed_by, source)
  values (p_event_id, v_action, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_changed_by, p_source);

  return v_after;
end;
$$;

-- ---------------------------------------------------------------------
-- Public registration: honour the event's audience.
--
-- An event marked "For candidates" must not accept an employer, and vice
-- versa. The form only offers the accepted role and the server action rejects
-- anything else, but register_for_event() is granted to `anon` and is
-- therefore callable directly with the public key — so the rule is enforced
-- here too. Everything else about this function is unchanged.
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
  v_email    text := lower(trim(p_email));
  v_name     text := trim(p_name);
  v_id       uuid;
  v_count    integer;
  v_capacity integer;
  v_audience text;
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

  -- Audience gate. A missing event falls through to the insert, where the
  -- trigger raises TB404 and the handler below reports NOT_FOUND.
  select audience into v_audience from public.events where id = p_event_id;

  if v_audience = 'CANDIDATES' and p_user_type <> 'CANDIDATE' then
    return jsonb_build_object('ok', false, 'code', 'AUDIENCE_CANDIDATES_ONLY');
  end if;

  if v_audience = 'EMPLOYERS' and p_user_type <> 'EMPLOYER' then
    return jsonb_build_object('ok', false, 'code', 'AUDIENCE_EMPLOYERS_ONLY');
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
-- Grants for the new/replaced objects.
-- ---------------------------------------------------------------------
grant select on public.event_availability to anon, authenticated;
grant execute on function public.register_for_event(uuid, text, text, text) to anon, authenticated;
grant execute on function public.event_finishes_at(timestamptz, timestamptz, date) to anon, authenticated;
grant execute on function public.admin_create_event(text, text, text, timestamptz, timestamptz, date, text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.admin_update_event(uuid, text, text, timestamptz, timestamptz, date, text, text, text, text, text, integer, text, text, text) to authenticated;
grant all on all functions in schema public to service_role;
