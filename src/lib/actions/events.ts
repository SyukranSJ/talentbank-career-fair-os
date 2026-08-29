"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { getConflictCandidates, getEventById } from "@/lib/data/events";
import { slugify, validateEventInput, type RuleIssue } from "@/lib/domain/rules";
import { findConflicts, type Conflict } from "@/lib/domain/conflicts";
import { canTransition } from "@/lib/domain/availability";
import { fromKL, toDateKey, toTimeKey } from "@/lib/domain/time";
import type { ChangeSource, EventStatus } from "@/lib/domain/types";

/**
 * Every admin write goes through here.
 *
 * The shape is deliberately CHECK-then-COMMIT rather than one-shot:
 *   `checkEventProposal()` is a read-only dry run that returns errors,
 *   warnings and conflicts. The UI renders that as a preview. Only when the
 *   admin confirms does `createEvent` / `updateEvent` actually write.
 *
 * The AI Copilot calls exactly the same two functions, in the same order, with
 * no extra privileges. That is the entire reason the AI cannot corrupt data:
 * there is no other door into the events table from the application.
 */

export interface ProposalCheck {
  /** False when something is genuinely invalid and must be fixed. */
  ok: boolean;
  errors: RuleIssue[];
  /** Things worth a second look that the admin may override. */
  warnings: RuleIssue[];
  /** Overlapping events. NEVER blocking — see conflicts.ts for why. */
  conflicts: Conflict[];
  resolved?: {
    startAt: Date;
    endAt: Date;
    lastDate: string | null;
  };
}

/** Read-only dry run. Safe to call on every keystroke; changes nothing. */
export async function checkEventProposal(
  raw: unknown,
  eventId?: string,
): Promise<ProposalCheck> {
  await requireAdmin();

  const validation = validateEventInput(raw, new Date());
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: [], conflicts: [] };
  }

  const { startAt, endAt, lastDate } = validation.times;
  // The window must cover the whole run, not just day one.
  const candidates = await getConflictCandidates(
    startAt,
    lastDate ? fromKL(lastDate, "23:59") : endAt,
  );
  const conflicts = findConflicts(
    {
      eventId,
      startAt,
      endAt,
      lastDate,
      location: validation.value.location,
      state: validation.value.state,
    },
    candidates,
  );

  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    conflicts,
    resolved: { startAt, endAt, lastDate },
  };
}

/** Slugs must be unique; add a numeric suffix rather than failing the save. */
async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const base = slugify(title) || "event";

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    let query = supabase.from("events").select("id").eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface MutationResult {
  ok: boolean;
  message?: string;
  errors?: RuleIssue[];
  conflicts?: Conflict[];
  eventId?: string;
  slug?: string;
}

export interface WriteOptions {
  /** The admin has seen the conflicts and chosen to go ahead anyway. */
  acknowledgeConflicts?: boolean;
  reason?: string;
  source?: ChangeSource;
}

export async function createEvent(
  raw: unknown,
  options: WriteOptions = {},
): Promise<MutationResult> {
  const admin = await requireAdmin();

  const check = await checkEventProposal(raw);
  if (!check.ok) return { ok: false, errors: check.errors };

  // Conflicts do not block, but they must have been SEEN. Requiring an explicit
  // acknowledgement means nobody double-books a venue by accident, while the
  // team can still deliberately run two events at once.
  if (check.conflicts.length > 0 && !options.acknowledgeConflicts) {
    return { ok: false, conflicts: check.conflicts, message: "Scheduling conflict detected." };
  }

  const validation = validateEventInput(raw, new Date());
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("admin_create_event", {
      p_slug: await uniqueSlug(validation.value.title),
      p_title: validation.value.title,
      p_description: validation.value.description,
      p_start_at: validation.times.startAt.toISOString(),
      p_end_at: validation.times.endAt.toISOString(),
      p_last_date: validation.times.lastDate,
      p_location: validation.value.location,
      p_state: validation.value.state,
      p_category: validation.value.category,
      p_audience: validation.value.audience,
      p_status: validation.value.status,
      p_capacity: validation.value.capacity,
      p_changed_by: admin.email,
      p_source: options.source ?? "MANUAL",
    })
    .single();

  if (error) return { ok: false, message: error.message };

  const created = data as { id: string; slug: string };
  revalidateEverything(created.slug);
  return { ok: true, eventId: created.id, slug: created.slug, message: "Event created." };
}

export async function updateEvent(
  eventId: string,
  raw: unknown,
  options: WriteOptions = {},
): Promise<MutationResult> {
  const admin = await requireAdmin();

  const existing = await getEventById(eventId);
  if (!existing) return { ok: false, message: "That event no longer exists." };

  const check = await checkEventProposal(raw, eventId);
  if (!check.ok) return { ok: false, errors: check.errors };

  if (check.conflicts.length > 0 && !options.acknowledgeConflicts) {
    return { ok: false, conflicts: check.conflicts, message: "Scheduling conflict detected." };
  }

  const validation = validateEventInput(raw, new Date());
  if (!validation.ok) return { ok: false, errors: validation.errors };

  if (!canTransition(existing.status, validation.value.status)) {
    return {
      ok: false,
      message: `An event cannot go from ${existing.status} to ${validation.value.status}.`,
    };
  }

  // Capacity must never be set below the number of people already registered —
  // that would silently put the event over capacity.
  if (validation.value.capacity < existing.registeredCount) {
    return {
      ok: false,
      errors: [
        {
          field: "capacity",
          message: `${existing.registeredCount} people are already registered, so capacity cannot be lower than that.`,
        },
      ],
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("admin_update_event", {
      p_event_id: eventId,
      p_title: validation.value.title,
      p_description: validation.value.description,
      p_start_at: validation.times.startAt.toISOString(),
      p_end_at: validation.times.endAt.toISOString(),
      p_last_date: validation.times.lastDate,
      p_location: validation.value.location,
      p_state: validation.value.state,
      p_category: validation.value.category,
      p_audience: validation.value.audience,
      p_status: validation.value.status,
      p_capacity: validation.value.capacity,
      p_reason: options.reason ?? null,
      p_changed_by: admin.email,
      p_source: options.source ?? "MANUAL",
    })
    .single();

  if (error) return { ok: false, message: error.message };

  const updated = data as { id: string; slug: string };
  revalidateEverything(updated.slug);
  return { ok: true, eventId: updated.id, slug: updated.slug, message: "Event updated." };
}

/**
 * Move an event to a new date/time, keeping everything else the same.
 * Separate from `updateEvent` because it is a distinct operation to the events
 * team, needs its own confirmation copy, and always records a reason.
 */
export async function rescheduleEvent(
  eventId: string,
  next: { date: string; endDate?: string; startTime: string; endTime: string },
  options: WriteOptions = {},
): Promise<MutationResult> {
  const existing = await getEventById(eventId);
  if (!existing) return { ok: false, message: "That event no longer exists." };

  if (existing.status === "COMPLETED") {
    return { ok: false, message: "A completed event cannot be moved." };
  }

  return updateEvent(
    eventId,
    {
      title: existing.title,
      description: existing.description,
      date: next.date,
      endDate: next.endDate,
      startTime: next.startTime,
      endTime: next.endTime,
      location: existing.location,
      state: existing.state,
      category: existing.category,
      audience: existing.audience,
      capacity: existing.capacity,
      // Moving a live event marks it RESCHEDULED so people who already saw the
      // old date get a visible signal on the public page.
      status: existing.status === "UPCOMING" ? "RESCHEDULED" : existing.status,
    },
    options,
  );
}

export async function setEventStatus(
  eventId: string,
  status: EventStatus,
  reason: string,
  options: WriteOptions = {},
): Promise<MutationResult> {
  const admin = await requireAdmin();

  const existing = await getEventById(eventId);
  if (!existing) return { ok: false, message: "That event no longer exists." };

  if (!canTransition(existing.status, status)) {
    return { ok: false, message: `An event cannot go from ${existing.status} to ${status}.` };
  }

  if (status === "CANCELLED" && reason.trim().length < 5) {
    return {
      ok: false,
      errors: [
        {
          field: "reason",
          message: "Give a short reason — it is shown publicly on the event page.",
        },
      ],
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("admin_set_event_status", {
      p_event_id: eventId,
      p_status: status,
      p_reason: reason.trim() || null,
      p_changed_by: admin.email,
      p_source: options.source ?? "MANUAL",
    })
    .single();

  if (error) return { ok: false, message: error.message };

  const updated = data as { id: string; slug: string };
  revalidateEverything(updated.slug);
  return { ok: true, eventId: updated.id, slug: updated.slug, message: "Status updated." };
}

/** Convenience for the admin edit form: current values in form-field shape. */
export async function getEventFormValues(eventId: string) {
  await requireAdmin();
  const event = await getEventById(eventId);
  if (!event) return null;

  const startDate = toDateKey(event.startAt);

  return {
    title: event.title,
    description: event.description,
    date: startDate,
    endDate: event.lastDate ?? undefined,
    startTime: toTimeKey(event.startAt),
    endTime: toTimeKey(event.endAt),
    location: event.location,
    state: event.state,
    category: event.category,
    audience: event.audience,
    capacity: event.capacity,
    status: event.status,
  };
}

function revalidateEverything(slug: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/events");
  revalidatePath(`/events/${slug}`);
}
