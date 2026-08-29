import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EventAudience,
  EventCategory,
  EventHistoryRecord,
  EventStatus,
  EventWithAvailability,
  RegistrationRecord,
} from "@/lib/domain/types";
import type { ConflictCandidate } from "@/lib/domain/conflicts";
import { fromKL, type DateKey } from "@/lib/domain/time";

/**
 * Data access. The ONLY place that knows what a database row looks like.
 * Everything above this layer works with domain objects whose dates are real
 * `Date` instances, so no component ever has to remember to parse a timestamp.
 */

/** Shape returned by the `event_availability` view. */
interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  last_date: string | null;
  location: string;
  state: string;
  category: EventCategory;
  audience: EventAudience;
  status: EventStatus;
  capacity: number;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  registered_count: number;
}

const EVENT_COLUMNS =
  "id,slug,title,description,start_at,end_at,last_date,location,state,category,audience,status,capacity,cancellation_reason,created_at,updated_at,registered_count";

function toEvent(row: EventRow): EventWithAvailability {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? "",
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    lastDate: row.last_date,
    location: row.location,
    state: row.state,
    category: row.category,
    audience: row.audience,
    status: row.status,
    capacity: row.capacity,
    cancellationReason: row.cancellation_reason,
    registeredCount: row.registered_count ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface EventFilters {
  category?: EventCategory | "ALL";
  audience?: EventAudience | "ALL";
  state?: string | "ALL";
  search?: string;
}

/** Every event, newest-first by start date. The calendar is a whole-year view,
 *  and ~50 events a year is small enough that paginating would add complexity
 *  for no user benefit. */
export async function listEvents(filters: EventFilters = {}): Promise<EventWithAvailability[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("event_availability").select(EVENT_COLUMNS).order("start_at");

  if (filters.category && filters.category !== "ALL") query = query.eq("category", filters.category);
  if (filters.audience && filters.audience !== "ALL") query = query.eq("audience", filters.audience);
  if (filters.state && filters.state !== "ALL") query = query.eq("state", filters.state);
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    query = query.or(`title.ilike.${term},location.ilike.${term},description.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load events: ${error.message}`);
  return (data as EventRow[]).map(toEvent);
}

export async function getEventBySlug(slug: string): Promise<EventWithAvailability | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_availability")
    .select(EVENT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load event: ${error.message}`);
  return data ? toEvent(data as EventRow) : null;
}

export async function getEventById(id: string): Promise<EventWithAvailability | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_availability")
    .select(EVENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load event: ${error.message}`);
  return data ? toEvent(data as EventRow) : null;
}

/**
 * Events that could possibly clash with a proposed slot.
 *
 * Deliberately fetches a WINDOW rather than the whole table: conflict checks
 * only care about events near the proposed time. A week either side comfortably
 * covers multi-day fairs while keeping the payload small.
 */
export async function getConflictCandidates(
  startAt: Date,
  endAt: Date,
): Promise<ConflictCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const windowStart = new Date(startAt.getTime() - 8 * 86_400_000).toISOString();
  const windowEnd = new Date(endAt.getTime() + 8 * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("events")
    .select("id,slug,title,location,state,start_at,end_at,last_date,status")
    .lte("start_at", windowEnd)
    .gte("end_at", windowStart);

  if (error) throw new Error(`Could not check for conflicts: ${error.message}`);

  return (data as Array<{
    id: string;
    slug: string;
    title: string;
    location: string;
    state: string;
    start_at: string;
    end_at: string;
    last_date: string | null;
    status: EventStatus;
  }>).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    location: row.location,
    state: row.state,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    lastDate: row.last_date,
    status: row.status,
  }));
}

/** Everything the Copilot is allowed to see about the schedule, for a date window. */
export async function getScheduleWindow(
  fromDate: DateKey,
  toDate: DateKey,
): Promise<EventWithAvailability[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_availability")
    .select(EVENT_COLUMNS)
    .gte("start_at", fromKL(fromDate, "00:00").toISOString())
    .lte("start_at", fromKL(toDate, "23:59").toISOString())
    .order("start_at");
  if (error) throw new Error(`Could not load schedule: ${error.message}`);
  return (data as EventRow[]).map(toEvent);
}

export async function getRegistrations(eventId: string): Promise<RegistrationRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id,event_id,name,email,user_type,created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load registrations: ${error.message}`);
  return (data as Array<{
    id: string;
    event_id: string;
    name: string;
    email: string;
    user_type: "CANDIDATE" | "EMPLOYER";
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    email: row.email,
    userType: row.user_type,
    createdAt: new Date(row.created_at),
  }));
}

export async function getEventHistory(eventId: string): Promise<EventHistoryRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_history")
    .select("id,event_id,action,previous_value,new_value,reason,changed_by,source,created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load history: ${error.message}`);
  return (data as Array<{
    id: string;
    event_id: string;
    action: EventHistoryRecord["action"];
    previous_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    reason: string | null;
    changed_by: string;
    source: EventHistoryRecord["source"];
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    reason: row.reason,
    changedBy: row.changed_by,
    source: row.source,
    createdAt: new Date(row.created_at),
  }));
}

/** Recent activity across all events, for the admin overview. */
export async function getRecentHistory(limit = 12): Promise<
  Array<EventHistoryRecord & { eventTitle: string; eventSlug: string }>
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_history")
    .select(
      "id,event_id,action,previous_value,new_value,reason,changed_by,source,created_at,events(title,slug)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load activity: ${error.message}`);

  return (data as Array<Record<string, unknown>>).map((row) => {
    const event = row.events as { title: string; slug: string } | null;
    return {
      id: row.id as string,
      eventId: row.event_id as string,
      action: row.action as EventHistoryRecord["action"],
      previousValue: row.previous_value as Record<string, unknown> | null,
      newValue: row.new_value as Record<string, unknown> | null,
      reason: row.reason as string | null,
      changedBy: row.changed_by as string,
      source: row.source as EventHistoryRecord["source"],
      createdAt: new Date(row.created_at as string),
      eventTitle: event?.title ?? "Deleted event",
      eventSlug: event?.slug ?? "",
    };
  });
}

/** Counts for the admin overview cards. */
export async function getRegistrationTotals(): Promise<{ total: number; byEvent: Map<string, number> }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("registrations").select("event_id");
  if (error) throw new Error(`Could not load registration totals: ${error.message}`);
  const byEvent = new Map<string, number>();
  for (const row of data as Array<{ event_id: string }>) {
    byEvent.set(row.event_id, (byEvent.get(row.event_id) ?? 0) + 1);
  }
  return { total: data.length, byEvent };
}
