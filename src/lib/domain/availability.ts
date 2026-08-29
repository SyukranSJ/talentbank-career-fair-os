/**
 * Capacity and status logic.
 *
 * THE ONE IDEA THAT MATTERS HERE:
 * `event.status` records what the events team *decided*. It is not the whole
 * truth about what a visitor should see. An event whose 200 seats are taken is
 * "full" whether or not anyone clicked a button, and an event whose end time
 * has passed is "completed" whether or not anyone remembered to tidy up.
 *
 * So the stored status is combined with live facts (registration count, the
 * current time) to produce a *derived* status, and only the derived status is
 * ever rendered or used to decide whether registration is open.
 *
 * The alternative — a `registered_count` column and a nightly job to flip
 * statuses — needs a counter that can drift, and a cron job that can not run.
 */

import type { EventAudience, EventStatus, EventWithAvailability, UserType } from "./types";
import { eventFinishesAt } from "./time";

export interface Availability {
  capacity: number;
  registered: number;
  /** Never negative, even if capacity were lowered below the current count. */
  remaining: number;
  /** 0-100, clamped. */
  percentFull: number;
  isAtCapacity: boolean;
  /** Fewer than 10% of seats, or fewer than 10 seats, left. */
  isAlmostFull: boolean;
}

export function getAvailability(event: EventWithAvailability): Availability {
  const capacity = Math.max(0, event.capacity);
  const registered = Math.max(0, event.registeredCount);
  const remaining = Math.max(0, capacity - registered);
  const percentFull = capacity === 0 ? 100 : Math.min(100, Math.round((registered / capacity) * 100));
  return {
    capacity,
    registered,
    remaining,
    percentFull,
    isAtCapacity: registered >= capacity,
    isAlmostFull: remaining > 0 && (remaining <= 10 || percentFull >= 90),
  };
}

/**
 * The status a visitor actually sees. Precedence matters and is deliberate:
 *
 *   CANCELLED  wins over everything — a cancelled event is cancelled even if
 *              it is in the past and even if it was full.
 *   COMPLETED  next — a finished event cannot be "full", it is simply over.
 *   FULL       next — either the team forced it, or the seats ran out.
 *   RESCHEDULED shows only while the event is still ahead and has room, so
 *              visitors who saw the old date get a visible signal.
 */
export function deriveStatus(event: EventWithAvailability, now: Date): EventStatus {
  if (event.status === "CANCELLED") return "CANCELLED";
  // endAt is only the FIRST day's end, so a two-day fair would otherwise read
  // as completed halfway through. eventFinishesAt() gives the last day's end.
  const finishesAt = eventFinishesAt(event.startAt, event.endAt, event.lastDate);
  if (event.status === "COMPLETED" || finishesAt.getTime() < now.getTime()) return "COMPLETED";
  if (event.status === "FULL" || getAvailability(event).isAtCapacity) return "FULL";
  if (event.status === "RESCHEDULED") return "RESCHEDULED";
  return "UPCOMING";
}

/** The single question the registration form and the API both ask. */
export function isRegistrationOpen(event: EventWithAvailability, now: Date): boolean {
  const status = deriveStatus(event, now);
  return status === "UPCOMING" || status === "RESCHEDULED";
}

/** Why registration is closed, phrased for a visitor rather than a developer. */
export function registrationClosedReason(
  event: EventWithAvailability,
  now: Date,
): string | null {
  const status = deriveStatus(event, now);
  switch (status) {
    case "CANCELLED":
      return event.cancellationReason
        ? `This event has been cancelled. ${event.cancellationReason}`
        : "This event has been cancelled and is no longer taking registrations.";
    case "COMPLETED":
      return "This event has already taken place.";
    case "FULL":
      return "This event has reached capacity. All places have been taken.";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- *
 * Who may register
 *
 * An event's audience is not decorative. A campus fair marked "For candidates"
 * exists so students are not competing for space with recruiters, and an
 * employer briefing marked "For employers" is not open to jobseekers. The
 * audience therefore decides which roles may register, and this is the single
 * definition of that rule — used by the form to decide what to show, by the
 * server action to decide what to accept, and by the database function as a
 * last line of defence.
 * -------------------------------------------------------------------------- */

/** The registration roles an event's audience permits. */
export function allowedUserTypes(audience: EventAudience): UserType[] {
  switch (audience) {
    case "CANDIDATES":
      return ["CANDIDATE"];
    case "EMPLOYERS":
      return ["EMPLOYER"];
    case "EVERYONE":
    default:
      return ["CANDIDATE", "EMPLOYER"];
  }
}

export function isUserTypeAllowed(audience: EventAudience, userType: UserType): boolean {
  return allowedUserTypes(audience).includes(userType);
}

/** Why a role was refused, phrased for the person who chose it. */
export function audienceRestrictionMessage(audience: EventAudience): string | null {
  switch (audience) {
    case "CANDIDATES":
      return "This event is for candidates only.";
    case "EMPLOYERS":
      return "This event is for employers only.";
    default:
      return null;
  }
}

/**
 * Which stored statuses an admin may move an event to from where it is now.
 * Keeps the UI honest (we grey out impossible options) and is re-checked
 * server-side so a crafted request cannot skip it.
 */
const ALLOWED_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  UPCOMING: ["FULL", "CANCELLED", "COMPLETED", "RESCHEDULED"],
  RESCHEDULED: ["UPCOMING", "FULL", "CANCELLED", "COMPLETED"],
  FULL: ["UPCOMING", "CANCELLED", "COMPLETED"],
  // A cancelled event can be reinstated — teams change their minds — but it
  // cannot jump straight to "full" without going back to upcoming first.
  CANCELLED: ["UPCOMING"],
  // Completed is terminal. Re-opening history would corrupt the audit trail.
  COMPLETED: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: EventStatus): EventStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
