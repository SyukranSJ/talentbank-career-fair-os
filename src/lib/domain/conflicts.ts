/**
 * Scheduling conflict detection.
 *
 * PRODUCT DECISION: a conflict is a WARNING, never a BLOCK.
 * Talentbank runs ~50 fairs a year across 12 states. Two events on the same day
 * is completely normal — a campus fair in Penang and a sector fair in KL do not
 * interfere with each other at all. What actually hurts is two events competing
 * for the same room, the same staff, or the same employers on the same morning.
 *
 * So instead of a boolean "is there a clash", conflicts are graded, and the
 * admin is always allowed to proceed with a clear picture of what they are
 * choosing. Blocking every overlap would train the team to work around the tool.
 */

import type { EventRecord } from "./types";
import { eventOccurrences, formatDailyHours, toDateKey, type DateKey } from "./time";

export type ConflictSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface Conflict {
  eventId: string;
  title: string;
  slug: string;
  location: string;
  startAt: Date;
  /** FIRST day's end — the daily window. */
  endAt: Date;
  /** Last day of the clashing event, or null if it is single-day. */
  lastDate: DateKey | null;
  severity: ConflictSeverity;
  /** One sentence an events coordinator can act on. */
  message: string;
}

/** Half-open interval overlap: events that merely touch (10-1pm, 1-5pm) do not conflict. */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Do two events share time on any day they both run?
 *
 * Multi-day fairs are compared day by day rather than as one long block. A
 * two-day fair that closes at 18:00 does not occupy the evening of night one,
 * so an event at 19:30 that night is not a clash — treating the stored range
 * as continuous reported exactly that as a HIGH venue conflict.
 */
export function occurrencesOverlap(
  a: { startAt: Date; endAt: Date; lastDate: DateKey | null },
  b: { startAt: Date; endAt: Date; lastDate: DateKey | null },
): boolean {
  const aDays = eventOccurrences(a.startAt, a.endAt, a.lastDate);
  const bDays = eventOccurrences(b.startAt, b.endAt, b.lastDate);

  for (const dayA of aDays) {
    for (const dayB of bDays) {
      // Different calendar days can never overlap, so skip the comparison.
      if (dayA.date !== dayB.date) continue;
      if (overlaps(dayA.start, dayA.end, dayB.start, dayB.end)) return true;
    }
  }
  return false;
}

/** Do two events fall on any shared calendar day (Malaysian time)? */
export function sharesADay(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return toDateKey(aStart) <= toDateKey(bEnd) && toDateKey(bStart) <= toDateKey(aEnd);
}

function normaliseLocation(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ConflictCandidate {
  id: string;
  slug: string;
  title: string;
  location: string;
  state: string;
  /** First day's start. */
  startAt: Date;
  /** FIRST day's end — the daily window, not the end of the whole run. */
  endAt: Date;
  /** Last calendar day, or null for a single-day event. */
  lastDate: DateKey | null;
  status: EventRecord["status"];
}

export interface ConflictCheckInput {
  /** Omitted when creating; set when editing or moving so an event never conflicts with itself. */
  eventId?: string;
  startAt: Date;
  endAt: Date;
  lastDate?: DateKey | null;
  location: string;
  state: string;
}

/**
 * Grades every candidate event against the proposed slot.
 *
 *   HIGH   — same venue, overlapping hours. Physically impossible.
 *   MEDIUM — same state, overlapping hours. Same regional team and the same
 *            employers get invited to both; a real operational problem.
 *   LOW    — different state, overlapping hours. Usually fine, worth a glance.
 *
 * Cancelled events are ignored: they hold no room and no staff.
 * Completed events are ignored: they are in the past by definition.
 */
export function findConflicts(
  input: ConflictCheckInput,
  candidates: ConflictCandidate[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const candidate of candidates) {
    if (input.eventId && candidate.id === input.eventId) continue;
    if (candidate.status === "CANCELLED" || candidate.status === "COMPLETED") continue;
    const clashes = occurrencesOverlap(
      { startAt: input.startAt, endAt: input.endAt, lastDate: input.lastDate ?? null },
      { startAt: candidate.startAt, endAt: candidate.endAt, lastDate: candidate.lastDate },
    );
    if (!clashes) continue;

    const sameVenue = normaliseLocation(candidate.location) === normaliseLocation(input.location);
    const sameState = normaliseLocation(candidate.state) === normaliseLocation(input.state);

    let severity: ConflictSeverity;
    let message: string;
    if (sameVenue) {
      severity = "HIGH";
      message = `Same venue (${candidate.location}) at an overlapping time. These two events cannot both run here.`;
    } else if (sameState) {
      severity = "MEDIUM";
      message = `Also in ${candidate.state} at an overlapping time. The same regional team and employers are likely committed to both.`;
    } else {
      severity = "LOW";
      message = `Overlapping hours, but in ${candidate.state} rather than ${input.state}. Usually fine to run in parallel.`;
    }

    conflicts.push({
      eventId: candidate.id,
      slug: candidate.slug,
      title: candidate.title,
      location: candidate.location,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      lastDate: candidate.lastDate,
      severity,
      message,
    });
  }

  const order: Record<ConflictSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return conflicts.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.startAt.getTime() - b.startAt.getTime(),
  );
}

export function highestSeverity(conflicts: Conflict[]): ConflictSeverity | null {
  if (conflicts.length === 0) return null;
  if (conflicts.some((c) => c.severity === "HIGH")) return "HIGH";
  if (conflicts.some((c) => c.severity === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

/**
 * THE ACKNOWLEDGEMENT RULE.
 *
 * A conflict never blocks a change — but it must have been SEEN. Every surface
 * that can commit a scheduling change asks this same question, so the rule
 * lives here rather than being re-implemented per component. It was previously
 * inlined in the admin form and the Copilot panel, and the Copilot's
 * "suggest a better date" cards were missed entirely: their apply button was
 * refused by the server with no way for the admin to satisfy the gate.
 *
 * Deliberately severity-independent. A LOW conflict still needs acknowledging,
 * because "these two are in different states, probably fine" is a judgement
 * for the events team to make, not for this function.
 */
export function requiresAcknowledgement(conflicts: Conflict[]): boolean {
  return conflicts.length > 0;
}

/** Whether a change may be committed given what the admin has confirmed. */
export function canApplyChange(conflicts: Conflict[], acknowledged: boolean): boolean {
  return !requiresAcknowledgement(conflicts) || acknowledged;
}

/** A single line summarising a conflict for the confirmation dialog. */
export function describeConflict(conflict: Conflict): string {
  return `${conflict.title} — ${formatDailyHours(conflict.startAt, conflict.endAt, conflict.lastDate)} at ${conflict.location}`;
}
